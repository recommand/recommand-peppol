import { describe, expect, it } from "bun:test";
import Decimal from "decimal.js";
import {
  computeSubscriptionBillingLine,
  splitBillingPeriodIntoMonths,
  summarizeBillingLines,
  type SubscriptionUsage,
  describeBillingOutcome,
} from "../data/billing/calculation";
import type { Subscription } from "../data/subscriptions";
import type { BillingConfig } from "../data/plans";

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  const billingConfig: BillingConfig = {
    name: "Professional custom",
    basePrice: 0,
    includedMonthlyDocuments: 1000,
    documentOveragePrice: 0.06,
  };
  return {
    id: "sub_1",
    teamId: "team_1",
    planId: "professional",
    planName: "Professional custom",
    billingConfig,
    startDate: new Date("2026-09-01T00:00:00.000Z"),
    endDate: null,
    lastBilledAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  } as Subscription;
}

function usage({
  incoming = 0,
  outgoing = 0,
  before = 0,
}: { incoming?: number; outgoing?: number; before?: number } = {}): SubscriptionUsage {
  return {
    usageBeforeSubscriptionStart: before,
    incomingByCompany: incoming ? [{ companyId: "c1", companyName: "Company One", usage: incoming }] : [],
    outgoingByCompany: outgoing ? [{ companyId: "c1", companyName: "Company One", usage: outgoing }] : [],
  };
}

// Billing dates are TZDate instances, whose toISOString() keeps an explicit
// "+00:00" offset; compare the instant, not the spelling.
const iso = (date: Date) => new Date(date.getTime()).toISOString();

const wholeSeptember = {
  startInclusive: new Date("2026-09-01T00:00:00.000Z"),
  endInclusive: new Date("2026-09-30T23:59:59.999Z"),
};

describe("splitBillingPeriodIntoMonths", () => {
  it("bills from the subscription start when nothing was billed yet", () => {
    const months = splitBillingPeriodIntoMonths(
      subscription({ startDate: new Date("2026-09-10T08:00:00.000Z") }),
      new Date("2026-09-30T23:59:59.999Z")
    );
    expect(months).toHaveLength(1);
    expect(iso(months[0].startInclusive)).toBe("2026-09-10T08:00:00.001Z");
    expect(iso(months[0].startOfPeriodInclusive)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(months[0].endInclusive)).toBe("2026-09-30T23:59:59.999Z");
  });

  it("resumes one millisecond after the last billing cursor", () => {
    const months = splitBillingPeriodIntoMonths(
      subscription({ lastBilledAt: new Date("2026-08-31T23:59:59.999Z") }),
      new Date("2026-09-30T23:59:59.999Z")
    );
    expect(iso(months[0].startInclusive)).toBe("2026-09-01T00:00:00.000Z");
  });

  it("splits an unbilled span into whole calendar months", () => {
    const months = splitBillingPeriodIntoMonths(
      subscription({ startDate: new Date("2026-07-15T00:00:00.000Z") }),
      new Date("2026-09-30T23:59:59.999Z")
    );
    expect(months.map((m) => [iso(m.startInclusive), iso(m.endInclusive)])).toEqual([
      ["2026-07-15T00:00:00.001Z", "2026-07-31T23:59:59.999Z"],
      ["2026-08-01T00:00:00.000Z", "2026-08-31T23:59:59.999Z"],
      ["2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z"],
    ]);
  });

  it("stops at the end date of a subscription that already ended", () => {
    const months = splitBillingPeriodIntoMonths(
      subscription({ endDate: new Date("2026-09-15T11:59:59.999Z") }),
      new Date("2026-09-30T23:59:59.999Z")
    );
    expect(months).toHaveLength(1);
    expect(iso(months[0].endInclusive)).toBe("2026-09-15T11:59:59.999Z");
  });

  it("refuses a period that starts after it ends", () => {
    expect(() =>
      splitBillingPeriodIntoMonths(
        subscription({ lastBilledAt: new Date("2026-09-30T23:59:59.999Z") }),
        new Date("2026-08-31T23:59:59.999Z")
      )
    ).toThrow(/Billing period start is after billing period end/);
  });
});

