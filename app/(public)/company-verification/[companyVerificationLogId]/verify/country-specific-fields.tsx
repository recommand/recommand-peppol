import { Input } from '@core/components/ui/input';
import { Label } from '@core/components/ui/label';
import { Card, CardContent } from '@core/components/ui/card';
import { useTranslation } from '@core/hooks/use-translation';
import type { VerificationCountrySpecific, VerificationCountryRequirements } from '@peppol/types/verification-country-specific';

export function CountrySpecificFields({ requirements, value, onChange }: {
  requirements: VerificationCountryRequirements;
  value: VerificationCountrySpecific | null;
  onChange: (value: VerificationCountrySpecific | null) => void;
}) {
  const { t } = useTranslation();
  if (requirements?.country !== 'FR') return null;
  return (
    <Card>
      <CardContent className="pt-6 space-y-2">
        <Label htmlFor="verification-siret">{requirements.required ? t`Establishment SIRET` : t`Establishment SIRET (Optional)`}</Label>
        <Input id="verification-siret" inputMode="numeric" value={value?.siret ?? ''}
          onChange={event => onChange(event.target.value ? { country: 'FR', siret: event.target.value } : null)} />
        <p className="text-sm text-muted-foreground">{t`The 14 digit SIRET identifies the establishment for verification. It does not add a receiving address.`}</p>
      </CardContent>
    </Card>
  );
}
