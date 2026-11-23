import { z } from "zod";
import "zod-openapi/extend";
import {
  attachmentSchema,
  lineSchema,
  partyIdentifierSchema,
  partySchema,
  periodSchema,
  unlimitedDecimalSchema,
} from "../invoice/schemas";
import { TRANSPORT_MODES, type TransportModeKey } from "@peppol/utils/transport-modes";

export const despatchPartySchema = partySchema
  .omit({
    vatNumber: true,
    taxRegistrationId: true,
    enterpriseNumber: true,
    enterpriseNumberScheme: true,
  })
  .extend({
    street: z.string().nullish().openapi({ examples: ["Example Street 1"] }),
    city: z.string().nullish().openapi({ examples: ["Brussels"] }),
    postalZone: z.string().nullish().openapi({ examples: ["1000"] }),
    country: partySchema.shape.country.nullish().openapi({
      examples: ["BE"],
      description: "The country of the party's address, as an ISO 3166-1 alpha-2 code. The address is written only when the country is given.",
    }),
    partyIdentifiers: partySchema.shape.partyIdentifiers.openapi({
      description:
        "The identifier of the party, such as its enterprise number under its ISO/IEC 6523 scheme, or a GLN. A despatch advice carries at most one per party.",
    }),
  })
  .openapi({
    ref: "DespatchParty",
    description: "A party to the despatch. A despatch advice carries no VAT or enterprise numbers of its own; give the enterprise number as the party identifier.",
  });

export const referencedPartySchema = z
  .object({
    name: z.string().nullish().openapi({
      examples: ["Buyer NV"],
      description: "The name of the party.",
    }),
    identifier: partyIdentifierSchema.nullish(),
  })
  .refine((party) => party.name || party.identifier, {
    message: "A party needs a name or an identifier.",
  })
  .openapi({
    ref: "ReferencedParty",
    description: "A party the despatch advice names for reference, by name or identifier.",
  });

