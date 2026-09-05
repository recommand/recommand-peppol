import { z } from 'zod';
import { isSiren, isSiret } from '@peppol/utils/identifier-validation';
import { UserFacingError } from '@directory/utils/util';

export const verificationCountrySpecificSchema = z.object({
  country: z.literal('FR'),
  siret: z.string().transform(value => value.replace(/[\s.-]/g, ''))
    .refine(isSiret, 'SIRET must be a valid 14 digit establishment number'),
}).strict();

export type VerificationCountrySpecific = z.infer<typeof verificationCountrySpecificSchema>;
export type VerificationCountryRequirements = { country: 'FR'; required: boolean } | null;

export function getVerificationCountryRequirements(
  country: string,
  mandateRequired: boolean,
  isSmpRecipient: boolean,
): VerificationCountryRequirements {
  return country === 'FR' && mandateRequired ? { country: 'FR', required: isSmpRecipient } : null;
}

export function validateVerificationCountrySpecific(
  company: { country: string; enterpriseNumber: string | null },
  input: unknown,
  required = false,
): VerificationCountrySpecific | null {
  if (input == null) {
    if (required) throw new UserFacingError('An establishment SIRET is required for this verification.');
    return null;
  }
  const parsed = verificationCountrySpecificSchema.safeParse(input);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? 'Invalid country-specific verification data');
  const data = parsed.data;
  if (data.country !== company.country) throw new UserFacingError('Verification country must match the company country');
  const enterprise = company.enterpriseNumber?.replace(/[\s.-]/g, '') ?? '';
  if ((!isSiren(enterprise) && !isSiret(enterprise)) || data.siret.slice(0, 9) !== enterprise.slice(0, 9) ||
    (enterprise.length === 14 && data.siret !== enterprise)) {
    throw new UserFacingError('The establishment SIRET must match the company enterprise number');
  }
  return data;
}
