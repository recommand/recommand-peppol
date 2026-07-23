import { XMLBuilder } from "fast-xml-parser";
import type { FranceCdar } from "./schemas";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: true,
});

function formatDate102(date: string): string {
  return date.replaceAll("-", "");
}

export function franceCdarToXML({
  franceCdar,
}: {
  franceCdar: FranceCdar;
}): string {
  const characteristics = (franceCdar.collectedAmounts ?? []).map((collected) => ({
    "ram:TypeCode": "MEN",
    "ram:ValueAmount": collected.amount,
    "ram:ValuePercent": collected.vatPercent,
  }));

  const hasStatusDetail =
    Boolean(franceCdar.reasonCode) ||
    Boolean(franceCdar.reason) ||
    characteristics.length > 0;

  const statusDetail = hasStatusDetail
    ? {
        "ram:SpecifiedDocumentStatus": {
          ...(franceCdar.reasonCode
            ? { "ram:ReasonCode": franceCdar.reasonCode }
            : {}),
          ...(franceCdar.reason ? { "ram:Reason": franceCdar.reason } : {}),
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
            "@_format": "102",
            "#text": formatDate102(franceCdar.issueDate),
          },
        },
        "ram:SenderTradeParty": {
          "ram:RoleCode": franceCdar.senderRole,
        },
        "ram:IssuerTradeParty": {
          ...(franceCdar.issuerLegalId
            ? {
                "ram:GlobalID": {
                  "@_schemeID": "0002",
                  "#text": franceCdar.issuerLegalId,
                },
              }
            : {}),
          "ram:RoleCode": franceCdar.phase === "305" ? "WK" : franceCdar.senderRole,
        },
        "ram:RecipientTradeParty": {
          ...(franceCdar.recipientLegalId
            ? {
                "ram:GlobalID": {
                  "@_schemeID": "0002",
                  "#text": franceCdar.recipientLegalId,
                },
              }
            : {}),
          "ram:RoleCode": franceCdar.recipientRole,
          ...(franceCdar.recipientElectronicAddress
            ? {
                "ram:URIUniversalCommunication": {
                  "ram:URIID": {
                    "@_schemeID": "0225",
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
                    "@_format": "102",
                    "#text": formatDate102(franceCdar.invoiceIssueDate),
                  },
                },
              }
            : {}),
          "ram:ProcessConditionCode": franceCdar.statusCode,
          ...(franceCdar.sellerLegalId
            ? {
                "ram:IssuerTradeParty": {
                  "ram:GlobalID": {
                    "@_schemeID": "0002",
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
