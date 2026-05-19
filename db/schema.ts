import type { BillingConfig } from "../data/plans";
import { teams } from "@core/db/schema";
import {
  timestamp,
  pgTable,
  text,
  jsonb,
  pgEnum,
  decimal,
  boolean,
  type AnyPgColumn,
  index,
  primaryKey,
  serial,
  date,
} from "drizzle-orm/pg-core";
import { ulid } from "ulid";
import { isNotNull, SQL, sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Invoice } from "@peppol/utils/parsing/invoice/schemas";
import type { CreditNote } from "@peppol/utils/parsing/creditnote/schemas";
import { autoUpdateTimestamp } from "@recommand/db/custom-types";
import { COUNTRIES } from "@peppol/utils/countries";
import type { SelfBillingInvoice } from "@peppol/utils/parsing/self-billing-invoice/schemas";
import type { SelfBillingCreditNote } from "@peppol/utils/parsing/self-billing-creditnote/schemas";
import type {
  IntegrationConfiguration,
  IntegrationManifest,
  IntegrationState,
} from "@peppol/types/integration";
import { validationResponse, validationResult } from "@peppol/types/validation";
import type { MessageLevelResponse } from "@peppol/utils/parsing/message-level-response/schemas";
import { zodValidIsoIcdSchemeIdentifiers } from "@peppol/utils/iso-icd-scheme-identifiers";
import type { Representative } from "@peppol/data/cbe-public-search/types";

export const paymentStatusEnum = pgEnum("peppol_payment_status", [
  "none",
  "open",
  "pending",
  "authorized",
  "paid",
  "canceled",
  "expired",
  "failed",
]);

export const profileStandingEnum = pgEnum("peppol_profile_standing", [
  "pending",
  "active",
  "grace",
  "suspended",
]);

export const zodValidCountryCodes = z.enum(
  COUNTRIES.map((c) => c.code) as [string, ...string[]]
);
export const validCountryCodes = pgEnum(
  "peppol_valid_country_codes",
  zodValidCountryCodes.options
);


export const zodVerificationRequirements = z.enum(["strict", "trusted", "lax"]);
export const verificationRequirementsEnum = pgEnum("verification_requirements", zodVerificationRequirements.options);

export const validIsoIcdSchemeIdentifiers = pgEnum(
  "peppol_valid_iso_icd_scheme_identifiers",
  zodValidIsoIcdSchemeIdentifiers.options
);

export const supportedDocumentTypes = z.enum([
  "invoice",
  "creditNote",
  "selfBillingInvoice",
  "selfBillingCreditNote",
  "messageLevelResponse",
  "unknown",
]);
export const supportedDocumentTypeEnum = pgEnum(
  "peppol_supported_document_type",
  supportedDocumentTypes.options
);

export const transferEventDirectionEnum = pgEnum(
  "peppol_transfer_event_direction",
  ["incoming", "outgoing"]
);

export const transferEventTypeEnum = pgEnum("peppol_transfer_event_type", [
  "peppol",
  "email",
]);

export const validationResultEnum = pgEnum(
  "peppol_validation_result",
  validationResult.options
);

export function lower(email: AnyPgColumn): SQL {
  return sql`lower(${email})`;
}

export const billingProfiles = pgTable("peppol_billing_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => "bp_" + ulid()),
  teamId: text("team_id") // Not linked to teams table, as we don't want to delete the billing profile when the team is deleted
    .notNull()
    .unique(),
  mollieCustomerId: text("mollie_customer_id"),
  firstPaymentId: text("first_payment_id"),
  firstPaymentStatus: paymentStatusEnum("first_payment_status")
    .notNull()
    .default("none"),
  isMandateValidated: boolean("is_mandate_validated").notNull().default(false),
  profileStanding: profileStandingEnum("profile_standing")
    .notNull()
    .default("pending"),
  graceStartedAt: timestamp("grace_started_at", { withTimezone: true }),
  graceReason: text("grace_reason"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),

  companyName: text("company_name").notNull(),
  address: text("address").notNull(),
  postalCode: text("postal_code").notNull(),
  city: text("city").notNull(),
  country: validCountryCodes("country").notNull(),
  vatNumber: text("vat_number"),
  billingEmail: text("billing_email"),
  billingPeppolAddress: text("billing_peppol_address"),

  isManuallyBilled: boolean("is_manually_billed").notNull().default(false), // Set to true if the billing profile has to be billed manually, e.g. by an admin

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: autoUpdateTimestamp(),
});

