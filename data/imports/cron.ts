import { Cron } from "croner";
import type { Logger } from "@recommand/lib/logger";
import { kickImportWorker } from "./worker";

/** Every minute, take up imports that wait: new ones another node accepted, retries, and abandoned ones. */
export function initializeImportCronJobs(logger: Logger): void {
  if (process.env.RUN_CRON !== "true") {
    return;
  }
  new Cron("* * * * *", { name: "peppol.imports", protect: true }, () => {
    kickImportWorker();
  });
  logger.info("Import processing cron job initialized");
}
