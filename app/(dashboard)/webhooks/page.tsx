import { RulesManagementPage } from "@core/components/rules/rules-management-page";
import type { Companies } from "@peppol/api/companies";
import type { Labels } from "@peppol/api/labels";
import { useActiveTeam } from "@core/hooks/user";
import { toast } from "@core/components/ui/sonner";
import { rc } from "@recommand/lib/client";
import { useEffect, useState } from "react";
import { useTranslation } from "@core/hooks/use-translation";

const companiesClient = rc<Companies>("v1");
const labelsClient = rc<Labels>("v1");

type CompanyOption = {
  id: string;
  name: string;
};

type LabelOption = {
  value: string;
  label: string;
};

export default function Page() {
  const activeTeam = useActiveTeam();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [labels, setLabels] = useState<LabelOption[]>([]);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      if (!activeTeam?.id) {
        setCompanies([]);
        setLabels([]);
        return;
      }

      try {
        const [companiesResponse, labelsResponse] = await Promise.all([
          companiesClient[":teamId"].companies.$get({
            param: { teamId: activeTeam.id },
            query: {},
          }),
          labelsClient[":teamId"].labels.$get({
            param: { teamId: activeTeam.id },
          }),
        ]);

        const [companiesJson, labelsJson] = await Promise.all([
          companiesResponse.json(),
          labelsResponse.json(),
        ]);

        if (!companiesJson.success || !Array.isArray(companiesJson.companies)) {
          throw new Error("Invalid companies response");
        }
        if (!labelsJson.success || !Array.isArray(labelsJson.labels)) {
          throw new Error("Invalid labels response");
        }

        if (!cancelled) {
          setCompanies(
            companiesJson.companies.map((company) => ({
              id: company.id,
              name: company.name,
            }))
          );
          setLabels(
            labelsJson.labels.map((label) => ({
              value: label.id,
              label: label.externalId
                ? `${label.name} (${label.externalId})`
                : label.name,
            }))
          );
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          toast.error(t`Failed to load rule builder options`);
          setCompanies([]);
          setLabels([]);
        }
      }
    }

    loadContext();

    return () => {
      cancelled = true;
    };
  }, [activeTeam?.id]);

  return (
    <RulesManagementPage
      title={t`Webhooks and rules`}
      description={t`Create webhooks and automations that react to Peppol events.`}
      breadcrumbs={[{ label: "Peppol" }, { label: t`Webhooks and rules` }]}
      conditionOptions={{
        company: companies.map((company) => ({
          value: company.id,
          label: company.name,
        })),
        label: labels,
      }}
    />
  );
}
