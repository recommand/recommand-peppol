import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Kept in sync with the fallback in e2e/helpers.ts, which imports it. */
export const DEFAULT_HOST = "http://localhost:3000";

/** A single probe may not hang the run: the server is polled, not waited on. */
const PROBE_TIMEOUT_MS = 5_000;
/** A cold start runs migrations for every package and boots Vite. */
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
let serverProcess: ChildProcess | null = null;
let serverExited = false;
let serverReady = false;
let serverStartedByTests = false;
/** Single flight: concurrent callers wait for the start already in progress. */
let pendingStart: Promise<void> | null = null;
/** Set once a server the tests started never came up. See ensureServerRunning. */
let startFailure: Error | null = null;
/** Why the last probe failed, so a timeout can say what it was looking at. */
let lastProbeError: string | null = null;
let cleanupRegistered = false;

function normaliseHost(host: string): string {
  return host.replace(/\/+$/, "");
}

/**
 * The server the tests talk to. Falls back to the default instead of doing
 * nothing when ETE_UNIT_TEST_HOST is unset, because that is the host the test
 * helpers use in that case too.
 */
export function getTestHost(): string {
  return normaliseHost(process.env.ETE_UNIT_TEST_HOST || DEFAULT_HOST);
}

function getProjectRoot(): string {
  let currentDir = import.meta.dir;
  while (currentDir !== path.dirname(currentDir)) {
    const packageJsonPath = path.join(currentDir, "package.json");
    // A .env file is the usual marker of the root, but it is absent when the
    // environment is injected by a secret manager, so also accept the
    // directory that holds the framework package.
    const envPath = path.join(currentDir, ".env");
    const frameworkPath = path.join(currentDir, "packages", "framework");
    if (
      existsSync(packageJsonPath) &&
      (existsSync(envPath) || existsSync(frameworkPath))
    ) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return process.cwd();
}

/**
 * Whether something is already listening on the host.
 *
 * Any HTTP answer counts, error statuses included: the question is whether a
 * server holds the port, not whether it is happy. It is asked on an API path
 * because in development `/` is proxied to Vite (see packages/framework/
 * index.ts), so probing `/` reports on the frontend and answers 500 while Vite
 * is still starting — which would make the tests start a second server on a
 * port that is already taken.
 */
/** Not a network condition, so it is thrown rather than polled. */
class BrokenFetchError extends Error {}

export async function isServerListening(host: string): Promise<boolean> {
  const url = `${normaliseHost(host)}/api/__probe`;
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Bun runs every test file in one process, so a file that replaces the
    // global fetch and does not put it back breaks every file after it. Worth
    // naming, because the symptom is otherwise a server that looks unreachable
    // however healthy it is, and no amount of waiting fixes it.
    if (!(response instanceof Response)) {
      throw new BrokenFetchError(
        `fetch("${url}") returned ${response} instead of a Response. Something in this run has replaced the global fetch and not restored it: a spyOn(globalThis, "fetch") reset with mockReset() leaves a stub that returns undefined, where mockRestore() would put the real fetch back.`,
      );
    }
    // Read the body so the connection is released rather than left dangling.
    await response.arrayBuffer();
    lastProbeError = null;
    return true;
  } catch (error) {
    if (error instanceof BrokenFetchError) {
      throw error;
    }
    // Kept so a run that times out can say what the probe actually hit —
    // "connection refused" and "timed out" mean very different things.
    lastProbeError = `GET ${url} failed: ${(error as Error).message}`;
    return false;
  }
}

/**
 * Whether the server is ready to be tested against. Defaults to "something
 * answers on the host", but a suite can pass a check of its own, for example
 * one that fetches the record its tests need.
 */
