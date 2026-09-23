import { billingProfiles, subscriptionBillingEventLines, subscriptionBillingEvents, subscriptions } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq, isNull, lt, or, gt, inArray, max } from "drizzle-orm";
import Decimal from "decimal.js";
import { getBillingProfile } from "../billing-profile";
import { getMandate, requestPayment } from "../mollie";
import { sendTelegramNotification } from "@peppol/utils/system-notifications/telegram";
import type { Mandate } from "@mollie/api-client";
import { type SubscriptionBillingLine, type TeamBillingResult, TeamBillingResultError, ERROR_TEAM_BILLING_RESULT } from "./billing-types";
import { generateTeamBillingResult } from "./helpers";
import { determineVatStrategy } from "./vat";
import { sendInvoiceAsBRBX } from "./invoicing";
import { calculateSubscriptionByMonthlyPeriods, describeBillingOutcome, selectBillableSubscriptions, summarizeBillingLines } from "./calculate";

export async function endBillingCycle(billingDate: Date, dryRun: boolean = false, teamIds?: string[]): Promise<TeamBillingResult[]> {
  const toBeBilled = await selectBillableSubscriptions(billingDate, teamIds);

  const groupedByTeam = toBeBilled.reduce((acc, subscription) => {
    acc[subscription.teamId] = [...(acc[subscription.teamId] || []), subscription];
    return acc;
  }, {} as Record<string, typeof subscriptions.$inferSelect[]>);

  const results: TeamBillingResult[] = [];
  for (const teamId in groupedByTeam) {
    try {
      const result = await billTeam({
        teamId: teamId,
        toBeBilledSubscriptions: groupedByTeam[teamId],
        billingDate: billingDate,
        dryRun: dryRun,
      });
      results.push(...result);
    } catch (error) {
      console.error(
        `Error ending billing cycle for team ${teamId}: ${error}`
      );
      sendTelegramNotification(`Error billing team ${teamId}: ${error}`);
      if (error instanceof TeamBillingResultError) {
        results.push(...error.teamBillingResult.map(x => ({
          ...x,
          teamId,
          billingDate: billingDate.toISOString(),
        })));
      } else {
        results.push({
          ...ERROR_TEAM_BILLING_RESULT,
          message: error?.toString() ?? "Unknown error",
          teamId,
          billingDate: billingDate.toISOString(),
        });
      }
    }
  }
  return results;
}

