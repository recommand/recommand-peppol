import type { Company } from "@peppol/data/companies";
import { type ImportFile, readImportFile } from "@peppol/data/imports/files";
import type { Import } from "@peppol/data/imports/imports";
import {
  type ImportResult,
  ignoreResult,
  publishFailedResult,
  recordAttempt,
  saveResultCheckpoints,
} from "@peppol/data/imports/results";
import { PermanentStageError } from "./stages/attempt";
import { checkStage } from "./stages/check";
import { classifyStage } from "./stages/classify";
import { extractStage } from "./stages/extract";
import { publishStage } from "./stages/publish";
import { structuredStage } from "./stages/structured";
import { textStage } from "./stages/text";
import type { Checkpoints, ResultContext, Stage, StageOutcome } from "./types";

/** The stages of one result, in order. Each reads the checkpoints of the stages before it. */
export const STAGES: Stage[] = [structuredStage, textStage, classifyStage, extractStage, checkStage, publishStage];

export function createResultContext(options: {
  importRow: Import;
  company: Company;
  result: ImportResult;
  files: ImportFile[];
  onProgress?: () => Promise<void>;
}): ResultContext {
  const files = new Map(options.files.map((file) => [file.id, file]));
  const primary = options.result.locations.find((location) => location.role === "primary")!;
  const bytes = new Map<string, Promise<Buffer>>();
  const context: ResultContext = {
    importRow: options.importRow,
    company: options.company,
    result: { ...options.result, locations: [...options.result.locations] },
    checkpoints: { ...(options.result.checkpoints as Checkpoints) },
    files,
    primaryFile: files.get(primary.fileId)!,
    readFile: (fileId) => {
      if (!bytes.has(fileId)) {
        const read = readImportFile(files.get(fileId)!);
        read.catch(() => bytes.delete(fileId));
        bytes.set(fileId, read);
      }
      return bytes.get(fileId)!;
    },
    addLocation: (location) => {
      if (!context.result.locations.some((existing) => existing.fileId === location.fileId)) {
        context.result.locations.push(location);
      }
    },
    addFile: (file) => files.set(file.id, file),
    recordAttempt: (attempt) =>
      recordAttempt({ ...attempt, importId: options.importRow.id, resultId: options.result.id }),
    progress: options.onProgress ?? (async () => {}),
  };
  return context;
}

/** A permanent error of a stage is its failure; any other error is thrown and retried. */
async function runStage(stage: Stage, context: ResultContext): Promise<StageOutcome> {
  try {
    return await stage.run(context);
  } catch (error) {
    if (error instanceof PermanentStageError) {
      return { failure: error.failure };
    }
    throw error;
  }
}

/**
 * Run the stages of one result from its first stage without a checkpoint. A stage's
 * checkpoint is saved before the next stage starts, so a retry does not repeat a model
 * call. A failure or an ignored result ends it; so does publication.
 */
export async function runResult(context: ResultContext): Promise<void> {
  const save = () =>
    saveResultCheckpoints(context.result.id, context.checkpoints, context.result.locations);
  for (const stage of STAGES) {
    if (stage.name in context.checkpoints || (stage.applies && !stage.applies(context))) {
      continue;
    }
    const outcome = await runStage(stage, context);
    if ("checkpoint" in outcome) {
      (context.checkpoints as Record<string, unknown>)[stage.name] = outcome.checkpoint;
      await save();
      await context.progress();
      continue;
    }
    if ("failure" in outcome) {
      await save();
      await publishFailedResult(context.importRow.id, context.result.id, outcome.failure);
    } else if ("ignored" in outcome) {
      await save();
      await ignoreResult(context.result.id, outcome.ignored);
    }
    return;
  }
}
