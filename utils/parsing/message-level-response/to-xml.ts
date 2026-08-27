import { XMLBuilder } from "fast-xml-parser";
import type { MessageLevelResponse } from "./schemas";
import { parsePeppolAddress } from "../peppol-address";
import type { XmlProfile } from "@peppol/utils/parsing/xml-profile";

const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    suppressBooleanAttributes: true,
});

export function messageLevelResponseToXML({
    messageLevelResponse,
    senderAddress,
    recipientAddress,
    profile,
}: {
    messageLevelResponse: MessageLevelResponse;
    senderAddress: string;
    recipientAddress: string;
    profile: XmlProfile;
}): string {
    const sender = parsePeppolAddress(senderAddress);
    const receiver = parsePeppolAddress(recipientAddress);

    const ublApplicationResponse = {
        ApplicationResponse: {
            "@_xmlns": "urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2",
            "@_xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
            "@_xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
            "@_xmlns:xsd": "http://www.w3.org/2001/XMLSchema",
            "cbc:CustomizationID": profile.customizationId,
            "cbc:ProfileID": profile.processId,
            "cbc:ID": messageLevelResponse.id,
            "cbc:IssueDate": messageLevelResponse.issueDate,
            "cac:SenderParty": {
                "cbc:EndpointID": {
                    "@_schemeID": sender.schemeId,
                    "#text": sender.identifier,
                },
            },
            "cac:ReceiverParty": {
                "cbc:EndpointID": {
                    "@_schemeID": receiver.schemeId,
                    "#text": receiver.identifier,
                },
            },
            "cac:DocumentResponse": {
                "cac:Response": {
                    "cbc:ResponseCode": messageLevelResponse.responseCode,
                },
                "cac:DocumentReference": {
                    "cbc:ID": messageLevelResponse.envelopeId,
                },
            },
        },
    };

    return builder.build(ublApplicationResponse);
}
