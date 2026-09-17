import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { COMPANY_ID, TEAM_ID, connectTestDatabase, seedTeamAndCompany, testDatabaseUrl } from "./harness";

// The billing preview promises two things a faked database cannot show: that it
// reports what the billing cycle would report, and that running it leaves the
// database byte for byte as it was. Both are asserted here against a real
// PostgreSQL, over the tables the billing cycle writes to.

let pool: Pool;
let previewTeamBilling: typeof import("../../data/billing/preview").previewTeamBilling;

const THROUGH = new Date("2026-09-30T23:59:59.999Z");

const WRITTEN_TABLES = [
  "peppol_subscriptions",
  "peppol_billing_profiles",
  "peppol_subscription_billing_events",
  "peppol_subscription_billing_event_lines",
  "peppol_transfer_events",
  "peppol_transmitted_documents",
] as const;

/** Everything the billing cycle would touch, as data, so a write cannot hide. */
async function databaseSnapshot() {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of WRITTEN_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
    snapshot[table] = rows;
  }
  return snapshot;
}

async function seedBillingProfile(
  overrides: { isManuallyBilled?: boolean; profileStanding?: string; vatNumber?: string | null; mollieCustomerId?: string | null } = {}
) {
  await pool.query(
    `INSERT INTO peppol_billing_profiles
       (id, team_id, company_name, address, postal_code, city, country, vat_number, profile_standing, is_manually_billed, mollie_customer_id)
     VALUES ('bp_test', $1, 'Example BV', '1 Street', '1000', 'Brussels', 'BE', $2, $3, $4, $5)`,
    [
      TEAM_ID,
      overrides.vatNumber === undefined ? "BE0123456789" : overrides.vatNumber,
      overrides.profileStanding ?? "active",
      overrides.isManuallyBilled ?? false,
      overrides.mollieCustomerId === undefined ? "cst_test" : overrides.mollieCustomerId,
    ]
  );
}

async function seedSubscription(billingConfig: Record<string, unknown>, startDate = "2026-09-01T00:00:00.000Z") {
  await pool.query(
    `INSERT INTO peppol_subscriptions (id, team_id, plan_id, plan_name, billing_config, start_date, last_billed_at)
     VALUES ('sub_preview', $1, 'professional', $2, $3, $4, '2026-08-31T23:59:59.999Z')`,
    [TEAM_ID, billingConfig.name, JSON.stringify(billingConfig), startDate]
  );
}

async function seedUsage(direction: "incoming" | "outgoing", count: number) {
  await pool.query(
    `INSERT INTO peppol_transfer_events (id, team_id, company_id, direction, created_at)
     SELECT 'te_' || $4 || '_' || generated, $1, $2, $3, '2026-09-15T12:00:00.000Z'
     FROM generate_series(1, $5) AS generated`,
    [TEAM_ID, COMPANY_ID, direction, direction, count]
  );
}

const customRates = {
  name: "Professional custom",
  basePrice: 0,
  includedMonthlyDocuments: 1000,
  documentOveragePrice: 0.06,
};

