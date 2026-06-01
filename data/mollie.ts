import createMollieClient, { SequenceType, type Mandate } from "@mollie/api-client";
import { db } from "@recommand/db";
import { billingProfiles, subscriptionBillingEvents } from "@peppol/db/schema";
import { eq, and, not } from "drizzle-orm";
import Decimal from "decimal.js";
import { sendTelegramNotification } from "@peppol/utils/system-notifications/telegram";
import { sendFailedPaymentEmail } from "./billing/send-failed-payment-email";

if (!process.env.MOLLIE_API_KEY) {
  throw new Error("MOLLIE_API_KEY is not set");
}
if (!process.env.BASE_URL) {
  throw new Error("BASE_URL is not set");
}

const mollie = createMollieClient({
  apiKey: process.env.MOLLIE_API_KEY as string,
});

export async function createMollieCustomer(
  name: string,
  teamId: string,
  billingProfileId: string
) {
  const customer = await mollie.customers.create({
    name: name,
    metadata: {
      teamId: teamId,
      billingProfileId: billingProfileId,
    },
  });

  return customer;
}

export async function createFirstPayment(
  mollieCustomerId: string,
  billingProfileId: string
) {
  const payment = await mollie.payments.create({
    amount: {
      currency: "EUR",
      value: "0.02",
    },
    customerId: mollieCustomerId,
    sequenceType: SequenceType.first,
    description: "To complete your registration, we need to securely verify your payment method.",
    redirectUrl: `${process.env.BASE_URL}/`,
    webhookUrl: `${process.env.BASE_URL}/api/peppol/mollie/mandate-webhook`,
    metadata: {
      billingProfileId: billingProfileId,
    },
  });

  return payment;
}

export async function processFirstPayment(paymentId: string) {
  const payment = await mollie.payments.get(paymentId);
  console.log("Payment", payment);

  if (payment.status === "paid") {
    const { profileStanding } = await db
      .select({ profileStanding: billingProfiles.profileStanding })
      .from(billingProfiles)
      .where(
        eq(billingProfiles.id, (payment.metadata as any).billingProfileId)
      )
      .limit(1)
      .then(result => result[0]);

    await db
      .update(billingProfiles)
      .set({
        firstPaymentId: paymentId,
        firstPaymentStatus: payment.status,
        isMandateValidated: true,
        profileStanding: profileStanding === "suspended" ? "suspended" : "active", // If the profile is suspended, keep it suspended
        graceStartedAt: null,
        graceReason: null,
      })
      .where(
        eq(billingProfiles.id, (payment.metadata as any).billingProfileId)
      );
  } else {
    await db
      .update(billingProfiles)
      .set({
        firstPaymentId: paymentId,
        firstPaymentStatus: payment.status,
        isMandateValidated: false,
      })
      .where(
        and(
          eq(billingProfiles.id, (payment.metadata as any).billingProfileId),
          eq(billingProfiles.isMandateValidated, false), // Only update if the mandate is not validated, so we don't reset a validated mandate
        )
      );
  }
}

export async function getMandate(mollieCustomerId: string) {
  const mandates = mollie.customerMandates.iterate({
    customerId: mollieCustomerId,
  });

  for await (const mandate of mandates) {
    if (mandate.status === "valid") {
      return mandate;
    }
  }

  return null;
}

export function getMaxPaymentSize(mandate: Mandate): Decimal {
  if (mandate.details && "maximumAmount" in mandate.details) {
    const maximumAmount = mandate.details.maximumAmount as { value: string, currency: string };
    if (maximumAmount && typeof maximumAmount === "object" && "value" in maximumAmount) {
      const customLimit = new Decimal(maximumAmount.value);
      if (customLimit.isNaN() === false && customLimit.isFinite() === true) {
        return customLimit;
      }
    }
  }

  return new Decimal(1000);
}

export async function requestPayment({
  mollieCustomerId,
  mollieMandateId,
  billingProfileId,
  billingEventId,
  amountDue,
  teamId,
  companyName,
  billingEmail,
  invoiceReference,
  billingDate,
}: {
  mollieCustomerId: string;
  mollieMandateId: string | null;
  billingProfileId: string;
  billingEventId: string;
  amountDue: string;
  teamId: string;
  companyName: string;
  billingEmail: string | null;
  invoiceReference: number | null;
  billingDate: Date;
}) {
  try {
    const mandate = await getMandate(mollieCustomerId);
    if (!mandate || !mollieMandateId) {
      throw new Error("Mandate not found");
    }
    const maxPaymentSize = getMaxPaymentSize(mandate);
    const amountDueDecimal = new Decimal(amountDue);
    if (amountDueDecimal.gt(maxPaymentSize)) {
      let remainingAmount = amountDueDecimal;
      while (remainingAmount.gt(0)) {
        const paymentAmount = remainingAmount.gt(maxPaymentSize) ? maxPaymentSize : remainingAmount;
        await _requestPayment(mollieCustomerId, mollieMandateId, billingProfileId, billingEventId, paymentAmount.toFixed(2));
        remainingAmount = remainingAmount.minus(paymentAmount);
      }
    } else {
      await _requestPayment(mollieCustomerId, mollieMandateId, billingProfileId, billingEventId, amountDueDecimal.toFixed(2));
    }
  } catch (error) {
    console.error(`Failed to request payment for billing event ${billingEventId}: ${error}`);
    await sendFailedPaymentEmail({
      billingEventId,
      teamId,
      companyName,
      billingEmail,
      invoiceReference,
      totalAmountIncl: amountDue,
      billingDate,
    });
    throw error;
  }
}

