import { activatedIntegrations, integrationTaskLogs } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and, sql, isNotNull, desc, asc } from "drizzle-orm";
import { configurationSchema } from "@peppol/types/integration/configuration";
import { stateSchema } from "@peppol/types/integration/state";
import { type IntegrationManifest, type IntegrationConfiguration, type IntegrationState, type IntegrationEvent, taskLogSchema } from "@peppol/types/integration";
import { UserFacingError } from "@peppol/utils/util";
import { getCompany } from "@peppol/data/companies";
import { getActiveSubscription } from "@peppol/data/subscriptions";
import { isPlayground } from "@peppol/data/teams";
import { canUseIntegrations } from "@peppol/utils/plan-validation";
import { getIntegrationManifestFromUrl, validateManifest, postToIntegration } from "./client";

export type ActivatedIntegration = typeof activatedIntegrations.$inferSelect;
export type InsertActivatedIntegration = typeof activatedIntegrations.$inferInsert;

export async function getIntegrations(teamId: string): Promise<ActivatedIntegration[]> {
  return await db.select().from(activatedIntegrations).where(eq(activatedIntegrations.teamId, teamId)).orderBy(asc(sql`${activatedIntegrations.manifest}->>'name'`), asc(activatedIntegrations.createdAt));
}

export async function getIntegration(
  teamId: string,
  integrationId: string
): Promise<ActivatedIntegration | undefined> {
  return await db
    .select()
    .from(activatedIntegrations)
    .where(and(eq(activatedIntegrations.teamId, teamId), eq(activatedIntegrations.id, integrationId)))
    .then((rows) => rows[0]);
}

export async function getIntegrationsByCompany(
  teamId: string,
  companyId: string
): Promise<ActivatedIntegration[]> {
  return await db
    .select()
    .from(activatedIntegrations)
    .where(
      and(eq(activatedIntegrations.teamId, teamId), eq(activatedIntegrations.companyId, companyId))
    )
    .orderBy(asc(sql`${activatedIntegrations.manifest}->>'name'`), asc(activatedIntegrations.createdAt));
}

function validateConfiguration(configuration: unknown): IntegrationConfiguration {
  const result = configurationSchema.safeParse(configuration);
  if (!result.success) {
    throw new UserFacingError(`Invalid configuration: ${result.error.errors.map(e => e.message).join(", ")}`);
  }
  return result.data;
}

function validateState(state: unknown): IntegrationState {
  const result = stateSchema.safeParse(state);
  if (!result.success) {
    throw new UserFacingError(`Invalid state: ${result.error.errors.map(e => e.message).join(", ")}`);
  }
  return result.data;
}

function enableRequiredCapabilities(
  manifest: IntegrationManifest,
  configuration: IntegrationConfiguration
): IntegrationConfiguration {
  const requiredCapabilityEvents = new Set(
    manifest.capabilities.filter(c => c.required).map(c => c.event)
  );

  if (requiredCapabilityEvents.size === 0) {
    return configuration;
  }

  const capabilitiesMap = new Map(
    configuration.capabilities.map(c => [c.event, c])
  );

  for (const requiredEvent of requiredCapabilityEvents) {
    const existingCapability = capabilitiesMap.get(requiredEvent);
    if (existingCapability) {
      if (!existingCapability.enabled) {
        capabilitiesMap.set(requiredEvent, { event: requiredEvent, enabled: true });
      }
    } else {
      capabilitiesMap.set(requiredEvent, { event: requiredEvent, enabled: true });
    }
  }

  return {
    ...configuration,
    capabilities: Array.from(capabilitiesMap.values()),
  };
}

