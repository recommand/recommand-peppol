import type { CompanyAddress } from "./types";

function getDescriptionValue(description: unknown): string | null {
  if (!description) {
    return null;
  }
  if (Array.isArray(description)) {
    const first = description[0];
    if (first && typeof first === "object" && "Value" in first) {
      const value = (first as { Value?: unknown }).Value;
      return value != null ? String(value) : null;
    }
    return null;
  }
  if (typeof description === "object" && "Value" in description) {
    const value = (description as { Value?: unknown }).Value;
    return value != null ? String(value) : null;
  }
  return null;
}

export function parseCbeAddress(addr: unknown): CompanyAddress | null {
  if (!addr || typeof addr !== "object") {
    return null;
  }

  const address = addr as {
    Street?: { Description?: unknown };
    HouseNumber?: unknown;
    Zipcode?: unknown;
    Municipality?: { Description?: unknown };
  };

  return {
    street: getDescriptionValue(address.Street?.Description),
    number: address.HouseNumber != null ? String(address.HouseNumber) : null,
    postalCode: address.Zipcode != null ? String(address.Zipcode) : null,
    city: getDescriptionValue(address.Municipality?.Description),
    country: "BE",
  };
}

export function hasCompleteCbeAddress(address: CompanyAddress | null): boolean {
  if (!address) {
    return false;
  }

  const streetLine = `${address.street ?? ""} ${address.number ?? ""}`.trim();
  return (
    streetLine.length > 0
    && (address.postalCode?.trim().length ?? 0) > 0
    && (address.city?.trim().length ?? 0) > 0
  );
}

export function pickFirstEstablishmentAddress(establishments: unknown): CompanyAddress | null {
  const list = establishments == null
    ? []
    : Array.isArray(establishments)
      ? establishments
      : [establishments];

  for (const establishment of list) {
    if (!establishment || typeof establishment !== "object") {
      continue;
    }
    const parsed = parseCbeAddress((establishment as { Address?: unknown }).Address);
    if (hasCompleteCbeAddress(parsed)) {
      return parsed;
    }
  }

  return null;
}
