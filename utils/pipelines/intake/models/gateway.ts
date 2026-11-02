import { createGateway } from "ai";
import { AI_GATEWAY_API_KEY } from "./config";

/** The AI gateway all intake models go through, or null without an API key. */
export function createIntakeGateway(apiKey = process.env[AI_GATEWAY_API_KEY]) {
  return apiKey ? createGateway({ apiKey }) : null;
}
