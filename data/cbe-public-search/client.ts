import { XMLParser } from "fast-xml-parser";
import { sendSystemAlert } from "@peppol/utils/system-notifications/telegram";
import { enterpriseDataCache } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { and, desc, eq } from "drizzle-orm";
import type { Representative, EnterpriseData, CompanyAddress, CompanyType } from "./types";
import { hasCompleteCbeAddress, parseCbeAddress, pickFirstEstablishmentAddress } from "./parse-address";
import { callKboSoap, getKboCredentials } from "./soap";

export type { Representative };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  isArray: (name) => {
    return name === "Function" || name === "Establishment";
  },
});

async function fetchEstablishmentAddressFallback(
  enterpriseNumber: string,
  credentials: { username: string; password: string },
): Promise<CompanyAddress | null> {
  const xml = await callKboSoap({
    credentials,
    soapAction: "http://fgov.economie.be/kbopub/ReadEstablishmentByEnterpriseNumber",
    requestBody: {
      "mes:ReadEstablishmentByEnterpriseNumberRequest": {
        "dat:EnterpriseNumber": enterpriseNumber,
        "mes:TypeOfResult": "long",
      },
    },
  });

  const parsed = parser.parse(xml);
  const establishments = parsed.Envelope?.Body?.ReadEstablishmentByEnterpriseNumberReply?.Establishment;

  return pickFirstEstablishmentAddress(establishments);
}

async function resolveEnterpriseAddress({
  enterpriseNumber,
  rootAddress,
  credentials,
}: {
  enterpriseNumber: string;
  rootAddress: CompanyAddress | null;
  credentials: { username: string; password: string };
}): Promise<CompanyAddress | null> {
  if (hasCompleteCbeAddress(rootAddress)) {
    console.log("Using cached address for enterprise", enterpriseNumber, JSON.stringify(rootAddress, null, 2));
    return rootAddress;
  }

  try {
    console.log("Fetching establishment address fallback for enterprise", enterpriseNumber);
    return await fetchEstablishmentAddressFallback(enterpriseNumber, credentials);
  } catch (error) {
    console.error(error);
    return rootAddress;
  }
}

export async function getEnterpriseData(enterpriseNumber: string, country: string): Promise<EnterpriseData> {

  try {
    const cache = await getEnterpriseDataFromCache(enterpriseNumber, country);
    if (cache && new Date(cache.updatedAt).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000) {
      if (hasCompleteCbeAddress(cache.enterpriseData.address)) {
        return cache.enterpriseData;
      }

      const address = await resolveEnterpriseAddress({
        enterpriseNumber,
        rootAddress: cache.enterpriseData.address,
        credentials: getKboCredentials(),
      });

      if (hasCompleteCbeAddress(address) && !hasCompleteCbeAddress(cache.enterpriseData.address)) {
        const enterpriseData = { ...cache.enterpriseData, address };
        try {
          await upsertEnterpriseDataInCache(enterpriseData);
        } catch (error) {
          console.error(error);
        }
        return enterpriseData;
      }

      return cache.enterpriseData;
    }
  } catch (error) { }

  const credentials = getKboCredentials();

  const xml = await callKboSoap({
    credentials,
    soapAction: "http://fgov.economie.be/kbopub/ReadEnterprise",
    requestBody: {
      "mes:ReadEnterpriseRequest": {
        "dat:EnterpriseNumber": enterpriseNumber,
      },
    },
  });

  const parsed = parser.parse(xml);

  const envelope = parsed.Envelope;
  const header = envelope?.Header;
  const body = envelope?.Body;
  const responseData = body?.ReadEnterpriseReply;
  const enterprise = responseData?.Enterprise;

  const accountBalance = header?.ReplyContext?.AccountBalance
    ? parseInt(header.ReplyContext.AccountBalance, 10)
    : 0;

  console.log("CBE Account balance:", accountBalance);
  // Send alert if account balance is less than 200 and is a multiple of 5 or less than 20
  if (accountBalance < 200 && (accountBalance % 5 === 0 || accountBalance < 20)) {
    sendSystemAlert("CBE Account balance is low", `Account balance is low: ${accountBalance}`, "warning");
  }

  const representatives: Representative[] = [];
  let address: CompanyAddress | null = null;
  let companyType: CompanyType | null = null;

  const functions = enterprise.Function || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const func of functions) {
    const person = func.Person;
    if (!person) {
      continue;
    }

    const period = func.Period;
    const beginDate = period?.Begin;
    const endDate = period?.End;

    if (!beginDate) {
      continue;
    }

    const begin = new Date(beginDate);
    begin.setHours(0, 0, 0, 0);

    if (begin > today) {
      continue;
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(0, 0, 0, 0);
      if (end < today) {
        continue;
      }
    }

    representatives.push({
      firstName: person.GivenName ?? null,
      lastName: person.Surname ?? null,
      function: func.Description?.Value || func.Code || null,
      beginDate,
      endDate: endDate ?? null,
    });
  }

  address = parseCbeAddress(enterprise.Address);
  address = await resolveEnterpriseAddress({
    enterpriseNumber,
    rootAddress: address,
    credentials,
  });

  if (enterprise.JuridicalForm || enterprise.Denomination) {
    const juridicalFormDesc = enterprise.JuridicalForm?.Description;
    const denominationDesc = enterprise.Denomination?.Description;
    companyType = {
      juridicalForm: enterprise.JuridicalForm ? {
        code: enterprise.JuridicalForm.Code ?? null,
        description: juridicalFormDesc?.Value ?? null,
        beginDate: enterprise.JuridicalForm.ValidityPeriod?.Begin ?? null,
      } : null,
      denomination: enterprise.Denomination ? {
        code: enterprise.Denomination.Code ?? null,
        description: denominationDesc?.Value ?? null,
        beginDate: enterprise.Denomination.ValidityPeriod?.Begin ?? null,
      } : null,
    };
  }

  const enterpriseData: EnterpriseData = {
    enterpriseNumber,
    beginDate: enterprise.Period?.Begin ?? null,
    representatives,
    address,
    companyType,
  };

  try {
    await upsertEnterpriseDataInCache(enterpriseData);
  } catch (error) {
    console.error(error);
  }
  
  return enterpriseData;
}