async function _requestPayment(
  mollieCustomerId: string,
  mollieMandateId: string,
  billingProfileId: string,
  billingEventId: string,
  amountDue: string
) {
  const payment = await mollie.payments.create({
    amount: {
      currency: "EUR",
      value: amountDue,
    },
    customerId: mollieCustomerId,
    mandateId: mollieMandateId,
    sequenceType: SequenceType.recurring,
    description: `Recommand Peppol - ${billingEventId}`,
    webhookUrl: `${process.env.BASE_URL}/api/peppol/mollie/payment-webhook`,
    metadata: {
      billingProfileId: billingProfileId,
      billingEventId: billingEventId,
    },
  });

  return payment;
}

export async function processPayment(paymentId: string) {
  const payment = await mollie.payments.get(paymentId);
  console.log("Payment", payment);

  const billingEventId = (payment.metadata as any).billingEventId;

  const [{ billingProfileId, invoiceReference, totalAmountIncl, billingDate, teamId, paymentStatus, amountDue: currentAmountDue }] = await db
    .select({
      billingProfileId: subscriptionBillingEvents.billingProfileId,
      invoiceReference: subscriptionBillingEvents.invoiceReference,
      totalAmountIncl: subscriptionBillingEvents.totalAmountIncl,
      billingDate: subscriptionBillingEvents.billingDate,
      teamId: subscriptionBillingEvents.teamId,
      paymentStatus: subscriptionBillingEvents.paymentStatus,
      amountDue: subscriptionBillingEvents.amountDue,
    })
    .from(subscriptionBillingEvents)
    .where(eq(subscriptionBillingEvents.id, billingEventId))
    .limit(1);

  if (payment.status === "paid") {
    await db.transaction(async (tx) => {
      const [{ amountDue, previouslyPaidAmount }] = await tx
        .select({
          amountDue: subscriptionBillingEvents.amountDue,
          previouslyPaidAmount: subscriptionBillingEvents.paidAmount,
        })
        .from(subscriptionBillingEvents)
        .where(
          eq(
            subscriptionBillingEvents.id,
            billingEventId
          )
        );

      await tx
        .update(subscriptionBillingEvents)
        .set({
          amountDue: new Decimal(amountDue)
            .minus(payment.amount.value)
            .toFixed(2),
          paymentStatus: payment.status,
          paymentId: paymentId,
          paidAmount: new Decimal(previouslyPaidAmount || 0)
            .plus(payment.amount.value)
            .toFixed(2),
          paymentMethod: payment.method,
          paymentDate: payment.paidAt ? new Date(payment.paidAt) : null,
        })
        .where(
          eq(
            subscriptionBillingEvents.id,
            billingEventId
          )
        );

      await tx
        .update(billingProfiles)
        .set({
          profileStanding: "active",
          graceStartedAt: null,
          graceReason: null,
          suspendedAt: null,
        })
        .where(and(
          eq(billingProfiles.id, billingProfileId),
          not(eq(billingProfiles.profileStanding, "suspended")) // Only update if the profile is not suspended
        ));
    });
  } else {
    if (paymentStatus === "paid" || new Decimal(currentAmountDue).lte(0)) {
      console.log(`Ignoring ${payment.status} webhook for settled billing event ${billingEventId}`);
      return;
    }

    const { graceStartedAt, companyName, billingEmail } = await db
      .select({
        graceStartedAt: billingProfiles.graceStartedAt,
        companyName: billingProfiles.companyName,
        billingEmail: billingProfiles.billingEmail,
      })
      .from(billingProfiles)
      .where(eq(billingProfiles.id, billingProfileId))
      .limit(1)
      .then(result => result[0]);

    const isGracePeriodTrigger = ["canceled", "expired", "failed"].includes(payment.status);

    await db.transaction(async (tx) => {
      await tx.update(subscriptionBillingEvents)
        .set({
          paymentStatus: payment.status,
          paymentId: paymentId,
        })
        .where(
          eq(
            subscriptionBillingEvents.id,
            billingEventId
          )
        );
      if (isGracePeriodTrigger) {
        await tx.update(billingProfiles)
          .set({
            profileStanding: "grace",
            graceStartedAt: graceStartedAt ?? new Date(),
            graceReason: "payment_" + payment.status,
          })
          .where(and(
            eq(billingProfiles.id, billingProfileId),
            not(eq(billingProfiles.profileStanding, "suspended")) // Only update if the profile is not suspended
          ));
      }
    });

    if (isGracePeriodTrigger) {
      await sendFailedPaymentEmail({
        billingEventId,
        teamId,
        companyName,
        billingEmail,
        invoiceReference,
        totalAmountIncl,
        billingDate,
      });
    }

    sendTelegramNotification(`Payment ${paymentId} failed for billing event ${billingEventId} with status ${payment.status}`);
  }
}
