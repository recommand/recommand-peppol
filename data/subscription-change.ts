import { z } from "zod";
import { addMilliseconds, addMonths, startOfMonth } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { allPlans, BillingConfigSchema, type BillingConfig } from "./plans";
import type { Subscription } from "./subscriptions";

export const subscriptionEffectiveOptions = ["now", "next-month"] as const;
export type SubscriptionEffective = (typeof subscriptionEffectiveOptions)[number];

const monetaryAmount = z
  .number()
  .refine((value) => Number.isFinite(value), "Must be a finite amount")
  .refine((value) => value >= 0, "Must not be negative");

const documentVolume = z
  .number()
  .refine((value) => Number.isInteger(value), "Must be a whole number of documents")
  .refine((value) => value >= 0, "Must not be negative");

/**
 * The fields of a billing config a support operator may override on top of a base
 * plan. Every override is optional; anything left out keeps the base plan value.
 */
export const BillingConfigOverridesSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  basePrice: monetaryAmount.optional(),
  minimumPrice: monetaryAmount.optional(),
  includedMonthlyDocuments: documentVolume.optional(),
  documentOveragePrice: monetaryAmount.optional(),
  incomingDocumentOveragePrice: monetaryAmount.optional(),
  outgoingDocumentOveragePrice: monetaryAmount.optional(),
});

export type BillingConfigOverrides = z.infer<typeof BillingConfigOverridesSchema>;

export type ResolvedSubscriptionConfig = {
  planId: string;
  planName: string;
  billingConfig: BillingConfig;
  overriddenFields: (keyof BillingConfigOverrides)[];
};

/**
 * Build the billing config to store: a base plan, with the given overrides applied
 * on top. The base plan is always kept as `planId`, because integration access and
 * other plan-driven behaviour hang off it; only the rates change.
 */
export function resolveSubscriptionConfig(
  planId: string,
  overrides: BillingConfigOverrides = {}
): ResolvedSubscriptionConfig {
  const plan = allPlans.find((candidate) => candidate.id === planId);
  if (!plan) {
    throw new Error(
      `Unknown plan "${planId}". Known plans: ${allPlans.map((p) => p.id).join(", ")}`
    );
  }

  const base: BillingConfig = {
    name: plan.name,
    basePrice: plan.basePrice,
    includedMonthlyDocuments: plan.includedMonthlyDocuments,
    documentOveragePrice: plan.documentOveragePrice,
    ...(plan.minimumPrice !== undefined ? { minimumPrice: plan.minimumPrice } : {}),
    ...(plan.incomingDocumentOveragePrice !== undefined
      ? { incomingDocumentOveragePrice: plan.incomingDocumentOveragePrice }
      : {}),
    ...(plan.outgoingDocumentOveragePrice !== undefined
      ? { outgoingDocumentOveragePrice: plan.outgoingDocumentOveragePrice }
      : {}),
  };

  const parsedOverrides = BillingConfigOverridesSchema.parse(overrides);
  const overriddenFields = (
    Object.keys(parsedOverrides) as (keyof BillingConfigOverrides)[]
  ).filter((field) => parsedOverrides[field] !== undefined);

  const billingConfig = BillingConfigSchema.parse({
    ...base,
    ...Object.fromEntries(
      overriddenFields.map((field) => [field, parsedOverrides[field]])
    ),
  });

  // The invoice line and the subscription row must always name the same thing.
  return {
    planId: plan.id,
    planName: billingConfig.name,
    billingConfig,
    overriddenFields,
  };
}

/**
 * When a change takes effect. `now` starts immediately; `next-month` starts at the
 * first instant of the next UTC month, which is also where the billing cycle cuts
 * its calendar months.
 */
export function resolveEffectiveDate(
  effective: SubscriptionEffective,
  now: Date
): Date {
  if (effective === "now") {
    return now;
  }
  return new Date(startOfMonth(addMonths(TZDate.tz("UTC", now), 1)).getTime());
}

export type SubscriptionChangeConflict =
  | "scheduled_change_exists"
  | "subscription_scheduled_to_end"
  | "backdated_start"
  | "start_before_active_period"
  | "start_within_billed_span";

export type SubscriptionSnapshot = {
  id: string;
  planId: string | null;
  planName: string;
  billingConfig: BillingConfig;
  startDate: string;
  endDate: string | null;
  lastBilledAt: string | null;
};

export type SubscriptionChangePlan = {
  outcome: "apply" | "unchanged" | "conflict";
  conflict: SubscriptionChangeConflict | null;
  message: string;
  /** Start of the new subscription period. */
  startDate: Date;
  /** The active period that gets closed, and the instant it closes at. */
  endsSubscriptionId: string | null;
  endsAt: Date | null;
  /** A scheduled period this change replaces, only when replacement was requested. */
  replacesSubscriptionId: string | null;
  before: {
    active: SubscriptionSnapshot | null;
    scheduled: SubscriptionSnapshot | null;
  };
  after: {
    planId: string;
    planName: string;
    billingConfig: BillingConfig;
    startDate: string;
  };
};

export function snapshotSubscription(
  subscription: Subscription | null
): SubscriptionSnapshot | null {
  if (!subscription) return null;
  return {
    id: subscription.id,
    planId: subscription.planId,
    planName: subscription.planName,
    billingConfig: subscription.billingConfig,
    startDate: subscription.startDate.toISOString(),
    endDate: subscription.endDate?.toISOString() ?? null,
    lastBilledAt: subscription.lastBilledAt?.toISOString() ?? null,
  };
}

