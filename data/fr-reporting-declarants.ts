import { db } from "@recommand/db";
import type { Logger } from "@recommand/lib/logger";
import { Cron } from "croner";
import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { UserFacingError } from "@peppol/utils/util";
import type { Company } from "@peppol/data/companies";
import {
  ArratechDeclarantError,
  ARRATECH_DECLARANT_TAKEN,
  registerArratechDeclarant,
  removeArratechDeclarant,
  type ArratechVatExigibility,
  type ArratechVatRegime,
} from "@peppol/data/at/fr-reporting-declarants";
import {
  companyVerificationLog,
  frReportingDeclarants,
  type frReportingEnvironments,
} from "@peppol/db/schema";
import { getFrenchSiren } from "@peppol/utils/identifier-validation";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";

export type FrenchReportingDeclarant = typeof frReportingDeclarants.$inferSelect;
export type FrenchReportingEnvironment = (typeof frReportingEnvironments)[number];

type ReportingTeam = {
  isPlayground?: boolean | null;
  useTestNetwork?: boolean | null;
};

/** Retries stop after roughly a day of provider unavailability. */
const MAX_REGISTRATION_ATTEMPTS = 24;

/**
 * Where a team's reports go. Test-network teams file into the partner's TEST
 * environment, everyone else into PROD. The two are separate registrations.
 */
export function resolveFrenchReportingEnvironment(team: ReportingTeam): FrenchReportingEnvironment {
  return team.useTestNetwork ? "TEST" : "PROD";
}

/**
 * Playground teams never reach the partner. Neither do test-network teams: the
 * partner reserves its TEST environment for accredited platforms, so their
 * declarants are recorded here only and their reports get simulated references.
 */
export function isFrenchReportingSimulated(team: ReportingTeam): boolean {
  return Boolean(team.isPlayground || team.useTestNetwork);
}

export async function getFrenchReportingDeclarant(
  companyId: string,
  environment: FrenchReportingEnvironment,
): Promise<FrenchReportingDeclarant | undefined> {
  return await db
    .select()
    .from(frReportingDeclarants)
    .where(
      and(
        eq(frReportingDeclarants.companyId, companyId),
        eq(frReportingDeclarants.environment, environment),
      ),
    )
    .then((rows) => rows[0]);
}

export async function getFrenchReportingDeclarantById(
  id: string,
): Promise<FrenchReportingDeclarant | undefined> {
  return await db
    .select()
    .from(frReportingDeclarants)
    .where(eq(frReportingDeclarants.id, id))
    .then((rows) => rows[0]);
}

/**
 * The registrations that exist at the partner for a company, i.e. the ones a
 * company deletion would leave behind. Simulated rows never reached the partner.
 */
export async function getPartnerRegisteredFrenchReportingDeclarants(
  companyId: string,
): Promise<FrenchReportingDeclarant[]> {
  return await db
    .select()
    .from(frReportingDeclarants)
    .where(
      and(
        eq(frReportingDeclarants.companyId, companyId),
        eq(frReportingDeclarants.simulated, false),
        eq(frReportingDeclarants.state, "registered"),
      ),
    );
}

/**
 * The declarant a report for this company is filed under, or null when reports
 * cannot be accepted yet: no registration, still pending or blocked, or suspended.
 */
export async function getReadyFrenchReportingDeclarant(
  companyId: string,
  environment: FrenchReportingEnvironment,
): Promise<FrenchReportingDeclarant | null> {
  const declarant = await getFrenchReportingDeclarant(companyId, environment);
  if (!declarant || declarant.state !== "registered" || !declarant.enabled) {
    return null;
  }
  return declarant;
}

async function hasSignedFrenchMandate(companyId: string): Promise<boolean> {
  const log = await db
    .select({ id: companyVerificationLog.id })
    .from(companyVerificationLog)
    .where(
      and(
        eq(companyVerificationLog.companyId, companyId),
        eq(companyVerificationLog.status, "verified"),
        isNotNull(companyVerificationLog.mandateAcceptedAt),
      ),
    )
    .orderBy(desc(companyVerificationLog.createdAt))
    .limit(1)
    .then((rows) => rows[0]);
  return Boolean(log);
}

/**
 * Registers (or re-registers) the company as a declarant for the team's
 * environment. The registration is written first and synchronised with the partner
 * right away; when the partner is unavailable the worker keeps retrying it.
 *
 * Registering is deliberately an explicit step and not a side effect of company
 * verification: the VAT regime is not known at verification time, and registering
 * starts the declarant's filing periods at the partner.
 */
