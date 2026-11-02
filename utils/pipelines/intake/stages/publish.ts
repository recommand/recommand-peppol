import { assignLabelToDocument } from "@peppol/data/document-labels";
import { publishDocumentResult } from "@peppol/data/imports/results";
import {
  insertIncomingDocumentRecord,
  prepareIncomingDocumentRecord,
  runIncomingDocumentFollowUps,
} from "@peppol/data/record-incoming-document";
import { getExtendedTeam } from "@peppol/data/teams";
import type { PreparedIncomingDocument } from "@peppol/utils/pipelines/receiving/types";
import { getDocumentType } from "@peppol/utils/type-repository/document-types";
import type { DocumentTypeKey } from "@peppol/utils/type-repository/document-types/types";
import { db } from "@recommand/db";
import { encodeResult } from "../encode";
import { failure, processingMethodOf, type ResultContext, type Stage, type StageOutcome } from "../types";

async function publish(context: ResultContext): Promise<StageOutcome> {
  const { importRow, company, checkpoints } = context;
  const structured = checkpoints.structured;
  const type = structured?.method === "parsed" ? structured.type : checkpoints.classify!.type;
  const documentType = getDocumentType(type)!;
  const check = checkpoints.check!;

  const encoded = await encodeResult(context, documentType, check.document);
  if ("error" in encoded) {
    return { failure: failure("extraction_invalid", `The extracted content could not be written as a document: ${encoded.error}`) };
  }
  const { sender, senderId, receiverId } = encoded;

  const received: PreparedIncomingDocument = {
    documentType,
    type: type as DocumentTypeKey,
    probableType: type as DocumentTypeKey,
    parsedDocument: encoded.document,
    xmlDocument: encoded.xml,
    originalPayload: encoded.originalPayload,
  };
  const team = await getExtendedTeam(company.teamId);
  const record = await prepareIncomingDocumentRecord({
    received,
    company,
    skipBilling: team?.isPlayground ?? false,
    // The check stage validated an extracted document already; parsed XML is validated here.
    validation: check.validation,
    source: {
      channel: importRow.channel,
      importId: importRow.id,
      processingMethod: processingMethodOf(checkpoints),
      findings: check.findings,
      senderId,
      receiverId,
      docTypeId: encoded.docTypeId,
      processId: encoded.processId,
      countryC1: sender?.country || company.country,
    },
  });

  // The document, its usage and the result are one commit. When another worker published
  // the result first, publishing it fails and the commit with it.
  const documentId = await db.transaction(async (tx) => {
    const id = await insertIncomingDocumentRecord(record, tx);
    await publishDocumentResult(tx, importRow.id, context.result.id, id);
    return id;
  });

  for (const labelId of importRow.labelIds) {
    try {
      await assignLabelToDocument(company.teamId, documentId, labelId);
    } catch (error) {
      console.error(`Failed to assign label ${labelId} to document ${documentId}:`, error);
    }
  }
  await runIncomingDocumentFollowUps({
    documentId,
    received,
    company,
    senderId,
    isPlayground: team?.isPlayground ?? false,
  });
  return { published: documentId };
}

/** Record the document like a document received over Peppol, and publish the result with it. */
export const publishStage: Stage = { name: "publish", run: publish };
