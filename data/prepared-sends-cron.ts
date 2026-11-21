import { Cron } from "croner";
import { Logger } from "@recommand/lib/logger";
import { purgeExpiredPreparedSends } from "./prepared-sends";

let initialized = false;

/** Every hour, deletes the prepared documents nothing can send anymore, which hold a whole document each. */
export const initializePreparedSendCronJobs = async (logger: Logger) => {
  if (initialized || process.env.RUN_CRON !== "true") {
    return;
  }

  initialized = true;

  new Cron("0 * * * *", { name: "peppol.prepared-sends.purge" }, async () => {
    try {
      await purgeExpiredPreparedSends();
    } catch (error) {
      logger.error(
        `Failed to purge expired prepared sends: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
};
