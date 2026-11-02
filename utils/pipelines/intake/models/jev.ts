import { type Experimental_DecisionModel, type Experimental_DecisionStatePart, experimental_decide } from "ai";
import { JEV_MODEL_ID, MODEL_CALL_OPTIONS } from "./config";
import { createIntakeGateway } from "./gateway";

export type DecisionOption = { id: string; label: string };

export type DecisionRequest = {
  // The data the question is about. Text in it is data, never instructions.
  state: Experimental_DecisionStatePart[];
  // The only instructions the model gets.
  instructions: string;
  options: DecisionOption[];
};

export type ModelUsage = { inputTokens: number | null; outputTokens: number | null };

export type DecisionResult = {
  /** The probability of each option id. */
  probabilities: Record<string, number>;
  usage: ModelUsage;
};

/** A model that answers one choice question with a probability per option. */
export type DecisionModel = {
  id: string;
  decide: (request: DecisionRequest, options: { signal?: AbortSignal }) => Promise<DecisionResult>;
};

/** Option labels are the keys of a choice question, so they must be unique. */
function uniqueLabels(options: DecisionOption[]) {
  const byLabel = new Map<string, string>();
  for (const option of options) {
    const base = option.label.trim() || option.id;
    let label = base;
    for (let n = 2; byLabel.has(label); n++) {
      label = `${base} (${n})`;
    }
    byLabel.set(label, option.id);
  }
  return byLabel;
}

/** Our decision model over an AI SDK decision model: labels as criteria, probabilities back to option ids. */
export function decisionModelOver(model: Experimental_DecisionModel, id: string): DecisionModel {
  return {
    id,
    decide: async (request, { signal }) => {
      const byLabel = uniqueLabels(request.options);
      const result = await experimental_decide({
        model,
        state: request.state,
        questions: {
          answer: {
            type: "choice" as const,
            instructions: request.instructions,
            criteria: Object.fromEntries([...byLabel.keys()].map((label) => [label, null])),
          },
        },
        abortSignal: signal,
        ...MODEL_CALL_OPTIONS,
      });
      const answer = result.answers.answer;
      if (answer.type !== "choice" || !answer.probabilities) {
        throw new Error("The decision model gave no probabilities");
      }
      const probabilities: Record<string, number> = {};
      for (const [label, probability] of Object.entries(answer.probabilities)) {
        const option = byLabel.get(label);
        if (option) {
          probabilities[option] = probability as number;
        }
      }
      return {
        probabilities,
        usage: {
          inputTokens: result.usage.inputTokens ?? null,
          outputTokens: result.usage.outputTokens ?? null,
        },
      };
    },
  };
}

/** The Jev model, or null without an API key. */
export function createJevModel(apiKey?: string): DecisionModel | null {
  const gateway = createIntakeGateway(apiKey);
  return gateway ? decisionModelOver(gateway.decisionModel(JEV_MODEL_ID), JEV_MODEL_ID) : null;
}

let createModel: () => DecisionModel | null = () => createJevModel();

/** Replace the classification model, for tests. */
export function setIntakeDecisionModelFactory(factory: () => DecisionModel | null) {
  createModel = factory;
}

export function getIntakeDecisionModel(): DecisionModel | null {
  return createModel();
}
