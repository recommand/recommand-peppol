export type ArratechSupportedDocumentType = {
  documentId: string;
  processId: string;
  exactMatchOnly?: boolean;
};

export function mergeSupportedDocumentTypes(
  currentDocumentTypes: ArratechSupportedDocumentType[],
  requestedDocumentTypes: ArratechSupportedDocumentType[],
): ArratechSupportedDocumentType[] {
  const documentTypesByCapability = new Map<string, ArratechSupportedDocumentType>();

  for (const documentType of currentDocumentTypes) {
    documentTypesByCapability.set(
      `${documentType.documentId}\0${documentType.processId}`,
      documentType,
    );
  }

  for (const documentType of requestedDocumentTypes) {
    documentTypesByCapability.set(
      `${documentType.documentId}\0${documentType.processId}`,
      documentType,
    );
  }

  return [...documentTypesByCapability.values()];
}
