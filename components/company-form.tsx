import { Label } from "@core/components/ui/label";
import { Button } from "@core/components/ui/button";
import type { Company } from "@peppol/types/company";
import { AsyncButton } from "@core/components/async-button";
import { Checkbox } from "@core/components/ui/checkbox";
import { CompanyDetailsFields, CompanyIdentityFields } from "@peppol/components/company-form-fields";
import { StatusMessage } from "@recommand/components/status-feedback";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

type CompanyFormProps = {
    company: Partial<Company>;
    onChange: (company: Partial<Company>) => void;
    onSubmit: () => Promise<void>;
    onCancel: () => void;
    isEditing?: boolean;
    showEnterpriseNumberForBelgianCompanies?: boolean;
    showVerificationWarning?: boolean;
};

export function CompanyForm({ company, onChange, onSubmit, onCancel, isEditing = false, showEnterpriseNumberForBelgianCompanies = false, showVerificationWarning = false }: CompanyFormProps) {
    const { t } = useTranslation();
    const mergeCompany = (updates: Partial<Company>) => {
        onChange({ ...company, ...updates });
    };

    return (
        <div className="space-y-4">
            <CompanyDetailsFields value={company} onChange={(updates) => mergeCompany(updates)} />
            <CompanyIdentityFields
                value={company}
                onChange={(updates) => mergeCompany(updates)}
                showEnterpriseNumberForBelgianCompanies={showEnterpriseNumberForBelgianCompanies}
                showDutchEnterpriseNumberSchemeAlert={true}
            />
            <div className="space-y-1">
                <div className="flex items-start gap-2">
                    <Checkbox
                        id="isSmpRecipient"
                        checked={company.isSmpRecipient === true}
                        onCheckedChange={(checked) => mergeCompany({ isSmpRecipient: checked === true })}
                    />
                    <Label htmlFor="isSmpRecipient" className="text-sm mt-0 pt-0">{t`Register as recipient`}</Label>
                </div>
                <p className="text-xs text-pretty text-muted-foreground">{t`If enabled, the company will be registered as a recipient in our SMP (the Peppol address book). This will allow you to send and receive documents. If disabled, you will only be able to send documents via Recommand.`}</p>
            </div>
            <div className="space-y-3 pt-2">
                {showVerificationWarning && (
                    <StatusMessage
                        tone="warning"
                        icon={AlertTriangle}
                        title={t`Saving will require re-verification`}
                        description={t`The VAT or enterprise number changed. Saving will revoke open verification sessions and any current verification status, and the company will need to be verified again.`}
                    />
                )}
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onCancel}
                    >
                        {t`Cancel`}
                    </Button>
                    <AsyncButton type="submit" onClick={onSubmit}>
                        {isEditing ? t`Save Changes` : t`Create Company`}
                    </AsyncButton>
                </div>
            </div>
        </div>
    );
}