function validateConfigurationCompatibility(
  manifest: IntegrationManifest,
  configuration: IntegrationConfiguration
): void {
  if (!manifest.authTypes.includes(configuration.auth.type)) {
    throw new UserFacingError(
      `Configuration auth type '${configuration.auth.type}' is not supported by manifest. Supported types: ${manifest.authTypes.join(", ")}`
    );
  }

  const manifestFieldIds = new Set(manifest.fields.map(f => f.id));
  const configurationFieldIds = new Set(configuration.fields.map(f => f.id));

  for (const manifestField of manifest.fields) {
    if (manifestField.required && !configurationFieldIds.has(manifestField.id)) {
      throw new UserFacingError(
        `Required field '${manifestField.id}' (${manifestField.title}) is missing from configuration`
      );
    }
  }

  for (const configField of configuration.fields) {
    if (!manifestFieldIds.has(configField.id)) {
      throw new UserFacingError(
        `Configuration contains extra field '${configField.id}' that is not defined in manifest`
      );
    }
    const manifestField = manifest.fields.find(f => f.id === configField.id);
    if (manifestField && manifestField.type !== configField.type) {
      throw new UserFacingError(
        `Configuration field '${configField.id}' has type '${configField.type}' but manifest expects type '${manifestField.type}'`
      );
    }
  }

  const manifestCapabilityEvents = new Set(manifest.capabilities.map(c => c.event));

  for (const configCapability of configuration.capabilities) {
    if (!manifestCapabilityEvents.has(configCapability.event)) {
      throw new UserFacingError(
        `Configuration contains capability for event '${configCapability.event}' that is not supported by manifest`
      );
    }
  }

  for (const manifestCapability of manifest.capabilities) {
    if (manifestCapability.required) {
      const configCapability = configuration.capabilities.find(c => c.event === manifestCapability.event);
      if (!configCapability || !configCapability.enabled) {
        throw new UserFacingError(
          `Required capability '${manifestCapability.event}' must be enabled in configuration`
        );
      }
    }
  }
}

export async function createIntegration(
  integration: Omit<InsertActivatedIntegration, "state" | "manifest"> & {
    manifest?: IntegrationManifest;
    url?: string;
  }
): Promise<ActivatedIntegration> {
  const company = await getCompany(integration.teamId, integration.companyId);
  if (!company) {
    throw new UserFacingError("Company not found or does not belong to the team");
  }

  let manifest: IntegrationManifest;
  if (integration.manifest) {
    manifest = validateManifest(integration.manifest);
  } else if (integration.url) {
    manifest = await getIntegrationManifestFromUrl(integration.url);
  } else {
    throw new UserFacingError("Either 'manifest' or 'url' must be provided");
  }

  let configuration: IntegrationConfiguration | null;
  if (integration.configuration) {
    configuration = validateConfiguration(integration.configuration);
    configuration = enableRequiredCapabilities(manifest, configuration);
    validateConfigurationCompatibility(manifest, configuration);  
  } else {
    configuration = null;
  }
  
  const { url: _, ...integrationData } = integration;
  const state = validateState({});

  const createdIntegration = await db
    .insert(activatedIntegrations)
    .values({ ...integrationData, manifest, configuration, state })
    .returning()
    .then((rows) => rows[0]);

  if (configuration !== null && configuration !== undefined) {
    try {
      await postToIntegration({ integration: createdIntegration, event: "integration.setup" });
    } catch (error) {
      console.error("Failed to trigger integration.setup event after creation:", error);
    }
  }

  return createdIntegration;
}

export async function updateIntegration(
  integration: Partial<Omit<InsertActivatedIntegration, "state">> & { id: string; teamId: string; companyId: string; configuration: IntegrationConfiguration}
): Promise<ActivatedIntegration> {
  const { id, teamId, ...updateFields } = integration;

  const company = await getCompany(teamId, updateFields.companyId);
  if (!company) {
    throw new UserFacingError("Company not found or does not belong to the team");
  }

  const existingIntegration = await getIntegration(teamId, id);
  if (!existingIntegration) {
    throw new UserFacingError("Integration not found");
  }

  const manifest = updateFields.manifest ? validateManifest(updateFields.manifest) : existingIntegration.manifest;
  let configuration = validateConfiguration(updateFields.configuration);

  configuration = enableRequiredCapabilities(manifest, configuration);
  validateConfigurationCompatibility(manifest, configuration);

  const updatedIntegration = await db
    .update(activatedIntegrations)
    .set({ ...updateFields, manifest, configuration })
    .where(
      and(eq(activatedIntegrations.teamId, teamId), eq(activatedIntegrations.id, id))
    )
    .returning()
    .then((rows) => rows[0]);

  const wasConfigurationNull = existingIntegration.configuration === null;
  const isConfigurationNotNull = configuration !== null && configuration !== undefined;

  if (wasConfigurationNull && isConfigurationNotNull) {
    try {
      await postToIntegration({ integration: updatedIntegration, event: "integration.setup" });
    } catch (error) {
      console.error("Failed to trigger integration.setup event after update:", error);
    }
  }

  return updatedIntegration;
}

