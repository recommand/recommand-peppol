import { sendEmail } from "@core/lib/email";
import { CompanyVerifiedNotification, subject as verifiedSubject } from "@peppol/emails/company-verified-notification";
import { CompanyVerificationRejectedNotification, subject as rejectedSubject } from "@peppol/emails/company-verification-rejected-notification";
import { getTeamExtension } from "@peppol/data/teams";
import { getTeamNotificationGroups, type NotificationGroup } from "@peppol/data/notification-language";
import React from "react";

/**
 * One group per language among the recipients, so members who configured
 * different languages each get the notification in their own. A team support
 * mailbox, when set, replaces the members and gets the team's language.
 */
async function getManualVerificationEmailGroups(teamId: string): Promise<NotificationGroup[]> {
  const teamExtension = await getTeamExtension(teamId);

  return getTeamNotificationGroups(teamId, {
    configuredEmails: [teamExtension?.supportEmailAddress],
    alwaysEmails: ["support@recommand.eu"],
  });
}

export async function sendManualVerificationEmail({
  teamId,
  companyName,
}: {
  teamId: string;
  companyName: string;
}): Promise<void> {
  const groups = await getManualVerificationEmailGroups(teamId);

  for (const { emails, t } of groups) {
    if (emails.length === 0) {
      continue;
    }

    try {
      await sendEmail({
        to: emails.join(", "),
        subject: verifiedSubject({ companyName, t }),
        email: React.createElement(CompanyVerifiedNotification, { companyName, t }),
      });
    } catch (error) {
      console.error(`Failed to send manual verification email for company ${companyName}:`, error);
    }
  }
}

export async function sendManualVerificationDeclinedEmail({
  teamId,
  companyName,
}: {
  teamId: string;
  companyName: string;
}): Promise<void> {
  const groups = await getManualVerificationEmailGroups(teamId);

  for (const { emails, t } of groups) {
    if (emails.length === 0) {
      continue;
    }

    try {
      await sendEmail({
        to: emails.join(", "),
        subject: rejectedSubject({ companyName, t }),
        email: React.createElement(CompanyVerificationRejectedNotification, { companyName, t }),
      });
    } catch (error) {
      console.error(`Failed to send manual verification declined email for company ${companyName}:`, error);
    }
  }
}
