// Maximum number of S3 requests (and per-document work that depends on them,
// such as archive building) to run at once.
export const S3_REQUEST_CONCURRENCY = 10;

// Run an async function over items with a bounded number of concurrent
// executions, so large batches (e.g. S3 requests for thousands of documents)
// never all fire at once and overwhelm the server or the remote service.
// Results preserve input order.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  // Shared cursor pointing at the next item no worker has picked up yet.
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  // Start `workerCount` workers that run in parallel. Each worker repeatedly
  // claims the next unprocessed item (by reading and advancing the shared
  // cursor) and processes it, until every item has been claimed. Because at
  // most `workerCount` workers are ever running, no more than `limit` calls to
  // `fn` are in flight at once. Reading `cursor++` is safe without locking
  // because JS runs this synchronous step on a single thread — the await only
  // yields *after* the index has been claimed.
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return; // nothing left to do; this worker exits
      results[index] = await fn(items[index], index);
    }
  });

  // Wait for all workers to drain the queue.
  await Promise.all(workers);
  return results;
}
