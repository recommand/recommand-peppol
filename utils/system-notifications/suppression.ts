/**
 * Best-effort suppression of repeated operational alerts.
 *
 * Some conditions are reported by many rows at once: one filing carries many events,
 * and a single answer about that filing reaches every one of them. Sending a message
 * per row buries the one thing support has to act on.
 *
 * The state lives in the process. It bounds how often the same condition is reported
 * by one instance, and it is not a record of what was sent: several instances each
 * report once, and a restart lets the next occurrence through again. Anything that
 * must be exactly once needs durable state, which this deliberately is not.
 */
export type AlertSuppressor = {
  /** True when this key has not been reported within the interval, and claims the slot. */
  shouldSend: (key: string, now?: Date) => boolean;
};

export function createAlertSuppressor({
  intervalMs,
  maxEntries = 500,
}: {
  intervalMs: number;
  maxEntries?: number;
}): AlertSuppressor {
  const sentAt = new Map<string, number>();

  return {
    shouldSend(key: string, now: Date = new Date()): boolean {
      const timestamp = now.getTime();
      const last = sentAt.get(key);
      if (last !== undefined && timestamp - last < intervalMs) {
        return false;
      }

      // Entries older than the interval can never suppress anything again, so they are
      // dropped before the map is allowed to grow.
      for (const [entry, at] of sentAt) {
        if (timestamp - at >= intervalMs) {
          sentAt.delete(entry);
        }
      }
      // A flood of distinct keys would otherwise keep every one of them. Oldest first,
      // which is insertion order for a Map.
      while (sentAt.size >= maxEntries) {
        const oldest = sentAt.keys().next();
        if (oldest.done) {
          break;
        }
        sentAt.delete(oldest.value);
      }

      sentAt.set(key, timestamp);
      return true;
    },
  };
}
