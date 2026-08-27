import { useState } from "react";
import { Button } from "@core/components/ui/button";
import { ShieldCheck } from "lucide-react";
import type { Company } from "@peppol/types/company";
import { ForwardSection } from "@peppol/app/(public)/company-verification/[companyVerificationLogId]/verify/forward-section";
import { useTranslation } from "@core/hooks/use-translation";

type Step6Props = {
    teamId: string;
    company: Company;
    verificationUrl: string;
    verificationLogId: string;
    onComplete: (company: Company) => void;
};

export function Step6Verification({ company, verificationUrl, verificationLogId, onComplete }: Step6Props) {
    const { t } = useTranslation();
    const [action, setAction] = useState<"forwarded" | null>(null);

    const handleVerify = () => {
        window.location.href = verificationUrl;
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                {t`To send or receive documents on behalf of ${company.name}, you must verify your identity to confirm you are authorized to act for this company.`}
            </p>
            <div className="space-y-3">
                <Button onClick={handleVerify} className="w-full">
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    {t`Start Verification`}
                </Button>
                <ForwardSection companyVerificationLogId={verificationLogId} onAction={() => setAction("forwarded")} />
                {action !== null ? (
                    <div className="flex justify-end">
                        <Button type="button" onClick={() => onComplete(company)}>
                            {t`Done`}
                        </Button>
                    </div>
                ) : (
                    <div className="text-center">
                        <button
                            type="button"
                            onClick={() => onComplete(company)}
                            className="text-sm text-muted-foreground hover:underline"
                        >
                            {t`Skip for now`}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
