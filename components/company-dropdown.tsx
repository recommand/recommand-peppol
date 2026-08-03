import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { Label } from "@core/components/ui/label";
import { useTranslation } from "@core/hooks/use-translation";

interface CompanyDropdownProps {
  companies: { id: string; name: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  placeholder?: string;
}

export function CompanyDropdown({
  companies,
  value,
  onChange,
  label,
  placeholder
}: CompanyDropdownProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t`Company`;
  const resolvedPlaceholder = placeholder ?? t`All companies`;
  return (
    <div>
      <Label htmlFor="company">{resolvedLabel}</Label>
      <Select
        value={value ?? "all"}
        onValueChange={(value) => onChange(value === "all" ? null : value)}
      >
        <SelectTrigger>
          <SelectValue placeholder={resolvedPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t`All companies`}</SelectItem>
          {companies.map((company) => (
            <SelectItem key={company.id} value={company.id}>
              {company.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
