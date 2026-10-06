import { useEffect, useState } from "react";
import { useActiveTeam } from "@core/hooks/user";
import { resolveCompanyPrefill } from "@peppol/lib/client/company-prefill";
import { useIsPlayground } from "@peppol/lib/client/playgrounds";
import { CreateCompanyWizard } from "@peppol/components/create-company-wizard";
import { rc } from "@recommand/lib/client";
import type { Companies } from "@peppol/api/companies";
import type { GetTeamExtension } from "@peppol/api/teams/get-team-extension";
import type { Company, CompanyFormData } from "@peppol/types/company";

const companiesClient = rc<Companies>("peppol");
const teamsClient = rc<GetTeamExtension>("v1");

export default function CompanyOnboarding({ onComplete }: { onComplete: () => Promise<void> }) {
    const activeTeam = useActiveTeam();
    const isPlayground = useIsPlayground();
    const [initialData, setInitialData] = useState<Partial<CompanyFormData> | undefined>(undefined);
    const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
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
                const prefill = await resolveCompanyPrefill(activeTeam.id);
                if (prefill) {
                    setPrefillNotice(prefill.notice ?? null);
                    setInitialData(prefill.values);
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
            {prefillNotice && (
                <p className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-md text-center">
                    {prefillNotice}
                </p>
            )}
            <CreateCompanyWizard
                teamId={activeTeam.id}
                verificationRequirements={verificationRequirements}
                initialData={initialData}
                onComplete={handleComplete}
                onCancel={handleCancel}
                offerSetUpLater
            />
        </div>
        </div>
    );
}
