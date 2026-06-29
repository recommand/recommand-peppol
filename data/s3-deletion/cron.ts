import { Cron } from "croner";
import { Logger } from "@recommand/lib/logger";
import { isS3Enabled } from "@core/lib/s3";
import { processPendingS3Deletions } from "./index";

export async function initializeS3DeletionCronJobs(
  logger: Logger
): Promise<void> {
  if (process.env.RUN_CRON !== "true" || !isS3Enabled()) {
    return;
  }

  // Soft start of 20 seconds
  await new Promise((resolve) => setTimeout(resolve, 20000));

  logger.info("Initializing S3 deletion queue cron job");

  // Every 5 minutes, so queued deletions start shortly after the request that
  // enqueued them returned.
  new Cron("*/5 * * * *", { name: "peppol.s3-deletion-queue" }, async () => {
    logger.info("Executing peppol.s3-deletion-queue");
    try {
      await processPendingS3Deletions(logger);
    } catch (error) {
      logger.error(
        `Failed to run peppol.s3-deletion-queue: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  logger.info("S3 deletion queue cron job initialized");

  logger.info("Running peppol.s3-deletion-queue immediately");
  processPendingS3Deletions(logger).catch((error) => {
    logger.error(
      `Failed to run peppol.s3-deletion-queue immediately: ${error instanceof Error ? error.message : String(error)}`
    );
  });
}