export async function updateIntegrationState(
  teamId: string,
  integrationId: string,
  state: IntegrationState
): Promise<void> {

  const validatedState = validateState(state);

  await db
    .update(activatedIntegrations)
    .set({ state: validatedState })
    .where(and(eq(activatedIntegrations.teamId, teamId), eq(activatedIntegrations.id, integrationId)));
}

export async function deleteIntegration(
  teamId: string,
  integrationId: string
): Promise<void> {
  await db
    .delete(activatedIntegrations)
    .where(and(eq(activatedIntegrations.teamId, teamId), eq(activatedIntegrations.id, integrationId)));
}

export async function createIntegrationTaskLog(
  integrationId: string,
  event: IntegrationEvent,
  task: string,
  success: boolean,
  message: string,
  context: string
): Promise<void> {
  const validatedTaskLog = taskLogSchema.parse({ event, task, success, message, context });
  await db
    .insert(integrationTaskLogs)
    .values({ integrationId, event, task: validatedTaskLog.task, success: validatedTaskLog.success, message: validatedTaskLog.message, context: validatedTaskLog.context ?? "" });
}

export async function getIntegrationsWithCronEnabled(
  event: "integration.cron.short" | "integration.cron.medium" | "integration.cron.long"
): Promise<ActivatedIntegration[]> {
  const capabilityJson = JSON.stringify([{ event, enabled: true }]);
  return await db
    .select()
    .from(activatedIntegrations)
    .where(
      and(
        isNotNull(activatedIntegrations.configuration),
        sql`${activatedIntegrations.configuration}->'capabilities' @> ${sql.raw(`'${capabilityJson.replace(/'/g, "''")}'`)}::jsonb`
      )
    );
}

export async function executeCronJob(event: IntegrationEvent): Promise<void> {
  const integrations = await getIntegrationsWithCronEnabled(
    event as "integration.cron.short" | "integration.cron.medium" | "integration.cron.long"
  );

  for (const integration of integrations) {
    try {
      const teamIsPlayground = await isPlayground(integration.teamId);
      const subscription = await getActiveSubscription(integration.teamId);
      if (!canUseIntegrations(teamIsPlayground, subscription)) {
        console.warn(`Skipping cron job ${event} for integration ${integration.id}: team does not have access to integrations`);
        continue;
      }
      await postToIntegration({ integration, event });
    } catch (error) {
      console.error("Failed to execute cron job", event, integration.id, error);
    }
  }
}

export type IntegrationTaskLog = typeof integrationTaskLogs.$inferSelect;

export async function getIntegrationTaskLogs(
  teamId: string,
  integrationId: string,
  options: {
    page?: number;
    limit?: number;
  } = {}
): Promise<{ logs: IntegrationTaskLog[]; total: number }> {
  const { page = 1, limit = 10 } = options;
  const offset = (page - 1) * limit;

  const integration = await getIntegration(teamId, integrationId);
  if (!integration) {
    throw new UserFacingError("Integration not found");
  }

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(integrationTaskLogs)
    .where(eq(integrationTaskLogs.integrationId, integrationId))
    .then((rows) => rows[0].count);

  const logs = await db
    .select()
    .from(integrationTaskLogs)
    .where(eq(integrationTaskLogs.integrationId, integrationId))
    .orderBy(desc(integrationTaskLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return { logs, total };
}