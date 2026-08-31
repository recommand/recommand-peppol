import {
  billingProfiles,
} from "@peppol/db/schema";
import { cleanVatNumber } from "@directory/utils/util";
import type { VatCategory } from "@peppol/utils/parsing/invoice/schemas";
import { getMinimalTeamMembers } from "@core/data/team-members";
import { render } from "@react-email/render";
import { InvoiceEmail } from "@peppol/emails/invoice-email";
import { formatISO } from "date-fns";
import { getTeamNotificationT } from "@peppol/data/notification-language";

export async function sendInvoiceAsBRBX(
  info: {
    issueDate: Date;
    teamId: string;
    companyName: string;
    companyStreet: string;
    companyPostalCode: string;
    companyCity: string;
    companyCountry: string;
    companyVatNumber: string | null;
    invoiceReference: number | null;
    totalAmountExcl: number;
    totalVatAmount: number;
    vatCategory: VatCategory;
    vatPercentage: number;
    vatExemptionReason: string | null;
    totalAmountIncl: number;
    lines: {
      planId: string | null;
      name: string;
      description: string;
      netPriceAmount: string;
      netAmount: string;
      vat: {
        category: VatCategory;
        percentage: string;
      };
    }[];
  },
  billingProfile: typeof billingProfiles.$inferSelect,
  dryRun: boolean = false
): Promise<string> {
  const companyId = dryRun
    ? process.env.BRBX_BILLING_DRY_RUN_COMPANY_ID
    : process.env.BRBX_BILLING_LIVE_COMPANY_ID;
  const jwt = dryRun
    ? process.env.BRBX_BILLING_DRY_RUN_JWT
    : process.env.BRBX_BILLING_LIVE_JWT;

  if (!companyId) {
    throw new Error(`BRBX_BILLING_${dryRun ? "DRY_RUN" : "LIVE"}_COMPANY_ID environment variable is not set`);
  }
  if (!jwt) {
    throw new Error(`BRBX_BILLING_${dryRun ? "DRY_RUN" : "LIVE"}_JWT environment variable is not set`);
  }
  
  let cleanedVat: string | null = cleanVatNumber(info.companyVatNumber) as string | null;
  if(cleanedVat){
    // If the two first characters of the VAT number are not letters, add the country code
    if(!/^[A-Z]{2}$/.test(cleanedVat.toUpperCase().substring(0, 2))) {
      cleanedVat = info.companyCountry.toUpperCase() + cleanedVat;
    }
  }

  let recipient: string | null = null;
  if (billingProfile.billingPeppolAddress) {
    recipient = billingProfile.billingPeppolAddress.trim();
  } else if (info.companyVatNumber) {
    if (!cleanedVat) {
      throw new Error("Cannot send invoice: company VAT number is invalid");
    }

    if (cleanedVat.startsWith("BE")) {
      const vatWithoutCountryCode = cleanedVat.substring(2);
      recipient = `0208:${vatWithoutCountryCode}`;
    }
  }

  let emailRecipients: string[] = [];
  if (billingProfile.billingEmail) {
    emailRecipients = [billingProfile.billingEmail];
  } else {
    const teamMembers = await getMinimalTeamMembers(info.teamId);
    emailRecipients = teamMembers.map(member => member.user.email);
  }

  const invoice = {
    issueDate: formatISO(info.issueDate, { representation: "date" }),
    dueDate: formatISO(info.issueDate, { representation: "date" }),
    invoiceNumber: info.invoiceReference ? info.invoiceReference.toString() : "no-number",
    note: "Thank you for being a customer of the open source Recommand Peppol integration platform and helping us make Peppol more accessible to all businesses. This invoice will be paid automatically.",
    buyer: {
      name: info.companyName,
      street: info.companyStreet,
      city: info.companyCity,
      postalZone: info.companyPostalCode,
      country: info.companyCountry,
      vatNumber: cleanedVat,
    },
    lines: info.lines.map(line => ({
      sellersId: line.planId ?? null,
      name: line.name,
      description: line.description,
      netPriceAmount: line.netPriceAmount,
      netAmount: line.netAmount,
      vat: {
        category: line.vat.category,
        percentage: line.vat.percentage,
      },
    })),
    totals: {
      taxExclusiveAmount: info.totalAmountExcl,
      taxInclusiveAmount: info.totalAmountIncl,
      linesAmount: info.totalAmountExcl,
      payableAmount: info.totalAmountIncl,
    },
    vat: {
      totalVatAmount: info.totalVatAmount,
      subtotals: [{
        taxableAmount: info.totalAmountExcl,
        vatAmount: info.totalVatAmount,
        category: info.vatCategory,
        percentage: info.vatPercentage,
        exemptionReason: info.vatExemptionReason,
      }],
    }
  };

  // The BRBX API takes one body and one recipient list per document, so this
  // notification cannot be split per recipient language the way the payment
  // failure reminder is: it goes out in the team's language.
  const t = await getTeamNotificationT(info.teamId);
  const htmlBody = await render(
    InvoiceEmail({
      t,
      companyName: info.companyName,
      invoiceNumber: invoice.invoiceNumber,
      totalAmountExcl: info.totalAmountExcl,
      totalVatAmount: info.totalVatAmount,
      totalAmountIncl: info.totalAmountIncl,
      vatPercentage: info.vatPercentage,
      vatCategory: info.vatCategory,
      vatExemptionReason: info.vatExemptionReason,
      lines: info.lines,
    })
  );

  const response = await fetch(`https://app.recommand.eu/api/v1/${companyId}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      documentType: "invoice",
      recipient,
      document: invoice,
      email: dryRun ? undefined : {
        to: emailRecipients,
        when: "on_peppol_failure",
        subject: t`Recommand invoice ${invoice.invoiceNumber}`,
        htmlBody: htmlBody,
      },
      pdfGeneration: {
        enabled: true,
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send invoice via BRBX API: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const responseJson = await response.json();
  return responseJson.id;
}