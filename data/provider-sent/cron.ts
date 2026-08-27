import { Cron } from "croner";
import { Logger } from "@recommand/lib/logger";
import { pruneOutgoingEnvelopeClaims } from "./claims";

export async function initializeProviderSentCronJobs(
  logger: Logger
): Promise<void> {
  if (process.env.RUN_CRON !== "true") {
    return;
  }

  // Soft start of 25 seconds
  await new Promise((resolve) => setTimeout(resolve, 25000));

  logger.info("Initializing outgoing envelope claim cron job");

  // Hourly: drop the envelope claims that are far older than any send can be. Nothing
  // else has to run in the background — transactions an access point reports are
  // recorded by the webhook that reports them.
  new Cron("0 * * * *", { name: "peppol.outgoing-envelope-claims" }, async () => {
    try {
      const pruned = await pruneOutgoingEnvelopeClaims();
      if (pruned > 0) {
        logger.info(`Pruned ${pruned} outgoing envelope claims`);
      }
    } catch (error) {
      logger.error(
        `Failed to run peppol.outgoing-envelope-claims: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  logger.info("Outgoing envelope claim cron job initialized");
}