export const subscriptions = pgTable("peppol_subscriptions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => "sub_" + ulid()),
  teamId: text("team_id") // Not linked to teams table, as we don't want to delete the subscription when the team is deleted
    .notNull(),
  planId: text("plan_id"),
  planName: text("plan_name").notNull(),
  billingConfig: jsonb("billing_config").$type<BillingConfig>().notNull(),
  startDate: timestamp("start_date", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  lastBilledAt: timestamp("last_billed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: autoUpdateTimestamp(),
});

export const subscriptionBillingEvents = pgTable(
  "peppol_subscription_billing_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "sbe_" + ulid()),
    teamId: text("team_id") // Not linked to teams table, as we don't want to delete the subscription billing events when the team is deleted
      .notNull(),
    billingProfileId: text("billing_profile_id")
      .references(() => billingProfiles.id)
      .notNull(),
    billingDate: timestamp("billing_date", { withTimezone: true }).notNull(),
    billingPeriodStart: timestamp("billing_period_start", {
      withTimezone: true,
    }).notNull(),
    billingPeriodEnd: timestamp("billing_period_end", {
      withTimezone: true,
    }).notNull(),
    totalAmountExcl: decimal("total_amount_excl").notNull(),
    vatAmount: decimal("vat_amount").notNull(),
    vatCategory: text("vat_category").notNull(),
    vatPercentage: decimal("vat_percentage").notNull(),
    totalAmountIncl: decimal("total_amount_incl").notNull(),
    usedQty: decimal("used_qty").notNull(),
    usedQtyIncoming: decimal("used_qty_incoming").notNull(),
    usedQtyOutgoing: decimal("used_qty_outgoing").notNull(),
    overageQtyIncoming: decimal("overage_qty_incoming").notNull(),
    overageQtyOutgoing: decimal("overage_qty_outgoing").notNull(),

    // Payment
    amountDue: decimal("amount_due").notNull(),
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("none"),
    paymentId: text("payment_id"),
    paidAmount: decimal("paid_amount"),
    paymentMethod: text("payment_method"),
    paymentDate: timestamp("payment_date"),

    // Invoice
    invoiceId: text("invoice_id").unique(),
    invoiceReference: serial("invoice_reference").unique(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  }
);

export const subscriptionBillingEventLines = pgTable(
  "peppol_subscription_billing_event_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "sbel_" + ulid()),
    subscriptionBillingEventId: text("subscription_billing_event_id")
      .references(() => subscriptionBillingEvents.id)
      .notNull(),
    subscriptionId: text("subscription_id").notNull(),
    subscriptionStartDate: timestamp("subscription_start_date", { withTimezone: true }).notNull(),
    subscriptionEndDate: timestamp("subscription_end_date", { withTimezone: true }).notNull(),
    subscriptionLastBilledAt: timestamp("subscription_last_billed_at", { withTimezone: true }).notNull(),
    billingConfig: jsonb("billing_config").$type<BillingConfig>().notNull(),
    planId: text("plan_id"),
    includedMonthlyDocuments: decimal("included_monthly_documents").notNull(),
    basePrice: decimal("base_price").notNull(),
    incomingDocumentOveragePrice: decimal("incoming_document_overage_price").notNull(),
    outgoingDocumentOveragePrice: decimal("outgoing_document_overage_price").notNull(),
    usedQty: decimal("used_qty").notNull(),
    usedQtyIncoming: decimal("used_qty_incoming").notNull(),
    usedQtyOutgoing: decimal("used_qty_outgoing").notNull(),
    overageQtyIncoming: decimal("overage_qty_incoming").notNull(),
    overageQtyOutgoing: decimal("overage_qty_outgoing").notNull(),

    // Invoice line details
    name: text("name").notNull(),
    description: text("description").notNull(),
    totalAmountExcl: decimal("total_amount_excl").notNull(),
  }
);