describe("computeSubscriptionBillingLine", () => {
  it("charges nothing while usage stays inside the allowance", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription(),
      ...wholeSeptember,
      usage: usage({ incoming: 400, outgoing: 500 }),
    });
    expect(line.lineTotalExcl).toBe(0);
    expect(line.overageQtyIncoming).toBe(0);
    expect(line.overageQtyOutgoing).toBe(0);
    expect(line.usedQty).toBe(900);
  });

  it("charges the overage rate for every document above the allowance", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription(),
      ...wholeSeptember,
      usage: usage({ incoming: 600, outgoing: 900 }),
    });
    // 1500 used, 1000 included, 500 over at 0.06
    expect(line.overageQtyIncoming).toBe(0);
    expect(line.overageQtyOutgoing).toBe(500);
    expect(line.lineTotalExcl).toBe(30);
  });

  it("uses the allowance on incoming documents first", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription(),
      ...wholeSeptember,
      usage: usage({ incoming: 1200, outgoing: 100 }),
    });
    expect(line.overageQtyIncoming).toBe(200);
    expect(line.overageQtyOutgoing).toBe(100);
    expect(line.lineTotalExcl).toBe(18);
  });

  it("deducts usage already billed earlier in the same month from the allowance", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription(),
      ...wholeSeptember,
      usage: usage({ outgoing: 300, before: 900 }),
    });
    // 1000 - 900 already used = 100 left, so 200 of the 300 are billed
    expect(line.overageQtyOutgoing).toBe(200);
    expect(line.lineTotalExcl).toBe(12);
  });

  it("never lets an earlier month consume more than the whole allowance", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription(),
      ...wholeSeptember,
      usage: usage({ outgoing: 10, before: 5000 }),
    });
    expect(line.overageQtyOutgoing).toBe(10);
    expect(line.lineTotalExcl).toBe(0.6);
  });

  it("does not pro rata the allowance for a partial month, but does pro rata the base price", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription({ billingConfig: { name: "Pro", basePrice: 310, includedMonthlyDocuments: 1000, documentOveragePrice: 0.06 } }),
      startInclusive: new Date("2026-09-01T00:00:00.000Z"),
      endInclusive: new Date("2026-09-11T00:00:00.000Z"),
      usage: usage({ outgoing: 1000 }),
    });
    // 10 of 31 days: 310 * 10/31 = 100, and the full 1000 allowance still applies
    expect(line.basePrice).toBe(310);
    expect(line.lineTotalExcl).toBe(100);
    expect(line.overageQtyOutgoing).toBe(0);
  });

  it("charges a whole calendar month in full, however many days it has", () => {
    for (const [start, end] of [
      ["2026-02-01T00:00:00.000Z", "2026-02-28T23:59:59.999Z"],
      ["2026-04-01T00:00:00.000Z", "2026-04-30T23:59:59.999Z"],
      ["2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.999Z"],
    ]) {
      const line = computeSubscriptionBillingLine({
        subscription: subscription({ billingConfig: { name: "Pro", basePrice: 99, includedMonthlyDocuments: 1000, documentOveragePrice: 0.06 } }),
        startInclusive: new Date(start),
        endInclusive: new Date(end),
        usage: usage(),
      });
      expect(line.lineTotalExcl).toBe(99);
    }
  });

  it("applies a minimum price pro rata as well", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription({
        billingConfig: { name: "Enterprise", basePrice: 0, minimumPrice: 350, includedMonthlyDocuments: 5000, documentOveragePrice: 0.01 },
      }),
      ...wholeSeptember,
      usage: usage({ outgoing: 100 }),
    });
    expect(line.lineTotalExcl).toBe(350);
  });

  it("uses direction-specific overage rates when they are set", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription({
        billingConfig: {
          name: "Split rates",
          basePrice: 0,
          includedMonthlyDocuments: 0,
          documentOveragePrice: 0.5,
          incomingDocumentOveragePrice: 0.04,
          outgoingDocumentOveragePrice: 0.08,
        },
      }),
      ...wholeSeptember,
      usage: usage({ incoming: 100, outgoing: 100 }),
    });
    expect(line.lineTotalExcl).toBe(12);
    expect(line.incomingDocumentOveragePrice).toBe(0.04);
    expect(line.outgoingDocumentOveragePrice).toBe(0.08);
  });

  it("names the invoice line after the billing config", () => {
    const line = computeSubscriptionBillingLine({
      subscription: subscription(),
      ...wholeSeptember,
      usage: usage({ outgoing: 1 }),
    });
    expect(line.lineName).toBe("Recommand Professional custom");
    expect(line.lineDescription).toContain("Included in subscription: 1000 documents");
  });

  it("rejects a billing config that is not usable", () => {
    for (const billingConfig of [
      null,
      { name: "Broken", includedMonthlyDocuments: 10, documentOveragePrice: 0.1 },
      { name: "Broken", basePrice: 1, documentOveragePrice: 0.1 },
      { name: "Broken", basePrice: 1, includedMonthlyDocuments: 10 },
    ]) {
      expect(() =>
        computeSubscriptionBillingLine({
          subscription: subscription({ billingConfig: billingConfig as never }),
          ...wholeSeptember,
          usage: usage(),
        })
      ).toThrow();
    }
  });
});

