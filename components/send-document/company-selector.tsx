import { useEffect, useState, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { rc } from "@recommand/lib/client";
import { useActiveTeam } from "@core/hooks/user";
import { toast } from "@core/components/ui/sonner";
import type { Companies } from "@peppol/api/companies";
import { useTranslation } from "@core/hooks/use-translation";

const companiesClient = rc<Companies>("peppol");

interface CompanySelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function CompanySelector({ value, onChange }: CompanySelectorProps) {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const activeTeam = useActiveTeam();
  const isInitialMount = useRef(true);

  useEffect(() => {
    const fetchCompanies = async () => {
      if (!activeTeam?.id) {
        setCompanies([]);
        setIsLoading(false);
        return;
      }

      try {
        const response = await companiesClient[":teamId"]["companies"].$get({
          param: { teamId: activeTeam.id },
          query: {},
        });
        const json = await response.json();

        if (!json.success || !Array.isArray(json.companies)) {
          toast.error(t`Failed to load companies`);
          setCompanies([]);
        } else {
          const companiesList = json.companies.map(
            (company: { id: string; name: string }) => ({
              id: company.id,
              name: company.name,
            })
          );
          setCompanies(companiesList);
        }
      } catch (error) {
        toast.error(t`Failed to load companies`);
        setCompanies([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCompanies();
  }, [activeTeam?.id]);

  useEffect(() => {
    if (!hasAutoSelected && !value && companies.length > 0) {
      onChange(companies[0].id);
      setHasAutoSelected(true);
    }
  }, [companies, hasAutoSelected, onChange]);

  if (isLoading) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder={t`Loading companies...`} />
        </SelectTrigger>
      </Select>
    );
  }

  if (companies.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder={t`No companies available`} />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(newValue) => {
        // Skip the initial mount call with empty value
        if (isInitialMount.current && newValue === "") {
          isInitialMount.current = false;
          return;
        }

        // Only call onChange if we have a valid value and it's different
        if (newValue && newValue !== value) {
          onChange(newValue);
        }
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder={t`Select a company`} />
      </SelectTrigger>
      <SelectContent>
        {companies.map((company) => (
          <SelectItem key={company.id} value={company.id}>
            {company.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
