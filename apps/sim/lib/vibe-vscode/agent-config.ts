import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const projectAgentIdSchema = z.enum(['local-codex', 'local-claude'])
export const projectAgentPermissionModeSchema = z.enum([
  'read-only',
  'workspace-write',
  'danger-full-access',
])
/** Runners own the effort vocabulary; catalog membership is checked before saving or executing. */
export const projectAgentEffortSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/)
export const projectAgentModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]*$/)

/** Permission choices are bounded profiles, never arbitrary runner flags, paths, or credentials. */
export const projectAgentSettingsSchema = z
  .object({
    agentId: projectAgentIdSchema,
    model: projectAgentModelIdSchema.nullable(),
    reasoningEffort: projectAgentEffortSchema.nullable(),
    permissionMode: projectAgentPermissionModeSchema.nullable(),
    instructions: z.string().trim().max(8000),
  })
  .strict()

export const projectAgentConfigSchema = projectAgentSettingsSchema.extend({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  /** Legacy stored configurations retain the deployment default; writes must choose explicitly. */
  permissionMode: projectAgentPermissionModeSchema.nullable().default(null),
})

export type ProjectAgentId = z.infer<typeof projectAgentIdSchema>
export type ProjectAgentEffort = z.infer<typeof projectAgentEffortSchema>
export type ProjectAgentPermissionMode = z.infer<typeof projectAgentPermissionModeSchema>
export type ProjectAgentSettings = z.infer<typeof projectAgentSettingsSchema>
export type ProjectAgentConfig = z.infer<typeof projectAgentConfigSchema>

export const DEFAULT_PROJECT_AGENT_CONFIG: Readonly<ProjectAgentConfig> = Object.freeze({
  version: 1,
  revision: 0,
  agentId: 'local-codex',
  model: null,
  reasoningEffort: null,
  permissionMode: null,
  instructions: '',
})

/** Missing legacy bindings retain Codex; corrupt or future data never silently changes runtime. */
export function readProjectAgentConfig(value: unknown): Readonly<ProjectAgentConfig> {
  if (value === null || value === undefined) return DEFAULT_PROJECT_AGENT_CONFIG
  const result = projectAgentConfigSchema.safeParse(value)
  if (!result.success) {
    throw new OrchestrationError('conflict', 'The saved project Agent configuration is invalid.')
  }
  return Object.freeze(result.data)
}

export function isProjectAgentLocked(binding: {
  lastTurnId: string | null
  runtimeThreadId: string | null
}): boolean {
  return Boolean(binding.lastTurnId || binding.runtimeThreadId)
}

export const projectAgentModelSchema = z
  .object({
    id: projectAgentModelIdSchema,
    aliases: z.array(projectAgentModelIdSchema).max(16).optional(),
    label: z.string().min(1).max(200),
    description: z.string().max(2000),
    reasoningEfforts: z.array(projectAgentEffortSchema).max(32),
    defaultReasoningEffort: projectAgentEffortSchema.nullable(),
  })
  .refine(
    (model) =>
      new Set(model.reasoningEfforts).size === model.reasoningEfforts.length &&
      (model.defaultReasoningEffort === null ||
        model.reasoningEfforts.includes(model.defaultReasoningEffort)),
    { message: 'Runner model defaults must belong to its supported effort levels' }
  )
export const projectAgentModelsSchema = z
  .array(projectAgentModelSchema)
  .min(1)
  .max(256)
  .refine((models) => new Set(models.map((model) => model.id)).size === models.length, {
    message: 'Runner model identifiers must be unique',
  })
export const projectAgentModelCatalogSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), models: projectAgentModelsSchema }),
  z.object({ status: z.literal('error'), message: z.string().min(1).max(500) }),
])
export type ProjectAgentModel = z.infer<typeof projectAgentModelSchema>
export type ProjectAgentModelCatalog = z.infer<typeof projectAgentModelCatalogSchema>

export const projectAgentPermissionPolicySchema = z
  .object({
    defaultMode: projectAgentPermissionModeSchema.exclude(['danger-full-access']),
    description: z.string().min(1).max(500),
    modes: z
      .array(
        z.object({
          id: projectAgentPermissionModeSchema,
          label: z.string().min(1).max(100),
          description: z.string().min(1).max(500),
        })
      )
      .min(1)
      .max(3),
  })
  .refine(
    (policy) =>
      new Set(policy.modes.map((mode) => mode.id)).size === policy.modes.length &&
      policy.modes.some((mode) => mode.id === policy.defaultMode),
    { message: 'The deployment permission default must belong to its distinct allowed modes' }
  )
export type ProjectAgentPermissionPolicy = z.infer<typeof projectAgentPermissionPolicySchema>

export const projectAgentCapabilitySchema = z.object({
  id: projectAgentIdSchema,
  label: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  permissions: projectAgentPermissionPolicySchema,
  modelCatalog: projectAgentModelCatalogSchema,
})
export type ProjectAgentCapability = z.infer<typeof projectAgentCapabilitySchema>

export function getProjectAgentPermission(
  policy: ProjectAgentPermissionPolicy | undefined,
  mode: ProjectAgentPermissionMode | null | undefined
) {
  return policy?.modes.find((option) => option.id === (mode ?? policy.defaultMode))
}

/** The runtime default is deliberately not a concrete model/effort pairing. */
export function getProjectAgentModel(
  catalog: ProjectAgentModelCatalog | undefined,
  model: string | null | undefined
): ProjectAgentModel | undefined {
  if (!model || catalog?.status !== 'ready') return undefined
  return (
    catalog.models.find((candidate) => candidate.id === model) ??
    catalog.models.find((candidate) => candidate.aliases?.includes(model))
  )
}
