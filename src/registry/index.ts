/**
 * The model registry: every model the studio can run, as data.
 * To add a model, add one entry in `image.ts`, `video.ts` or `audio.ts`. The composer,
 * the live price, validation and the provider call all follow from that entry.
 */
import { musicModels, speechModels } from "./audio";
import { imageModels } from "./image";
import { kieModels } from "./kie/models";
import { videoModels } from "./video";
import type { ModelDef } from "./types";

const base: ModelDef[] = [...imageModels, ...videoModels, ...speechModels, ...musicModels];
const kieById = new Map(kieModels.map((m) => [m.id, m]));
const baseIds = new Set(base.map((m) => m.id));

/** kie.ai models take the place of the base models with the same id, and add the new ones. */
export const models: ModelDef[] = [...base.map((m) => kieById.get(m.id) ?? m), ...kieModels.filter((m) => !baseIds.has(m.id))];

const byId = new Map(models.map((m) => [m.id, m]));

export function getModel(id: string | null | undefined): ModelDef | undefined {
  return id ? byId.get(id) : undefined;
}

/** Models for one studio or tool, in display order. */
export function modelsFor(surface: string): ModelDef[] {
  return models.filter((m) => m.surfaces.includes(surface));
}

/** The model a surface opens on: the first featured one that can run. */
export function defaultModel(surface: string): ModelDef | undefined {
  const list = modelsFor(surface).filter((m) => m.status === "available");
  return list.find((m) => m.featured) ?? list[0];
}

export * from "./types";
export * from "./logic";
export { quoteUsd, catalogEndpoint, knownEndpoint, isKie } from "./quote";
