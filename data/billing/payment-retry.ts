import {
  billingProfiles,
  paymentFailureReminders,
  subscriptionBillingEvents,
} from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq, gte, inArray, gt } from "drizzle-orm";
import { subDays } from "date-fns";
import { getMandate, requestPayment } from "../mollie";

export type PaymentRetryResult = {
  status: "success" | "failed" | "skipped";
  billingEventId: string;
  invoiceReference: number | null;
  teamId: string;
  companyName: string;
  amountDue: string;
  errorMessage?: string;
};

export async function retryFailedPayments(
  teamIds?: string[],
  dryRun: boolean = false
): Promise<PaymentRetryResult[]> {
  const results: PaymentRetryResult[] = [];
  const sevenDaysAgo = subDays(new Date(), 7);

  const failedPayments = await db
    .select({
      billingEvent: subscriptionBillingEvents,
      billingProfile: billingProfiles,
    })
    .from(subscriptionBillingEvents)
    .innerJoin(billingProfiles, eq(subscriptionBillingEvents.billingProfileId, billingProfiles.id))
    .where(
      and(
        gt(subscriptionBillingEvents.amountDue, "0"),
        inArray(subscriptionBillingEvents.paymentStatus, ["none", "canceled", "expired", "failed"]),
        teamIds && teamIds.length > 0 ? inArray(subscriptionBillingEvents.teamId, teamIds) : undefined,
        eq(billingProfiles.isManuallyBilled, false),
      )
    );

  for (const { billingEvent, billingProfile } of failedPayments) {
    try {
      if (billingEvent.createdAt >= sevenDaysAgo) {
        results.push({
          status: "skipped",
          billingEventId: billingEvent.id,
          invoiceReference: billingEvent.invoiceReference,
          teamId: billingEvent.teamId,
          companyName: billingProfile.companyName,
          amountDue: billingEvent.amountDue,
          errorMessage: "Skipped: original payment attempt was within the last 7 days",
        });
        continue;
      }

      const recentReminder = await db
        .select()
        .from(paymentFailureReminders)
        .where(
          and(
            eq(paymentFailureReminders.billingEventId, billingEvent.id),
            gte(paymentFailureReminders.createdAt, sevenDaysAgo)
          )
        )
        .limit(1);

      if (recentReminder.length > 0) {
        results.push({
          status: "skipped",
          billingEventId: billingEvent.id,
          invoiceReference: billingEvent.invoiceReference,
          teamId: billingEvent.teamId,
          companyName: billingProfile.companyName,
          amountDue: billingEvent.amountDue,
          errorMessage: "Skipped: payment retry already attempted within the last 7 days",
        });
        continue;
      }

      if (!billingProfile.mollieCustomerId) {
        throw new Error("Billing profile has no Mollie customer ID");
      }

      const mandate = await getMandate(billingProfile.mollieCustomerId);

      if (dryRun) {
        console.log(`[DRY RUN] Would retry payment for billing event ${billingEvent.id} (invoice ${billingEvent.invoiceReference ?? "N/A"})`);
        results.push({
          status: "success",
          billingEventId: billingEvent.id,
          invoiceReference: billingEvent.invoiceReference,
          teamId: billingEvent.teamId,
          companyName: billingProfile.companyName,
          amountDue: billingEvent.amountDue,
        });
        continue;
      }

      try {
        await requestPayment({
          mollieCustomerId: billingProfile.mollieCustomerId,
          mollieMandateId: mandate?.id ?? null,
          billingProfileId: billingProfile.id,
          billingEventId: billingEvent.id,
          amountDue: billingEvent.amountDue,
          teamId: billingEvent.teamId,
          companyName: billingProfile.companyName,
          billingEmail: billingProfile.billingEmail,
          invoiceReference: billingEvent.invoiceReference,
          billingDate: billingEvent.billingDate,
        });
        await db.insert(paymentFailureReminders).values({
          billingEventId: billingEvent.id,
          emailAddresses: [],
        });
        results.push({
          status: "success",
          billingEventId: billingEvent.id,
          invoiceReference: billingEvent.invoiceReference,
          teamId: billingEvent.teamId,
          companyName: billingProfile.companyName,
          amountDue: billingEvent.amountDue,
        });
      } catch (paymentError) {
        results.push({
          status: "failed",
          billingEventId: billingEvent.id,
          invoiceReference: billingEvent.invoiceReference,
          teamId: billingEvent.teamId,
          companyName: billingProfile.companyName,
          amountDue: billingEvent.amountDue,
          errorMessage: paymentError instanceof Error ? paymentError.message : String(paymentError),
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        status: "failed",
        billingEventId: billingEvent.id,
        invoiceReference: billingEvent.invoiceReference,
        teamId: billingEvent.teamId,
        companyName: billingProfile.companyName,
        amountDue: billingEvent.amountDue,
        errorMessage,
      });
      console.error(`Failed to retry payment for billing event ${billingEvent.id}:`, error);
    }
  }

  return results;
}
