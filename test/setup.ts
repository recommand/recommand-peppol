import { afterAll, beforeAll } from "bun:test";
import { stopDevServer, ensureServerRunning } from "./utils/dev-server";
import { SKIP_E2E } from "./utils/skip-e2e";

beforeAll(async () => {
    if (SKIP_E2E) return;
    await ensureServerRunning();
}, 180_000);

afterAll(async () => {
    if (SKIP_E2E) return;
    await stopDevServer();
}, 30_000);
