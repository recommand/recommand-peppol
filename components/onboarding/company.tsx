import { useEffect, useState } from "react";
import { useActiveTeam } from "@core/hooks/user";
import { fetchBillingProfile } from "@peppol/lib/billing";
import { useIsPlayground } from "@peppol/lib/client/playgrounds";
import { CreateCompanyWizard } from "@peppol/components/create-company-wizard";
import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import type { GetTeamExtension } from "@peppol/api/teams/get-team-extension";
import type { Company, CompanyFormData } from "@peppol/types/company";
import { useTranslation } from "@core/hooks/use-translation";

const companiesClient = rc<Companies>("peppol");
const teamsClient = rc<GetTeamExtension>("v1");

export default function CompanyOnboarding({ onComplete }: { onComplete: () => Promise<void> }) {
    const { t } = useTranslation();
    const activeTeam = useActiveTeam();
    const isPlayground = useIsPlayground();
    const [initialData, setInitialData] = useState<Partial<CompanyFormData> | undefined>(undefined);
    const [hasBillingPrefill, setHasBillingPrefill] = useState(false);
    const [checked, setChecked] = useState(false);
    const [verificationRequirements, setVerificationRequirements] = useState<"strict" | "trusted" | "lax" | null>(null);

    useEffect(() => {
        if (!activeTeam?.id) return;

        const init = async () => {
            const [companiesResponse, teamExtensionResponse] = await Promise.all([
                companiesClient[":teamId"]["companies"].$get({ param: { teamId: activeTeam.id }, query: {} }),
                teamsClient[":teamId"]["team-extension"].$get({ param: { teamId: activeTeam.id } }),
            ]);

            const companiesJson = await companiesResponse.json();
            if (companiesJson.success && Array.isArray(companiesJson.companies) && companiesJson.companies.length > 0) {
                await onComplete();
                return;
            }

            const teamExtensionJson = await teamExtensionResponse.json();
            if (teamExtensionJson.success) {
                setVerificationRequirements(teamExtensionJson.verificationRequirements);
            }

            if (!isPlayground) {
                const billingProfile = await fetchBillingProfile(activeTeam.id);
                if (billingProfile) {
                    setHasBillingPrefill(true);
                    setInitialData({
                        name: billingProfile.companyName || "",
                        address: billingProfile.address || "",
                        postalCode: billingProfile.postalCode || "",
                        city: billingProfile.city || "",
                        country: (billingProfile.country as CompanyFormData["country"]) || "BE",
                        vatNumber: billingProfile.vatNumber || null,
                    });
                }
            }

            setChecked(true);
        };

        init();
    }, [activeTeam?.id]);

    if (!activeTeam?.id || !checked) return null;

    const handleComplete = async (_company: Company) => {
        await onComplete();
    };

    const handleCancel = async () => {
        await onComplete();
    };

    return (
        <div>
        <div className="w-full max-w-lg space-y-4">
            {hasBillingPrefill && (
                <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-md text-center">
                    {t`Some fields have been pre-filled from your billing profile.`}
                </p>
            )}
            <CreateCompanyWizard
                teamId={activeTeam.id}
                verificationRequirements={verificationRequirements}
                initialData={initialData}
                onComplete={handleComplete}
                onCancel={handleCancel}
            />
        </div>
        </div>
    );
}
