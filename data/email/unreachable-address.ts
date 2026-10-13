import { Errors } from "postmark";

export function isUnreachableEmailAddressError(error: unknown): boolean {
  if (error instanceof Errors.InactiveRecipientsError) {
    return true;
  }
  return (
    error instanceof Errors.ApiInputError &&
    error.code === Errors.ApiInputError.ERROR_CODES.invalidEmailRequest &&
    /'To'/i.test(error.message)
  );
}
