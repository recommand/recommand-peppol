import type { Import } from "@peppol/data/imports/imports";
import type { Failure } from "@peppol/types/intake";
import { getDocumentFormatsByDocumentTypeKey } from "@peppol/utils/type-repository/document-formats";
import { documentTypes } from "@peppol/utils/type-repository/document-types";
import type { AnyDocumentType } from "@peppol/utils/type-repository/document-types/types";
import { failure } from "./types";

const allTypes = documentTypes as readonly AnyDocumentType[];

/** The types AI intake can recognise and extract from a PDF. */
export function aiIntakeTypes(): AnyDocumentType[] {
  return allTypes.filter((type) => type.aiIntake);
}

/** The types an import can produce: from a PDF with AI, or from XML in a registered format. */
export function intakeTypeKeys(): string[] {
  return allTypes
    .filter((type) => type.aiIntake || getDocumentFormatsByDocumentTypeKey(type.key).length > 0)
    .map((type) => type.key);
}

/**
 * The failure of a result whose detected type the import does not allow: not the type
 * the request expected, or not a type the receiving address accepts.
 */
export function typeConstraintFailure(
  importRow: Pick<Import, "expectedType" | "acceptedTypes">,
  type: string,
): Failure | null {
  if (importRow.expectedType && importRow.expectedType !== type) {
    return failure(
      "type_mismatch",
      `The file contains a ${type}, not the expected ${importRow.expectedType}.`,
      { detectedType: type, expectedType: importRow.expectedType },
    );
  }
  if (importRow.acceptedTypes && !importRow.acceptedTypes.includes(type)) {
    return failure(
      "unsupported_document_type",
      `The receiving address does not accept documents of type ${type}.`,
      { detectedType: type },
    );
  }
  return null;
}
