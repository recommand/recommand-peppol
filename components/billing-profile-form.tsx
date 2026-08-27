import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@core/components/ui/select";
import { COUNTRIES } from "@peppol/utils/countries";
import { useTranslation } from "@core/hooks/use-translation";
import { createRegionNames, regionDisplayName, sortByRegionDisplayName } from "@core/lib/regions";

export type BillingProfileFormData = {
  companyName: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  vatNumber: string | null;
  billingEmail: string | null;
  billingPeppolAddress: string | null;
};

type BillingProfileFormProps = {
  profileForm: BillingProfileFormData;
  onChange: (form: BillingProfileFormData) => void;
  onCancel?: () => void;
  onSubmit?: () => void;
};

export const DEFAULT_BILLING_PROFILE_FORM_DATA: BillingProfileFormData = {
  companyName: "",
  address: "",
  postalCode: "",
  city: "",
  country: "BE",
  vatNumber: null,
  billingEmail: null,
  billingPeppolAddress: null,
};

export function BillingProfileForm({ profileForm, onChange, onCancel, onSubmit }: BillingProfileFormProps) {
  const { t, language } = useTranslation();
  const regionNames = createRegionNames(language);
  const countryOptions = sortByRegionDisplayName(COUNTRIES, regionNames);
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="companyName">{t`Company Name`}</Label>
        <Input
          id="companyName"
          value={profileForm.companyName}
          onChange={(e) => onChange({ ...profileForm, companyName: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">{t`Address`}</Label>
        <Input
          id="address"
          value={profileForm.address}
          onChange={(e) => onChange({ ...profileForm, address: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="postalCode">{t`Postal Code`}</Label>
          <Input
            id="postalCode"
            value={profileForm.postalCode}
            onChange={(e) => onChange({ ...profileForm, postalCode: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="city">{t`City`}</Label>
          <Input
            id="city"
            value={profileForm.city}
            onChange={(e) => onChange({ ...profileForm, city: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="country">{t`Country`}</Label>
        <Select
          value={profileForm.country}
          onValueChange={(value) => onChange({ ...profileForm, country: value })}
        >
          <SelectTrigger>
            <SelectValue />
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
      <div className="space-y-2">
        <Label htmlFor="vatNumber">{t`VAT Number (Optional)`}</Label>
        <Input
          id="vatNumber"
          value={profileForm.vatNumber || ''}
          onChange={(e) => {
            const value = e.target.value.trim();
            if (value === '') {
              onChange({ ...profileForm, vatNumber: null });
            } else {
              onChange({ ...profileForm, vatNumber: value });
            }
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="billingEmail">{t`Billing Email (Optional)`}</Label>
        <Input
          id="billingEmail"
          type="email"
          value={profileForm.billingEmail || ''}
          placeholder="billing@example.com"
          onChange={(e) => {
            const value = e.target.value.trim();
            if (value === '') {
              onChange({ ...profileForm, billingEmail: null });
            } else {
              onChange({ ...profileForm, billingEmail: value });
            }
          }}
        />
        <p className="text-sm text-muted-foreground">
          {t`Email address to receive invoices. If not set, invoices will be sent to all team members.`}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="billingPeppolAddress">{t`Billing Peppol Address (Optional)`}</Label>
        <Input
          id="billingPeppolAddress"
          value={profileForm.billingPeppolAddress || ''}
          placeholder="0208:1234567890"
          onChange={(e) => {
            const value = e.target.value.trim();
            if (value === '') {
              onChange({ ...profileForm, billingPeppolAddress: null });
            } else {
              onChange({ ...profileForm, billingPeppolAddress: value });
            }
          }}
        />
        <p className="text-sm text-muted-foreground">
          {t`Peppol address for invoice delivery. If not set, we will try to derive it from your VAT number or deliver the invoice via email.`}
        </p>
      </div>
      {(onCancel || onSubmit) && <div className="flex justify-end space-x-2 pt-4">
        {onCancel && <Button variant="outline" onClick={onCancel}>
          {t`Cancel`}
        </Button>}
        {onSubmit && <Button onClick={onSubmit}>
          {t`Save Changes`}
        </Button>}
      </div>}
    </div>
  );
}
