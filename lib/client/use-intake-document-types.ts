import { useEffect, useState } from "react";
import { rc } from "@recommand/lib/client";
import type { IntakeDocumentTypes } from "@peppol/api/intake-document-types";

const client = rc<IntakeDocumentTypes>("peppol");

export type IntakeDocumentType = { key: string; aiIntake: boolean };

/** The document types intake can produce, as the server defines them; empty while loading. */
export function useIntakeDocumentTypes(): IntakeDocumentType[] {
  const [types, setTypes] = useState<IntakeDocumentType[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await client.intakeDocumentTypes.$get();
        const json = await response.json();
        if (!cancelled && json.success) {
          setTypes(json.documentTypes);
        }
      } catch {
        // Without the list, the dialogs offer automatic detection and all types only.
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  return types;
}
