import { zodValidator } from "@recommand/lib/zod-validator";
import { Server } from "@recommand/lib/api";
import { z } from "zod";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { endBillingCycle } from "@peppol/data/billing/billing";
import { retryFailedPayments } from "@peppol/data/billing/payment-retry";
import { endOfMonth, format, subMonths } from "date-fns";
import { requireGlobalPermission } from "@core/lib/permissions/permission-middleware";
import { describeRoute } from "hono-openapi";
import ExcelJS from "exceljs";
import { TZDate } from "@date-fns/tz";

const server = new Server();

const _endBillingCycle = server.post(
  "/billing/end-billing-cycle",
  requireGlobalPermission("peppol.billing"),
  describeRoute({ hide: true }),
  zodValidator("query", z.object({ dryRun: z.string().optional().default("false"), teamId: z.union([z.string(), z.array(z.string())]).optional(), billingDate: z.string().optional() })),
  async (c) => {

    const { dryRun, teamId } = c.req.valid("query");
    const teamIds = Array.isArray(teamId) ? teamId : teamId ? [teamId] : undefined;

    try {

      let billingDate: Date;
      if (c.req.query("billingDate")) {
        // Date is in format YYYY-MM-DD, convert it to a Date object (end of day in UTC)
        billingDate = new Date(c.req.query("billingDate") + "T23:59:59.999Z");
      } else {
        // End of previous month (UTC)
        billingDate = endOfMonth(subMonths(TZDate.tz("UTC"), 1));
      }
      const isDryRun = dryRun === "true";
      console.log("Ending billing cycle for", teamIds ? teamIds : "all teams", "on", billingDate, "with dry run", isDryRun);
      const results = await endBillingCycle(billingDate, isDryRun, teamIds);

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Billing Results");

      worksheet.columns = [
        { header: "Status", key: "status", width: 15 },
        { header: "Is Invoice Sent", key: "isInvoiceSent", width: 10 },
        { header: "Is Payment Requested", key: "isPaymentRequested", width: 10 },
        { header: "Message", key: "message", width: 40 },
        { header: "Billing Profile ID", key: "billingProfileId", width: 30 },
        { header: "Billing Profile Standing", key: "billingProfileStanding", width: 20 },
        { header: "Is Manually Billed", key: "isManuallyBilled", width: 20 },
        { header: "Team ID", key: "teamId", width: 30 },
        { header: "Subscription ID", key: "subscriptionId", width: 30 },
        { header: "Company Name", key: "companyName", width: 30 },
        { header: "Company Street", key: "companyStreet", width: 30 },
        { header: "Company Postal Code", key: "companyPostalCode", width: 20 },
        { header: "Company City", key: "companyCity", width: 20 },
        { header: "Company Country", key: "companyCountry", width: 15 },
        { header: "Company VAT Number", key: "companyVatNumber", width: 20 },
        { header: "Subscription Start Date", key: "subscriptionStartDate", width: 20 },
        { header: "Subscription End Date", key: "subscriptionEndDate", width: 20 },
        { header: "Subscription Last Billed At", key: "subscriptionLastBilledAt", width: 25 },
        { header: "Plan ID", key: "planId", width: 30 },
        { header: "Included Monthly Documents", key: "includedMonthlyDocuments", width: 25 },
        { header: "Base Price", key: "basePrice", width: 15 },
        { header: "Incoming Document Overage Price", key: "incomingDocumentOveragePrice", width: 30 },
        { header: "Outgoing Document Overage Price", key: "outgoingDocumentOveragePrice", width: 30 },
        { header: "Billing Event ID", key: "billingEventId", width: 30 },
        { header: "Invoice ID", key: "invoiceId", width: 30 },
        { header: "Invoice Reference", key: "invoiceReference", width: 20 },
        { header: "Line Total (Excl. VAT)", key: "lineTotalExcl", width: 25 },
        { header: "Total Amount Invoice (Excl. VAT)", key: "totalAmountExcl", width: 25 },
        { header: "VAT Category", key: "vatCategory", width: 15 },
        { header: "VAT Percentage", key: "vatPercentage", width: 15 },
        { header: "VAT Exemption Reason", key: "vatExemptionReason", width: 40 },
        { header: "VAT Amount", key: "vatAmount", width: 15 },
        { header: "Total Amount Invoice (Incl. VAT)", key: "totalAmountIncl", width: 25 },
        { header: "Billing Date", key: "billingDate", width: 20 },
        { header: "Billing Period Start", key: "billingPeriodStart", width: 25 },
        { header: "Billing Period End", key: "billingPeriodEnd", width: 25 },
        { header: "Used Quantity", key: "usedQty", width: 15 },
        { header: "Used Quantity Incoming", key: "usedQtyIncoming", width: 25 },
        { header: "Used Quantity Outgoing", key: "usedQtyOutgoing", width: 25 },
        { header: "Overage Quantity Incoming", key: "overageQtyIncoming", width: 25 },
        { header: "Overage Quantity Outgoing", key: "overageQtyOutgoing", width: 25 },
      ];

      worksheet.getRow(1).font = { bold: true };

      for (const result of results) {
        worksheet.addRow(result);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `billing-cycle-${format(billingDate, "yyyy-MM-dd")}-${isDryRun ? "dry-run" : "live"}.xlsx`;

      c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);

      return c.body(buffer);
    } catch (error) {
      console.error(error);
      return c.json(actionFailure("Failed to generate billing cycle report"), 500);
    }
  }
);

const _retryFailedPayments = server.post(
  "/billing/retry-failed-payments",
  requireGlobalPermission("peppol.billing"),
  describeRoute({ hide: true }),
  zodValidator("query", z.object({ dryRun: z.string().optional().default("false"), teamId: z.union([z.string(), z.array(z.string())]).optional() })),
  async (c) => {
    try {
      const { dryRun, teamId } = c.req.valid("query");
      const teamIds = Array.isArray(teamId) ? teamId : teamId ? [teamId] : undefined;
      const isDryRun = dryRun === "true";

      console.log("Retrying failed payments for", teamIds ? teamIds : "all teams", "with dry run", isDryRun);
      const results = await retryFailedPayments(teamIds, isDryRun);

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Payment Retry Results");

      worksheet.columns = [
        { header: "Status", key: "status", width: 15 },
        { header: "Billing Event ID", key: "billingEventId", width: 30 },
        { header: "Invoice Reference", key: "invoiceReference", width: 20 },
        { header: "Team ID", key: "teamId", width: 30 },
        { header: "Company Name", key: "companyName", width: 30 },
        { header: "Amount Due", key: "amountDue", width: 15 },
        { header: "Error Message", key: "errorMessage", width: 50 },
      ];

      worksheet.getRow(1).font = { bold: true };

      for (const result of results) {
        worksheet.addRow({
          status: result.status,
          billingEventId: result.billingEventId,
          invoiceReference: result.invoiceReference,
          teamId: result.teamId,
          companyName: result.companyName,
          amountDue: result.amountDue,
          errorMessage: result.errorMessage || "",
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `payment-retry-${format(new Date(), "yyyy-MM-dd")}-${isDryRun ? "dry-run" : "live"}.xlsx`;

      c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);

      return c.body(buffer);
    } catch (error) {
      console.error(error);
      return c.json(actionFailure("Failed to retry failed payments"), 500);
    }
  }
);

export type Billing = typeof _endBillingCycle | typeof _retryFailedPayments;

export default server;