export const companies = pgTable("peppol_companies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => "c_" + ulid()),
  teamId: text("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  postalCode: text("postal_code").notNull(),
  city: text("city").notNull(),
  country: validCountryCodes("country").notNull(),
  enterpriseNumberScheme: validIsoIcdSchemeIdentifiers("enterprise_number_scheme"),
  enterpriseNumber: text("enterprise_number"),
  vatNumber: text("vat_number"),
  email: text("email"),
  phone: text("phone"),
  isSmpRecipient: boolean("is_smp_recipient").notNull().default(true),
  isVerified: boolean("is_verified").notNull().default(false),
  verificationProofReference: text("verification_proof_reference"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: autoUpdateTimestamp(),
});

export const verificationStatusEnum = pgEnum("verification_status", ["opened", "idVerificationRequested", "inReview", "verified", "rejected", "error"]);

export const companyVerificationLog = pgTable(
  "company_verification_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "cvl_" + ulid()),
    companyId: text("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    status: verificationStatusEnum("status").notNull().default("opened"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    companyName: text("company_name"),
    enterpriseNumber: text("enterprise_number"),
    verificationProofReference: text("verification_proof_reference"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export const enterpriseDataCache = pgTable(
  "enterprise_data_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "edc_" + ulid()),
    enterpriseNumber: text("enterprise_number").notNull(),
    country: validCountryCodes("country").notNull(),
    name: text("name"),
    beginDate: date("begin_date"),
    street: text("street"),
    number: text("number"),
    postalCode: text("postal_code"),
    city: text("city"),
    juridicalFormCode: text("juridical_form_code"),
    juridicalFormDescription: text("juridical_form_description"),
    juridicalFormBeginDate: date("juridical_form_begin_date"),
    denominationCode: text("denomination_code"),
    denominationDescription: text("denomination_description"),
    denominationBeginDate: date("denomination_begin_date"),
    representatives: jsonb("representatives").$type<Representative[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    uniqueIndex("enterprise_data_cache_unique").on(table.enterpriseNumber, table.country),
  ]
);

export const companyIdentifiers = pgTable(
  "peppol_company_identifiers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "ci_" + ulid()),
    companyId: text("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    scheme: text("scheme").notNull(),
    identifier: text("identifier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    uniqueIndex("peppol_company_identifiers_unique").on(
      table.companyId,
      lower(table.scheme),
      lower(table.identifier)
    ),
  ]
);

export const companyDocumentTypes = pgTable(
  "peppol_company_document_types",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "cdt_" + ulid()),
    companyId: text("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    docTypeId: text("doc_type_id").notNull(),
    processId: text("process_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    uniqueIndex("peppol_company_document_types_unique").on(
      table.companyId,
      table.docTypeId,
      table.processId
    ),
  ]
);

export const companyNotificationEmailAddresses = pgTable(
  "peppol_company_notification_email_addresses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "cnea_" + ulid()),
    companyId: text("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    email: text("email").notNull(),
    notifyIncoming: boolean("notify_incoming").notNull().default(false),
    notifyOutgoing: boolean("notify_outgoing").notNull().default(false),
    includeAutoGeneratedPdfIncoming: boolean(
      "include_auto_generated_pdf_incoming"
    )
      .notNull()
      .default(false),
    includeAutoGeneratedPdfOutgoing: boolean(
      "include_auto_generated_pdf_outgoing"
    )
      .notNull()
      .default(false),
    includeDocumentJsonIncoming: boolean("include_document_json_incoming")
      .notNull()
      .default(false),
    includeDocumentJsonOutgoing: boolean("include_document_json_outgoing")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    uniqueIndex("peppol_company_notification_email_addresses_unique").on(
      table.companyId,
      lower(table.email)
    ),
  ]
);

export const webhooks = pgTable("peppol_webhooks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => "wh_" + ulid()),
  teamId: text("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  companyId: text("company_id").references(() => companies.id, {
    onDelete: "cascade",
  }),
  url: text("url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: autoUpdateTimestamp(),
});

export const transferEvents = pgTable("peppol_transfer_events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => "te_" + ulid()),
  teamId: text("team_id") // Not linked to teams table, as we don't want to delete the transfer events when the team is deleted
    .notNull(),
  companyId: text("company_id").notNull(),
  type: transferEventTypeEnum("type").notNull().default("peppol"),
  transmittedDocumentId: text("transmitted_document_id"),
  direction: transferEventDirectionEnum("direction").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const transmittedDocuments = pgTable(
  "peppol_transmitted_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "doc_" + ulid()),
    teamId: text("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    companyId: text("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    direction: transferEventDirectionEnum("direction").notNull(),

    senderId: text("sender_id").notNull(), // e.g. 0208:1012081766
    receiverId: text("receiver_id"), // e.g. 0208:1012081766 (can be null for email-only documents)
    docTypeId: text("doc_type_id").notNull(), // e.g. urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1
    processId: text("process_id").notNull(), // e.g. urn:fdc:peppol.eu:2017:poacc:billing:01:1.0
    countryC1: text("country_c1").notNull(), // e.g. BE
    xml: text("xml"), // XML body of the document, can be null if the body was not kept

    sentOverPeppol: boolean("sent_over_peppol").notNull().default(true),
    sentOverEmail: boolean("sent_over_email").notNull().default(false),
    emailRecipients: text("email_recipients").notNull().array().default([]),

    type: supportedDocumentTypeEnum("type").notNull().default("unknown"),
    parsed: jsonb("parsed").$type<
      | Invoice
      | CreditNote
      | SelfBillingInvoice
      | SelfBillingCreditNote
      | MessageLevelResponse
    >(),
    validation: jsonb("validation").$type<z.infer<typeof validationResponse>>(),

    senderName: text("sender_name"),
    receiverName: text("receiver_name"),
    documentNumber: text("document_number"),
    // Important: after applying the migration for these columns, run
    // scripts/backfill-transmitted-document-search.ts to backfill search data
    // and create the indexes. Those indexes are managed outside Drizzle
    // migrations because they must be created concurrently on this large table.
    searchText: text("search_text"),

    peppolMessageId: text("peppol_message_id"),
    peppolConversationId: text("peppol_conversation_id"),
    receivedPeppolSignalMessage: text("received_peppol_signal_message"),
    envelopeId: text("envelope_id"),

    readAt: timestamp("read_at"), // defaults to null, set when the document is read
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  }
);

export const transmittedDocumentLabels = pgTable(
  "peppol_transmitted_document_labels",
  {
    transmittedDocumentId: text("transmitted_document_id")
      .references(() => transmittedDocuments.id, { onDelete: "cascade" })
      .notNull(),
    labelId: text("label_id")
      .references(() => labels.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "peppol_transmitted_document_labels_pkey",
      columns: [table.transmittedDocumentId, table.labelId],
    }),
  ]
);

export const teamExtensions = pgTable("peppol_team_extensions", {
  id: text("id")
    .primaryKey()
    .references(() => teams.id, { onDelete: "cascade" }),
  isPlayground: boolean("is_playground").notNull().default(false),
  useTestNetwork: boolean("use_test_network").notNull().default(false),
  verificationRequirements: verificationRequirementsEnum("verification_requirements").notNull().default("lax"),
  companyVerificationExtensionUntil: timestamp("company_verification_extension_until", { withTimezone: true }),
  supportEmailAddress: text("support_email_address"),
});

export const labels = pgTable(
  "peppol_labels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "lbl_" + ulid()),
    teamId: text("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    colorHex: text("color_hex").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    uniqueIndex("peppol_labels_external_id_unique")
      .on(table.teamId, table.externalId)
      .where(isNotNull(table.externalId)),
  ]
);

export const supportingDataSuppliers = pgTable(
  "supporting_data_suppliers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "sd_supp_" + ulid()), // Supporting Data Supplier
    teamId: text("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    vatNumber: text("vat_number"),
    peppolAddresses: text("peppol_addresses").notNull().array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    index("supporting_suppliers_team_id_idx").on(table.teamId),
    uniqueIndex("supporting_suppliers_external_id_unique")
      .on(table.teamId, table.externalId)
      .where(isNotNull(table.externalId)),
  ]
);

export const supportingDataSupplierLabels = pgTable(
  "supporting_data_supplier_labels",
  {
    supportingDataSupplierId: text("supporting_data_supplier_id")
      .references(() => supportingDataSuppliers.id, { onDelete: "cascade" })
      .notNull(),
    labelId: text("label_id")
      .references(() => labels.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "supporting_data_supplier_labels_pkey",
      columns: [table.supportingDataSupplierId, table.labelId],
    }),
  ]
);

export const supportingDataCustomers = pgTable(
  "supporting_data_customers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "sd_cust_" + ulid()),
    teamId: text("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    vatNumber: text("vat_number"),
    enterpriseNumber: text("enterprise_number"),
    peppolAddresses: text("peppol_addresses").notNull().array().default([]),
    address: text("address").notNull(),
    city: text("city").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull(),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    index("supporting_customers_team_id_idx").on(table.teamId),
    uniqueIndex("supporting_customers_external_id_unique")
      .on(table.teamId, table.externalId)
      .where(isNotNull(table.externalId)),
  ]
);

export const activatedIntegrations = pgTable(
  "activated_integrations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "itg_" + ulid()),
    teamId: text("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    companyId: text("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    manifest: jsonb("manifest").$type<IntegrationManifest>().notNull(),
    configuration: jsonb("configuration").$type<IntegrationConfiguration>(),
    state: jsonb("state").$type<IntegrationState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [index("activated_integrations_team_id_idx").on(table.teamId)]
);

export const integrationTaskLogs = pgTable("integration_task_logs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => "itl_" + ulid()),
  integrationId: text("integration_id")
    .references(() => activatedIntegrations.id, { onDelete: "cascade" })
    .notNull(),
  event: text("event").notNull(),
  task: text("task").notNull(),
  success: boolean("success").notNull(),
  message: text("message").notNull(),
  context: text("context").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: autoUpdateTimestamp(),
});

export const paymentFailureReminders = pgTable("peppol_payment_failure_reminders", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => "pfr_" + ulid()),
  billingEventId: text("billing_event_id")
    .references(() => subscriptionBillingEvents.id, { onDelete: "cascade" })
    .notNull(),
  emailAddresses: text("email_addresses").notNull().array().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
