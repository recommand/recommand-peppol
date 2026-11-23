export function getOrderLineStatusCodeByKey(key: string): string {
    return ORDER_LINE_STATUSES.find((entry) => entry.key === key)?.code ?? key;
}

/** The key of a code, or the code itself when it has none, so the schema refuses it. */
export function getOrderLineStatusKeyByCode(code: string): string {
    return ORDER_LINE_STATUSES.find((entry) => entry.code === code.trim())?.key ?? code;
}

/** UNCL1229 subset: https://docs.peppol.eu/poacc/upgrade-3/codelist/UNCL1229/ */
export const ORDER_LINE_STATUSES = [
    { key: "added", code: "1", name: "Added" },
    { key: "changed", code: "3", name: "Changed" },
    { key: "accepted", code: "5", name: "Accepted" },
    { key: "rejected", code: "7", name: "Rejected" },
    { key: "already_delivered", code: "42", name: "Already delivered" },
] as const;

export type OrderLineStatusKey = (typeof ORDER_LINE_STATUSES)[number]["key"];
