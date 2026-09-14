import type { BillingConfig } from "../data/plans";
import type { ArratechOnboarding } from "@peppol/data/at/kyc-onboarding-state";
import type { VerificationCountrySpecific } from '@peppol/types/verification-country-specific';
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
  integer,
} from "drizzle-orm/pg-core";
import { ulid } from "ulid";
import { isNotNull, SQL, sql } from "drizzle-orm";
import { uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { autoUpdateTimestamp } from "@recommand/db/custom-types";
import { COUNTRIES } from "@peppol/utils/countries";
import type {
  IntegrationConfiguration,
  IntegrationManifest,
  IntegrationState,
} from "@peppol/types/integration";
import { validationResponse, validationResult } from "@peppol/types/validation";
import { STORED_DOCUMENT_TYPE_KEYS } from "@peppol/utils/type-repository/document-types/keys";
import type { ParsedDocument } from "@peppol/utils/type-repository/document-types/parsed";
import { zodValidIsoIcdSchemeIdentifiers } from "@peppol/utils/iso-icd-scheme-identifiers";
import type { Representative } from "@peppol/data/cbe-public-search/types";
import type { EmailFallbackRequest } from "@peppol/data/deliveries/email-fallback";
import { labels } from "@directory/db/schema";

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

export const supportedDocumentTypes = z.enum(STORED_DOCUMENT_TYPE_KEYS);
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
  "reporting",
]);

export const validationResultEnum = pgEnum(
  "peppol_validation_result",
  validationResult.options
);

export const accessPointProviderIds = [
  "recommand-ap1",
  "at-shared-ap-fr",
] as const;
export const zodAccessPointProviderIds = z.enum(accessPointProviderIds);
export const accessPointProviderEnum = pgEnum(
  "peppol_access_point_provider",
  accessPointProviderIds
);

export const smpProviderIds = ["recommand-smp1", "at-shared-smp-fr"] as const;
export const zodSmpProviderIds = z.enum(smpProviderIds);
export const smpProviderEnum = pgEnum("peppol_smp_provider", smpProviderIds);

// Where a document payload (xml / parsed attachments) currently lives.
// "none" = the payload was never kept, "db" = stored in this row, "s3" = offloaded to S3.
export const payloadLocationEnum = pgEnum("peppol_payload_location", [
  "none",
  "db",
  "s3",
]);

