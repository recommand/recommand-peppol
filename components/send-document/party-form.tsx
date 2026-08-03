import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import type { Party } from "@peppol/utils/parsing/invoice/schemas";
import { COUNTRIES } from "@peppol/utils/countries";
import { useTranslation } from "@core/hooks/use-translation";
import { createRegionNames, regionDisplayName, sortByRegionDisplayName } from "@core/lib/regions";

interface PartyFormProps {
  party: Partial<Party>;
  onChange: (party: Partial<Party>) => void;
  required?: boolean;
  disabled?: boolean;
}

export function PartyForm({ party, onChange, required = false, disabled = false }: PartyFormProps) {
  const { t, language } = useTranslation();
  const regionNames = createRegionNames(language);
  const countryOptions = sortByRegionDisplayName(COUNTRIES, regionNames);
  const handleChange = (field: keyof Party, value: string) => {
    onChange({ ...party, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="vatNumber">
            {t`VAT Number`}{required && " *"}
          </Label>
          <Input
            id="vatNumber"
            value={party.vatNumber || ""}
            onChange={(e) => handleChange("vatNumber", e.target.value)}
            placeholder="BE1234567894"
            required={required}
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor="name">
            {t`Company Name`}{required && " *"}
          </Label>
          <Input
            id="name"
            value={party.name || ""}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder={t`Example Company`}
            required={required}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="street">
            {t`Street Address`}{required && " *"}
          </Label>
          <Input
            id="street"
            value={party.street || ""}
            onChange={(e) => handleChange("street", e.target.value)}
            placeholder={t`Main Street 123`}
            required={required}
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor="street2">{t`Street Address 2`}</Label>
          <Input
            id="street2"
            value={party.street2 || ""}
            onChange={(e) => handleChange("street2", e.target.value)}
            placeholder={t`Suite 100`}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="city">
            {t`City`}{required && " *"}
          </Label>
          <Input
            id="city"
            value={party.city || ""}
            onChange={(e) => handleChange("city", e.target.value)}
            placeholder={t`Brussels`}
            required={required}
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor="postalZone">
            {t`Postal Code`}{required && " *"}
          </Label>
          <Input
            id="postalZone"
            value={party.postalZone || ""}
            onChange={(e) => handleChange("postalZone", e.target.value)}
            placeholder="1000"
            required={required}
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor="country">
            {t`Country`}{required && " *"}
          </Label>
          <Select
            value={party.country || ""}
            onValueChange={(value) => handleChange("country", value)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder={t`Select country`} />
            </SelectTrigger>
            <SelectContent>
              {countryOptions.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.flag} {regionDisplayName(regionNames, country.code, country.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
