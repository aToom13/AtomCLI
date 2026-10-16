import type { Session } from "@/core/session"
import { ModelAvailability } from "@/integrations/provider/availability"
import { Provider } from "@/integrations/provider/provider"
import { modelIsRoutable } from "../model-router"

export type ModelReference = { providerID: string; modelID: string }

export function parseModelSpecifier(value: string): ModelReference {
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid model format: ${value}. Use "provider/model" (e.g. "atomcli/minimax-m2.5-free")`)
  }
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

export function preferredModel(
  explicit: ModelReference | undefined,
  configured: ModelReference | undefined,
  routed: ModelReference,
): ModelReference {
  return explicit ?? configured ?? routed
}

export function canonicalReference(
  requested: ModelReference,
  resolved: { options?: Record<string, any> },
): ModelReference {
  if (requested.providerID !== "atomcli" || !["atomcli-auto", "atomcli-free"].includes(requested.modelID)) {
    return requested
  }
  const primary = resolved.options?._fallbackChain?.primary
  if (!primary || typeof primary.providerID !== "string" || typeof primary.modelID !== "string") {
    throw new Error(`Model alias ${requested.providerID}/${requested.modelID} did not resolve to a usable model`)
  }
  return { providerID: primary.providerID, modelID: primary.modelID }
}

export function executionReference(requested: ModelReference, canonical: ModelReference): ModelReference {
  if (requested.providerID === "atomcli" && ["atomcli-auto", "atomcli-free"].includes(requested.modelID)) {
    return requested
  }
  return canonical
}

export async function canonicalModel(
  reference: ModelReference,
  session?: Session.Info,
  prompt?: string,
): Promise<ModelReference> {
  const resolved = await Provider.getModel(reference.providerID, reference.modelID, { session, prompt, verify: true })
  const canonical = canonicalReference(reference, resolved)
  await validateModel(canonical)
  return executionReference(reference, canonical)
}

export async function validateModel(reference: ModelReference) {
  const provider = await Provider.getProvider(reference.providerID)
  if (!provider) throw new Error(`Unknown model provider: ${reference.providerID}`)
  const model = provider.models[reference.modelID]
  if (!model) throw new Error(`Unknown model: ${reference.providerID}/${reference.modelID}`)
  const availability = ModelAvailability.active(model.availability)
  if (availability) throw new Error(availabilityMessage(reference, availability))
  if (!modelIsRoutable(model)) {
    throw new Error(
      `Unusable model: ${reference.providerID}/${reference.modelID} must support text input/output and declare positive context/output limits`,
    )
  }
  return model
}

export async function modelTemporaryAvailability(reference: ModelReference) {
  const provider = await Provider.getProvider(reference.providerID)
  return ModelAvailability.active(provider?.models[reference.modelID]?.availability)
}

export function availabilityMessage(reference: ModelReference, availability: ModelAvailability.Info) {
  const state = availability.status === "rate_limited" ? "rate limited" : "temporarily unavailable"
  return `Model ${reference.providerID}/${reference.modelID} is ${state} (${ModelAvailability.retryLabel(availability)})`
}
