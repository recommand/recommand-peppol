import { useState } from "react";
import type { Company, CompanyFormData } from "@peppol/types/company";
import { defaultCompanyFormData } from "@peppol/types/company";
import { Step1Vat } from "./step-1-vat";
import { Step2Info } from "./step-2-info";
import { Step3Usage } from "./step-3-usage";
import { Step4Create } from "./step-4-create";
import { Step5Identifiers } from "./step-5-identifiers";
import { Step6Verification } from "./step-6-verification";
import { useTranslation } from "@core/hooks/use-translation";

type CreateCompanyWizardProps = {
    teamId: string;
    verificationRequirements: "strict" | "trusted" | "lax" | null;
    initialData?: Partial<CompanyFormData>;
    onComplete: (company: Company) => void;
    onCancel: () => void;
};

export function CreateCompanyWizard({ teamId, verificationRequirements, initialData, onComplete, onCancel }: CreateCompanyWizardProps) {
    const { t } = useTranslation();
    const displayStepTitles: Record<number, string> = {
        1: t`Country & VAT`,
        2: t`Company information`,
        3: t`Sending & receiving`,
        5: t`Peppol addresses`,
        6: t`Verification`,
    };
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState<CompanyFormData>({
        ...defaultCompanyFormData,
        ...initialData,
    });
    const [createdCompany, setCreatedCompany] = useState<Company | null>(null);
    const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
    const [verificationLogId, setVerificationLogId] = useState<string | null>(null);

    const verificationRequired = verificationRequirements === "strict" || verificationRequirements === "lax";

    // Step 4 is a hidden transition; display steps = internal steps minus 1
    const totalDisplaySteps = verificationRequired ? 5 : 4;
    const displayStep = step < 4 ? step : step - 1;

    const mergeData = (partial: Partial<CompanyFormData>) => {
        setFormData((prev) => ({ ...prev, ...partial }));
    };

    const afterIdentifiers = () => {
        if (verificationRequired) {
            setStep(6);
        } else {
            onComplete(createdCompany!);
        }
    };

    return (
        <div className="space-y-6">
            {step !== 4 && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{t`Step ${displayStep} of ${totalDisplaySteps}`}</p>
                        <p className="text-xs text-muted-foreground">{displayStepTitles[step]}</p>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 rounded-full"
                            style={{ width: `${(displayStep / totalDisplaySteps) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {step === 1 && (
                <Step1Vat
                    teamId={teamId}
                    data={formData}
                    onNext={(data) => {
                        mergeData(data);
                        setStep(2);
                    }}
                    onCancel={onCancel}
                />
            )}
            {step === 2 && (
                <Step2Info
                    data={formData}
                    onNext={(data) => {
                        mergeData(data);
                        setStep(3);
                    }}
                    onBack={() => setStep(1)}
                />
            )}
            {step === 3 && (
                <Step3Usage
                    isSmpRecipient={formData.isSmpRecipient}
                    onNext={(isSmpRecipient) => {
                        mergeData({ isSmpRecipient });
                        setStep(4);
                    }}
                    onBack={() => setStep(2)}
                />
            )}
            {step === 4 && (
                <Step4Create
                    teamId={teamId}
                    data={formData}
                    onNext={(company, url, logId) => {
                        setCreatedCompany(company);
                        setVerificationUrl(url);
                        setVerificationLogId(logId);
                        setStep(5);
                    }}
                    onBack={() => setStep(3)}
                />
            )}
            {step === 5 && createdCompany && (
                <Step5Identifiers
                    teamId={teamId}
                    company={createdCompany}
                    onNext={afterIdentifiers}
                />
            )}
            {step === 6 && createdCompany && verificationUrl && verificationLogId && (
                <Step6Verification
                    teamId={teamId}
                    company={createdCompany}
                    verificationUrl={verificationUrl}
                    verificationLogId={verificationLogId}
                    onComplete={onComplete}
                />
            )}
        </div>
    );
}
