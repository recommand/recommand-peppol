export function getPaymentCodeByKey(key: string): string {
    return PAYMENT_MEANS.find((payment) => payment.key === key)?.code ?? "1";
}

export function getPaymentKeyByCode(code: string): string {
    return PAYMENT_MEANS.find((payment) => payment.code === code)?.key ?? "other";
}

export const PAYMENT_MEANS: { key: string, code: string, name: string }[] = [
    {
        key: "cash",
        code: "10",
        name: "In cash",
    },
    {
        key: "credit_transfer",
        code: "30",
        name: "Credit transfer",
    },
    {
        key: "debit_transfer",
        code: "31",
        name: "Debit transfer",
    },
    {
        key: "bank_card",
        code: "48",
        name: "Bank card",
    },
    {
        key: "credit_card",
        code: "54",
        name: "Credit card",
    },
    {
        key: "debit_card",
        code: "55",
        name: "Debit card",
    },
    {
        key: "sepa_credit_transfer",
        code: "58",
        name: "SEPA credit transfer",
    },
    {
        key: "sepa_direct_debit",
        code: "59",
        name: "SEPA direct debit",
    }
]
const CREDIT_TRANSFER_CODES = ["30", "58"];

/**
 * Whether a payment means carries the payee's account (BT-84). A credit
 * transfer always does: the buyer needs the account to pay into. Other means,
 * such as a direct debit or a card payment, are collected by the seller and
 * only carry an account when one is given.
 */
export function hasPayeeAccount(payment: { paymentMethod: string; iban: string }): boolean {
    return payment.iban.trim() !== "" || CREDIT_TRANSFER_CODES.includes(getPaymentCodeByKey(payment.paymentMethod));
}
