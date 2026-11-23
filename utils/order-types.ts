export function getOrderTypeCodeByKey(key: string): string {
    return ORDER_TYPES.find((entry) => entry.key === key)?.code ?? key;
}

/** The key of a code, or the code itself when it has none, so the schema refuses it. */
export function getOrderTypeKeyByCode(code: string): string {
    return ORDER_TYPES.find((entry) => entry.code === code.trim())?.key ?? code;
}

/** UNCL1001 subset T01: https://docs.peppol.eu/poacc/upgrade-3/codelist/UNCL1001_T01/ */
export const ORDER_TYPES = [
    { key: "order", code: "220", name: "Order" },
    { key: "purchase_order", code: "105", name: "Purchase order" },
    { key: "blanket_order", code: "221", name: "Blanket order" },
    { key: "call_off_order", code: "226", name: "Call-off order" },
    { key: "consignment_order", code: "227", name: "Consignment order" },
    { key: "cross_docking_order", code: "402", name: "Cross-docking order" },
] as const;

export type OrderTypeKey = (typeof ORDER_TYPES)[number]["key"];
