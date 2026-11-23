export function getOrderResponseCodeByKey(key: string): string {
    return ORDER_RESPONSES.find((entry) => entry.key === key)?.code ?? key;
}

/** The key of a code, or the code itself when it has none, so the schema refuses it. */
export function getOrderResponseKeyByCode(code: string): string {
    return ORDER_RESPONSES.find((entry) => entry.code === code.trim())?.key ?? code;
}

/** UNCL4343 subset T76: https://docs.peppol.eu/poacc/upgrade-3/codelist/UNCL4343-T76/ */
export const ORDER_RESPONSES = [
    { key: "acknowledged", code: "AB", name: "Acknowledged" },
    { key: "accepted", code: "AP", name: "Accepted" },
    { key: "rejected", code: "RE", name: "Rejected" },
    { key: "conditionally_accepted", code: "CA", name: "Conditionally accepted" },
] as const;

export type OrderResponseKey = (typeof ORDER_RESPONSES)[number]["key"];