function sameBillingConfig(a: BillingConfig, b: BillingConfig): boolean {
  const normalize = (config: BillingConfig) =>
    JSON.stringify({
      name: config.name,
      basePrice: config.basePrice,
      minimumPrice: config.minimumPrice ?? null,
      includedMonthlyDocuments: config.includedMonthlyDocuments,
      documentOveragePrice: config.documentOveragePrice,
      incomingDocumentOveragePrice: config.incomingDocumentOveragePrice ?? null,
      outgoingDocumentOveragePrice: config.outgoingDocumentOveragePrice ?? null,
    });
  return normalize(a) === normalize(b);
}

function isSameConfiguration(
  subscription: Subscription | null,
  resolved: ResolvedSubscriptionConfig
): boolean {
  if (!subscription) return false;
  return (
    subscription.planId === resolved.planId &&
    subscription.planName === resolved.planName &&
    sameBillingConfig(subscription.billingConfig, resolved.billingConfig)
  );
}

/**
 * Decide what a requested subscription change would do, without touching the
 * database. Closing the active period at `startDate - 1ms` leaves every earlier
 * period, and its rates, exactly as billed.
 *
 * `billedThrough` is the latest instant any of the team's periods was billed up
 * to. A billing run may settle a period ahead of time, so a new period can only
 * start after that instant: a period starting inside an already billed span would
 * be billed a second time.
 */
export function planSubscriptionChange({
  active,
  scheduled,
  resolved,
  startDate,
  now,
  replaceScheduled = false,
  billedThrough = null,
}: {
  active: Subscription | null;
  scheduled: Subscription | null;
  resolved: ResolvedSubscriptionConfig;
  startDate: Date;
  now: Date;
  replaceScheduled?: boolean;
  billedThrough?: Date | null;
}): SubscriptionChangePlan {
  const after = {
    planId: resolved.planId,
    planName: resolved.planName,
    billingConfig: resolved.billingConfig,
    startDate: startDate.toISOString(),
  };
  const before = {
    active: snapshotSubscription(active),
    scheduled: snapshotSubscription(scheduled),
  };
  const base = {
    startDate,
    endsSubscriptionId: null,
    endsAt: null,
    replacesSubscriptionId: null,
    before,
    after,
  };

  const conflict = (
    reason: SubscriptionChangeConflict,
    message: string
  ): SubscriptionChangePlan => ({
    ...base,
    outcome: "conflict",
    conflict: reason,
    message,
  });

  const unchanged = (message: string): SubscriptionChangePlan => ({
    ...base,
    outcome: "unchanged",
    conflict: null,
    message,
  });

  // A change may only ever take effect from now on: earlier periods were already
  // billed at their own rates and are never rewritten.
  if (startDate.getTime() < now.getTime()) {
    return conflict(
      "backdated_start",
      "A subscription change cannot start in the past. Use --effective now or --effective next-month."
    );
  }

  if (active && startDate.getTime() <= active.startDate.getTime()) {
    return conflict(
      "start_before_active_period",
      `The requested start is not after the current period, which started at ${active.startDate.toISOString()}.`
    );
  }

  // Repeating an identical request must not create another subscription row.
  if (scheduled && isSameConfiguration(scheduled, resolved)) {
    if (scheduled.startDate.getTime() === startDate.getTime()) {
      return unchanged(
        `This change is already scheduled as ${scheduled.id}, starting at ${scheduled.startDate.toISOString()}.`
      );
    }
  }
  if (active && !scheduled && !active.endDate && isSameConfiguration(active, resolved)) {
    return unchanged(
      `The active subscription ${active.id} already carries this plan and these rates.`
    );
  }

  // Everything up to `billedThrough` is settled; a period starting on or before it
  // would be billed again for the part that was already invoiced.
  if (billedThrough && startDate.getTime() <= billedThrough.getTime()) {
    return conflict(
      "start_within_billed_span",
      `This team is already billed through ${billedThrough.toISOString()}, so a new period cannot start at ${startDate.toISOString()}. Choose an effective date after the billed span.`
    );
  }

  if (scheduled && !replaceScheduled) {
    return conflict(
      "scheduled_change_exists",
      `A different change is already scheduled (${scheduled.id}, ${scheduled.planName}, starting at ${scheduled.startDate.toISOString()}). Pass --replace-scheduled to replace it.`
    );
  }

  // An active period with an end date is a scheduled cancellation or downgrade;
  // silently reopening it would undo a customer decision.
  if (active?.endDate && !replaceScheduled) {
    return conflict(
      "subscription_scheduled_to_end",
      `The active subscription ${active.id} is scheduled to end at ${active.endDate.toISOString()}. Pass --replace-scheduled to override that.`
    );
  }

  return {
    ...base,
    outcome: "apply",
    conflict: null,
    endsSubscriptionId: active?.id ?? null,
    endsAt: active ? addMilliseconds(startDate, -1) : null,
    replacesSubscriptionId: replaceScheduled ? (scheduled?.id ?? null) : null,
    message: active
      ? `Period ${active.id} keeps its own rates up to ${addMilliseconds(startDate, -1).toISOString()}; the new rates apply from ${startDate.toISOString()}.`
      : `A new subscription period starts at ${startDate.toISOString()}.`,
  };
}
