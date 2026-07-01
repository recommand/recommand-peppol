import { INVOICE_DOCUMENT_TYPE_INFO, CREDIT_NOTE_DOCUMENT_TYPE_INFO, SI_UBL_INVOICE_DOCUMENT_TYPE_INFO, SI_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO, type DocumentTypeInfo } from "./document-types";

export type CountryInfo = {
    code: string;
    name: string;
    flag: string;
    defaultVatScheme?: string | null;
    defaultEnterpriseNumberScheme?: string | null;
    defaultDocumentTypes: DocumentTypeInfo[];
}

const DEFAULT_DOCUMENT_TYPES: DocumentTypeInfo[] = [
    INVOICE_DOCUMENT_TYPE_INFO,
    CREDIT_NOTE_DOCUMENT_TYPE_INFO,
];

export const COUNTRIES: CountryInfo[] = [
    {
        code: "AT",
        name: "Austria",
        flag: "🇦🇹",
        defaultVatScheme: "9914",
        defaultEnterpriseNumberScheme: "9919",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "BE",
        name: "Belgium",
        flag: "🇧🇪",
        defaultVatScheme: "9925",
        defaultEnterpriseNumberScheme: "0208",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "BG",
        name: "Bulgaria",
        flag: "🇧🇬",
        defaultVatScheme: "9926",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "CA",
        name: "Canada",
        flag: "🇨🇦",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "HR",
        name: "Croatia",
        flag: "🇭🇷",
        defaultVatScheme: "9934",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "DK",
        name: "Denmark",
        flag: "🇩🇰",
        defaultEnterpriseNumberScheme: "0184",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "EE",
        name: "Estonia",
        flag: "🇪🇪",
        defaultEnterpriseNumberScheme: "0191",
        defaultVatScheme: "9931",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "FI",
        name: "Finland",
        flag: "🇫🇮",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "FR",
        name: "France",
        flag: "🇫🇷",
        defaultEnterpriseNumberScheme: "0225",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "DE",
        name: "Germany",
        flag: "🇩🇪",
        defaultVatScheme: "9930",
        defaultEnterpriseNumberScheme: "0204",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "GR",
        name: "Greece",
        flag: "🇬🇷",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "HU",
        name: "Hungary",
        flag: "🇭🇺",
        defaultVatScheme: "9910",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "IS",
        name: "Iceland",
        flag: "🇮🇸",
        defaultEnterpriseNumberScheme: "0196",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "IE",
        name: "Ireland",
        flag: "🇮🇪",
        defaultVatScheme: "9935",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "IT",
        name: "Italy",
        flag: "🇮🇹",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "LU",
        name: "Luxembourg",
        flag: "🇱🇺",
        defaultVatScheme: "9938",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "NL",
        name: "Netherlands",
        flag: "🇳🇱",
        defaultVatScheme: "9944",
        defaultEnterpriseNumberScheme: "0106",
        defaultDocumentTypes: [
            ...DEFAULT_DOCUMENT_TYPES,
            SI_UBL_INVOICE_DOCUMENT_TYPE_INFO,
            SI_UBL_CREDIT_NOTE_DOCUMENT_TYPE_INFO,
        ],
    },
    {
        code: "NO",
        name: "Norway",
        flag: "🇳🇴",
        defaultEnterpriseNumberScheme: "0192",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "PL",
        name: "Poland",
        flag: "🇵🇱",
        defaultVatScheme: "9945",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "SE",
        name: "Sweden",
        flag: "🇸🇪",
        defaultEnterpriseNumberScheme: "0007",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "SK",
        name: "Slovakia",
        flag: "🇸🇰",
        defaultEnterpriseNumberScheme: "0158",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "GB",
        name: "United Kingdom",
        flag: "🇬🇧",
        defaultVatScheme: "9932",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "AU",
        name: "Australia",
        flag: "🇦🇺",
        defaultEnterpriseNumberScheme: "0151",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "JP",
        name: "Japan",
        flag: "🇯🇵",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "MY",
        name: "Malaysia",
        flag: "🇲🇾",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "NZ",
        name: "New Zealand",
        flag: "🇳🇿",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "SG",
        name: "Singapore",
        flag: "🇸🇬",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "US",
        name: "United States",
        flag: "🇺🇸",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
    {
        code: "AE",
        name: "United Arab Emirates",
        flag: "🇦🇪",
        defaultDocumentTypes: DEFAULT_DOCUMENT_TYPES,
    },
].sort((a, b) => a.name.localeCompare(b.name));