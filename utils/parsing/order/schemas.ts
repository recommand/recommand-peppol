import { z } from "zod";
import "zod-openapi/extend";
import { zCurrencies } from "@peppol/utils/currencies";
import {
  attachmentSchema,
  decimalSchema,
  deliverySchema,
  lineSchema,
  partySchema,
  paymentTermsSchema,
  periodSchema,
  priceDecimalSchema,
  vatSchema,
} from "../invoice/schemas";
import { ORDER_TYPES, type OrderTypeKey } from "@peppol/utils/order-types";

export const orderTypeSchema = z.enum(ORDER_TYPES.map((entry) => entry.key) as [OrderTypeKey, ...OrderTypeKey[]]).openapi({
  ref: "OrderType",
  examples: ["order"],
  description: `The kind of order: ${ORDER_TYPES.map((entry) => `\`${entry.key}\` (${entry.name.toLowerCase()})`).join(", ")}. Peppol reads a missing type as a regular \`order\`.`,
});

export const orderPartySchema = partySchema
  .omit({ taxRegistrationId: true })
  .extend({
    vatNumber: z.string().nullish().openapi({
      examples: ["BE0123456789"],
      description:
        "The VAT number including its country prefix, for example BE0123456789. Written for the buyer and the invoicee; a Peppol order has no place for the seller's VAT number.",
    }),
    street: z.string().nullish().openapi({ examples: ["Example Street 1"] }),
    city: z.string().nullish().openapi({ examples: ["Brussels"] }),
    postalZone: z.string().nullish().openapi({ examples: ["1000"] }),
    country: partySchema.shape.country.nullish().openapi({
      examples: ["BE"],
      description:
        "The country of the party's address, as an ISO 3166-1 alpha-2 code. The address is optional for the buyer, and required for the seller and the invoicee.",
    }),
    partyIdentifiers: partySchema.shape.partyIdentifiers.openapi({
      description:
        "An identifier of the party other than its VAT number, its enterprise number or its Peppol address, such as a GLN or the number the other party knows it by. A Peppol order carries at most one per party.",
    }),
  })
  .openapi({ ref: "OrderParty" });

export const orderDeliverySchema = deliverySchema
  .omit({ date: true })
  .extend({
    requestedPeriod: periodSchema.nullish().openapi({
      description: "When the buyer wants the goods or services delivered.",
    }),
  })
  .openapi({ ref: "OrderDelivery" });

export const deliveryTermsSchema = z
  .object({
    code: z.string().nullish().openapi({
      examples: ["FOB"],
      description: "The delivery terms as a code, usually an Incoterms code.",
    }),
    specialTerms: z.string().nullish().openapi({
      examples: ["Deliver to the loading dock"],
      description: "The delivery terms as free text.",
    }),
    location: z.string().nullish().openapi({
      examples: ["Antwerp"],
      description: "The location the delivery terms refer to, such as the named place of an Incoterm.",
    }),
  })
  .openapi({ ref: "DeliveryTerms", description: "The terms of delivery." });

