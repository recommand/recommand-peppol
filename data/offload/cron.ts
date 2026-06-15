import { Cron } from "croner";
import { Logger } from "@recommand/lib/logger";
import { isS3Enabled } from "@core/lib/s3";
import { offloadOldDocuments } from "./index";

export async function initializeOffloadCronJobs(logger: Logger): Promise<void> {
  if (process.env.RUN_CRON !== "true" || !isS3Enabled()) {
    return;
  }

  // Soft start of 15 seconds
  await new Promise((resolve) => setTimeout(resolve, 15000));

  logger.info("Initializing document offload cron job");

  // Daily at 01:00
  new Cron("0 1 * * *", { name: "peppol.offload" }, async () => {
    logger.info("Executing peppol.offload");
    try {
      await offloadOldDocuments(logger);
    } catch (error) {
      logger.error(
        `Failed to run peppol.offload: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  logger.info("Document offload cron job initialized");

  logger.info("Running peppol.offload immediately");
  offloadOldDocuments(logger).catch((error) => {
    logger.error(
      `Failed to run peppol.offload immediately: ${error instanceof Error ? error.message : String(error)}`
    );
  });
}
