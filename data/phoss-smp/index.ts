import { UserFacingError } from "@directory/utils/util";
import { getCompanyById, type Company, type InsertCompany } from "@peppol/data/companies";
import { deleteServiceGroup, registerServiceGroup } from "./service-group";
import { deleteServiceMetadata, registerServiceMetadata } from "./service-metadata";
import { registerBusinessCard } from "./business-card";
import { canUpsertCompanyIdentifier, getCompanyIdentifiers, type CompanyIdentifier } from "../company-identifiers";
import { getCompanyDocumentTypes, type CompanyDocumentType } from "../company-document-types";
import { verifyRecipient } from "../recipient";

type MinimalCompanyIdentifier = {
  scheme: string;
  identifier: string;
}

export async function upsertCompanyRegistrations({companyId, useTestNetwork}: {companyId: string, useTestNetwork: boolean}) {
  const company = await getCompanyById(companyId);
  if(company && !company.isSmpRecipient){
    return;
  }
  const identifiers = await getCompanyIdentifiers(companyId);
  const documentTypes = await getCompanyDocumentTypes(companyId);
  if(!company || !identifiers || !documentTypes){
    throw new UserFacingError("Company or identifiers or document types not found, could not upsert company registration");
  }

  for (const identifier of identifiers) {
    await registerCompanyIdentifier({company, identifier, documentTypes, useTestNetwork});
  }
}

export async function unregisterCompanyRegistrations({companyId, useTestNetwork}: {companyId: string, useTestNetwork: boolean}) {
  const identifiers = await getCompanyIdentifiers(companyId);
  if(!identifiers){
    throw new UserFacingError("Identifiers not found, could not unregister company registration");
  }

  for (const identifier of identifiers) {
    await unregisterCompanyIdentifier({identifier, useTestNetwork});
  }
}

export async function upsertCompanyRegistration({companyId, identifier, useTestNetwork}: {companyId: string, identifier: MinimalCompanyIdentifier, useTestNetwork: boolean}) {
  const company = await getCompanyById(companyId);
  const documentTypes = await getCompanyDocumentTypes(companyId);
  if(!company || !documentTypes){
    throw new UserFacingError("Company or document types not found, could not upsert company registration");
  }

  await registerCompanyIdentifier({company, identifier, documentTypes, useTestNetwork});
}

export async function unregisterCompanyDocumentType({documentType, useTestNetwork}: {documentType: CompanyDocumentType, useTestNetwork: boolean}) {
  const identifiers = await getCompanyIdentifiers(documentType.companyId);

  for (const identifier of identifiers) {
    await deleteServiceMetadata({
      peppolIdentifierEas: identifier.scheme,
      peppolIdentifierAddress: identifier.identifier,
      documentTypeCode: documentType.docTypeId,
      useTestNetwork,
    });
  }
}

async function registerCompanyIdentifier({company, identifier, documentTypes, useTestNetwork}: {company: Company | InsertCompany, identifier: MinimalCompanyIdentifier, documentTypes: CompanyDocumentType[], useTestNetwork: boolean}) {

  if(!company.isSmpRecipient || !company.id){
    return;
  }

  if(!await canUpsertCompanyIdentifier(identifier.scheme, identifier.identifier, undefined, company.id, company.id)){
    throw new UserFacingError("Company cannot be registered as SMP recipient, it has identifiers that are already registered as recipient with another company.");
  }

  const address = `${company.address}, ${company.postalCode} ${company.city}, ${company.country}`;
  try{
    await registerServiceGroup({
      peppolIdentifierEas: identifier.scheme,
      peppolIdentifierAddress: identifier.identifier,
      useTestNetwork,
    });
  }catch(error){
    console.error(error);
    // Try to get the SMP hostnames so we can make a more descriptive error message
    let smpHostnames: string[] = [];
    try{
      const recipientVerification = await verifyRecipient({recipientAddress: identifier.scheme + ":" + identifier.identifier, useTestNetwork});
      smpHostnames = recipientVerification.smpHostnames;
    }catch(error){
      // Ignore the error
    }
    if(smpHostnames.length > 0){
      throw new UserFacingError(`Failed to register company identifier ${identifier.scheme}:${identifier.identifier}, it might already be registered with another SMP (${smpHostnames.join(", ")}). Please revoke your registration with the other SMP and try again. Feel free to contact support@recommand.eu if you are unsure about how to proceed.`);
    }else{
      throw new UserFacingError(`Failed to register company identifier ${identifier.scheme}:${identifier.identifier}, it might already be registered with another SMP. Please ensure this is not the case. Feel free to contact support@recommand.eu if you are unsure about how to proceed.`);
    }
  }

  for (const documentType of documentTypes) {
    await registerServiceMetadata({
      peppolIdentifierEas: identifier.scheme,
      peppolIdentifierAddress: identifier.identifier,
      documentTypeCode: documentType.docTypeId,
      documentProcessIdCode: documentType.processId,
      useTestNetwork,
    });
  }

  await registerBusinessCard({
    peppolIdentifierEas: identifier.scheme,
    peppolIdentifierAddress: identifier.identifier,
    name: company.name,
    countryCode: company.country,
    geographicalInformation: address,
    vatNumber: company.vatNumber,
    useTestNetwork,
  });

}

export async function unregisterCompanyIdentifier({identifier, useTestNetwork}: {identifier: CompanyIdentifier, useTestNetwork: boolean}) {
  await deleteServiceGroup({
    peppolIdentifierEas: identifier.scheme,
    peppolIdentifierAddress: identifier.identifier,
    useTestNetwork,
  });
}