export const originalPayloadContainerFormats = ["none", "pdf"] as const;
export const originalPayloadContainerFormatEnum = pgEnum(
  "peppol_original_payload_container_format",
  originalPayloadContainerFormats
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
  accessPointProvider: accessPointProviderEnum("access_point_provider")
    .notNull()
    .default("recommand-ap1"),
  smpProvider: smpProviderEnum("smp_provider")
    .notNull()
    .default("recommand-smp1"),
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
    countrySpecific: jsonb('country_specific').$type<VerificationCountrySpecific>(),
    address: text("address"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: validCountryCodes("country"),
    verificationProofReference: text("verification_proof_reference"),
    // When the representative signed the mandate that is filed with the KYC.
    mandateAcceptedAt: timestamp("mandate_accepted_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    arratechOnboarding: jsonb("arratech_onboarding").$type<ArratechOnboarding>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

// French e-reporting (DGFiP Flux 10) is filed through our reporting partner, which
// only accepts events for a SIREN that was registered to us as a declarant first.
// One registration per company and environment: the partner keeps TEST and PROD
// registrations apart, and a SIREN can be held by a single organisation per
// environment.
export const frReportingEnvironments = ["PROD", "TEST"] as const;
export const zodFrReportingEnvironments = z.enum(frReportingEnvironments);
export const frReportingEnvironmentEnum = pgEnum(
  "peppol_fr_reporting_environment",
  frReportingEnvironments
);

// The VAT regime drives the filing cadence and period boundaries of the declarant.
export const frVatRegimes = [
  "REEL_NORMAL_MENSUEL",
  "REEL_SIMPLIFIE",
  "FRANCHISE_EN_BASE",
] as const;
export const zodFrVatRegimes = z.enum(frVatRegimes);
export const frVatRegimeEnum = pgEnum("peppol_fr_vat_regime", frVatRegimes);

// VAT point of taxation. Payment events (sub-fluxes 10.2 and 10.4) only exist under
// ENCAISSEMENTS; under DEBITS they are out of scope.
export const frVatExigibilities = ["ENCAISSEMENTS", "DEBITS"] as const;
export const zodFrVatExigibilities = z.enum(frVatExigibilities);
export const frVatExigibilityEnum = pgEnum(
  "peppol_fr_vat_exigibility",
  frVatExigibilities
);

// pending: waiting for (or retrying) the registration with the partner.
// registered: the partner accepted the registration, or the registration is
// simulated because the team never reaches the partner.
// blocked: the partner refused it or retries ran out; support has to intervene.
export const frReportingDeclarantStates = ["pending", "registered", "blocked"] as const;
export const zodFrReportingDeclarantStates = z.enum(frReportingDeclarantStates);
export const frReportingDeclarantStateEnum = pgEnum(
  "peppol_fr_reporting_declarant_state",
  frReportingDeclarantStates
);

export const frReportingDeclarants = pgTable(
  "peppol_fr_reporting_declarants",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "frd_" + ulid()),
    companyId: text("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    environment: frReportingEnvironmentEnum("environment").notNull(),
    siren: text("siren").notNull(),
    // Legal name carried as the issuer on every report filed for this declarant.
    issuerName: text("issuer_name").notNull(),
    vatRegime: frVatRegimeEnum("vat_regime").notNull(),
    vatExigibility: frVatExigibilityEnum("vat_exigibility").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // Playground and test-network teams never reach the partner: their registration
    // is recorded here only, and their reports are simulated.
    simulated: boolean("simulated").notNull().default(false),
    state: frReportingDeclarantStateEnum("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastError: text("last_error"),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    // The partner's last view of the registration, kept for support.
    partnerSnapshot: jsonb("partner_snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    uniqueIndex("peppol_fr_reporting_declarants_company_environment_idx").on(
      table.companyId,
      table.environment
    ),
    index("peppol_fr_reporting_declarants_due_idx").on(
      table.state,
      table.nextAttemptAt
    ),
  ]
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
    accessPointProvider: accessPointProviderEnum("access_point_provider")
      .notNull()
      .default("recommand-ap1"),
    smpProvider: smpProviderEnum("smp_provider")
      .notNull()
      .default("recommand-smp1"),
    xml: text("xml"), // XML body of the document. Null when xmlLocation is "none" (not kept) or "s3" (offloaded).
    // Single source of truth for where the xml body lives. See data/offload.
    xmlLocation: payloadLocationEnum("xml_location").notNull().default("db"),
    // Single source of truth for where the parsed attachments live. When "s3" the
    // attachments are stored as JSON next to the xml; when "none" there are none.
    attachmentsLocation: payloadLocationEnum("attachments_location")
      .notNull()
      .default("db"),
    originalPayloadLocation: payloadLocationEnum("original_payload_location")
      .notNull()
      .default("none"),
    originalPayloadContainerFormat: originalPayloadContainerFormatEnum(
      "original_payload_container_format"
    )
      .notNull()
      .default("none"),
    // The exact S3 key prefix used when this document's payloads were offloaded,
    // without a suffix. Resolve a payload by appending ".xml" or
    // ".attachments.json". Original binary payloads use ".original". Null until
    // a document payload is stored in S3. Stored (rather
    // than re-derived) so reads/deletes are immune to changes in the key scheme.
    s3KeyPrefix: text("s3_key_prefix"),
    // Set when an offload worker claims this row, so other workers/instances
    // skip it while it is being uploaded. A stale claim (older than the worker's
    // threshold) is treated as abandoned and the row becomes eligible again.
    offloadClaimedAt: timestamp("offload_claimed_at", { withTimezone: true }),

    sentOverPeppol: boolean("sent_over_peppol").notNull().default(true),
    sentOverEmail: boolean("sent_over_email").notNull().default(false),
    emailRecipients: text("email_recipients").notNull().array().default([]),
    // The email the sender asked for in case the Peppol transmission fails, when the
    // access point accepted the transmission and has not yet said whether it arrived.
    // Marked started when it is acted on and cleared when that is done, so a failure
    // reported twice sends it once and a run that stops can be resumed (see
    // data/deliveries/email-fallback).
    emailFallback: jsonb("email_fallback").$type<EmailFallbackRequest>(),

    type: supportedDocumentTypeEnum("type").notNull().default("unknown"),
    parsed: jsonb("parsed").$type<ParsedDocument>(),
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
    // The sending access point provider's own transaction reference (e.g. the
    // Arratech transaction id), used to correlate provider callbacks/webhooks
    // with this document. Null for providers that don't expose one.
    apTransactionId: text("ap_transaction_id"),
    // Identifier assigned by an external filing service to a document that was not
    // exchanged over Peppol (e.g. the reporting partner's flow id for a French B2C
    // report). Null for documents sent over Peppol or email.
    externalReferenceId: text("external_reference_id"),

    readAt: timestamp("read_at"), // defaults to null, set when the document is read
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    index("peppol_transmitted_documents_offload_idx").on(
      table.xmlLocation,
      table.createdAt,
      table.offloadClaimedAt
    ),
    // Unique: one transmitted document per access point transaction. Both the
    // sending pipeline and the provider webhooks write this id, and the
    // constraint is what makes a transaction impossible to record twice
    // instead of merely unlikely to be.
    // The few documents with a fallback waiting or under way, for the drain that
    // resumes stopped runs.
    index("peppol_transmitted_documents_email_fallback_idx")
      .on(table.id)
      .where(isNotNull(table.emailFallback)),
    uniqueIndex("peppol_transmitted_documents_ap_transaction_id_idx")
      .on(table.apTransactionId)
      .where(isNotNull(table.apTransactionId)),
    // Unique: one document per filing. A report retried under the same reference
    // comes back from the filing service with the same reference id, and the
    // constraint is what turns that retry into the existing document instead of a
    // second one with its own billing.
    uniqueIndex("peppol_transmitted_documents_external_reference_id_idx")
      .on(table.externalReferenceId)
      .where(isNotNull(table.externalReferenceId)),
  ]
);

// Where a filed e-reporting event stands with the tax administration. The first two
// are the states an event is accepted into; the other four are reached later and
// are terminal. `pending_rectificative` means the event arrived after its period
// was filed and will be carried by a corrective filing: it is not on any report yet.
export const frReportingStatuses = [
  "accepted",
  "pending_rectificative",
  "filed",
  "filed_rectificative",
  "superseded",
  "rejected",
] as const;
export const zodFrReportingStatuses = z.enum(frReportingStatuses);
export const frReportingStatusEnum = pgEnum(
  "peppol_fr_reporting_status",
  frReportingStatuses
);

// One row per e-reporting event we filed, keyed by the partner's flow id. The
// partner sends no webhook for reporting, so the status is polled from here until
// it is terminal; the document itself only knows the flow id.
export const frReportingSubmissions = pgTable(
  "peppol_fr_reporting_submissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "frs_" + ulid()),
    transmittedDocumentId: text("transmitted_document_id")
      .references(() => transmittedDocuments.id, { onDelete: "cascade" })
      .notNull(),
    declarantId: text("declarant_id").references(() => frReportingDeclarants.id, {
      onDelete: "set null",
    }),
    teamId: text("team_id").notNull(),
    companyId: text("company_id").notNull(),
    environment: frReportingEnvironmentEnum("environment").notNull(),
    // The partner's handle for the event; the document's external reference id.
    flowId: text("flow_id").notNull(),
    reference: text("reference").notNull(),
    subFlux: text("sub_flux").notNull(),
    operation: text("operation").notNull(),
    transmissionType: text("transmission_type").notNull(),
    // Simulated filings never reach the partner and are never polled.
    simulated: boolean("simulated").notNull().default(false),
    // The partner's internal ledger state, kept for support.
    ledgerStatus: text("ledger_status"),
    reportingStatus: frReportingStatusEnum("reporting_status").notNull().default("accepted"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    operationDate: text("operation_date"),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    submissionId: text("submission_id"),
    outcomeCode: text("outcome_code"),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    // Null once there is nothing left to learn: terminal status, simulated, or
    // given up on.
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    checkAttempts: integer("check_attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    uniqueIndex("peppol_fr_reporting_submissions_flow_id_idx").on(table.flowId),
    uniqueIndex("peppol_fr_reporting_submissions_document_idx").on(
      table.transmittedDocumentId
    ),
    index("peppol_fr_reporting_submissions_due_idx").on(table.nextCheckAt),
  ]
);

// Queue of S3 key prefixes whose objects must be deleted. Rows are enqueued in
// the same transaction that deletes documents (or a whole company), so the
// HTTP request returns as soon as the database rows are gone and a background
// worker removes the S3 objects afterwards (see data/s3-deletion). One row
// covers everything under its prefix, so deleting a company with 100k
// offloaded documents enqueues a single row.
export const pendingS3Deletions = pgTable(
  "pending_s3_deletions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "psd_" + ulid()),
    prefix: text("prefix").notNull(),
    // Set when a worker claims this row, so other workers/instances skip it
    // while its prefix is being drained. A stale claim (older than the worker's
    // threshold) is treated as abandoned and the row becomes eligible again.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("pending_s3_deletions_claim_idx").on(
      table.claimedAt,
      table.createdAt
    ),
  ]
);

// The SBDH envelopes our sending pipeline handed to an access point. The row is
// written before the document is sent, so by the time the access point can report the
// transaction back to us the claim is already there: it is what tells the handler of
// that report whether the transaction belongs to a send of ours or to a document the
// provider sent on our behalf (see data/provider-sent). Rows are pruned once they are
// far older than any send can be.
export const outgoingEnvelopeClaims = pgTable("peppol_outgoing_envelope_claims", {
  // The SBDH instance identifier, which the access point echoes back as the
  // transaction's document instance id.
  instanceIdentifier: text("instance_identifier").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  index("peppol_outgoing_envelope_claims_created_at_idx").on(table.createdAt),
]);

// How a document was handed to one recipient. A document is the content; a delivery
// is one attempt to get it to one address over one channel, so a document sent over
// Peppol and to two email addresses has three. New channels are added here.
export const deliveryChannels = ["peppol", "email"] as const;
export const deliveryChannelEnum = pgEnum("peppol_delivery_channel", deliveryChannels);

// Where a delivery stands, in the same words for every channel. `pending` means the
// channel accepted the document and has not said whether it arrived; `delivered`
// means it confirmed arrival (for Peppol the recipient's access point acknowledged
// the message, for email the recipient's mail server accepted it); `failed` is final.
// A recipient-side rejection, reported after delivery, is a later addition.
export const deliveryStatuses = ["pending", "delivered", "failed"] as const;
export const deliveryStatusEnum = pgEnum("peppol_delivery_status", deliveryStatuses);

// Why a delivery failed, in the channel's own terms rather than a provider's. The
// provider's own code is kept next to it.
export const deliveryFailureCategories = [
  "recipient_not_found",
  "document_not_supported",
  "validation",
  "transport",
  "recipient_rejected",
  "duplicate",
  "other",
] as const;
export const deliveryFailureCategoryEnum = pgEnum(
  "peppol_delivery_failure_category",
  deliveryFailureCategories
);

// One row per delivery of an outgoing document (see data/deliveries). Written with
// the document, and moved on by what the channel reports afterwards: an access point
// that only confirms or fails a transmission later does so through its webhook or
// the reconciliation poll. Incoming documents and filed reports have none. The
// transport references (message, conversation and envelope ids) stay on the document.
export const documentDeliveries = pgTable(
  "peppol_document_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "dlv_" + ulid()),
    transmittedDocumentId: text("transmitted_document_id")
      .references(() => transmittedDocuments.id, { onDelete: "cascade" })
      .notNull(),
    teamId: text("team_id").notNull(),
    companyId: text("company_id").notNull(),
    channel: deliveryChannelEnum("channel").notNull(),
    // The Peppol address or email address the document was delivered to.
    address: text("address").notNull(),
    status: deliveryStatusEnum("status").notNull(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    failureCategory: deliveryFailureCategoryEnum("failure_category"),
    failureMessage: text("failure_message"),
    failureProviderCode: text("failure_provider_code"),
    // The service that carried the delivery: the access point provider for Peppol,
    // the mail service for email. Null for a simulated transmission.
    provider: text("provider"),
    useTestNetwork: boolean("use_test_network").notNull().default(false),
    // The provider's own reference for the transmission, which is what its later
    // reports are matched on: the access point's transaction id, the mail service's
    // message id. Unique within a provider so a report can only ever land on one
    // delivery.
    providerTransactionId: text("provider_transaction_id"),
    // The provider's id and name for the last report applied, and that report's
    // payload as received, for support.
    providerEventId: text("provider_event_id"),
    providerEventType: text("provider_event_type"),
    providerPayload: jsonb("provider_payload").$type<Record<string, unknown>>(),
    // When the provider was last asked about a delivery that was still pending.
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: autoUpdateTimestamp(),
  },
  (table) => [
    index("peppol_document_deliveries_document_idx").on(table.transmittedDocumentId),
    uniqueIndex("peppol_document_deliveries_provider_reference_idx")
      .on(table.provider, table.providerTransactionId)
      .where(isNotNull(table.providerTransactionId)),
    index("peppol_document_deliveries_pending_idx").on(
      table.status,
      table.channel,
      table.statusChangedAt
    ),
  ]
);

// A delivery outcome a provider reported for a transaction that has no delivery yet.
// The report can arrive before the send that produced the transaction has recorded
// its document, so it waits here, keyed by the transaction, and is applied when the
// document's deliveries are written (see data/deliveries). One row per transaction
// of a provider, however many times the provider retries the report.
export const providerDeliveryReports = pgTable(
  "peppol_provider_delivery_reports",
  {
    provider: text("provider").notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    channel: deliveryChannelEnum("channel").notNull(),
    useTestNetwork: boolean("use_test_network").notNull().default(false),
    status: deliveryStatusEnum("status").notNull(),
    failureCategory: deliveryFailureCategoryEnum("failure_category"),
    failureMessage: text("failure_message"),
    failureProviderCode: text("failure_provider_code"),
    eventId: text("event_id"),
    eventType: text("event_type"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "peppol_provider_delivery_reports_pkey",
      columns: [table.provider, table.providerTransactionId],
    }),
  ]
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
