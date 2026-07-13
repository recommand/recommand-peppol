import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Combobox } from "@core/components/ui/combobox";
import { AlertTriangle } from "lucide-react";
import { StatusMessage } from "@recommand/components/status-feedback";
import { COUNTRIES } from "@peppol/utils/countries";
import { ISO_ICD_SCHEME_IDENTIFIERS } from "@peppol/utils/iso-icd-scheme-identifiers";
import type { CompanyFormData } from "@peppol/types/company";
import { zodValidCountryCodes } from "@peppol/db/schema";
import { z } from "zod";

type CountryCode = z.infer<typeof zodValidCountryCodes>;

export type CompanyIdentityFieldsValue = Pick<CompanyFormData, "country" | "vatNumber" | "enterpriseNumber" | "enterpriseNumberScheme">;
export type CompanyDetailsFieldsValue = Pick<CompanyFormData, "name" | "address" | "postalCode" | "city" | "email" | "phone">;

type CompanyIdentityFieldsProps = {
    value: Partial<CompanyIdentityFieldsValue>;
    onChange: (updates: Partial<CompanyIdentityFieldsValue>) => void;
    showEnterpriseNumberForBelgianCompanies?: boolean;
    showDutchEnterpriseNumberSchemeAlert?: boolean;
    vatNumberLabel?: string;
};

type CompanyDetailsFieldsProps = {
    value: Partial<CompanyDetailsFieldsValue>;
    onChange: (updates: Partial<CompanyDetailsFieldsValue>) => void;
};

const enterpriseNumberSchemeOptions = ISO_ICD_SCHEME_IDENTIFIERS.map((scheme) => {
    const truncatedName = scheme.name.length > 30
        ? scheme.name.substring(0, 30) + "..."
        : scheme.name;

    return {
        value: scheme.key,
        label: `${scheme.key} - ${truncatedName}`,
    };
});

export function getCompanyCountryDefaults(country: CountryCode): CompanyIdentityFieldsValue {
    const countryInfo = COUNTRIES.find((entry) => entry.code === country);
    const hasDefaultScheme = countryInfo?.defaultEnterpriseNumberScheme
        ? ISO_ICD_SCHEME_IDENTIFIERS.some((scheme) => scheme.key === countryInfo.defaultEnterpriseNumberScheme)
        : false;

    return {
        country,
        vatNumber: null,
        enterpriseNumber: null,
        enterpriseNumberScheme: hasDefaultScheme ? countryInfo?.defaultEnterpriseNumberScheme ?? null : null,
    };
}

export function hasRequiredCompanyDetails(value: Partial<CompanyDetailsFieldsValue>) {
    return Boolean(value.name?.trim() && value.address?.trim() && String(value.postalCode ?? "").trim() && String(value.city ?? "").trim());
}

