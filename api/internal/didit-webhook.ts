import { Server } from "@recommand/lib/api";
import { actionFailure, actionSuccess } from "@recommand/lib/utils";
import { describeRoute } from "hono-openapi";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@recommand/db";
import { companyVerificationLog } from "@peppol/db/schema";
import { UserFacingError } from "@directory/utils/util";
import { finalizeCompanyVerification, getCompanyVerificationLog } from "@peppol/data/company-verification";
import { requiresArratechKycReview } from "@peppol/data/at/kyc";
import { startArratechKycReview } from "@peppol/data/at/kyc-review";
import { getCompanyById } from "@peppol/data/companies";
import { sendManualVerificationDeclinedEmail, sendManualVerificationEmail } from "@peppol/data/send-manual-verification-email";

const server = new Server();

server.post(
  "/didit",
  describeRoute({ hide: true }),
  async (c) => {
    console.log("Received Didit webhook");
    const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET_KEY;
    if (!webhookSecret) {
      console.error("DIDIT_WEBHOOK_SECRET_KEY environment variable is not set");
      return c.json(actionFailure("Webhook secret not configured"), 500);
    }

    try {
      const rawBody = await c.req.raw.clone().text();
      const signature = c.req.header("X-Signature");
      const timestamp = c.req.header("X-Timestamp");

      if (!signature || !timestamp) {
        return c.json(actionFailure("Missing signature or timestamp"), 401);
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const incomingTime = parseInt(timestamp, 10);
      if (Math.abs(currentTime - incomingTime) > 300) {
        return c.json(actionFailure("Request timestamp is stale"), 401);
      }

      const hmac = createHmac("sha256", webhookSecret);
      const expectedSignature = hmac.update(rawBody).digest("hex");

      const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
      const providedSignatureBuffer = Buffer.from(signature, "utf8");

      if (
        expectedSignatureBuffer.length !== providedSignatureBuffer.length ||
        !timingSafeEqual(expectedSignatureBuffer, providedSignatureBuffer)
      ) {
        return c.json(actionFailure("Invalid signature"), 401);
      }

      const diditWebhookSchema = z.object({
        session_id: z.string(),
        status: z.string(),
        vendor_data: z.string(),
        webhook_type: z.string(),
        decision: z.object({
          id_verification: z.object({
            first_name: z.string().optional().nullable(),
            last_name: z.string().optional().nullable(),
          }).optional(),
          reviews: z.array(z.object({
            new_status: z.string().nullable(),
          })).optional(),
        }).optional(),
      });

      const parseResult = diditWebhookSchema.safeParse(JSON.parse(rawBody));
      if (!parseResult.success) {
        console.error("Invalid webhook payload:", parseResult.error);
        return c.json(actionFailure("Invalid webhook payload: " + parseResult.error.message), 400);
      }

      const { session_id, status, vendor_data, webhook_type, decision } = parseResult.data;

      if (webhook_type !== "status.updated") {
        return c.json(actionSuccess({ message: "Webhook type not processed" }), 200);
      }

      const companyVerificationLogRecord = await getCompanyVerificationLog(vendor_data);
      if (!companyVerificationLogRecord) {
        return c.json(actionFailure("Company verification log not found"), 404);
      }

      const verificationProofReference = session_id;
      const lastManualReview = decision?.reviews?.find(r => r.new_status !== null);

      let isVerified = false;
      if (lastManualReview) {
        isVerified = lastManualReview.new_status === "Approved";
      } else if (status === "Approved") {
        const diditFirstName = decision?.id_verification?.first_name;
        const diditLastName = decision?.id_verification?.last_name;
        const storedFirstName = companyVerificationLogRecord.firstName;
        const storedLastName = companyVerificationLogRecord.lastName;

        if (diditFirstName && diditLastName && storedFirstName && storedLastName) { // We don't check if the names match anymore, because Didit does it for us now through the expected_details parameter
          isVerified = true;
        }
      } else if (status === "In Review") {
        await db
          .update(companyVerificationLog)
          .set({ status: "inReview" })
          .where(eq(companyVerificationLog.id, companyVerificationLogRecord.id));
        return c.json(actionSuccess({ message: "Verification status updated to in review" }), 200);
      } else if (status === "Not Started" || status === "In Progress") {
        return c.json(actionSuccess({ message: "Verification status not changed (not started)" }), 200);
      }

      const company = await getCompanyById(companyVerificationLogRecord.companyId);
      if (!company) {
        return c.json(actionFailure("Company not found"), 404);
      }

      if (!isVerified && !lastManualReview && company.isVerified) {
        console.log(`Ignoring automated rejection for already-verified company ${companyVerificationLogRecord.companyId}`);
        return c.json(actionSuccess({ message: "Verification status not changed (already verified)" }), 200);
      }

      if (isVerified && await requiresArratechKycReview(company)) {
        const kycReview = await startArratechKycReview({
          companyVerificationLogId: companyVerificationLogRecord.id,
          company,
          verificationProofReference,
        });
        return c.json(
          actionSuccess({
            message:
              kycReview.status === "inReview"
                ? "Verification is awaiting platform activation"
                : "Verification status not changed (already finalized)",
          }),
          200
        );
      }

      const result = await finalizeCompanyVerification({
        companyVerificationLogId: companyVerificationLogRecord.id,
        company,
        status: isVerified ? "verified" : "rejected",
        verificationProofReference,
      });

      if (lastManualReview && result.status === "verified") {
        await sendManualVerificationEmail({
          teamId: company.teamId,
          companyName: company.name,
        });
      }

      if (lastManualReview && result.status === "rejected") {
        await sendManualVerificationDeclinedEmail({
          teamId: company.teamId,
          companyName: company.name,
        });
      }

      return c.json(actionSuccess({ message: result.status === "error" ? "Verification completed with activation error" : "Verification status updated" }), 200);
    } catch (error) {
      console.error("Error processing Didit webhook:", error);
      if (error instanceof UserFacingError) {
        return c.json(actionFailure(error), 400);
      }
      return c.json(actionFailure("Unknown error"), 500);
    }
  }
);

export default server;