export async function requestFrenchReportingDeclarant({
  company,
  team,
  vatRegime,
  vatExigibility,
  logger = console,
}: {
  company: Company;
  team: ReportingTeam;
  vatRegime: ArratechVatRegime;
  vatExigibility: ArratechVatExigibility;
  logger?: Pick<Logger, "info" | "warn" | "error">;
}): Promise<FrenchReportingDeclarant> {
  if (company.country !== "FR") {
    throw new UserFacingError(
      "French e-reporting is only available for companies registered in France.",
    );
  }
  const siren = getFrenchSiren(company.enterpriseNumber);
  if (!siren) {
    throw new UserFacingError(
      "The company needs a valid French SIREN or SIRET as enterprise number before it can be registered for e-reporting.",
    );
  }

  const simulated = isFrenchReportingSimulated(team);
  const environment = resolveFrenchReportingEnvironment(team);

  if (!simulated) {
    if (!company.isVerified) {
      throw new UserFacingError(
        "The company must be verified before it can be registered for e-reporting.",
      );
    }
    // The signed French mandate is what entitles us to report for the SIREN; its
    // annex names the e-reporting delegation explicitly.
    if (!(await hasSignedFrenchMandate(company.id))) {
      throw new UserFacingError(
        "The company was verified without a signed French mandate. Contact support@recommand.eu to enable e-reporting.",
      );
    }
  }

  const now = new Date();
  const registration = {
    siren,
    issuerName: company.name,
    vatRegime,
    vatExigibility,
    enabled: true,
    simulated,
    state: simulated ? ("registered" as const) : ("pending" as const),
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    registeredAt: simulated ? now : null,
    partnerSnapshot: null,
  };

  const declarant = await db
    .insert(frReportingDeclarants)
    .values({ companyId: company.id, environment, ...registration })
    .onConflictDoUpdate({
      target: [frReportingDeclarants.companyId, frReportingDeclarants.environment],
      set: registration,
    })
    .returning()
    .then((rows) => rows[0]!);

  if (simulated) {
    return declarant;
  }

  try {
    await processFrenchReportingDeclarant(declarant.id, logger);
  } catch (error) {
    // The worker owns retries; the caller only needs the current state.
    logger.warn(
      `French reporting declarant ${declarant.id} could not be synchronised now: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return (await getFrenchReportingDeclarantById(declarant.id)) ?? declarant;
}

/**
 * Turns a failed partner call into the next state of the registration. Kept pure so
 * the retry and blocking rules can be tested without a database.
 */
export function nextRegistrationStateAfterFailure(
  declarant: Pick<FrenchReportingDeclarant, "attempts">,
  error: unknown,
  now: Date = new Date(),
): {
  state: "pending" | "blocked";
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
} {
  const attempts = declarant.attempts + 1;
  const message = error instanceof Error ? error.message : String(error);
  const retryable =
    error instanceof ArratechDeclarantError
      ? error.retryable && error.code !== ARRATECH_DECLARANT_TAKEN
      : false;
  if (!retryable || attempts >= MAX_REGISTRATION_ATTEMPTS) {
    return { state: "blocked", attempts, nextAttemptAt: now, lastError: message };
  }
  const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
  return {
    state: "pending",
    attempts,
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000),
    lastError: message,
  };
}

/**
 * Synchronises one pending registration with the partner. Serialised per declarant
 * with an advisory lock so the request handler and the worker never race.
 */
export async function processFrenchReportingDeclarant(
  id: string,
  logger: Pick<Logger, "info" | "warn" | "error"> = console,
): Promise<void> {
  await db.transaction(async (tx) => {
    const lock = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${`fr-reporting-declarant:${id}`}, 0)) as acquired`,
    );
    if (!lock.rows[0]?.acquired) {
      return;
    }

    const declarant = await tx
      .select()
      .from(frReportingDeclarants)
      .where(eq(frReportingDeclarants.id, id))
      .then((rows) => rows[0]);
    if (!declarant || declarant.state !== "pending" || declarant.simulated) {
      return;
    }

    try {
      const snapshot = await registerArratechDeclarant({
        environment: declarant.environment,
        siren: declarant.siren,
        input: {
          issuerName: declarant.issuerName,
          vatRegime: declarant.vatRegime,
          vatExigibility: declarant.vatExigibility,
          enabled: declarant.enabled,
          intakeMode: "SELF_SUBMIT",
        },
        useTestNetwork: declarant.environment === "TEST",
      });
      await tx
        .update(frReportingDeclarants)
        .set({
          state: "registered",
          registeredAt: new Date(),
          lastError: null,
          partnerSnapshot: snapshot,
        })
        .where(eq(frReportingDeclarants.id, id));
      logger.info(
        `French reporting declarant ${id} registered for SIREN ${declarant.siren} (${declarant.environment})`,
      );
    } catch (error) {
      const next = nextRegistrationStateAfterFailure(declarant, error);
      await tx
        .update(frReportingDeclarants)
        .set(next)
        .where(eq(frReportingDeclarants.id, id));
      if (next.state === "blocked") {
        logger.error(
          `French reporting declarant ${id} blocked for SIREN ${declarant.siren}: ${next.lastError}`,
        );
        sendSystemAlert(
          "French Reporting Declarant Blocked",
          `Registration of SIREN ${declarant.siren} (${declarant.environment}) for company ${declarant.companyId} could not be completed with Arratech and needs support.\n\n` +
            `Error: \`\`\`\n${next.lastError}\n\`\`\`` +
            (error instanceof ArratechDeclarantError && error.code === ARRATECH_DECLARANT_TAKEN
              ? "\n\nThe SIREN is registered to another organisation. Ask Arratech support to release it if it is ours."
              : ""),
          "error",
        );
      } else {
        logger.warn(
          `French reporting declarant ${id} registration attempt ${next.attempts} failed, retrying at ${next.nextAttemptAt.toISOString()}: ${next.lastError}`,
        );
      }
    }
  });
}

