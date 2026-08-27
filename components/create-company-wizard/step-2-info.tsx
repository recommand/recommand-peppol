import { useState } from "react";
import { Button } from "@core/components/ui/button";
import type { CompanyFormData } from "@peppol/types/company";
import { CompanyDetailsFields, hasRequiredCompanyDetails, type CompanyDetailsFieldsValue } from "@peppol/components/company-form-fields";
import { useTranslation } from "@core/hooks/use-translation";

type Step2Props = {
    data: Partial<CompanyFormData>;
    onNext: (data: Partial<CompanyFormData>) => void;
    onBack: () => void;
};

export function Step2Info({ data, onNext, onBack }: Step2Props) {
    const { t } = useTranslation();
    const [detailsData, setDetailsData] = useState<Partial<CompanyDetailsFieldsValue>>({
        name: data.name ?? "",
        address: data.address ?? "",
        postalCode: data.postalCode ?? "",
        city: data.city ?? "",
        email: data.email ?? null,
        phone: data.phone ?? null,
    });

    const handleNext = () => {
        onNext(detailsData);
    };

    const isValid = hasRequiredCompanyDetails(detailsData);

    return (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (isValid) handleNext(); }}>
            <CompanyDetailsFields
                value={detailsData}
                onChange={(partial) => setDetailsData((prev) => ({ ...prev, ...partial }))}
            />
            <div className="flex justify-between gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onBack}>
                    {t`Back`}
                </Button>
                <Button type="submit" disabled={!isValid}>
                    {t`Next`}
                </Button>
            </div>
        </form>
    );
}
