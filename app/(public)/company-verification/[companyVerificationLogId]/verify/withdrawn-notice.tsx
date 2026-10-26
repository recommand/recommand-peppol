import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import { Button } from "@core/components/ui/button";
import { useUser } from "@core/hooks/user";
import { useTranslation } from "@core/hooks/use-translation";
import { StatusHero } from "@recommand/components/status-feedback";

/**
 * Shown for a verification link that support withdrew because an earlier session of
 * the same company already held the identity check. It is not a refusal. The earlier
 * session is not linked from here: its link was given to whoever started it, and
 * team members follow the company's verification from their companies overview.
 */
export function WithdrawnNotice({ companyName }: { companyName: string }) {
    const { t } = useTranslation();
    const user = useUser();
    return (
        <div className="min-h-svh flex items-center justify-center bg-muted/30 px-4 py-12">
            <div className="w-full max-w-lg space-y-8">
                <StatusHero
                    tone="info"
                    icon={Info}
                    title={t`Verification Link Withdrawn`}
                    description={t`This link was withdrawn because an earlier verification of ${companyName} had already been submitted. It is not a rejection, and you do not need to submit anything here.`}
                />
                {user && (
                    <Button variant="outline" className="w-full" asChild>
                        <Link to="/companies">{t`Go to Companies`}</Link>
                    </Button>
                )}
            </div>
        </div>
    );
}
