import { XMLBuilder } from "fast-xml-parser";
import type { FranceCdar } from "./schemas";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

function formatDate204(date: string): string {
  if (!date.includes("T")) {
    return `${date.replaceAll("-", "")}000000`;
  }
  return date.replaceAll("-", "").replaceAll(":", "").replace("T", "");
}

export function franceCdarToXML({
  franceCdar,
}: {
  franceCdar: FranceCdar;
}): string {
  const characteristics = (franceCdar.collectedAmounts ?? []).map((collected) => ({
    "ram:TypeCode": "MEN",
    "ram:ValueAmount": {
      "@_currencyID": collected.currency,
      "#text": collected.amount,
    },
    "ram:ValuePercent": collected.vatPercent,
  }));

  const hasStatusDetail =
    Boolean(franceCdar.reasonCode) ||
    Boolean(franceCdar.reason) ||
    Boolean(franceCdar.reasonNote) ||
    characteristics.length > 0;

  const statusDetail = hasStatusDetail
    ? {
        "ram:SpecifiedDocumentStatus": {
          ...(franceCdar.reasonCode
            ? { "ram:ReasonCode": franceCdar.reasonCode }
            : {}),
          ...(franceCdar.reason ? { "ram:Reason": franceCdar.reason } : {}),
          ...(franceCdar.reasonNote
            ? {
                "ram:IncludedNote": {
                  "ram:Content": franceCdar.reasonNote,
                },
              }
            : {}),
          ...(characteristics.length > 0
            ? { "ram:SpecifiedDocumentCharacteristic": characteristics }
            : {}),
        },
      }
    : {};

  const cdar = {
    "rsm:CrossDomainAcknowledgementAndResponse": {
      "@_xmlns:rsm":
        "urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100",
      "@_xmlns:ram":
        "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
      "@_xmlns:qdt": "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
      "@_xmlns:udt":
        "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
      "rsm:ExchangedDocumentContext": {
        "ram:BusinessProcessSpecifiedDocumentContextParameter": {
          "ram:ID": franceCdar.businessProcess,
        },
        "ram:GuidelineSpecifiedDocumentContextParameter": {
          "ram:ID": "urn.cpro.gouv.fr:1p0:CDV:invoice",
        },
      },
      "rsm:ExchangedDocument": {
        "ram:ID": franceCdar.id,
        "ram:IssueDateTime": {
          "udt:DateTimeString": {
            "@_format": "204",
            "#text": formatDate204(franceCdar.issueDate),
          },
        },
        "ram:SenderTradeParty": {
          "ram:RoleCode": franceCdar.senderRole,
        },
        "ram:IssuerTradeParty": {
          ...(franceCdar.issuerLegalId
            ? {
                "ram:GlobalID": {
                  "@_schemeID": franceCdar.issuerLegalIdScheme,
                  "#text": franceCdar.issuerLegalId,
                },
              }
            : {}),
          "ram:RoleCode": franceCdar.issuerRole,
        },
        "ram:RecipientTradeParty": {
          ...(franceCdar.recipientLegalId
            ? {
                "ram:GlobalID": {
                  "@_schemeID": franceCdar.recipientLegalIdScheme,
                  "#text": franceCdar.recipientLegalId,
                },
              }
            : {}),
          "ram:RoleCode": franceCdar.recipientRole,
          ...(franceCdar.recipientElectronicAddress
            ? {
                "ram:URIUniversalCommunication": {
                  "ram:URIID": {
                    "@_schemeID": franceCdar.recipientElectronicAddressScheme,
                    "#text": franceCdar.recipientElectronicAddress,
                  },
                },
              }
            : {}),
        },
      },
      "rsm:AcknowledgementDocument": {
        "ram:TypeCode": franceCdar.phase,
        "ram:ReferenceReferencedDocument": {
          "ram:IssuerAssignedID": franceCdar.invoiceId,
          ...(franceCdar.invoiceIssueDate
            ? {
                "ram:FormattedIssueDateTime": {
                  "qdt:DateTimeString": {
                    "@_format": "204",
                    "#text": formatDate204(franceCdar.invoiceIssueDate),
                  },
                },
              }
            : {}),
          "ram:ProcessConditionCode": franceCdar.statusCode,
          ...(franceCdar.sellerLegalId
            ? {
                "ram:IssuerTradeParty": {
                  "ram:GlobalID": {
                    "@_schemeID": franceCdar.sellerLegalIdScheme,
                    "#text": franceCdar.sellerLegalId,
                  },
                },
              }
            : {}),
          ...statusDetail,
        },
      },
    },
  };

  return builder.build(cdar);
}
