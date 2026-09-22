/** The same write path as remember(), exposed as named durable steps. */

import {
  embedGraph,
  extractMarkdown,
  hashNote,
  noteIsUnchanged,
  writeGraph,
} from "./pipeline.ts";
import type { CloudneeDeps, RememberInput, RememberResult } from "./types.ts";

export interface WorkflowStep {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Runs hash → (unchanged short-circuit) → extract → write → embed.
 * The unchanged probe is not a step; it re-hashes and reads D1 inline.
 */
export async function cognifySteps(
  deps: CloudneeDeps,
  input: RememberInput,
  step: WorkflowStep,
): Promise<RememberResult> {
  const hash = await step.do("hash", () => hashNote(input.markdown));
  if (await noteIsUnchanged(deps.store, input.orgId, input.path, hash)) {
    return { status: "unchanged", hash, edgeIds: [] };
  }
  const extraction = await step.do("extract", () => extractMarkdown(deps.extractor, input.markdown));
  const edgeIds = await step.do("write", () => writeGraph(deps, input, extraction, hash));
  await step.do("embed", () => embedGraph(deps, input.orgId));
  return { status: "written", hash, edgeIds };
}
