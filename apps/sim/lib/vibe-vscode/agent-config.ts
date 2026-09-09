import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const projectAgentIdSchema = z.enum(['local-codex', 'local-claude'])
export const projectAgentEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])

/** User-editable run settings never include executables, credentials, paths, or permissions. */
export const projectAgentSettingsSchema = z
  .object({
    agentId: projectAgentIdSchema,
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]*$/)
      .nullable(),
    reasoningEffort: projectAgentEffortSchema.nullable(),
    instructions: z.string().trim().max(8000),
  })
  .strict()

export const projectAgentConfigSchema = projectAgentSettingsSchema.extend({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
})

export type ProjectAgentId = z.infer<typeof projectAgentIdSchema>
export type ProjectAgentEffort = z.infer<typeof projectAgentEffortSchema>
export type ProjectAgentSettings = z.infer<typeof projectAgentSettingsSchema>
export type ProjectAgentConfig = z.infer<typeof projectAgentConfigSchema>

export const DEFAULT_PROJECT_AGENT_CONFIG: Readonly<ProjectAgentConfig> = Object.freeze({
  version: 1,
  revision: 0,
  agentId: 'local-codex',
  model: null,
  reasoningEffort: null,
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

export const projectAgentCapabilitySchema = z.object({
  id: projectAgentIdSchema,
  label: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  permissionLabel: z.string(),
  reasoningEfforts: z.array(projectAgentEffortSchema),
})
export type ProjectAgentCapability = z.infer<typeof projectAgentCapabilitySchema>