async function billTeam({
  teamId,
  toBeBilledSubscriptions,
  billingDate,
  dryRun = false,
}: {
  teamId: string;
  toBeBilledSubscriptions: typeof subscriptions.$inferSelect[];
  billingDate: Date;
  dryRun?: boolean;
}): Promise<TeamBillingResult[]> {

  let invoiceReference: number | null = null;
  let billingEventId: string | null = null;
  let isPaymentRequested: boolean = false;
  let invoiceId: string | null = null;

  try {

    // Get billing profile for team
    const billingProfile = await getBillingProfile(teamId);

    if (!billingProfile) {
      throw new TeamBillingResultError(
        `Billing profile not found`,
        [{ isInvoiceSent: "", isPaymentRequested: "" }]
      );
    }

    // Skip pending billing profiles
    if (billingProfile.profileStanding === "pending") {
      // TODO: later on, we should just silently skip the billing cycle for this team (return empty array), as these teams have never properly setup their billing profile
      throw new TeamBillingResultError(
        `Billing profile is pending`,
        [{
          billingProfileId: billingProfile.id,
          billingProfileStanding: billingProfile.profileStanding,
          isManuallyBilled: billingProfile.isManuallyBilled,
          companyName: billingProfile.companyName,
          companyStreet: billingProfile.address,
          companyPostalCode: billingProfile.postalCode,
          companyCity: billingProfile.city,
          companyCountry: billingProfile.country,
          companyVatNumber: billingProfile.vatNumber,
          isInvoiceSent: "", 
          isPaymentRequested: "",
        }]
      );
    }

    // Bill each subscription
    const billingLines: SubscriptionBillingLine[] = [];
    for (const subscription of toBeBilledSubscriptions) {
      billingLines.push(...await calculateSubscriptionByMonthlyPeriods({
        subscription,
        billingDate,
      }));
    }

    // Determine VAT strategy
    const vatStrategy = determineVatStrategy(billingProfile);

    // Calculate totals, billing period and usage totals
    const summary = summarizeBillingLines(billingLines, vatStrategy.percentage);
    const { totalAmountExcl, totalVatAmount, totalAmountIncl } = summary;
    const billingPeriodStart = summary.billingPeriodStart;
    let billingPeriodEnd = summary.billingPeriodEnd;

    if (!billingPeriodStart) {
      throw new TeamBillingResultError(
        `Billing period start is not set`,
        [{ isInvoiceSent: "", isPaymentRequested: "" }]
      );
    }

    if (!billingPeriodEnd) {
      billingPeriodEnd = billingDate;
    }

    // Gather usage totals
    const { usedQty, usedQtyIncoming, usedQtyOutgoing, overageQtyIncoming, overageQtyOutgoing } = summary;

    // The same decision the read-only preview reports
    const decision = describeBillingOutcome({
      profileStanding: billingProfile.profileStanding,
      isManuallyBilled: billingProfile.isManuallyBilled,
      hasBillingProfile: true,
      hasLines: billingLines.length > 0,
      totalAmountIncl,
      hasMollieCustomer: Boolean(billingProfile.mollieCustomerId),
    });

    // If total amount incl == 0, mark as billed
    if (decision.outcome === "marked_billed_only") {
      if (!dryRun) {
        await db
          .update(subscriptions)
          .set({ lastBilledAt: billingDate })
          .where(inArray(subscriptions.id, toBeBilledSubscriptions.map(subscription => subscription.id)));
      }

      return billingLines.map((x, i) => ({
        ...generateTeamBillingResult(x, billingProfile),
        status: "success",
        isInvoiceSent: "",
        isPaymentRequested: "",
        message: "",
        billingProfileId: billingProfile.id,
        billingProfileStanding: billingProfile.profileStanding,
        isManuallyBilled: billingProfile.isManuallyBilled,
        teamId: teamId,
        companyName: billingProfile.companyName,
        companyStreet: billingProfile.address,
        companyPostalCode: billingProfile.postalCode,
        companyCity: billingProfile.city,
        companyCountry: billingProfile.country,
        companyVatNumber: billingProfile.vatNumber,
        billingEventId: billingEventId,
        invoiceId: invoiceId,
        invoiceReference: invoiceReference,
        totalAmountExcl: i === 0 ? totalAmountExcl.toNumber() : null,
        vatCategory: vatStrategy.vatCategory,
        vatPercentage: vatStrategy.percentage.toNumber(),
        vatExemptionReason: vatStrategy.vatExemptionReason,
        vatAmount: i === 0 ? totalVatAmount.toNumber() : null,
        totalAmountIncl: i === 0 ? totalAmountIncl.toNumber() : null,
        billingDate: billingDate.toISOString(),
      }));
    }

    if (decision.outcome === "blocked_no_payment_customer") {
      throw new TeamBillingResultError(
        "Billing profile has no Mollie customer id",
        billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
      );
    }

    if (decision.outcome !== "manually_billed" && decision.outcome !== "invoice_and_payment") {
      throw new TeamBillingResultError(
        decision.message,
        billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
      );
    }

    if (decision.outcome === "invoice_and_payment") {
      const mollieCustomerId = billingProfile.mollieCustomerId;
      if (!mollieCustomerId) {
        throw new Error(`Billing decision for team ${teamId} expects a payment customer that is missing`);
      }

      // Get the customer mandate
      let mandate: Mandate | null = null;
      try {
        mandate = await getMandate(mollieCustomerId);
      } catch (error) {
        console.error(`Error getting mandate for billing profile ${billingProfile.id}: ${error}`);
      }
      if (!mandate) {
        // Update billing profile mandate status
        await db
          .update(billingProfiles)
          .set({
            isMandateValidated: false,
          })
          .where(eq(billingProfiles.id, billingProfile.id));
      }

      // Create billing event
      if (!dryRun) {
        await db.transaction(async (tx) => {

          // Find the next invoice reference
          const highestInvoiceReference = await tx
            .select({ invoiceReference: max(subscriptionBillingEvents.invoiceReference) })
            .from(subscriptionBillingEvents);
          let nextInvoiceReference = 5000;
          if (highestInvoiceReference.length > 0) {
            nextInvoiceReference = (highestInvoiceReference[0].invoiceReference ?? nextInvoiceReference) + 1;
          }
          invoiceReference = nextInvoiceReference;

          // Create billing event
          const [{ id: _billingEventId }] = await tx
            .insert(subscriptionBillingEvents)
            .values({
              teamId,
              billingProfileId: billingProfile.id,
              billingDate: billingDate,
              billingPeriodStart,
              billingPeriodEnd,
              totalAmountExcl: totalAmountExcl.toFixed(2),
              vatAmount: totalVatAmount.toFixed(2),
              vatCategory: vatStrategy.vatCategory,
              vatPercentage: vatStrategy.percentage.toFixed(2),
              totalAmountIncl: totalAmountIncl.toFixed(2),
              usedQty: usedQty.toFixed(2),
              usedQtyIncoming: usedQtyIncoming.toFixed(2),
              usedQtyOutgoing: usedQtyOutgoing.toFixed(2),
              overageQtyIncoming: overageQtyIncoming.toFixed(2),
              overageQtyOutgoing: overageQtyOutgoing.toFixed(2),
              amountDue: totalAmountIncl.toFixed(2),
              paymentStatus: totalAmountIncl.gt(0) ? "none" : "paid",
              paymentId: null,
              paidAmount: totalAmountIncl.gt(0) ? null : new Decimal(0).toFixed(2),
              paymentMethod: totalAmountIncl.gt(0) ? null : "auto-reconcile",
              paymentDate: totalAmountIncl.gt(0) ? null : new Date(),
              invoiceReference,
            })
            .returning({ id: subscriptionBillingEvents.id });
          billingEventId = _billingEventId;

          if (!billingEventId) {
            throw new TeamBillingResultError(
              `Failed to create billing event`,
              billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
            );
          }

          // Create billing event lines
          for (const result of billingLines) {
            await tx
              .insert(subscriptionBillingEventLines)
              .values({
                subscriptionBillingEventId: billingEventId!,
                subscriptionId: result.subscriptionId,
                billingConfig: result.billingConfig,
                subscriptionStartDate: result.subscriptionStartDate,
                subscriptionEndDate: result.subscriptionEndDate ?? billingPeriodEnd,
                subscriptionLastBilledAt: result.subscriptionLastBilledAt ? new Date(result.subscriptionLastBilledAt) : billingPeriodStart,
                planId: result.planId,
                includedMonthlyDocuments: result.includedMonthlyDocuments.toFixed(2),
                basePrice: result.basePrice.toFixed(2),
                incomingDocumentOveragePrice: result.incomingDocumentOveragePrice.toFixed(2),
                outgoingDocumentOveragePrice: result.outgoingDocumentOveragePrice.toFixed(2),
                usedQty: result.usedQty.toFixed(2),
                usedQtyIncoming: result.usedQtyIncoming.toFixed(2),
                usedQtyOutgoing: result.usedQtyOutgoing.toFixed(2),
                overageQtyIncoming: result.overageQtyIncoming.toFixed(2),
                overageQtyOutgoing: result.overageQtyOutgoing.toFixed(2),
                name: result.lineName,
                description: result.lineDescription,
                totalAmountExcl: result.lineTotalExcl.toFixed(2),
              });
          }
        });
      }

      // Create invoice for team
      try {
        invoiceId = await sendInvoiceAsBRBX({
          issueDate: billingDate,
          teamId: teamId,
          companyName: billingProfile.companyName,
          companyStreet: billingProfile.address,
          companyPostalCode: billingProfile.postalCode,
          companyCity: billingProfile.city,
          companyCountry: billingProfile.country,
          companyVatNumber: billingProfile.vatNumber ?? null,
          invoiceReference: invoiceReference,
          totalAmountExcl: totalAmountExcl.toNumber(),
          totalVatAmount: totalVatAmount.toNumber(),
          vatCategory: vatStrategy.vatCategory,
          vatPercentage: vatStrategy.percentage.toNumber(),
          vatExemptionReason: vatStrategy.vatExemptionReason,
          totalAmountIncl: totalAmountIncl.toNumber(),
          lines: billingLines.map(x => ({
            planId: x.planId ?? null,
            name: x.lineName,
            description: x.lineDescription,
            netPriceAmount: x.lineTotalExcl.toFixed(2),
            netAmount: x.lineTotalExcl.toFixed(2),
            vat: {
              category: vatStrategy.vatCategory,
              percentage: vatStrategy.percentage.toFixed(2),
            },
          })),
        }, billingProfile, dryRun);
      } catch (error) {
        throw new TeamBillingResultError(
          `Failed to send invoice: ${error}`,
          billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
        );
      }

      // Update billing event with invoice id and reference
      if (!dryRun) {
        if (!invoiceId) {
          throw new TeamBillingResultError(
            `Failed to finalize billing due to missing invoice id`,
            billingLines.map(x => generateTeamBillingResult(x, billingProfile, { isInvoiceSent: "", isPaymentRequested: "" }))
          );
        }
        console.log("Updating billing event with invoice id", invoiceId, "for billing event", billingEventId);
        await db
          .update(subscriptionBillingEvents)
          .set({ invoiceId: invoiceId })
          .where(eq(subscriptionBillingEvents.id, billingEventId!));
      }

      // Payment through Mollie
      if (!dryRun && !billingProfile.isManuallyBilled) {
        // Send payment request to mollie (on webhook, update billing event with payment result, notify admin on failure)
        try {
          await requestPayment({
            mollieCustomerId,
            mollieMandateId: mandate?.id ?? null,
            billingProfileId: billingProfile.id,
            billingEventId: billingEventId!,
            amountDue: totalAmountIncl.toFixed(2),
            teamId: teamId,
            companyName: billingProfile.companyName,
            billingEmail: billingProfile.billingEmail,
            invoiceReference: invoiceReference,
            billingDate: billingDate,
          });
          isPaymentRequested = true;
        } catch (error) {
          console.error(`Failed to request payment for billing event ${billingEventId}: ${error}`);
          // Fail silently, this is passed on through the isPaymentRequested field
        }
      }
    }

    // Update lastBilledAt date
    if (!dryRun) {
      await db
        .update(subscriptions)
        .set({ lastBilledAt: billingDate })
        .where(inArray(subscriptions.id, toBeBilledSubscriptions.map(subscription => subscription.id)));
    }

    return billingLines.map((x, i) => ({
      ...generateTeamBillingResult(x, billingProfile),
      status: "success",
      isInvoiceSent: invoiceId ? "x" : "",
      isPaymentRequested: billingProfile.isManuallyBilled ? "" : isPaymentRequested ? "x" : "?",
      message: "",
      billingProfileId: billingProfile.id,
      billingProfileStanding: billingProfile.profileStanding,
      isManuallyBilled: billingProfile.isManuallyBilled,
      teamId: teamId,
      companyName: billingProfile.companyName,
      companyStreet: billingProfile.address,
      companyPostalCode: billingProfile.postalCode,
      companyCity: billingProfile.city,
      companyCountry: billingProfile.country,
      companyVatNumber: billingProfile.vatNumber,
      billingEventId: billingEventId,
      invoiceId: invoiceId,
      invoiceReference: invoiceReference,
      totalAmountExcl: i === 0 ? totalAmountExcl.toNumber() : null,
      vatCategory: vatStrategy.vatCategory,
      vatPercentage: vatStrategy.percentage.toNumber(),
      vatExemptionReason: vatStrategy.vatExemptionReason,
      vatAmount: i === 0 ? totalVatAmount.toNumber() : null,
      totalAmountIncl: i === 0 ? totalAmountIncl.toNumber() : null,
      billingDate: billingDate.toISOString(),
    }));
  } catch (error) {
    try {
      // Remove billing event again
      if (billingEventId) {
        await db.transaction(async (tx) => {
          await tx
            .delete(subscriptionBillingEventLines)
            .where(eq(subscriptionBillingEventLines.subscriptionBillingEventId, billingEventId!));
          await tx
            .delete(subscriptionBillingEvents)
            .where(eq(subscriptionBillingEvents.id, billingEventId!));
        });
      }
    } catch (error) {
      throw new Error(`CRITICAL ERROR: Failed to remove billing event ${billingEventId} again: ${error}`);
    }
    throw error;
  }
}
