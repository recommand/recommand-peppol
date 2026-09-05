import { UserFacingError } from '@directory/utils/util';
import { getVerificationCountryRequirements, validateVerificationCountrySpecific, type VerificationCountrySpecific } from '@peppol/types/verification-country-specific';

export type VerificationSubmission = {
  firstName: string;
  lastName: string;
  mandateAcceptedAt: Date | null;
  countrySpecific: VerificationCountrySpecific | null;
};

export async function submitVerificationIdentity(input: {
  company: { country: string; enterpriseNumber: string | null; isSmpRecipient: boolean };
  firstName: string;
  lastName: string;
  mandateRequired: boolean;
  mandateAccepted: boolean;
  countrySpecific?: VerificationCountrySpecific | null;
}, dependencies: {
  claimOpenedSubmission: (snapshot: VerificationSubmission) => Promise<boolean>;
  startIdentityVerification: () => Promise<string>;
}): Promise<string> {
  if (input.mandateRequired && !input.mandateAccepted) {
    throw new UserFacingError('The mandate has to be signed before the identity check can start.');
  }
  const requirements = getVerificationCountryRequirements(input.company.country, input.mandateRequired, input.company.isSmpRecipient);
  const countrySpecific = validateVerificationCountrySpecific(input.company, input.countrySpecific, requirements?.required);
  const claimed = await dependencies.claimOpenedSubmission({
    firstName: input.firstName,
    lastName: input.lastName,
    mandateAcceptedAt: input.mandateRequired ? new Date() : null,
    countrySpecific,
  });
  if (!claimed) throw new UserFacingError('This verification has already been submitted.');
  return dependencies.startIdentityVerification();
}
