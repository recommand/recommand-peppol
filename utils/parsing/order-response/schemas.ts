import { z } from "zod";
import "zod-openapi/extend";
import { zCurrencies } from "@peppol/utils/currencies";
import {
  additionalItemPropertySchema,
  itemClassificationCodeSchema,
  lineSchema,
  partySchema,
  periodSchema,
  priceDecimalSchema,
  unlimitedDecimalSchema,
  vatSchema,
} from "../invoice/schemas";
import { ORDER_LINE_STATUSES, type OrderLineStatusKey } from "@peppol/utils/order-line-statuses";
import { ORDER_RESPONSES, type OrderResponseKey } from "@peppol/utils/order-responses";

export const orderResponseValueSchema = z.enum(ORDER_RESPONSES.map((entry) => entry.key) as [OrderResponseKey, ...OrderResponseKey[]]).openapi({
  ref: "OrderResponseValue",
  examples: ["accepted"],
  description: `The seller's answer to the order: ${ORDER_RESPONSES.map((entry) => `\`${entry.key}\` (${entry.name.toLowerCase()})`).join(", ")}. \`conditionally_accepted\` needs lines that say what changes; the other answers take none.`,
});

export const orderLineStatusSchema = z.enum(ORDER_LINE_STATUSES.map((entry) => entry.key) as [OrderLineStatusKey, ...OrderLineStatusKey[]]).openapi({
  ref: "OrderLineStatus",
  examples: ["changed"],
  description: `What the seller does with the order line: ${ORDER_LINE_STATUSES.map((entry) => `\`${entry.key}\` (${entry.name.toLowerCase()})`).join(", ")}.`,
});

export const orderResponsePartySchema = partySchema
  .pick({ name: true })
  .extend({
    partyIdentifiers: partySchema.shape.partyIdentifiers.openapi({
      examples: [[{ identifier: "0123456749", scheme: "0208" }]],
      description:
        "The identifiers of the party, such as its enterprise number under its ISO/IEC 6523 scheme, or a GLN.",
    }),
  })
  .openapi({
    ref: "OrderResponseParty",
    description:
      "A party to the order, named and identified. An order response carries no addresses or VAT numbers.",
  });

const itemShape = lineSchema.pick({
  buyersId: true,
  sellersId: true,
  standardId: true,
}).shape;

export const substitutedItemSchema = z
  .object({
    id: z.string().nullish().openapi({
      examples: ["1"],
      description: "An identifier for the substituted line. Defaults to the id of the line it replaces.",
    }),
    name: z.string().nullish().openapi({
      examples: ["Sauce brown, ready"],
      description: "The name of the item the seller delivers instead.",
    }),
    sellersId: itemShape.sellersId,
    standardId: itemShape.standardId,
    commodityClassifications: z.array(itemClassificationCodeSchema).nullish(),
    vat: vatSchema.nullish(),
    additionalItemProperties: z.array(additionalItemPropertySchema).nullish(),
  })
  .openapi({
    ref: "SubstitutedItem",
    description: "The item the seller delivers instead of the one ordered.",
  });

export const orderResponseLineSchema = z
  .object({
    id: z.string().nullish().openapi({
      examples: ["1"],
      description: "An identifier for the response line, unique within the response. Defaults to `orderLineReference`.",
    }),
    orderLineReference: z.string().min(1).openapi({
      examples: ["1"],
      description: "The id of the order line this line responds to.",
    }),
    status: orderLineStatusSchema,
    note: z.string().nullish().openapi({
      examples: ["Only 10 in stock"],
      description: "A free text explanation of the change or the rejection.",
    }),
    quantity: unlimitedDecimalSchema.nullish().openapi({
      examples: ["10"],
      description: "The quantity the seller will deliver, when it differs from the order.",
    }),
    unitCode: z.string().nullish().openapi({
      examples: ["C62"],
      description: "The unit of `quantity`. Defaults to C62 (one).",
    }),
    maximumBackorderQuantity: unlimitedDecimalSchema.nullish().openapi({
      examples: ["3"],
      description: "The quantity the seller will deliver later.",
    }),
    promisedDeliveryPeriod: periodSchema.nullish().openapi({
      description: "When the seller will deliver this line.",
    }),
    netPriceAmount: priceDecimalSchema.nullish().openapi({
      description: "The price of one unit excluding VAT, when it differs from the order.",
    }),
    baseQuantity: unlimitedDecimalSchema.nullish().openapi({
      description: "The number of units the price refers to.",
    }),
    name: z.string().min(1).openapi({
      examples: ["Brown sauce"],
      description: "The name of the ordered item.",
    }),
    ...itemShape,
    substitute: substitutedItemSchema.nullish(),
  })
  .openapi({ ref: "OrderResponseLine" });

const _orderResponseSchema = z.object({
  orderResponseNumber: z.string().min(1).openapi({
    examples: ["OR-2026-001"],
    description: "The number the seller assigned to the order response.",
  }),
  issueDate: z.string().date().openapi({
    examples: ["2026-03-21"],
    description: "The date the response was issued, as YYYY-MM-DD.",
  }),
  response: orderResponseValueSchema,
  note: z.string().nullish().openapi({
    examples: ["Delivery postponed by a week"],
    description: "A free text explanation of the response, such as the reason for a rejection.",
  }),
  orderReference: z.string().min(1).openapi({
    examples: ["PO-2026-001"],
    description: "The number of the order this response answers.",
  }),
  salesOrderReference: z.string().nullish().openapi({
    examples: ["SO-2026-001"],
    description: "The seller's own number for the order.",
  }),
  buyerReference: z.string().nullish().openapi({
    examples: ["CC-4120"],
    description: "The buyer reference the order carried.",
  }),
  seller: orderResponsePartySchema.openapi({
    description: "The party responding to the order. It sends the response.",
  }),
  buyer: orderResponsePartySchema.openapi({
    description: "The party that placed the order. It receives the response.",
  }),
  promisedDeliveryPeriod: periodSchema.nullish().openapi({
    description: "When the seller will deliver the order.",
  }),
  lines: z.array(orderResponseLineSchema).nullish().openapi({
    description: "The order lines the seller changes, adds or rejects. Required with response code `CA`, not allowed with the others.",
  }),
  currency: zCurrencies.default("EUR").openapi({
    examples: ["EUR"],
    description: "The currency of the prices in the response. Defaults to EUR.",
  }),
});

export const orderResponseSchema = _orderResponseSchema.openapi({
  ref: "OrderResponse",
  title: "Order Response",
});

export const sendOrderResponseSchema = _orderResponseSchema
  .extend({
    issueDate: z.string().date().nullish().openapi({
      examples: ["2026-03-21"],
      description: "If not provided, the issue date will be the current date.",
    }),
    seller: orderResponsePartySchema.nullish().openapi({
      description: "If not provided, the seller will be the company that is sending the response.",
    }),
  })
  .openapi({
    ref: "SendOrderResponse",
    title: "Order Response to send",
    description: "A Peppol BIS order response to send to the buyer",
  });

export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type OrderResponseParty = z.infer<typeof orderResponsePartySchema>;
