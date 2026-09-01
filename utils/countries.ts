import {
    COUNTRIES as DIRECTORY_COUNTRIES,
    type CountryInfo as DirectoryCountryInfo,
} from "@directory/utils/countries";
import {
    FRANCE_REGULATED_PROCESS_ID,
} from "./type-repository/document-formats/france-process";
import {
    getReceivingCapability,
} from "./type-repository/receiving-capabilities";
import type { ReceivingCapability } from "./type-repository/receiving-capabilities/types";

export type CountryInfo = DirectoryCountryInfo & {
    defaultDocumentTypes: ReceivingCapability[];
}

const PEPPOL_BILLING_PROCESS_ID =
    "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const DEFAULT_DOCUMENT_TYPES: ReceivingCapability[] = [
    getReceivingCapability("peppol-ubl-bis3-invoice", PEPPOL_BILLING_PROCESS_ID),
    getReceivingCapability("peppol-ubl-bis3-creditnote", PEPPOL_BILLING_PROCESS_ID),
];

const FRANCE_DEFAULT_DOCUMENT_TYPES: ReceivingCapability[] = [
    getReceivingCapability("peppol-ubl-bis3-invoice", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("peppol-ubl-bis3-creditnote", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("ubl-france-cius-invoice", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("ubl-france-cius-creditnote", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("ubl-france-extended-invoice", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("ubl-france-extended-creditnote", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("cii-d22b-france-cius", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("cii-d22b-france-extended", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("facturx-france", FRANCE_REGULATED_PROCESS_ID),
    getReceivingCapability("france-cdar", FRANCE_REGULATED_PROCESS_ID),
];

const DOCUMENT_TYPES_BY_COUNTRY: Record<string, ReceivingCapability[]> = {
    FR: FRANCE_DEFAULT_DOCUMENT_TYPES,
    NL: [
        ...DEFAULT_DOCUMENT_TYPES,
        getReceivingCapability("si-ubl-invoice", PEPPOL_BILLING_PROCESS_ID),
        getReceivingCapability("si-ubl-creditnote", PEPPOL_BILLING_PROCESS_ID),
    ],
};

export const COUNTRIES: CountryInfo[] = DIRECTORY_COUNTRIES.map((country) => ({
    ...country,
    defaultDocumentTypes:
        DOCUMENT_TYPES_BY_COUNTRY[country.code] ?? DEFAULT_DOCUMENT_TYPES,
}));
