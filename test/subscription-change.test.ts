import { describe, expect, it } from "bun:test";
import {
  planSubscriptionChange,
  resolveEffectiveDate,
  resolveSubscriptionConfig,
  type ResolvedSubscriptionConfig,
} from "../data/subscription-change";
import type { Subscription } from "../data/subscriptions";
import type { BillingConfig } from "../data/plans";

const NOW = new Date("2026-09-17T10:30:00.000Z");

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  const billingConfig: BillingConfig = {
    name: "Professional 1000",
    basePrice: 99,
    includedMonthlyDocuments: 1000,
    documentOveragePrice: 0.1,
  };
  return {
    id: "sub_active",
    teamId: "team_1",
    planId: "professional",
    planName: "Professional 1000",
    billingConfig,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: null,
    lastBilledAt: new Date("2026-08-31T23:59:59.999Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as Subscription;
}

const custom = () =>
  resolveSubscriptionConfig("professional", {
    name: "Professional custom",
    basePrice: 0,
    includedMonthlyDocuments: 1000,
    documentOveragePrice: 0.06,
  });

function plan(args: {
  active?: Subscription | null;
  scheduled?: Subscription | null;
  resolved?: ResolvedSubscriptionConfig;
  startDate?: Date;
  replaceScheduled?: boolean;
  billedThrough?: Date | null;
}) {
  return planSubscriptionChange({
    active: args.active ?? null,
    scheduled: args.scheduled ?? null,
    resolved: args.resolved ?? custom(),
    startDate: args.startDate ?? NOW,
    now: NOW,
    replaceScheduled: args.replaceScheduled ?? false,
    billedThrough: args.billedThrough ?? null,
  });
}

describe("resolveSubscriptionConfig", () => {
  it("keeps the base plan and applies only the overridden rates", () => {
    const resolved = custom();
    expect(resolved.planId).toBe("professional");
    expect(resolved.billingConfig).toEqual({
      name: "Professional custom",
      basePrice: 0,
      includedMonthlyDocuments: 1000,
      documentOveragePrice: 0.06,
    });
    expect(resolved.overriddenFields.sort()).toEqual([
      "basePrice",
      "documentOveragePrice",
      "includedMonthlyDocuments",
      "name",
    ]);
  });

  it("falls back to the base plan for every field left out", () => {
    const resolved = resolveSubscriptionConfig("professional", { basePrice: 49 });
    expect(resolved.billingConfig).toEqual({
      name: "Professional 1000",
      basePrice: 49,
      includedMonthlyDocuments: 1000,
      documentOveragePrice: 0.1,
    });
    expect(resolved.overriddenFields).toEqual(["basePrice"]);
  });

  it("keeps the subscription name and the invoice line name in step", () => {
    expect(resolveSubscriptionConfig("starter", { name: "Starter custom" })).toMatchObject({
      planName: "Starter custom",
      billingConfig: expect.objectContaining({ name: "Starter custom" }),
    });
    expect(resolveSubscriptionConfig("starter").planName).toBe("Starter");
  });

  it("supports every plan in the catalogue, including the ones the customer API hides", () => {
    for (const planId of ["developer", "starter", "professional", "professional-2500", "professional-5000", "enterprise"]) {
      expect(resolveSubscriptionConfig(planId).planId).toBe(planId);
    }
  });

  it("rejects an unknown plan", () => {
    expect(() => resolveSubscriptionConfig("professional-9000")).toThrow(/Unknown plan/);
  });

  it("rejects amounts that are negative or not finite", () => {
    for (const basePrice of [-1, Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
      expect(() => resolveSubscriptionConfig("professional", { basePrice })).toThrow();
    }
    expect(() => resolveSubscriptionConfig("professional", { documentOveragePrice: -0.06 })).toThrow();
    expect(() => resolveSubscriptionConfig("professional", { minimumPrice: Number.NaN })).toThrow();
  });

  it("rejects fractional or negative document volumes", () => {
    for (const includedMonthlyDocuments of [10.5, -1, Number.NaN]) {
      expect(() => resolveSubscriptionConfig("professional", { includedMonthlyDocuments })).toThrow();
    }
    expect(resolveSubscriptionConfig("professional", { includedMonthlyDocuments: 0 }).billingConfig.includedMonthlyDocuments).toBe(0);
  });

  it("accepts a zero base price with a paid overage rate", () => {
    const resolved = resolveSubscriptionConfig("professional", { basePrice: 0, documentOveragePrice: 0.06 });
    expect(resolved.billingConfig.basePrice).toBe(0);
    expect(resolved.billingConfig.documentOveragePrice).toBe(0.06);
  });

  it("accepts direction-specific overage rates", () => {
    const resolved = resolveSubscriptionConfig("professional", {
      incomingDocumentOveragePrice: 0.04,
      outgoingDocumentOveragePrice: 0.08,
    });
    expect(resolved.billingConfig.incomingDocumentOveragePrice).toBe(0.04);
    expect(resolved.billingConfig.outgoingDocumentOveragePrice).toBe(0.08);
  });
});

describe("resolveEffectiveDate", () => {
  it("starts immediately for now", () => {
    expect(resolveEffectiveDate("now", NOW).toISOString()).toBe(NOW.toISOString());
  });

  it("starts at the first instant of the next UTC month", () => {
    expect(resolveEffectiveDate("next-month", NOW).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls over the year", () => {
    expect(resolveEffectiveDate("next-month", new Date("2026-12-31T23:59:59.999Z")).toISOString())
      .toBe("2027-01-01T00:00:00.000Z");
  });

  it("does not drift when the current month is longer than the next", () => {
    expect(resolveEffectiveDate("next-month", new Date("2026-01-31T12:00:00.000Z")).toISOString())
      .toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("planSubscriptionChange", () => {
  it("closes the running period one millisecond before the new one starts", () => {
    const active = subscription();
    const result = plan({ active, startDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(result.outcome).toBe("apply");
    expect(result.endsSubscriptionId).toBe("sub_active");
    expect(result.endsAt?.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(result.startDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("reports the old period keeping its own rates", () => {
    const result = plan({ active: subscription(), startDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(result.message).toContain("keeps its own rates");
    expect(result.before.active).toMatchObject({
      id: "sub_active",
      lastBilledAt: "2026-08-31T23:59:59.999Z",
    });
    expect(result.after).toMatchObject({
      planId: "professional",
      planName: "Professional custom",
      startDate: "2026-10-01T00:00:00.000Z",
    });
  });

  it("starts a first period for a team without a subscription", () => {
    const result = plan({});
    expect(result.outcome).toBe("apply");
    expect(result.endsSubscriptionId).toBeNull();
    expect(result.endsAt).toBeNull();
  });

  it("refuses to backdate a change", () => {
    const result = plan({ active: subscription(), startDate: new Date("2026-09-01T00:00:00.000Z") });
    expect(result.outcome).toBe("conflict");
    expect(result.conflict).toBe("backdated_start");
  });

  it("refuses a start that is not after the running period", () => {
    const active = subscription({ startDate: new Date("2026-09-17T12:00:00.000Z") });
    const result = plan({ active, startDate: NOW });
    expect(result.outcome).toBe("conflict");
    expect(result.conflict).toBe("start_before_active_period");
  });

  it("reports a conflict instead of silently dropping a scheduled change", () => {
    const scheduled = subscription({
      id: "sub_scheduled",
      planName: "Starter",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    const result = plan({ active: subscription(), scheduled, startDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(result.outcome).toBe("conflict");
    expect(result.conflict).toBe("scheduled_change_exists");
    expect(result.message).toContain("--replace-scheduled");
    expect(result.replacesSubscriptionId).toBeNull();
  });

  it("replaces a scheduled change only when that was asked for", () => {
    const scheduled = subscription({
      id: "sub_scheduled",
      planName: "Starter",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    const result = plan({
      active: subscription(),
      scheduled,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      replaceScheduled: true,
    });
    expect(result.outcome).toBe("apply");
    expect(result.replacesSubscriptionId).toBe("sub_scheduled");
    expect(result.endsSubscriptionId).toBe("sub_active");
  });

  it("refuses to quietly reopen a subscription that is scheduled to end", () => {
    const active = subscription({ endDate: new Date("2026-09-30T23:59:59.999Z") });
    const result = plan({ active, startDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(result.outcome).toBe("conflict");
    expect(result.conflict).toBe("subscription_scheduled_to_end");

    const overridden = plan({
      active,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      replaceScheduled: true,
    });
    expect(overridden.outcome).toBe("apply");
  });

  it("treats a repeat of an already applied change as a no-op", () => {
    const resolved = custom();
    const active = subscription({
      id: "sub_custom",
      planId: resolved.planId,
      planName: resolved.planName,
      billingConfig: resolved.billingConfig,
      startDate: new Date("2026-09-01T00:00:00.000Z"),
    });
    const result = plan({ active, resolved, startDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(result.outcome).toBe("unchanged");
    expect(result.endsSubscriptionId).toBeNull();
  });

  it("treats a repeat of an already scheduled change as a no-op", () => {
    const resolved = custom();
    const scheduled = subscription({
      id: "sub_scheduled",
      planId: resolved.planId,
      planName: resolved.planName,
      billingConfig: resolved.billingConfig,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    const result = plan({
      active: subscription(),
      scheduled,
      resolved,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(result.outcome).toBe("unchanged");
    expect(result.replacesSubscriptionId).toBeNull();
  });

  it("does not treat a different rate at the same date as a repeat", () => {
    const resolved = custom();
    const scheduled = subscription({
      id: "sub_scheduled",
      planId: resolved.planId,
      planName: resolved.planName,
      billingConfig: { ...resolved.billingConfig, documentOveragePrice: 0.07 },
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    const result = plan({
      active: subscription(),
      scheduled,
      resolved,
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(result.outcome).toBe("conflict");
    expect(result.conflict).toBe("scheduled_change_exists");
  });

  it("does not treat the same rates at a different date as a repeat", () => {
    const resolved = custom();
    const scheduled = subscription({
      id: "sub_scheduled",
      planId: resolved.planId,
      planName: resolved.planName,
      billingConfig: resolved.billingConfig,
      startDate: new Date("2026-11-01T00:00:00.000Z"),
    });
    const result = plan({ active: subscription(), scheduled, resolved, startDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(result.outcome).toBe("conflict");
  });

  it("refuses a start inside a span that was already billed", () => {
    const billedThrough = new Date("2026-09-30T23:59:59.999Z");
    const active = subscription({ lastBilledAt: billedThrough });
    const result = plan({ active, startDate: NOW, billedThrough });
    expect(result.outcome).toBe("conflict");
    expect(result.conflict).toBe("start_within_billed_span");
    expect(result.message).toContain("2026-09-30T23:59:59.999Z");
    expect(result.endsSubscriptionId).toBeNull();
  });

  it("refuses a start on the last billed instant itself", () => {
    const billedThrough = new Date("2026-09-30T23:59:59.999Z");
    const result = plan({ active: subscription({ lastBilledAt: billedThrough }), startDate: billedThrough, billedThrough });
    expect(result.conflict).toBe("start_within_billed_span");
  });

  it("allows a start right after the billed span", () => {
    const billedThrough = new Date("2026-09-30T23:59:59.999Z");
    const result = plan({
      active: subscription({ lastBilledAt: billedThrough }),
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      billedThrough,
    });
    expect(result.outcome).toBe("apply");
  });

  it("keeps a repeat of an applied change a no-op even inside the billed span", () => {
    const resolved = custom();
    const billedThrough = new Date("2026-09-30T23:59:59.999Z");
    const active = subscription({
      id: "sub_custom",
      planId: resolved.planId,
      planName: resolved.planName,
      billingConfig: resolved.billingConfig,
      startDate: new Date("2026-09-10T00:00:00.000Z"),
      lastBilledAt: billedThrough,
    });
    const result = plan({ active, resolved, startDate: NOW, billedThrough });
    expect(result.outcome).toBe("unchanged");
  });

  it("never proposes touching a billing cursor", () => {
    const result = plan({ active: subscription(), startDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(JSON.stringify(result.after)).not.toContain("lastBilledAt");
    expect(result.before.active?.lastBilledAt).toBe("2026-08-31T23:59:59.999Z");
  });
});