export type ReadinessCheck = (host: string) => Promise<boolean>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(
  host: string,
  isReady: ReadinessCheck,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Fail immediately rather than polling a port nothing will ever answer on,
    // which is what happens when the server cannot boot (a bad DATABASE_URL, a
    // port already in use, a failed migration).
    if (serverStartedByTests && serverExited) {
      throw new Error("The dev server exited before it became ready.");
    }
    if (await isReady(host)) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Server at ${host} did not become ready after ${Math.round(timeoutMs / 1000)} seconds.\n` +
      `${lastProbeError ?? "The readiness check never passed."}`,
  );
}

/**
 * Kills whatever is left of the server when the test process goes away, so a
 * crash or a Ctrl-C cannot leave an orphan holding port 3000 that the next run
 * then mistakes for a server of its own.
 */
function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const killGroup = () => {
    const pid = serverProcess?.pid;
    if (!pid || !serverStartedByTests) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  };

  process.on("exit", killGroup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      killGroup();
      process.exit(1);
    });
  }
}

async function startDevServer(): Promise<void> {
  if (serverProcess) {
    return;
  }

  const projectRoot = getProjectRoot();
  const frameworkPath = path.join(projectRoot, "packages/framework");
  const envFile = path.join(projectRoot, ".env");

  // Omitted when absent, which is the case when the environment is injected by
  // a secret manager (`op run -- bun test`). Values already in the environment
  // win over the file either way, so the two can be combined.
  const args = ["--cwd", frameworkPath];
  if (existsSync(envFile)) {
    args.push("--env-file", envFile);
  }
  args.push("dev");

  serverExited = false;

  serverProcess = spawn("bun", args, {
    cwd: projectRoot,
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
    shell: false,
    // `dev` is `concurrently`, which runs the API and Vite as grandchildren.
    // Its own process group is what makes it possible to kill all of them at
    // once; without it the group is the test runner's, `kill(-pid)` fails with
    // ESRCH, and the grandchildren survive and keep holding the port.
    detached: true,
  });

  if (!serverProcess.pid) {
    serverProcess = null;
    throw new Error("Failed to start dev server: no PID assigned");
  }

  serverStartedByTests = true;
  registerCleanup();

  serverProcess.on("exit", () => {
    serverExited = true;
    serverReady = false;
  });
}

export async function stopDevServer(): Promise<void> {
  const pid = serverProcess?.pid;

  if (!serverProcess || !serverStartedByTests || !pid) {
    // A server that was already running when the tests started is left alone.
    serverProcess = null;
    serverStartedByTests = false;
    serverReady = false;
    return;
  }

  console.log(`Stopping dev server (PID: ${pid})...`);
  const processRef = serverProcess;

  const exited = new Promise<void>((resolve) => {
    if (serverExited) {
      resolve();
      return;
    }
    processRef.once("exit", () => resolve());
  });

  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      // Negative pid: the whole group, so `concurrently` and the API and Vite
      // processes it spawned all go, not just the wrapper.
      process.kill(-pid, signal);
    } catch {
      // Already gone.
    }
  };

  try {
    signalGroup("SIGTERM");
    const timedOut = await Promise.race([
      exited.then(() => false),
      sleep(5_000).then(() => true),
    ]);
    if (timedOut) {
      signalGroup("SIGKILL");
      await Promise.race([exited, sleep(2_000)]);
    }
  } finally {
    serverProcess = null;
    serverStartedByTests = false;
    serverReady = false;
    console.log("Dev server stopped");
  }
}

export async function ensureServerRunning(
  host?: string,
  isReady: ReadinessCheck = isServerListening,
): Promise<void> {
  const testHost = normaliseHost(host || getTestHost());

  // A server that never came up will not come up for the next hook either, and
  // `bun run --hot` keeps a process that failed to boot alive, so nothing else
  // notices. Reporting the first failure again turns what would be one timeout
  // per suite into a single one for the run.
  if (startFailure) {
    throw startFailure;
  }

  // Another caller is already booting the server; wait for it before deciding
  // anything, so two hooks can never spawn two servers on the same port.
  while (pendingStart) {
    await pendingStart;
  }

  if (serverReady && (await isReady(testHost))) {
    return;
  }
  serverReady = false;

  pendingStart = (async () => {
    if (!(await isServerListening(testHost))) {
      console.log("Starting dev server for tests...");
      await startDevServer();
    }

    try {
      // Waited for in both cases: a server that is already listening may still
      // be booting, and its routes are not usable until it finishes.
      await waitForServer(testHost, isReady);
    } catch (error) {
      // Only a host that answers nothing at all is hopeless. A server that is
      // up but failed a suite's own readiness check is left running, because
      // the next suite may well be satisfied by it.
      if (!(await isServerListening(testHost))) {
        startFailure = error as Error;
        await stopDevServer();
      }
      throw error;
    }

    console.log(`Dev server is ready at ${testHost}`);
    serverReady = true;
  })();

  try {
    await pendingStart;
  } finally {
    pendingStart = null;
  }
}