export const orderLineSchema = lineSchema
  .omit({
    documentReference: true,
    orderLineReference: true,
    billingPeriod: true,
    originCountry: true,
  })
  .extend({
    name: z.string().min(1).openapi({
      examples: ["Pallet of copier paper"],
      description: "The name of the item or service being ordered.",
    }),
    quantity: lineSchema.shape.quantity.openapi({
      description: "The number of units ordered, expressed in `unitCode`.",
    }),
    netPriceAmount: priceDecimalSchema.nullish().openapi({
      description:
        "The agreed price of one unit excluding VAT. Optional: an order can leave prices to the seller. When it is left out, the line carries no amount, discounts or surcharges, and the order carries no totals.",
    }),
    netAmount: decimalSchema.nullish().openapi({
      description:
        "The total net amount of the line: quantity * netPriceAmount, minus discounts, plus surcharges. Rounded to 2 decimal places. Calculated when not provided, and only present on a priced line.",
    }),
    vat: vatSchema.nullish().openapi({
      description:
        "The VAT category and rate of the item. Optional in an order; the order only carries a VAT total when every line, discount and surcharge has one.",
    }),
    partialDeliveryAllowed: z.boolean().nullish().openapi({
      description:
        "Whether the seller may deliver the line in parts. Peppol assumes it may when this is left out.",
    }),
    requestedDeliveryPeriod: periodSchema.nullish().openapi({
      description: "When the buyer wants this line delivered, if it differs from the order's requested delivery period.",
    }),
    quotationLineReference: z.string().nullish().openapi({
      examples: ["3"],
      description: "The line of the seller's quotation this line orders. Requires `quotationReference` on the order.",
    }),
  })
  .refine(
    (line) =>
      line.netPriceAmount != null ||
      (!line.netAmount && !line.discounts?.length && !line.surcharges?.length),
    {
      message:
        "A line without a netPriceAmount cannot have a netAmount, discounts or surcharges.",
    },
  )
  .openapi({ ref: "OrderLine" });

const allowanceChargeShape = {
  amount: decimalSchema,
  vat: vatSchema.nullish().openapi({
    description: "The VAT category and rate the amount falls under. Optional in an order.",
  }),
};

export const orderDiscountSchema = z
  .object({
    reasonCode: z.string().nullish().openapi({
      examples: ["95"],
      description:
        "The reason code for the discount, from the [UNCL5189 subset](https://docs.peppol.eu/poacc/upgrade-3/codelist/UNCL5189/).",
    }),
    reason: z.string().min(1).openapi({
      examples: ["Discount"],
      description: "The reason for the discount as free text. A Peppol order requires it on a document level discount.",
    }),
    ...allowanceChargeShape,
  })
  .openapi({ ref: "OrderDiscount" });

export const orderSurchargeSchema = z
  .object({
    reasonCode: z.string().nullish().openapi({
      examples: ["FC"],
      description:
        "The reason code for the surcharge, from the [UNCL7161](https://docs.peppol.eu/poacc/upgrade-3/codelist/UNCL7161/) code list.",
    }),
    reason: z.string().min(1).openapi({
      examples: ["Freight services"],
      description: "The reason for the surcharge as free text. A Peppol order requires it on a document level surcharge.",
    }),
    ...allowanceChargeShape,
  })
  .openapi({ ref: "OrderSurcharge" });

export const orderTotalsSchema = z
  .object({
    linesAmount: decimalSchema.nullish().openapi({
      description: "The sum of the net amounts of all lines.",
    }),
    discountAmount: decimalSchema.nullish().openapi({
      description: "The sum of all document level discounts.",
    }),
    surchargeAmount: decimalSchema.nullish().openapi({
      description: "The sum of all document level surcharges.",
    }),
    taxExclusiveAmount: decimalSchema.nullish().openapi({
      description: "The total of the lines, discounts and surcharges, excluding VAT.",
    }),
    taxInclusiveAmount: decimalSchema.nullish().openapi({
      description: "The total including VAT. Only present when the order carries a VAT total.",
    }),
    payableAmount: decimalSchema.nullish().openapi({
      description:
        "The amount the buyer expects to pay. Defaults to taxInclusiveAmount, or to taxExclusiveAmount when the order carries no VAT total.",
    }),
    paidAmount: decimalSchema.nullish().openapi({
      description: "An amount already paid in advance.",
    }),
  })
  .openapi({
    ref: "OrderTotals",
    description:
      "The expected totals of the order. Calculated from the lines when every line has a netPriceAmount; an order with an unpriced line carries no totals.",
  });

export const orderVatTotalsSchema = z
  .object({
    totalVatAmount: decimalSchema.openapi({
      description: "The expected VAT amount of the order. A Peppol order has no breakdown per VAT category.",
    }),
  })
  .openapi({ ref: "OrderVatTotals" });

