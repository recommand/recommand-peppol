/**
 * A single status line for the regression run.
 *
 * Bun's default reporter prints every passing test. At a thousand recordings
 * that buries the one or two failures the run is for. Combined with
 * `--only-failures`, this replaces those lines with a count, a bar and an
 * estimate of how long is left.
 *
 * The line is written to `/dev/tty`, not stdout or stderr. Bun captures those
 * per test and prints each write as a new line, so a `\r` rewrite on stderr
 * still scrolls. The terminal device is outside that capture, so the same
 * line can be overwritten. Failures still print in full — the line is parked
 * with a newline first so they are not overwritten — and bun's own summary
 * at the end is left alone.
 */

import { openSync } from "node:fs";
import { WriteStream } from "node:tty";
import { RECORDINGS_ROOT } from "./recordings";

const BAR_WIDTH = 20;
const PREFIX = `${RECORDINGS_ROOT}/`;

export type Progress = {
  /** Show work in progress without counting a result. */
  begin(name: string): void;
  pass(): void;
  fail(name: string): void;
  /** Leave the status line on screen so later output is not overwritten. */
  finish(): void;
};

type StatusOut = Pick<NodeJS.WriteStream, "write"> & {
  columns?: number;
};

export function createProgress(
  total: number,
  out: StatusOut = openTerminal(),
): Progress {
  let completed = 0;
  let failed = 0;
  let startedAt = 0;
  let finished = false;

  function markStarted(): void {
    if (startedAt === 0) startedAt = Date.now();
  }

  function render(name: string | undefined, newline: boolean): void {
    const text = clip(compose(name), lineWidth());
    out.write(`\r\x1b[2K${text}${newline ? "\n" : ""}`);
  }

  function lineWidth(): number {
    return Math.max(20, (out.columns ?? 80) - 1);
  }

  function compose(name: string | undefined): string {
    const width = String(Math.max(total, 1)).length;
    const current = String(completed).padStart(width);
    const failBit = failed > 0 ? `  ${failed} fail` : "";
    const head = `  ${current}/${total}  ${bar(completed, total)}${failBit}${eta()}`;
    if (!name) return head;
    const room = lineWidth() - head.length - 2;
    if (room < 12) return head;
    return `${head}  ${shorten(name, room)}`;
  }

  function eta(): string {
    if (startedAt === 0) return "";
    const elapsed = Date.now() - startedAt;
    if (completed >= total || finished) return `  ${formatDuration(elapsed)}`;
    if (completed === 0 || elapsed < 1_000) return "";
    const remaining = (elapsed / completed) * (total - completed);
    return `  ${formatDuration(remaining)} left`;
  }

  return {
    begin(name) {
      render(name, false);
    },
    pass() {
      markStarted();
      completed++;
      render(undefined, false);
    },
    fail(name) {
      markStarted();
      completed++;
      failed++;
      render(name, true);
    },
    finish() {
      finished = true;
      render(undefined, true);
    },
  };
}

/**
 * The real terminal, even when bun has replaced stdout and stderr with pipes
 * that capture test output. Falls back to stderr when there is no terminal
 * (piped CI logs).
 */
function openTerminal(): StatusOut {
  try {
    return new WriteStream(openSync("/dev/tty", "w"));
  } catch {
    return process.stderr;
  }
}

function bar(done: number, total: number): string {
  if (total <= 0) return `[${" ".repeat(BAR_WIDTH)}]`;
  const filled = Math.min(
    BAR_WIDTH,
    Math.max(done > 0 ? 1 : 0, Math.round((done / total) * BAR_WIDTH)),
  );
  if (filled === 0) return `[${" ".repeat(BAR_WIDTH)}]`;
  if (filled === BAR_WIDTH) return `[${"=".repeat(BAR_WIDTH)}]`;
  return `[${"=".repeat(filled - 1)}>${" ".repeat(BAR_WIDTH - filled)}]`;
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
}

function shorten(name: string, max: number): string {
  const trimmed = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
  if (trimmed.length <= max) return trimmed;
  if (max < 2) return trimmed.slice(0, max);
  return `…${trimmed.slice(-(max - 1))}`;
}

function clip(text: string, max: number): string {
  if (max <= 1 || text.length <= max) return text;
  return text.slice(0, max);
}
