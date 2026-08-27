import { useState } from "react";
import { Button } from "@core/components/ui/button";
import { AsyncButton } from "@core/components/async-button";
import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import type { CompanyFormData } from "@peppol/types/company";
import { CompanyIdentityFields, getCompanyCountryDefaults, type CompanyIdentityFieldsValue } from "@peppol/components/company-form-fields";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<Companies>("peppol");

type Step1Props = {
    teamId: string;
    data: Partial<CompanyFormData>;
    onNext: (data: Partial<CompanyFormData>) => void;
    onCancel: () => void;
};

export function Step1Vat({ teamId, data, onNext, onCancel }: Step1Props) {
    const { t } = useTranslation();
    const [identityData, setIdentityData] = useState<Partial<CompanyIdentityFieldsValue>>({
        ...getCompanyCountryDefaults(data.country ?? "BE"),
        country: data.country ?? "BE",
        vatNumber: data.vatNumber ?? null,
        enterpriseNumber: data.enterpriseNumber ?? null,
        enterpriseNumberScheme: data.enterpriseNumberScheme ?? null,
    });

    const mergeIdentityData = (partial: Partial<CompanyIdentityFieldsValue>) => {
        setIdentityData((prev) => ({ ...prev, ...partial }));
    };

    const handleNext = async () => {
        const country = identityData.country ?? "BE";
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
                    {t`Cancel`}
                </Button>
                <AsyncButton type="submit" onClick={handleNext}>
                    {t`Next`}
                </AsyncButton>
            </div>
        </form>
    );
}
