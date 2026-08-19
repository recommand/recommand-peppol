import { paymentFailureReminders } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { format, subDays } from "date-fns";
import { render } from "@react-email/render";
import { FailedPaymentEmail } from "@peppol/emails/failed-payment";
import { ServerClient } from "postmark";
import { and, eq, gte } from "drizzle-orm";
import { getTeamNotificationGroups } from "@peppol/data/notification-language";

export type FailedPaymentEmailParams = {
  billingEventId: string;
  teamId: string;
  companyName: string;
  billingEmail: string | null;
  invoiceReference: number | null;
  totalAmountIncl: string;
  billingDate: Date;
};

export async function sendFailedPaymentEmail({
  billingEventId,
  teamId,
  companyName,
  billingEmail,
  invoiceReference,
  totalAmountIncl,
  billingDate,
}: FailedPaymentEmailParams): Promise<{ emailSent: boolean; emailRecipients: string[] }> {

  // Check if the billing event has a payment failure reminder within the last 7 days
  const sevenDaysAgo = subDays(new Date(), 7);
  const recentReminder = await db
    .select()
    .from(paymentFailureReminders)
    .where(
      and(eq(paymentFailureReminders.billingEventId, billingEventId), gte(paymentFailureReminders.createdAt, sevenDaysAgo))
    )
    .limit(1);

  if (recentReminder.length > 0) {
    console.log(`Skipping reminder for billing event ${billingEventId} - reminder sent within last 7 days`);
    return { emailSent: false, emailRecipients: [] };
  }

  // One group per language the recipients read, so a mixed-language team gets
  // the reminder in each member's own language instead of the team's.
  const groups = await getTeamNotificationGroups(teamId, {
    configuredEmails: [billingEmail],
  });
  const emailRecipients = groups.flatMap((group) => group.emails);

  if (emailRecipients.length > 0) {
    if (!process.env.POSTMARK_API_KEY) {
      throw new Error("POSTMARK_API_KEY is not set");
    }

    const postmarkClient = new ServerClient(process.env.POSTMARK_API_KEY);

    for (const [index, group] of groups.entries()) {
      const t = group.t;
      const emailHtml = await render(
        FailedPaymentEmail({
          t,
          companyName,
          invoiceReference: invoiceReference ?? 0,
          totalAmountIncl: parseFloat(totalAmountIncl),
          billingDate: format(billingDate, "yyyy-MM-dd"),
        })
      );

      await postmarkClient.sendEmail({
        From: "billing@recommand.eu",
        To: group.emails.join(", "),
        // Only the first send carries the copy to billing: the groups differ
        // only in language, so more copies would tell them nothing new.
        Cc: index === 0 ? "billing@recommand.eu" : undefined,
        Subject: t`Payment failed for invoice ${invoiceReference ?? ""}`,
        HtmlBody: emailHtml,
      });
    }
  }

  await db.insert(paymentFailureReminders).values({
    billingEventId,
    emailAddresses: emailRecipients,
  });

  return { emailSent: emailRecipients.length > 0, emailRecipients };
}
