import { Button } from "@core/components/ui/button";
import { CompanyIdentifiersManager } from "@peppol/components/company-identifiers-manager";
import type { Company } from "@peppol/types/company";
import { useTranslation } from "@core/hooks/use-translation";

type Step5Props = {
    teamId: string;
    company: Company;
    onNext: () => void;
};

export function Step5Identifiers({ teamId, company, onNext }: Step5Props) {
    const { t } = useTranslation();
    return (
        <div className="space-y-4">
            <div>
                <p className="text-sm text-muted-foreground">
                    {t`Peppol identifiers are the addresses your company uses on the Peppol network. By default, identifiers were created from your enterprise or VAT number. You can add additional identifiers here if needed.`}
                </p>
            </div>
            <CompanyIdentifiersManager teamId={teamId} companyId={company.id} />
            <div className="flex justify-end pt-2">
                <Button type="button" onClick={onNext}>
                    {t`Continue`}
                </Button>
            </div>
        </div>
    );
}
