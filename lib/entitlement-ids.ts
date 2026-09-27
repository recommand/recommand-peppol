/**
 * The commercial rights this package enforces, by id. Kept free of server code so
 * the dashboard can refer to them too.
 */
export const PEPPOL_ENTITLEMENTS = Object.freeze({
  TRANSACTIONS: "peppol.transactions",
  INTEGRATIONS: "peppol.integrations",
});

export type PeppolEntitlementId = (typeof PEPPOL_ENTITLEMENTS)[keyof typeof PEPPOL_ENTITLEMENTS];
