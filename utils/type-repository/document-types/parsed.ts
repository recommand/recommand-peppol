import type { documentTypes } from ".";
import type { ParsedDocumentOf } from "./types";

/**
 * Every shape a stored `parsed` document can take, derived from the registry
 * rather than listed by hand. A document type that declares a `documentSchema`
 * is part of this union automatically.
 *
 * This module is types only, so importing it from the database schema costs no
 * runtime dependency on the registry.
 */
export type ParsedDocument = ParsedDocumentOf<(typeof documentTypes)[number]>;
