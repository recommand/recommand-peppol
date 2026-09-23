import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// The read-only preview and the billing cycle must reach the same decision from
// the same rows. This runs both against one PostgreSQL, with the payment provider,
// the invoice sender and the notifier replaced by stubs that record every call.

let pool: Pool;
let previewTeamBilling: typeof import("../../data/billing/preview").previewTeamBilling;
let endBillingCycle: typeof import("../../data/billing/billing").endBillingCycle;

const THROUGH = new Date("2026-09-30T23:59:59.999Z");
const CURSOR_BEFORE = "2026-08-31T23:59:59.999Z";
const calls = { mandates: 0, payments: 0, invoices: 0, notifications: 0 };

async function seedBillingProfile(overrides: { isManuallyBilled?: boolean; profileStanding?: string; mollieCustomerId?: string | null } = {}) {
  await pool.query(
    `INSERT INTO peppol_billing_profiles
       (id, team_id, company_name, address, postal_code, city, country, vat_number, profile_standing, is_manually_billed, mollie_customer_id)
     VALUES ('bp_parity', $1, 'Example BV', '1 Street', '1000', 'Brussels', 'BE', 'BE0123456789', $2, $3, $4)`,
    [TEAM_ID, overrides.profileStanding ?? "active", overrides.isManuallyBilled ?? false, overrides.mollieCustomerId === undefined ? "cst_test" : overrides.mollieCustomerId]
  );
}

async function seedSubscriptionWithUsage(outgoing: number) {
  await pool.query(
    `INSERT INTO peppol_subscriptions (id, team_id, plan_id, plan_name, billing_config, start_date, last_billed_at)
     VALUES ('sub_parity', $1, 'professional', 'Professional custom', $2, '2026-09-01T00:00:00.000Z', $3)`,
    [TEAM_ID, JSON.stringify({ name: "Professional custom", basePrice: 0, includedMonthlyDocuments: 1000, documentOveragePrice: 0.06 }), CURSOR_BEFORE]
  );
  await pool.query(
    `INSERT INTO peppol_transfer_events (id, team_id, company_id, direction, created_at)
     SELECT 'te_' || generated, $1, $2, 'outgoing', '2026-09-15T12:00:00.000Z' FROM generate_series(1, $3) AS generated`,
    [TEAM_ID, COMPANY_ID, outgoing]
  );
}

async function cursor() {
  const { rows } = await pool.query(`SELECT last_billed_at FROM peppol_subscriptions WHERE id = 'sub_parity'`);
  return (rows[0].last_billed_at as Date).toISOString();
}

async function billingEventCount() {
  const { rows } = await pool.query(`SELECT count(*)::int AS count FROM peppol_subscription_billing_events`);
  return rows[0].count as number;
}

describe.skipIf(!testDatabaseUrl)("billing preview parity with the billing cycle", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({
      sendTelegramNotification: () => { calls.notifications++; },
      sendSystemAlert: () => { calls.notifications++; },
    }));
    const notInThisTest = () => { throw new Error("Not part of the billing cycle"); };
    mock.module("@peppol/data/mollie", () => ({
      getMandate: async () => { calls.mandates++; return { id: "mdt_test" }; },
      requestPayment: async () => { calls.payments++; },
      createMollieCustomer: notInThisTest,
      createFirstPayment: notInThisTest,
      processFirstPayment: notInThisTest,
      getMaxPaymentSize: notInThisTest,
      processPayment: notInThisTest,
    }));
    mock.module("@peppol/data/billing/invoicing", () => ({
      sendInvoiceAsBRBX: async () => { calls.invoices++; return "inv_test"; },
    }));
    previewTeamBilling = (await import("../../data/billing/preview")).previewTeamBilling;
    endBillingCycle = (await import("../../data/billing/billing")).endBillingCycle;
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    calls.mandates = calls.payments = calls.invoices = calls.notifications = 0;
    await pool.query(
      `TRUNCATE peppol_subscription_billing_event_lines, peppol_subscription_billing_events,
                peppol_subscriptions, peppol_billing_profiles, peppol_transfer_events CASCADE`
    );
  });

  it("stops the cycle for a profile without a payment customer, exactly as previewed", async () => {
    await seedBillingProfile({ mollieCustomerId: null });
    await seedSubscriptionWithUsage(1200);

    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(preview.outcome).toBe("blocked_no_payment_customer");

    const results = await endBillingCycle(THROUGH, false, [TEAM_ID]);
    expect(results.map((result) => [result.status, result.message])).toEqual([["error", "Billing profile has no Mollie customer id"]]);
    expect(await cursor()).toBe(CURSOR_BEFORE);
    expect(await billingEventCount()).toBe(0);
    expect(calls).toMatchObject({ mandates: 0, payments: 0, invoices: 0 });
  });

  it("moves only the cursor for a zero total, exactly as previewed", async () => {
    await seedBillingProfile({ mollieCustomerId: null });
    await seedSubscriptionWithUsage(10);

    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(preview.outcome).toBe("marked_billed_only");
    expect(preview.wouldAdvanceLastBilledAt).toBe(true);

    const results = await endBillingCycle(THROUGH, false, [TEAM_ID]);
    expect(results[0]).toMatchObject({ status: "success", isInvoiceSent: "", isPaymentRequested: "" });
    expect(await cursor()).toBe(THROUGH.toISOString());
    expect(await billingEventCount()).toBe(0);
    expect(calls).toMatchObject({ mandates: 0, payments: 0, invoices: 0, notifications: 0 });
  });

  it("moves only the cursor for a manually billed profile, exactly as previewed", async () => {
    await seedBillingProfile({ isManuallyBilled: true, mollieCustomerId: null });
    await seedSubscriptionWithUsage(1200);

    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(preview.outcome).toBe("manually_billed");

    const results = await endBillingCycle(THROUGH, false, [TEAM_ID]);
    expect(results[0]).toMatchObject({ status: "success", isInvoiceSent: "", isPaymentRequested: "" });
    expect(await cursor()).toBe(THROUGH.toISOString());
    expect(await billingEventCount()).toBe(0);
    expect(calls).toMatchObject({ mandates: 0, payments: 0, invoices: 0, notifications: 0 });
  });

  it("skips a pending profile without moving the cursor, exactly as previewed", async () => {
    await seedBillingProfile({ profileStanding: "pending" });
    await seedSubscriptionWithUsage(1200);

    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(preview.outcome).toBe("skipped_pending_profile");

    const results = await endBillingCycle(THROUGH, false, [TEAM_ID]);
    expect(results.map((result) => [result.status, result.message])).toEqual([["error", "Billing profile is pending"]]);
    expect(await cursor()).toBe(CURSOR_BEFORE);
  });

  it("invoices and charges a complete profile, exactly as previewed", async () => {
    await seedBillingProfile();
    await seedSubscriptionWithUsage(1200);

    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(preview.outcome).toBe("invoice_and_payment");
    expect(preview.totals.totalAmountIncl).toBe(14.52);

    const results = await endBillingCycle(THROUGH, false, [TEAM_ID]);
    expect(results[0]).toMatchObject({ status: "success", isInvoiceSent: "x", isPaymentRequested: "x", totalAmountIncl: 14.52 });
    expect(await cursor()).toBe(THROUGH.toISOString());
    expect(await billingEventCount()).toBe(1);
    expect(calls).toMatchObject({ mandates: 1, payments: 1, invoices: 1 });
  });
});
