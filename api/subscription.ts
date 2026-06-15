import { zodValidator } from "@recommand/lib/zod-validator";
import { Server, type Context } from "@recommand/lib/api";
import { z } from "zod";
import {
  cancelSubscription,
  getActiveSubscription,
  getFutureSubscription,
  startSubscription,
} from "@peppol/data/subscriptions";
import { getBillingEvents } from "@peppol/data/billing/usage";
import { availablePlans } from "@peppol/data/plans";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { requireTeamAccess, type AuthenticatedTeamContext, type AuthenticatedUserContext } from "@core/lib/auth-middleware";
import { describeRoute } from "hono-openapi";
import { subscriptionBillingEvents, transmittedDocuments } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, eq } from "drizzle-orm";
import JSZip from "jszip";
import { renderDocumentPdf } from "@peppol/utils/document-renderer";
import { resolveDocumentXmlAndAttachments } from "@peppol/data/offload/storage";

const server = new Server();

const _getActiveSubscription = server.get(
  "/:teamId/subscription",
  requireTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", z.object({ teamId: z.string() })),
  async (c) => {
    const subscription = await getActiveSubscription(c.var.team.id);
    const futureSubscription = await getFutureSubscription(c.var.team.id);
    return c.json(actionSuccess({ subscription, futureSubscription }));
  }
);

const _startSubscription = server.post(
  "/:teamId/subscription",
  requireTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", z.object({ teamId: z.string() })),
  zodValidator(
    "json",
    z.object({
      planId: z.string(),
    })
  ),
  async (c) => {
    const planId = c.req.valid("json").planId;

    // Get plan
    const plan = availablePlans.find((p) => p.id === planId);
    if (!plan) {
      return c.json(actionFailure("Plan not found"), 404);
    }

    const subscription = await startSubscription(
      c.var.team.id,
      planId,
      plan.name,
      plan
    );

    return c.json(actionSuccess({ subscription }));
  }
);

const _cancelSubscription = server.post(
  "/:teamId/subscription/cancel",
  requireTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", z.object({ teamId: z.string() })),
  async (c) => {
    await cancelSubscription(c.var.team.id);
    return c.json(actionSuccess());
  }
);

const _getBillingEvents = server.get(
  "/:teamId/subscription/billing-events",
  requireTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", z.object({ teamId: z.string() })),
  async (c) => {
    const events = await getBillingEvents(c.var.team.id);
    return c.json(actionSuccess({ events }));
  }
);

const downloadBillingInvoiceParamSchema = z.object({
  teamId: z.string(),
  billingEventId: z.string(),
});

const downloadBillingInvoiceQuerySchema = z.object({
  generatePdf: z.enum(["never", "always", "when_no_pdf_attachment"]).default("always"),
});

type DownloadBillingInvoiceContext = Context<AuthenticatedUserContext & AuthenticatedTeamContext, string, { in: { param: z.input<typeof downloadBillingInvoiceParamSchema>, query: z.input<typeof downloadBillingInvoiceQuerySchema> }, out: { param: z.infer<typeof downloadBillingInvoiceParamSchema>, query: z.infer<typeof downloadBillingInvoiceQuerySchema> } }>;

const _downloadBillingInvoice = server.get(
  "/:teamId/subscription/billing-events/:billingEventId/download",
  requireTeamAccess(),
  describeRoute({hide: true}),
  zodValidator("param", downloadBillingInvoiceParamSchema),
  zodValidator("query", downloadBillingInvoiceQuerySchema),
  async (c: DownloadBillingInvoiceContext) => {
    try {
      const { billingEventId } = c.req.valid("param");
      const { generatePdf } = c.req.valid("query");
      const teamId = c.var.team.id;

      const billingEvent = await db
        .select()
        .from(subscriptionBillingEvents)
        .where(
          and(
            eq(subscriptionBillingEvents.teamId, teamId),
            eq(subscriptionBillingEvents.id, billingEventId)
          )
        )
        .limit(1);

      if (!billingEvent[0]) {
        return c.json(actionFailure("Billing event not found"), 404);
      }

      if (!billingEvent[0].invoiceId) {
        return c.json(actionFailure("Billing event has no associated invoice"), 404);
      }

      const invoiceId = billingEvent[0].invoiceId;

      const document = await db
        .select()
        .from(transmittedDocuments)
        .where(eq(transmittedDocuments.id, invoiceId))
        .limit(1);

      if (!document[0]) {
        return c.json(actionFailure("Invoice document not found"), 404);
      }

      const zip = new JSZip();

      const { xml, attachments } = await resolveDocumentXmlAndAttachments(document[0]);
      if (xml) {
        zip.file("document.xml", xml);
      }

      let hasPdfAttachment = false;
      if (Array.isArray(attachments)) {
        for (const attachment of attachments) {
          const base64 = attachment.embeddedDocument;
          const mimeCode = attachment.mimeCode;
          const filename = attachment.filename;

          if (base64 && mimeCode && filename) {
            zip.file(filename, Buffer.from(base64, 'base64'));
            if (mimeCode === "application/pdf") {
              hasPdfAttachment = true;
            }
          }
        }
      }

      const shouldGeneratePdf = generatePdf === "always" || (generatePdf === "when_no_pdf_attachment" && !hasPdfAttachment);
      
      if (shouldGeneratePdf) {
        try {
          const pdfBuffer = await renderDocumentPdf(document[0] as any);
          zip.file("auto-generated.pdf", pdfBuffer);
        } catch (error) {
          console.error("Failed to generate PDF for billing invoice package:", error);
        }
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      const invoiceReference = billingEvent[0].invoiceReference;
      const filename = invoiceReference ? `invoice-${invoiceReference}.zip` : `invoice-${invoiceId}.zip`;

      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);

      return c.body(zipBuffer);
    } catch (error) {
      console.error("Failed to download billing invoice:", error);
      return c.json(actionFailure("Failed to download invoice"), 500);
    }
  }
);

export type Subscription = typeof _getActiveSubscription | typeof _startSubscription | typeof _cancelSubscription | typeof _getBillingEvents | typeof _downloadBillingInvoice;

export default server;
