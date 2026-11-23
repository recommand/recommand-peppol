export function getTransportModeCodeByKey(key: string): string {
    return TRANSPORT_MODES.find((entry) => entry.key === key)?.code ?? key;
}

/** The key of a code, or the code itself when it has none, so the schema refuses it. */
export function getTransportModeKeyByCode(code: string): string {
    return TRANSPORT_MODES.find((entry) => entry.code === code.trim())?.key ?? code;
}

/** UN/ECE Recommendation 19: https://docs.peppol.eu/poacc/upgrade-3/codelist/UNECERec19/ */
export const TRANSPORT_MODES = [
    { key: "not_specified", code: "0", name: "Not specified" },
    { key: "maritime", code: "1", name: "Maritime transport" },
    { key: "rail", code: "2", name: "Rail transport" },
    { key: "road", code: "3", name: "Road transport" },
    { key: "air", code: "4", name: "Air transport" },
    { key: "mail", code: "5", name: "Mail" },
    { key: "multimodal", code: "6", name: "Multimodal transport" },
    { key: "fixed_installation", code: "7", name: "Fixed transport installation" },
    { key: "inland_water", code: "8", name: "Inland water transport" },
    { key: "not_applicable", code: "9", name: "Not applicable" },
] as const;

export type TransportModeKey = (typeof TRANSPORT_MODES)[number]["key"];