export const transportModeSchema = z.enum(TRANSPORT_MODES.map((entry) => entry.key) as [TransportModeKey, ...TransportModeKey[]]).openapi({
  ref: "TransportMode",
  examples: ["road"],
  description: `How the shipment travels: ${TRANSPORT_MODES.map((entry) => `\`${entry.key}\` (${entry.name.toLowerCase()})`).join(", ")}.`,
});

const measureSchema = z
  .object({
    value: unlimitedDecimalSchema,
    unitCode: z.string().openapi({
      examples: ["KGM"],
      description:
        "The unit, from [UN/ECE Recommendation 20](https://docs.peppol.eu/poacc/upgrade-3/codelist/UNECERec20/), for example KGM or MTQ.",
    }),
  })
  .openapi({ ref: "Measure" });

export const shipmentSchema = z
  .object({
    id: z.string().nullish().openapi({
      examples: ["SHIP-2026-001"],
      description: "An identifier for the shipment. Defaults to the despatch advice number.",
    }),
    information: z.string().nullish().openapi({
      examples: ["Fragile"],
      description: "A free text description of the shipment.",
    }),
    grossWeight: measureSchema.nullish().openapi({
      description: "The gross weight of the shipment.",
    }),
    grossVolume: measureSchema.nullish().openapi({
      description: "The gross volume of the shipment.",
    }),
    handlingUnitCount: z.number().int().nonnegative().nullish().openapi({
      examples: [2],
      description: "The number of transport handling units, such as pallets, in the shipment.",
    }),
    consignmentId: z.string().nullish().openapi({
      examples: ["CONS-1"],
      description: "The carrier's identifier for the consignment, such as a waybill number.",
    }),
    carrier: referencedPartySchema.nullish().openapi({
      description: "The carrier that transports the shipment.",
    }),
    transportMode: transportModeSchema.nullish(),
    trackingId: z.string().nullish().openapi({
      examples: ["1Z999AA10123456784"],
      description: "The carrier's tracking number.",
    }),
    estimatedDeliveryPeriod: periodSchema.nullish().openapi({
      description: "When the shipment is expected to arrive.",
    }),
    actualDespatchDate: z.string().date().nullish().openapi({
      examples: ["2026-03-22"],
      description: "The date the shipment left, as YYYY-MM-DD.",
    }),
  })
  .openapi({ ref: "Shipment", description: "How the goods travel." });

export const itemInstanceSchema = z
  .object({
    serialId: z.string().nullish().openapi({ examples: ["SN-0001"] }),
    lotNumber: z.string().nullish().openapi({ examples: ["LOT-42"] }),
    expiryDate: z.string().date().nullish().openapi({ examples: ["2027-01-31"] }),
    bestBeforeDate: z.string().date().nullish().openapi({ examples: ["2027-01-15"] }),
    manufactureDate: z.string().date().nullish().openapi({ examples: ["2026-01-15"] }),
  })
  .openapi({
    ref: "ItemInstance",
    description: "A serial number, a batch or lot, or the dates of the delivered units.",
  });

const itemShape = lineSchema.pick({
  buyersId: true,
  sellersId: true,
  standardId: true,
  commodityClassifications: true,
  additionalItemProperties: true,
}).shape;

export const despatchLineSchema = z
  .object({
    id: z.string().nullish().openapi({
      examples: ["1"],
      description: "A line number. If not provided, it will be calculated automatically.",
    }),
    note: z.string().nullish().openapi({
      description: "A free text note about the line.",
    }),
    name: z.string().min(1).openapi({
      examples: ["Pallet of copier paper"],
      description: "The name of the delivered item.",
    }),
    ...itemShape,
    quantity: unlimitedDecimalSchema.openapi({
      examples: ["10"],
      description: "The quantity delivered, expressed in `unitCode`.",
    }),
    unitCode: z.string().default("C62").openapi({
      examples: ["C62"],
      description:
        "Recommended unit codes can be found [here](https://docs.peppol.eu/poacc/upgrade-3/codelist/UNECERec20/).",
    }),
    outstandingQuantity: unlimitedDecimalSchema.nullish().openapi({
      examples: ["2"],
      description: "The quantity still to be delivered later, in `unitCode`.",
    }),
    outstandingReason: z.string().nullish().openapi({
      examples: ["Out of stock"],
      description: "Why part of the quantity is delivered later. Peppol recommends one with every outstanding quantity.",
    }),
    orderLineReference: z.string().nullish().openapi({
      examples: ["1"],
      description: "The id of the order line delivered. Written as NA when left out, since Peppol requires one.",
    }),
    orderReference: z.string().nullish().openapi({
      examples: ["PO-2026-001"],
      description: "The order the line belongs to, when it differs from the despatch advice's `orderReference`.",
    }),
    itemInstances: z.array(itemInstanceSchema).nullish().openapi({
      description: "The serial numbers, lots or dates of the delivered units.",
    }),
  })
  .refine((line) => line.sellersId || line.standardId, {
    message: "A despatch line needs a sellersId or a standardId (PEPPOL-T16-R003).",
  })
  .openapi({ ref: "DespatchLine" });

const _despatchAdviceSchema = z.object({
  despatchAdviceNumber: z.string().min(1).openapi({
    examples: ["DA-2026-001"],
    description: "The number the despatching party assigned to the despatch advice.",
  }),
  issueDate: z.string().date().openapi({
    examples: ["2026-03-22"],
    description: "The date the despatch advice was issued, as YYYY-MM-DD.",
  }),
  note: z.string().nullish().openapi({
    examples: ["Delivered to the loading dock"],
    description: "A free text note about the despatch.",
  }),
  orderReference: z.string().nullish().openapi({
    examples: ["PO-2026-001"],
    description: "The number of the order the goods were ordered with.",
  }),
  despatchParty: despatchPartySchema.openapi({
    description: "The party that sends the goods. It sends the despatch advice.",
  }),
  consignee: despatchPartySchema.openapi({
    description: "The party the goods are delivered to. It receives the despatch advice.",
  }),
  buyer: referencedPartySchema.nullish().openapi({
    description: "The party that ordered the goods, when it is not the consignee.",
  }),
  seller: referencedPartySchema.nullish().openapi({
    description: "The party that sold the goods, when it is not the despatching party.",
  }),
  shipment: shipmentSchema.nullish(),
  lines: z.array(despatchLineSchema).min(1).openapi({
    description: "The delivered items. At least one line is required.",
  }),
  attachments: z.array(attachmentSchema).nullish().openapi({
    description: "Optional attachments, such as a packing list or certificates.",
  }),
});

export const despatchAdviceSchema = _despatchAdviceSchema.openapi({
  ref: "DespatchAdvice",
  title: "Despatch Advice",
});

export const sendDespatchAdviceSchema = _despatchAdviceSchema
  .extend({
    issueDate: z.string().date().nullish().openapi({
      examples: ["2026-03-22"],
      description: "If not provided, the issue date will be the current date.",
    }),
    despatchParty: despatchPartySchema.nullish().openapi({
      description: "If not provided, the despatching party will be the company that is sending the despatch advice.",
    }),
  })
  .openapi({
    ref: "SendDespatchAdvice",
    title: "Despatch Advice to send",
    description: "A Peppol BIS despatch advice to send to the consignee",
  });

export type DespatchAdvice = z.infer<typeof despatchAdviceSchema>;
export type DespatchParty = z.infer<typeof despatchPartySchema>;