/**
 * Suspends or resumes a declarant at the partner. Suspending mid-period leaves that
 * period unfiled, so this is only exposed to support.
 */
export async function setFrenchReportingDeclarantEnabled(
  id: string,
  enabled: boolean,
): Promise<FrenchReportingDeclarant> {
  const declarant = await getFrenchReportingDeclarantById(id);
  if (!declarant) {
    throw new UserFacingError("French reporting declarant not found");
  }
  let partnerSnapshot = declarant.partnerSnapshot;
  if (!declarant.simulated) {
    partnerSnapshot = await registerArratechDeclarant({
      environment: declarant.environment,
      siren: declarant.siren,
      input: {
        issuerName: declarant.issuerName,
        vatRegime: declarant.vatRegime,
        vatExigibility: declarant.vatExigibility,
        enabled,
        intakeMode: "SELF_SUBMIT",
      },
      useTestNetwork: declarant.environment === "TEST",
    });
  }
  return await db
    .update(frReportingDeclarants)
    .set({
      enabled,
      state: "registered",
      registeredAt: declarant.registeredAt ?? new Date(),
      lastError: null,
      partnerSnapshot,
    })
    .where(eq(frReportingDeclarants.id, id))
    .returning()
    .then((rows) => rows[0]!);
}

/**
 * Removes the registration here and at the partner. Removing mid-period leaves that
 * period unfiled, so this is only exposed to support.
 */
export async function removeFrenchReportingDeclarant(id: string): Promise<void> {
  const declarant = await getFrenchReportingDeclarantById(id);
  if (!declarant) {
    return;
  }
  if (!declarant.simulated && declarant.state === "registered") {
    await removeArratechDeclarant({
      environment: declarant.environment,
      siren: declarant.siren,
      useTestNetwork: declarant.environment === "TEST",
    });
  }
  await db.delete(frReportingDeclarants).where(eq(frReportingDeclarants.id, id));
}

export function initializeFrenchReportingDeclarantCron(logger: Logger): void {
  if (process.env.RUN_CRON !== "true") {
    return;
  }

  new Cron(
    "* * * * *",
    {
      name: "peppol.fr-reporting-declarants",
      protect: () =>
        logger.warn("Skipping peppol.fr-reporting-declarants tick: previous batch still running"),
    },
    async () => {
      try {
        const due = await db
          .select({ id: frReportingDeclarants.id })
          .from(frReportingDeclarants)
          .where(
            and(
              eq(frReportingDeclarants.state, "pending"),
              eq(frReportingDeclarants.simulated, false),
              lte(frReportingDeclarants.nextAttemptAt, new Date()),
            ),
          )
          .orderBy(frReportingDeclarants.nextAttemptAt)
          .limit(25);
        for (const { id } of due) {
          try {
            await processFrenchReportingDeclarant(id, logger);
          } catch (error) {
            logger.error(
              `French reporting declarant ${id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch (error) {
        logger.error(
          `French reporting declarant worker failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  logger.info("French reporting declarant cron job initialized");
}
