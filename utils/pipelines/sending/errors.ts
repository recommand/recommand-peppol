export class SendingFailure extends Error {
  constructor(
    message: string | Record<string, string[]>,
    readonly status: 400 | 422,
    /** Extra fields returned next to the errors, such as why a delivery failed. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(typeof message === "string" ? message : JSON.stringify(message));
    this.payload = message;
  }

  readonly payload: string | Record<string, string[]>;
}
