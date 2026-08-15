import {
    FRANCE_REGULATED_PROCESS_ID,
} from "./type-repository/document-formats/france-process";
import {
    getReceivingCapability,
} from "./type-repository/receiving-capabilities";
import type { ReceivingCapability } from "./type-repository/receiving-capabilities/types";

export type CountrySupportLevel = "supported" | "partial" | "unsupported";

export type CountryInfo = {
    code: string;
    name: string;
    flag: string;
    supportLevel: CountrySupportLevel;
    defaultVatScheme?: string | null;
    defaultEnterpriseNumberScheme?: string | null;
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

export const COUNTRIES: CountryInfo[] = ([
    {
        code: "AT",
        name: "Austria",
        flag: "🇦🇹",
        supportLevel: "supported",
        defaultVatScheme: "9914",
        defaultEnterpriseNumberScheme: "9919",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "BE",
        name: "Belgium",
        flag: "🇧🇪",
        supportLevel: "supported",
        defaultVatScheme: "9925",
        defaultEnterpriseNumberScheme: "0208",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "BG",
        name: "Bulgaria",
        flag: "🇧🇬",
        supportLevel: "unsupported",
        defaultVatScheme: "9926",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "CA",
        name: "Canada",
        flag: "🇨🇦",
        supportLevel: "supported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "HR",
        name: "Croatia",
        flag: "🇭🇷",
        supportLevel: "partial",
        defaultVatScheme: "9934",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "DK",
        name: "Denmark",
        flag: "🇩🇰",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0184",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "EE",
        name: "Estonia",
        flag: "🇪🇪",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0191",
        defaultVatScheme: "9931",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "FI",
        name: "Finland",
        flag: "🇫🇮",
        supportLevel: "supported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "FR",
        name: "France",
        flag: "🇫🇷",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0225",
        defaultDocumentTypes: FRANCE_DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "DE",
        name: "Germany",
        flag: "🇩🇪",
        supportLevel: "supported",
        defaultVatScheme: "9930",
        defaultEnterpriseNumberScheme: "0204",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "GR",
        name: "Greece",
        flag: "🇬🇷",
        supportLevel: "partial",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "HU",
        name: "Hungary",
        flag: "🇭🇺",
        supportLevel: "partial",
        defaultVatScheme: "9910",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "IS",
        name: "Iceland",
        flag: "🇮🇸",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0196",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "IE",
        name: "Ireland",
        flag: "🇮🇪",
        supportLevel: "supported",
        defaultVatScheme: "9935",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "IT",
        name: "Italy",
        flag: "🇮🇹",
        supportLevel: "partial",
        defaultVatScheme: "0211",
        defaultEnterpriseNumberScheme: "0210",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "LV",
        name: "Latvia",
        flag: "🇱🇻",
        supportLevel: "partial",
        defaultVatScheme: "9939",
        defaultEnterpriseNumberScheme: "0218",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "LU",
        name: "Luxembourg",
        flag: "🇱🇺",
        supportLevel: "supported",
        defaultVatScheme: "9938",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "NL",
        name: "Netherlands",
        flag: "🇳🇱",
        supportLevel: "supported",
        defaultVatScheme: "9944",
        defaultEnterpriseNumberScheme: "0106",
        defaultDocumentTypes: [
            ...DEFAULT_DOCUMENT_TYPES,
            getReceivingCapability("si-ubl-invoice", PEPPOL_BILLING_PROCESS_ID),
            getReceivingCapability("si-ubl-creditnote", PEPPOL_BILLING_PROCESS_ID),
        ],
    },
    {
        code: "NO",
        name: "Norway",
        flag: "🇳🇴",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0192",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "PL",
        name: "Poland",
        flag: "🇵🇱",
        supportLevel: "partial",
        defaultVatScheme: "9945",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "PT",
        name: "Portugal",
        flag: "🇵🇹",
        supportLevel: "supported",
        defaultVatScheme: "9946",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "RO",
        name: "Romania",
        flag: "🇷🇴",
        supportLevel: "partial",
        defaultVatScheme: "9947",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "SI",
        name: "Slovenia",
        flag: "🇸🇮",
        supportLevel: "supported",
        defaultVatScheme: "9949",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "ES",
        name: "Spain",
        flag: "🇪🇸",
        supportLevel: "partial",
        defaultVatScheme: "9920",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "SE",
        name: "Sweden",
        flag: "🇸🇪",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0007",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "SK",
        name: "Slovakia",
        flag: "🇸🇰",
        supportLevel: "partial",
        defaultEnterpriseNumberScheme: "0245",
        defaultVatScheme: "9950",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "GB",
        name: "United Kingdom",
        flag: "🇬🇧",
        supportLevel: "supported",
        defaultVatScheme: "9932",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "AU",
        name: "Australia",
        flag: "🇦🇺",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0151",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "HK",
        name: "Hong Kong",
        flag: "🇭🇰",
        supportLevel: "unsupported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "JP",
        name: "Japan",
        flag: "🇯🇵",
        supportLevel: "unsupported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "MY",
        name: "Malaysia",
        flag: "🇲🇾",
        supportLevel: "unsupported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "NZ",
        name: "New Zealand",
        flag: "🇳🇿",
        supportLevel: "unsupported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "SG",
        name: "Singapore",
        flag: "🇸🇬",
        supportLevel: "unsupported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "US",
        name: "United States",
        flag: "🇺🇸",
        supportLevel: "supported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "AE",
        name: "United Arab Emirates",
        flag: "🇦🇪",
        supportLevel: "unsupported",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
] satisfies CountryInfo[]).sort((a, b) => a.name.localeCompare(b.name));

export function getCountryName(countryCode: string): string {
    return COUNTRIES.find((country) => country.code === countryCode)?.name ?? countryCode;
}

export function getCountrySupportLevel(countryCode: string | null | undefined): CountrySupportLevel | undefined {
    return COUNTRIES.find((country) => country.code === countryCode)?.supportLevel;
}
