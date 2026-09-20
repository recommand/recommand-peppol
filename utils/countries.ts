import {
    FRANCE_REGULATED_PROCESS_ID,
} from "./type-repository/document-formats/france-process";
import {
    getReceivingCapability,
} from "./type-repository/receiving-capabilities";
import type { ReceivingCapability } from "./type-repository/receiving-capabilities/types";

export type CountrySupportLevel = "supported" | "partial" | "unsupported";

type BaseCountryInfo = {
    code: string;
    name: string;
    flag: string;
    supportLevel: CountrySupportLevel;
    defaultVatScheme?: string | null;
    defaultEnterpriseNumberScheme?: string | null;
}

const BASE_COUNTRIES: BaseCountryInfo[] = ([
    {
        code: "AT",
        name: "Austria",
        flag: "🇦🇹",
        supportLevel: "supported",
        defaultVatScheme: "9914",
        defaultEnterpriseNumberScheme: "9919",
    },
    {
        code: "BE",
        name: "Belgium",
        flag: "🇧🇪",
        supportLevel: "supported",
        defaultVatScheme: "9925",
        defaultEnterpriseNumberScheme: "0208",
    },
    {
        code: "BG",
        name: "Bulgaria",
        flag: "🇧🇬",
        supportLevel: "unsupported",
        defaultVatScheme: "9926",
    },
    {
        code: "CA",
        name: "Canada",
        flag: "🇨🇦",
        supportLevel: "supported",
    },
    {
        code: "HR",
        name: "Croatia",
        flag: "🇭🇷",
        supportLevel: "partial",
        defaultVatScheme: "9934",
    },
    {
        code: "CY",
        name: "Cyprus",
        flag: "🇨🇾",
        supportLevel: "supported",
        defaultVatScheme: "9928",
    },
    {
        code: "DK",
        name: "Denmark",
        flag: "🇩🇰",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0184",
    },
    {
        code: "EE",
        name: "Estonia",
        flag: "🇪🇪",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0191",
        defaultVatScheme: "9931",
    },
    {
        code: "FI",
        name: "Finland",
        flag: "🇫🇮",
        supportLevel: "supported",
    },
    {
        code: "FR",
        name: "France",
        flag: "🇫🇷",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0225",
    },
    {
        code: "DE",
        name: "Germany",
        flag: "🇩🇪",
        supportLevel: "supported",
        defaultVatScheme: "9930",
        defaultEnterpriseNumberScheme: "0204",
    },
    {
        code: "GR",
        name: "Greece",
        flag: "🇬🇷",
        supportLevel: "partial",
    },
    {
        code: "HU",
        name: "Hungary",
        flag: "🇭🇺",
        supportLevel: "partial",
        defaultVatScheme: "9910",
    },
    {
        code: "IS",
        name: "Iceland",
        flag: "🇮🇸",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0196",
    },
    {
        code: "IE",
        name: "Ireland",
        flag: "🇮🇪",
        supportLevel: "supported",
        defaultVatScheme: "9935",
    },
    {
        code: "IT",
        name: "Italy",
        flag: "🇮🇹",
        supportLevel: "partial",
        defaultVatScheme: "0211",
        defaultEnterpriseNumberScheme: "0210",
    },
    {
        code: "LV",
        name: "Latvia",
        flag: "🇱🇻",
        supportLevel: "partial",
        defaultVatScheme: "9939",
        defaultEnterpriseNumberScheme: "0218",
    },
    {
        code: "LU",
        name: "Luxembourg",
        flag: "🇱🇺",
        supportLevel: "supported",
        defaultVatScheme: "9938",
    },
    {
        code: "NL",
        name: "Netherlands",
        flag: "🇳🇱",
        supportLevel: "supported",
        defaultVatScheme: "9944",
        defaultEnterpriseNumberScheme: "0106",
    },
    {
        code: "NO",
        name: "Norway",
        flag: "🇳🇴",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0192",
    },
    {
        code: "PL",
        name: "Poland",
        flag: "🇵🇱",
        supportLevel: "partial",
        defaultVatScheme: "9945",
    },
    {
        code: "PT",
        name: "Portugal",
        flag: "🇵🇹",
        supportLevel: "supported",
        defaultVatScheme: "9946",
    },
    {
        code: "RO",
        name: "Romania",
        flag: "🇷🇴",
        supportLevel: "partial",
        defaultVatScheme: "9947",
    },
    {
        code: "SI",
        name: "Slovenia",
        flag: "🇸🇮",
        supportLevel: "supported",
        defaultVatScheme: "9949",
    },
    {
        code: "ES",
        name: "Spain",
        flag: "🇪🇸",
        supportLevel: "partial",
        defaultVatScheme: "9920",
    },
    {
        code: "SE",
        name: "Sweden",
        flag: "🇸🇪",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0007",
    },
    {
        code: "SK",
        name: "Slovakia",
        flag: "🇸🇰",
        supportLevel: "partial",
        defaultEnterpriseNumberScheme: "0245",
        defaultVatScheme: "9950",
    },
    {
        code: "GB",
        name: "United Kingdom",
        flag: "🇬🇧",
        supportLevel: "supported",
        defaultVatScheme: "9932",
    },
    {
        code: "AU",
        name: "Australia",
        flag: "🇦🇺",
        supportLevel: "supported",
        defaultEnterpriseNumberScheme: "0151",
    },
    {
        code: "HK",
        name: "Hong Kong",
        flag: "🇭🇰",
        supportLevel: "unsupported",
    },
    {
        code: "JP",
        name: "Japan",
        flag: "🇯🇵",
        supportLevel: "unsupported",
    },
    {
        code: "MY",
        name: "Malaysia",
        flag: "🇲🇾",
        supportLevel: "unsupported",
    },
    {
        code: "NZ",
        name: "New Zealand",
        flag: "🇳🇿",
        supportLevel: "unsupported",
    },
    {
        code: "SG",
        name: "Singapore",
        flag: "🇸🇬",
        supportLevel: "unsupported",
    },
    {
        code: "US",
        name: "United States",
        flag: "🇺🇸",
        supportLevel: "supported",
    },
    {
        code: "AE",
        name: "United Arab Emirates",
        flag: "🇦🇪",
        supportLevel: "unsupported",
    },
] satisfies BaseCountryInfo[]).sort((a, b) => a.name.localeCompare(b.name));

export type CountryInfo = BaseCountryInfo & {
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

export const COUNTRIES: CountryInfo[] = BASE_COUNTRIES.map((country) => ({
    ...country,
    defaultDocumentTypes:
        DOCUMENT_TYPES_BY_COUNTRY[country.code] ?? DEFAULT_DOCUMENT_TYPES,
}));

export function getCountryName(countryCode: string): string {
    return COUNTRIES.find((country) => country.code === countryCode)?.name ?? countryCode;
}

export function getCountrySupportLevel(countryCode: string | null | undefined): CountrySupportLevel | undefined {
    return COUNTRIES.find((country) => country.code === countryCode)?.supportLevel;
}