export async function getEnterpriseDataFromCache(enterpriseNumber: string, country: string): Promise<{ enterpriseData: EnterpriseData, updatedAt: Date } | null> {
  const cache = await db.select()
    .from(enterpriseDataCache)
    .where(and(eq(enterpriseDataCache.enterpriseNumber, enterpriseNumber), eq(enterpriseDataCache.country, country)))
    .orderBy(desc(enterpriseDataCache.createdAt))
    .limit(1)
    .then((rows) => rows[0]);
  if (!cache) {
    return null;
  }
  const hasAddress = cache.street || cache.number || cache.postalCode || cache.city;
  const hasCompanyType = cache.juridicalFormCode || cache.denominationCode;

  return {
    enterpriseData: {
      enterpriseNumber: cache.enterpriseNumber,
      beginDate: cache.beginDate,
      address: hasAddress ? {
        street: cache.street,
        number: cache.number,
        postalCode: cache.postalCode,
        city: cache.city,
        country: cache.country,
      } : null,
      companyType: hasCompanyType ? {
        juridicalForm: cache.juridicalFormCode ? {
          code: cache.juridicalFormCode,
          description: cache.juridicalFormDescription,
          beginDate: cache.juridicalFormBeginDate,
        } : null,
        denomination: cache.denominationCode ? {
          code: cache.denominationCode,
          description: cache.denominationDescription,
          beginDate: cache.denominationBeginDate,
        } : null,
      } : null,
      representatives: cache.representatives || [],
    },
    updatedAt: cache.updatedAt,
  };
}

export async function upsertEnterpriseDataInCache(data: EnterpriseData) {
  const country = (data.address?.country || "BE") as typeof enterpriseDataCache.$inferInsert.country;
  await db.transaction(async (tx) => {
    await tx.delete(enterpriseDataCache).where(and(eq(enterpriseDataCache.enterpriseNumber, data.enterpriseNumber), eq(enterpriseDataCache.country, country)));
    await tx.insert(enterpriseDataCache).values({
      enterpriseNumber: data.enterpriseNumber,
      country,
      beginDate: data.beginDate,
      name: data.companyType?.denomination?.description,
      street: data.address?.street,
      number: data.address?.number,
      postalCode: data.address?.postalCode,
      city: data.address?.city,
      juridicalFormCode: data.companyType?.juridicalForm?.code,
      juridicalFormDescription: data.companyType?.juridicalForm?.description,
      juridicalFormBeginDate: data.companyType?.juridicalForm?.beginDate,
      denominationCode: data.companyType?.denomination?.code,
      denominationDescription: data.companyType?.denomination?.description,
      denominationBeginDate: data.companyType?.denomination?.beginDate,
      representatives: data.representatives,
    });
  });
}
