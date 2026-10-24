import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { Button } from "@core/components/ui/button";
import { StatusMessage } from "@recommand/components/status-feedback";
import { AlertCircle, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

const client = rc<Companies>("v1");

/**
 * Leads on from a finished session to the company's verification as it stands:
 * the open session when there is one, otherwise a new one. Links of finished
 * sessions stay in inboxes, and without this whoever opens one stops at the old
 * outcome even though the company still needs to be verified.
 */
export function ContinueVerificationButton({
    companyVerificationLogId,
    followUp,
}: {
    companyVerificationLogId: string;
    followUp: "continue" | "startNew" | "retry";
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [isContinuing, setIsContinuing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleContinue = async () => {
        try {
            setIsContinuing(true);
            setError(null);
            const response = await client["companies"]["verification"][":companyVerificationLogId"]["continue"].$post({
                param: { companyVerificationLogId },
            });
            const json = await response.json();
            if (!json.success) {
                setError(stringifyActionFailure(json.errors));
                return;
            }
            navigate(`/company-verification/${json.verificationLogId}/verify`);
        } catch {
            setError(t`An unexpected error occurred. Please try again.`);
        } finally {
            setIsContinuing(false);
        }
    };

    return (
        <div className="space-y-3">
            {error && <StatusMessage tone="error" icon={AlertCircle} description={error} />}

            <Button className="w-full" size="lg" onClick={handleContinue} disabled={isContinuing}>
                {isContinuing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : followUp === "continue" ? (
                    <ArrowRight className="h-4 w-4" />
                ) : (
                    <RefreshCw className="h-4 w-4" />
                )}
                {followUp === "continue" ? t`Continue Verification` : followUp === "retry" ? t`Try Again` : t`Start New Verification`}
            </Button>
        </div>
    );
}