describe.skipIf(!testDatabaseUrl)("billing preview against PostgreSQL", () => {
  beforeAll(async () => {
    pool = await connectTestDatabase();
    mock.module("@recommand/db", () => ({ db: drizzle(pool) }));
    mock.module("@peppol/utils/system-notifications/telegram", () => ({
      sendTelegramNotification: () => {
        throw new Error("The preview must not notify");
      },
      sendSystemAlert: () => {
        throw new Error("The preview must not notify");
      },
    }));
    // Nothing stubs the payment provider on purpose: no Mollie credentials are set
    // here, so any call the preview made would fail loudly rather than pass quietly.
    previewTeamBilling = (await import("../../data/billing/preview")).previewTeamBilling;
    await seedTeamAndCompany(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE peppol_subscription_billing_event_lines, peppol_subscription_billing_events,
                peppol_subscriptions, peppol_billing_profiles, peppol_transfer_events,
                peppol_transmitted_documents CASCADE`
    );
  });

  it("charges the overage above the allowance, at the rate on the subscription", async () => {
    await seedBillingProfile();
    await seedSubscription(customRates);
    await seedUsage("outgoing", 1200);

    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });

    expect(preview.outcome).toBe("invoice_and_payment");
    expect(preview.totals.totalAmountExcl).toBe(12); // 200 over at 0.06
    expect(preview.totals.vatAmount).toBe(2.52);
    expect(preview.totals.totalAmountIncl).toBe(14.52);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({
      subscriptionId: "sub_preview",
      planId: "professional",
      planName: "Professional custom",
      overageQtyOutgoing: 200,
      lineTotalExcl: 12,
    });
  });

  it("leaves the database untouched", async () => {
    await seedBillingProfile();
    await seedSubscription(customRates);
    await seedUsage("outgoing", 1200);

    const before = await databaseSnapshot();
    await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(await databaseSnapshot()).toEqual(before);
  });

  it("leaves the database untouched for a manually billed profile", async () => {
    await seedBillingProfile({ isManuallyBilled: true });
    await seedSubscription(customRates);
    await seedUsage("outgoing", 1200);

    const before = await databaseSnapshot();
    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });

    expect(preview.outcome).toBe("manually_billed");
    expect(preview.totals.totalAmountExcl).toBe(12);
    expect(preview.wouldSendInvoice).toBe(false);
    expect(preview.wouldRequestPayment).toBe(false);
    expect(preview.wouldAdvanceLastBilledAt).toBe(true);
    expect(await databaseSnapshot()).toEqual(before);
  });

  it("leaves the database untouched when the total is zero, and does not move the cursor itself", async () => {
    await seedBillingProfile();
    await seedSubscription(customRates);
    await seedUsage("outgoing", 10);

    const before = await databaseSnapshot();
    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });

    expect(preview.outcome).toBe("marked_billed_only");
    expect(preview.totals.totalAmountIncl).toBe(0);
    expect(preview.wouldAdvanceLastBilledAt).toBe(true);

    const after = await databaseSnapshot();
    expect(after).toEqual(before);
    expect((after.peppol_subscriptions[0] as { last_billed_at: Date }).last_billed_at.toISOString())
      .toBe("2026-08-31T23:59:59.999Z");
  });

  it("promises no invoice, payment or cursor move when the profile has no payment customer", async () => {
    await seedBillingProfile({ mollieCustomerId: null });
    await seedSubscription(customRates);
    await seedUsage("outgoing", 1200);

    const before = await databaseSnapshot();
    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });

    expect(preview.outcome).toBe("blocked_no_payment_customer");
    expect(preview.billingProfile?.hasMollieCustomer).toBe(false);
    expect(preview.wouldCreateBillingEvent).toBe(false);
    expect(preview.wouldSendInvoice).toBe(false);
    expect(preview.wouldRequestPayment).toBe(false);
    expect(preview.wouldAdvanceLastBilledAt).toBe(false);
    expect(preview.totals.totalAmountExcl).toBe(12);
    expect(await databaseSnapshot()).toEqual(before);
  });

  it("keeps the zero total and manual outcomes without a payment customer", async () => {
    await seedBillingProfile({ mollieCustomerId: null });
    await seedSubscription(customRates);
    await seedUsage("outgoing", 10);
    expect((await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH })).outcome).toBe("marked_billed_only");

    await pool.query(`TRUNCATE peppol_billing_profiles, peppol_transfer_events CASCADE`);
    await seedBillingProfile({ mollieCustomerId: null, isManuallyBilled: true });
    await seedUsage("outgoing", 1200);
    const manual = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(manual.outcome).toBe("manually_billed");
    expect(manual.wouldAdvanceLastBilledAt).toBe(true);
  });

  it("reports a pending profile as skipped without writing", async () => {
    await seedBillingProfile({ profileStanding: "pending" });
    await seedSubscription(customRates);
    await seedUsage("outgoing", 1200);

    const before = await databaseSnapshot();
    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });

    expect(preview.outcome).toBe("skipped_pending_profile");
    expect(preview.wouldAdvanceLastBilledAt).toBe(false);
    expect(await databaseSnapshot()).toEqual(before);
  });

  it("reports a team with no billing profile without writing", async () => {
    await seedSubscription(customRates);

    const before = await databaseSnapshot();
    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });

    expect(preview.outcome).toBe("skipped_no_billing_profile");
    expect(preview.lines).toHaveLength(0);
    expect(await databaseSnapshot()).toEqual(before);
  });

  it("bills each period at its own rates when the rates changed mid-period", async () => {
    await seedBillingProfile();
    await pool.query(
      `INSERT INTO peppol_subscriptions (id, team_id, plan_id, plan_name, billing_config, start_date, end_date, last_billed_at)
       VALUES ('sub_before', $1, 'professional', 'Professional 1000', $2, '2026-01-01T00:00:00.000Z',
               '2026-09-30T23:59:59.999Z', '2026-08-31T23:59:59.999Z')`,
      [TEAM_ID, JSON.stringify({ name: "Professional 1000", basePrice: 99, includedMonthlyDocuments: 1000, documentOveragePrice: 0.1 })]
    );
    await pool.query(
      `INSERT INTO peppol_subscriptions (id, team_id, plan_id, plan_name, billing_config, start_date)
       VALUES ('sub_after', $1, 'professional', 'Professional custom', $2, '2026-10-01T00:00:00.000Z')`,
      [TEAM_ID, JSON.stringify(customRates)]
    );

    const before = await databaseSnapshot();
    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });

    // Only the old period is due on this date, and it is charged at its own rates.
    expect(preview.lines.map((line) => line.subscriptionId)).toEqual(["sub_before"]);
    expect(preview.totals.totalAmountExcl).toBe(99);
    expect(await databaseSnapshot()).toEqual(before);
  });

  it("reverse charges a customer outside Belgium", async () => {
    await seedBillingProfile({ vatNumber: "NL123456789B01" });
    await seedSubscription(customRates);
    await seedUsage("outgoing", 1200);

    const preview = await previewTeamBilling({ teamId: TEAM_ID, billingDate: THROUGH });
    expect(preview.vat).toMatchObject({ category: "AE", percentage: 0 });
    expect(preview.totals.totalAmountIncl).toBe(12);
  });
});