export function CompanyIdentityFields({
    value,
    onChange,
    showEnterpriseNumberForBelgianCompanies = false,
    showDutchEnterpriseNumberSchemeAlert = false,
    vatNumberLabel = "VAT Number (Optional)",
}: CompanyIdentityFieldsProps) {
    const country = value.country ?? "";
    const vatNumber = value.vatNumber ?? "";
    const enterpriseNumber = value.enterpriseNumber ?? "";
    const enterpriseNumberScheme = value.enterpriseNumberScheme ?? "";
    const countryInfo = COUNTRIES.find((entry) => entry.code === country);
    const countryOptions = COUNTRIES.filter((entry) => entry.supportLevel !== "unsupported" || entry.code === country);

    return (
        <>
            <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Select
                    value={country}
                    onValueChange={(nextCountry) => onChange(getCompanyCountryDefaults(nextCountry as CountryCode))}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                    <SelectContent>
                        {countryOptions.map((countryOption) => (
                            <SelectItem key={countryOption.code} value={countryOption.code}>
                                {countryOption.flag} {countryOption.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {countryInfo?.supportLevel === "partial" && (
                    <StatusMessage
                        tone="warning"
                        icon={AlertTriangle}
                        title={`${countryInfo.name} is partially supported`}
                        description={`Companies in ${countryInfo.name} are functional, but some country-specific features or requirements may not be covered yet.`}
                    />
                )}
                {countryInfo?.supportLevel === "unsupported" && (
                    <StatusMessage
                        tone="warning"
                        icon={AlertTriangle}
                        title={`${countryInfo.name} is currently not supported`}
                        description={`New companies cannot be created in ${countryInfo.name}, and existing companies cannot switch to it. We are working on supporting more countries in the future. Would you like to see support for ${countryInfo.name}? Let us know via support@recommand.eu.`}
                    />
                )}
            </div>
            <div className="space-y-2">
                <Label htmlFor="vatNumber">{vatNumberLabel}</Label>
                <Input
                    id="vatNumber"
                    value={vatNumber}
                    onChange={(event) => onChange({ vatNumber: event.target.value || null })}
                    placeholder={country === "BE" ? "BE0123456789" : ""}
                />
                {country === "BE" && <p className="text-xs text-pretty text-muted-foreground">For Belgian businesses, the VAT number will be used to infer the enterprise number.</p>}
                {country === "NL" && <p className="text-xs text-pretty text-muted-foreground">For Dutch businesses, the VAT number format is NL + 9 digits + B + 2 digits (e.g. NL123456789B01).</p>}
            </div>
            {(country !== "BE" || showEnterpriseNumberForBelgianCompanies) && (
                <div className="space-y-2">
                    <Label htmlFor="enterpriseNumber">Enterprise Number (Optional)</Label>
                    <div className="flex gap-2">
                        <div className="w-48">
                            <Combobox
                                value={enterpriseNumberScheme}
                                onValueChange={(nextScheme) => onChange({ enterpriseNumberScheme: nextScheme || null })}
                                options={enterpriseNumberSchemeOptions}
                                placeholder="Select scheme..."
                                searchPlaceholder="Search scheme..."
                                emptyText="No scheme found."
                                className="w-full"
                            />
                        </div>
                        <Input
                            id="enterpriseNumber"
                            value={enterpriseNumber}
                            onChange={(event) => onChange({ enterpriseNumber: event.target.value || null })}
                            className="flex-1"
                        />
                    </div>
                    {showDutchEnterpriseNumberSchemeAlert && country === "NL" && enterpriseNumberScheme !== "0106" && enterpriseNumberScheme !== "0190" && enterpriseNumber.trim() && (
                        <StatusMessage
                            tone="warning"
                            icon={AlertTriangle}
                            title="Enterprise number scheme 0106 or 0190 required"
                            description="For Dutch sellers, the scheme identifier is required to be able to send invoices and credit notes."
                        />
                    )}
                </div>
            )}
        </>
    );
}

export function CompanyDetailsFields({ value, onChange }: CompanyDetailsFieldsProps) {
    return (
        <>
            <div className="space-y-2">
                <Label htmlFor="name">Company Name</Label>
                <Input
                    id="name"
                    value={value.name ?? ""}
                    onChange={(event) => onChange({ name: event.target.value })}
                    required
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                    id="address"
                    value={value.address ?? ""}
                    onChange={(event) => onChange({ address: event.target.value })}
                    required
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="postalCode">Postal Code</Label>
                    <Input
                        id="postalCode"
                        value={value.postalCode ?? ""}
                        onChange={(event) => onChange({ postalCode: event.target.value })}
                        required
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                        id="city"
                        value={value.city ?? ""}
                        onChange={(event) => onChange({ city: event.target.value })}
                        required
                    />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="email">Email (Optional)</Label>
                    <Input
                        id="email"
                        type="email"
                        value={value.email ?? ""}
                        onChange={(event) => onChange({ email: event.target.value || null })}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="phone">Phone (Optional)</Label>
                    <Input
                        id="phone"
                        type="tel"
                        value={value.phone ?? ""}
                        onChange={(event) => onChange({ phone: event.target.value || null })}
                    />
                </div>
            </div>
        </>
    );
}
