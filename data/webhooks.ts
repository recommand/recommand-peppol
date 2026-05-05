import { ulid } from "ulid";
import { db } from "@recommand/db";
import { eq } from "drizzle-orm";
import {
  createRule,
  deleteRule,
  getRule,
  listRules,
  updateRule,
} from "@core/data/rules/rules";
import type { VersionedAction, VersionedCondition } from "@core/lib/rules/types";
import { rules } from "@core/db/schema";

const companyConditionPath = "payload.companyId";

export type Webhook = {
  id: string;
  teamId: string;
  companyId: string | null;
  url: string;
  createdAt: Date;
  updatedAt: Date | null;
};

export type InsertWebhook = {
  id?: string;
  teamId: string;
  companyId?: string | null;
  url: string;
};

function isWebhookRule(rule: Awaited<ReturnType<typeof getRule>>) {
  if (!rule) {
    return false;
  }

  return (
    rule.eventType === "*" &&
    isWebhookCompatibleCondition(rule.condition) &&
    rule.actions.length === 1 &&
    rule.actions[0].type === "webhook" &&
    rule.actions[0].version === 1
  );
}

function isWebhookCompatibleCondition(condition: VersionedCondition | null) {
  if (!condition) {
    return true;
  }

  const entries = Object.entries(condition.match);
  return (
    entries.length === 1 &&
    entries[0]?.[0] === companyConditionPath &&
    typeof entries[0]?.[1].eq === "string"
  );
}

function getWebhookCompanyId(condition: VersionedCondition | null) {
  const companyId = condition?.match[companyConditionPath]?.eq;
  return typeof companyId === "string" ? companyId : null;
}

function buildWebhookCondition(companyId?: string | null): VersionedCondition | null {
  return companyId
    ? {
        version: 1,
        match: {
          [companyConditionPath]: {
            eq: companyId,
          },
        },
      }
    : null;
}

function toWebhook(rule: Exclude<Awaited<ReturnType<typeof getRule>>, null>): Webhook {
  const action = rule.actions[0] as Extract<VersionedAction, { type: "webhook" }>;
  return {
    id: rule.id,
    teamId: rule.teamId,
    companyId: getWebhookCompanyId(rule.condition),
    url: action.config.url,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

export async function getWebhooks(teamId: string): Promise<Webhook[]> {
  const allRules = await listRules(teamId, { eventType: "*" });
  return allRules.filter(isWebhookRule).map(toWebhook);
}

export async function getWebhook(
  teamId: string,
  webhookId: string
): Promise<Webhook | undefined> {
  const rule = await getRule(teamId, webhookId);
  if (!rule) {
    return undefined;
  }

  if (!isWebhookRule(rule)) {
    return undefined;
  }
  return toWebhook(rule);
}

export async function getWebhookById(
  webhookId: string
): Promise<Webhook | undefined> {
  const [ruleRow] = await db
    .select()
    .from(rules)
    .where(eq(rules.id, webhookId))
    .limit(1);

  if (!ruleRow) {
    return undefined;
  }

  const rule = await getRule(ruleRow.teamId, webhookId);
  if (!rule) {
    return undefined;
  }

  if (!isWebhookRule(rule)) {
    return undefined;
  }
  return toWebhook(rule);
}

export async function getWebhooksByCompany(
  teamId: string,
  companyId: string
): Promise<Webhook[]> {
  const teamWebhooks = await getWebhooks(teamId);
  return teamWebhooks.filter(
    (webhook) => webhook.companyId === null || webhook.companyId === companyId
  );
}

export async function createWebhook(webhook: InsertWebhook): Promise<Webhook> {
  const rule = await createRule(webhook.teamId, {
    id: webhook.id ?? "wh_" + ulid(),
    name: `Webhook: ${webhook.url}`,
    enabled: true,
    eventType: "*",
    condition: buildWebhookCondition(webhook.companyId),
    actions: [
      {
        type: "webhook",
        version: 1,
        config: {
          url: webhook.url,
        },
      },
    ],
  });

  return toWebhook(rule);
}

export async function updateWebhook(
  webhook: InsertWebhook & { id: string }
): Promise<Webhook | undefined> {
  const rule = await updateRule(webhook.teamId, webhook.id, {
    name: `Webhook: ${webhook.url}`,
    eventType: "*",
    condition: buildWebhookCondition(webhook.companyId),
    actions: [
      {
        type: "webhook",
        version: 1,
        config: {
          url: webhook.url,
        },
      },
    ],
  });

  if (!rule || !isWebhookRule(rule)) {
    return undefined;
  }

  return toWebhook(rule);
}

async function deleteWebhookByRuleId(teamId: string, webhookId: string) {
  await deleteRule(teamId, webhookId);
}

export async function deleteWebhook(
  teamId: string,
  webhookId: string
): Promise<void> {
  await deleteWebhookByRuleId(teamId, webhookId);
}