const _orderSchema = z.object({
  orderNumber: z.string().min(1).openapi({
    examples: ["PO-2026-001"],
    description: "The number the buyer assigned to the order.",
  }),
  issueDate: z.string().date().openapi({
    examples: ["2026-03-20"],
    description: "The date the order was issued, as YYYY-MM-DD.",
  }),
  orderType: orderTypeSchema.nullish(),
  note: z.string().nullish().openapi({
    examples: ["Please deliver before noon"],
    description: "A free text note about the order as a whole.",
  }),
  buyerReference: z.string().nullish().openapi({
    examples: ["CC-4120"],
    description:
      "A reference the buyer wants repeated on the invoice so it can route the invoice internally, such as a contact or a cost centre. The seller copies it to the invoice's `buyerReference`.",
  }),
  validityEndDate: z.string().date().nullish().openapi({
    examples: ["2026-04-20"],
    description:
      "The last date the seller can accept the order, as YYYY-MM-DD. Peppol recommends giving one.",
  }),
  quotationReference: z.string().nullish().openapi({
    examples: ["QT-2026-017"],
    description: "The seller's quotation the order is based on.",
  }),
  salesOrderReference: z.string().nullish().openapi({
    examples: ["SO-2026-001"],
    description: "The seller's own number for this order, when the order confirms one.",
  }),
  catalogueReference: z.string().nullish().openapi({
    examples: ["CAT-2026"],
    description: "The seller's catalogue the items are ordered from.",
  }),
  contractReference: z.string().nullish().openapi({
    examples: ["CT-2024-017"],
    description: "The contract the order is placed under.",
  }),
  projectReference: z.string().nullish().openapi({
    examples: ["PR-42"],
    description: "The project the order belongs to.",
  }),
  buyer: orderPartySchema.openapi({
    description: "The party placing the order. It sends the order.",
  }),
  seller: orderPartySchema.openapi({
    description: "The party the order is placed with. It receives the order.",
  }),
  invoicee: orderPartySchema.nullish().openapi({
    description: "The party to invoice, when it is not the buyer.",
  }),
  delivery: orderDeliverySchema.nullish().openapi({
    description: "Where and when the buyer wants the order delivered.",
  }),
  deliveryTerms: deliveryTermsSchema.nullish(),
  paymentTerms: paymentTermsSchema.nullish(),
  lines: z.array(orderLineSchema).min(1).openapi({
    description: "The order lines. At least one line is required.",
  }),
  discounts: z.array(orderDiscountSchema).nullish().openapi({
    description: "Optional document level discounts.",
  }),
  surcharges: z.array(orderSurchargeSchema).nullish().openapi({
    description: "Optional document level surcharges.",
  }),
  totals: orderTotalsSchema.nullish(),
  vat: orderVatTotalsSchema.nullish().openapi({
    description: "The expected VAT total. Calculated when every line, discount and surcharge has a VAT category.",
  }),
  attachments: z.array(attachmentSchema).nullish().openapi({
    description: "Optional attachments, such as specifications or drawings.",
  }),
  currency: zCurrencies.default("EUR").openapi({
    examples: ["EUR"],
    description: "The currency of the order's prices and amounts. Defaults to EUR.",
  }),
});

export const orderSchema = _orderSchema.openapi({ ref: "Order", title: "Order" });

export const sendOrderSchema = _orderSchema
  .extend({
    issueDate: z.string().date().nullish().openapi({
      examples: ["2026-03-20"],
      description: "If not provided, the issue date will be the current date.",
    }),
    buyer: orderPartySchema.nullish().openapi({
      description: "If not provided, the buyer will be the company that is sending the order.",
    }),
  })
  .openapi({
    ref: "SendOrder",
    title: "Order to send",
    description: "A Peppol BIS order to send to a seller",
  });

export type Order = z.infer<typeof orderSchema>;
export type OrderLine = z.infer<typeof orderLineSchema>;
export type OrderParty = z.infer<typeof orderPartySchema>;
