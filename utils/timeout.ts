// Reject if `promise` does not settle within `ms`. Note this stops *waiting* for
// the result; it does not cancel the underlying request (the socket may linger
// until the runtime tears it down). That is enough to keep callers responsive,
// e.g. when a network request hangs indefinitely.
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
