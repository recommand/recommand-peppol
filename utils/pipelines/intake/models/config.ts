// The models of document intake. The ids are pinned: a moving alias could change the
// results without a change here. The thresholds are start values; tune them with the
// attempt rows, because the probabilities are not calibrated.

/**
 * Classifies a PDF from its text layer: Jev from TypeSafe AI, through the Vercel AI
 * Gateway. Jev takes only images as files, so it does not get the PDF itself.
 */
export const JEV_MODEL_ID = "typesafe-ai/jev-1.14.0";
/**
 * Extracts the document content from a PDF with structured output, and classifies a
 * PDF without a text layer.
 */
export const EXTRACTION_MODEL_ID = "anthropic/claude-haiku-5.5";

/** Below this probability for the best type, classification is uncertain. */
export const CLASSIFICATION_THRESHOLD = 0.5;
/** The characters of the text layer that go into the classification state. */
export const CLASSIFICATION_TEXT_LIMIT = 8000;
/** A model call that takes longer is aborted and retried later. */
export const MODEL_CALL_TIMEOUT_MS = 2 * 60 * 1000;

/** The gateway's standard variable. Without it, no model is available. */
export const AI_GATEWAY_API_KEY = "AI_GATEWAY_API_KEY";

/** Options of every model call: no retention at the provider, and no retries in the SDK. */
export const MODEL_CALL_OPTIONS = {
  // The worker retries with backoff, so the SDK does not.
  maxRetries: 0,
  providerOptions: { gateway: { zeroDataRetention: true } },
} as const;