describe("summarizeBillingLines", () => {
  const lines = [
    computeSubscriptionBillingLine({
      subscription: subscription({ id: "sub_old" }),
      startInclusive: new Date("2026-08-01T00:00:00.000Z"),
      endInclusive: new Date("2026-08-31T23:59:59.999Z"),
      usage: usage({ outgoing: 1500 }),
    }),
    computeSubscriptionBillingLine({
      subscription: subscription({ id: "sub_new" }),
      ...wholeSeptember,
      usage: usage({ incoming: 200, outgoing: 1100 }),
    }),
  ];

  it("totals the lines and applies VAT once", () => {
    const summary = summarizeBillingLines(lines, new Decimal(21));
    expect(summary.totalAmountExcl.toNumber()).toBe(48);
    expect(summary.totalVatAmount.toNumber()).toBe(10.08);
    expect(summary.totalAmountIncl.toNumber()).toBe(58.08);
  });

  it("spans the widest billing period and adds up the usage", () => {
    const summary = summarizeBillingLines(lines, new Decimal(0));
    expect(iso(summary.billingPeriodStart!)).toBe("2026-08-01T00:00:00.000Z");
    expect(iso(summary.billingPeriodEnd!)).toBe("2026-09-30T23:59:59.999Z");
    expect(summary.usedQty.toNumber()).toBe(2800);
    expect(summary.overageQtyOutgoing.toNumber()).toBe(800);
    expect(summary.totalVatAmount.toNumber()).toBe(0);
  });

  it("returns an empty period and a zero total when there is nothing to bill", () => {
    const summary = summarizeBillingLines([], new Decimal(21));
    expect(summary.totalAmountIncl.toNumber()).toBe(0);
    expect(summary.billingPeriodStart).toBeNull();
    expect(summary.billingPeriodEnd).toBeNull();
  });
});

describe("describeBillingOutcome", () => {
  const base = {
    profileStanding: "active" as string | null,
    isManuallyBilled: false,
    hasBillingProfile: true,
    hasLines: true,
    totalAmountIncl: new Decimal(58.08),
    hasMollieCustomer: true,
  };

  it("invoices and charges a normal profile with a positive total", () => {
    expect(describeBillingOutcome(base).outcome).toBe("invoice_and_payment");
  });

  it("blocks a positive total when the profile has no payment customer", () => {
    const result = describeBillingOutcome({ ...base, hasMollieCustomer: false });
    expect(result.outcome).toBe("blocked_no_payment_customer");
    expect(result.message).toContain("lastBilledAt does not move");
  });

  it("still only moves the cursor for a zero total without a payment customer", () => {
    expect(
      describeBillingOutcome({ ...base, hasMollieCustomer: false, totalAmountIncl: new Decimal(0) }).outcome
    ).toBe("marked_billed_only");
  });

  it("still bills a manual profile without a payment customer", () => {
    expect(describeBillingOutcome({ ...base, hasMollieCustomer: false, isManuallyBilled: true }).outcome)
      .toBe("manually_billed");
  });

  it("only moves the billing cursor when the total is zero", () => {
    expect(describeBillingOutcome({ ...base, totalAmountIncl: new Decimal(0) }).outcome)
      .toBe("marked_billed_only");
  });

  it("skips the invoice and the payment for a manually billed profile, but still moves the cursor", () => {
    const result = describeBillingOutcome({ ...base, isManuallyBilled: true });
    expect(result.outcome).toBe("manually_billed");
    expect(result.message).toContain("lastBilledAt");
  });

  it("treats a zero total as a zero total even when the profile is billed manually", () => {
    expect(
      describeBillingOutcome({ ...base, isManuallyBilled: true, totalAmountIncl: new Decimal(0) }).outcome
    ).toBe("marked_billed_only");
  });

  it("skips a pending profile", () => {
    expect(describeBillingOutcome({ ...base, profileStanding: "pending" }).outcome)
      .toBe("skipped_pending_profile");
  });

  it("reports a missing billing profile before anything else", () => {
    expect(
      describeBillingOutcome({ ...base, hasBillingProfile: false, profileStanding: null }).outcome
    ).toBe("skipped_no_billing_profile");
  });

  it("reports that nothing is due when no period is billable", () => {
    expect(describeBillingOutcome({ ...base, hasLines: false, totalAmountIncl: new Decimal(0) }).outcome)
      .toBe("nothing_to_bill");
  });
});
