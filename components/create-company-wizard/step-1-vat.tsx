import { useState } from "react";
import { Button } from "@core/components/ui/button";
import { AsyncButton } from "@core/components/async-button";
import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import type { CompanyFormData } from "@peppol/types/company";
import { CompanyIdentityFields, getCompanyCountryDefaults, type CompanyIdentityFieldsValue } from "@peppol/components/company-form-fields";
import { getCountrySupportLevel } from "@peppol/utils/countries";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<Companies>("peppol");

type Step1Props = {
    teamId: string;
    data: Partial<CompanyFormData>;
    onNext: (data: Partial<CompanyFormData>) => void;
    onCancel: () => void;
    offerSetUpLater: boolean;
};

export function Step1Vat({ teamId, data, onNext, onCancel, offerSetUpLater }: Step1Props) {
    const { t } = useTranslation();
    const [identityData, setIdentityData] = useState<Partial<CompanyIdentityFieldsValue>>({
        ...(data.country ? getCompanyCountryDefaults(data.country) : {}),
        country: data.country,
        vatNumber: data.vatNumber ?? null,
        enterpriseNumber: data.enterpriseNumber ?? null,
        enterpriseNumberScheme: data.enterpriseNumberScheme ?? null,
    });

    const mergeIdentityData = (partial: Partial<CompanyIdentityFieldsValue>) => {
        setIdentityData((prev) => ({ ...prev, ...partial }));
    };

    // Companies can only be created in a supported country, so there is no going on
    // without one: not by the button, nor by submitting the form another way.
    const canContinue = Boolean(identityData.country) && getCountrySupportLevel(identityData.country) !== "unsupported";

    const handleNext = async () => {
        const country = identityData.country;
        if (!country || !canContinue) return;
        const vatNumber = identityData.vatNumber ?? "";
        const enterpriseNumber = identityData.enterpriseNumber ?? "";
        const enterpriseNumberScheme = identityData.enterpriseNumberScheme ?? "";

        if (country === "BE" && vatNumber.trim().length >= 4) {
            try {
                const response = await client[":teamId"]["vat-lookup"].$get({
                    param: { teamId },
                    query: { country, vatNumber },
                });
                const json = await response.json();
                if (json.success) {
                    onNext({
                        country,
                        vatNumber: vatNumber || null,
                        enterpriseNumber: enterpriseNumber || null,
                        enterpriseNumberScheme: enterpriseNumberScheme || "0208",
                        name: json.name ?? "",
                        address: json.address ?? "",
                        postalCode: json.postalCode ?? "",
                        city: json.city ?? "",
                    });
                    return;
                }
            } catch {
            }
        }
        onNext({
            country,
            vatNumber: vatNumber || null,
            enterpriseNumber: enterpriseNumber || null,
            enterpriseNumberScheme: enterpriseNumberScheme || null,
        });
    };

    return (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleNext(); }}>
            <CompanyIdentityFields
                value={identityData}
                onChange={mergeIdentityData}
                vatNumberLabel={t`VAT Number`}
            />
            <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onCancel}>
                    {offerSetUpLater ? t`Set up later` : t`Cancel`}
                </Button>
                <AsyncButton type="submit" onClick={handleNext} disabled={!canContinue}>
                    {t`Next`}
                </AsyncButton>
            </div>
            {offerSetUpLater && (
                <p className="text-xs text-pretty text-muted-foreground">
                    {t`Working through the API for clients? Choose ‘Set up later’ and add their companies later.`}
                </p>
            )}
        </form>
    );
}
