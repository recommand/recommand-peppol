import { useEffect, useState } from "react";
import { rc } from "@recommand/lib/client";
import { useActiveTeam } from "@core/hooks/user";
import type { Companies } from "@peppol/api/companies";

const client = rc<Companies>("peppol");

/** The companies of the active team, by id and name; null while loading. */
export function useCompanies(): { id: string; name: string }[] | null {
  const activeTeam = useActiveTeam();
  const [companies, setCompanies] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!activeTeam?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await client[":teamId"]["companies"].$get({ param: { teamId: activeTeam.id }, query: {} });
        const json = await response.json();
        if (cancelled) return;
        setCompanies(
          json.success && Array.isArray(json.companies)
            ? json.companies.map((company: { id: string; name: string }) => ({ id: company.id, name: company.name }))
            : [],
        );
      } catch {
        if (!cancelled) setCompanies([]);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeTeam?.id]);
  return companies;
}
