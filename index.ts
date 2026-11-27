import type { RecommandApp } from "@recommand/lib/app";
import { Server } from "@recommand/lib/api";
import { Logger } from "@recommand/lib/logger";
import reportingServer from "./api/reporting";
import companiesServer from "./api/companies";
import labelsServer from "@peppol/api/labels";
import sendDocumentServer from "./api/send-document";
import documentDefaultsServer from "./api/document-defaults";
import previewDocumentServer from "./api/preview-document";
import generateDocumentServer from "./api/generate-document";
import receiveDocumentServer from "./api/internal/receive-document";
import diditWebhookServer from "./api/internal/didit-webhook";
import arratechWebhookServer from "./api/internal/arratech-webhook";
import postmarkWebhookServer from "./api/internal/postmark-webhook";
import transmittedDocumentsServer from "./api/documents";
import webhooksServer from "./api/webhooks";
import integrationsServer from "./api/integrations";
import recipientServer from "./api/recipients";
import receivingCapabilitiesServer from "./api/receiving-capabilities";
import playgroundsServer from "./api/playgrounds";
import suppliersServer from "@peppol/api/suppliers";
import teamsServer from "./api/teams/get-team-extension";
import teamEntitlementsServer from "./api/teams/get-team-entitlements";
import customersServer from "@peppol/api/customers";
import { initializeIntegrationCronJobs } from "./data/integrations/cron";
import { initializeOffloadCronJobs } from "./data/offload/cron";
import { initializeProviderSentCronJobs } from "./data/provider-sent/cron";
import { initializeS3DeletionCronJobs } from "./data/s3-deletion/cron";
import { initializeArratechOnboardingCron } from "./data/at/kyc-onboarding";
import { initializeFrenchReportingDeclarantCron } from "./data/fr-reporting-declarants";
import { initializeFrenchReportingStatusCron } from "./data/fr-reporting-submissions";
import { initializeDeliveryReconciliationCron } from "./data/deliveries/reconcile";
import { initializeEmailDeliveryReconciliationCron } from "./data/deliveries/reconcile-email";
import { initializeDeletedNorwegianOrganisationsCron } from "./data/bronnoysund/deleted-organisations";
import { onTeamCreated, onTeamBeforeDelete } from "./lib/backend-events";
import { addBackendEventListener, CORE_BACKEND_EVENTS } from "@core/lib/backend-events";
import { registerPeppolEventTypes } from "./lib/event-types";
import { initializeMetricsServer } from "./utils/metrics";

export let logger: Logger;

const server = new Server();

export async function init(app: RecommandApp, server: Server) {
  logger = new Logger(app);
  logger.info("Initializing peppol app");

  registerPeppolEventTypes();
  addBackendEventListener(CORE_BACKEND_EVENTS.TEAM_CREATED, onTeamCreated);
  addBackendEventListener(CORE_BACKEND_EVENTS.TEAM_BEFORE_DELETE, onTeamBeforeDelete);
}

export function start() {
  initializeIntegrationCronJobs(logger);
  initializeOffloadCronJobs(logger);
  initializeProviderSentCronJobs(logger);
  initializeS3DeletionCronJobs(logger);
  initializeArratechOnboardingCron(logger);
  initializeFrenchReportingDeclarantCron(logger);
  initializeFrenchReportingStatusCron(logger);
  initializeDeliveryReconciliationCron(logger);
  initializeEmailDeliveryReconciliationCron(logger);
  initializeDeletedNorwegianOrganisationsCron(logger);

  initializeMetricsServer(logger);
}

for (const prefix of ["/peppol/", "/v1/"]) {
  server.route(prefix, sendDocumentServer);
  server.route(prefix, documentDefaultsServer);
  server.route(prefix, previewDocumentServer);
  server.route(prefix, generateDocumentServer);
  server.route(prefix, companiesServer);
  server.route(prefix, transmittedDocumentsServer);
  server.route(prefix, recipientServer);
  server.route(prefix, receivingCapabilitiesServer);
  server.route(prefix + "internal/", receiveDocumentServer);
  server.route(prefix + "internal/", diditWebhookServer);
  server.route(prefix + "internal/", arratechWebhookServer);
  server.route(prefix + "internal/", postmarkWebhookServer);

  server.route(prefix, webhooksServer);
  server.route(prefix, integrationsServer);
  server.route(prefix, playgroundsServer);

  server.route(prefix, suppliersServer);
  server.route(prefix, customersServer);
  server.route(prefix, labelsServer);

  server.route(prefix, reportingServer);
  server.route(prefix, teamsServer);
  server.route(prefix, teamEntitlementsServer);
}

export default server;
