import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ProjectAgentSettings } from '@/lib/vibe-vscode/agent-config'
import { type LocalAgentTurn, runLocalAgentProcess } from '@/lib/vibe-vscode/local-agent-process'
import type { VscodeSessionOrigin } from '@/lib/vibe-vscode/types'
import { parseCodexJsonLine } from '@/executor/handlers/codex/core/events'

function stringArray(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      Array.isArray(parsed) &&
      parsed.length <= 256 &&
      parsed.every((item) => typeof item === 'string' && item.length > 0)
    )
      return parsed
  } catch {
    /* Invalid configuration disables local execution. */
  }
  throw new OrchestrationError('forbidden', 'The local project runner configuration is invalid.')
}

export interface LocalProjectPolicy {
  roots: string[]
  remoteAuthorities: string[]
}

export function getLocalProjectPolicy(): LocalProjectPolicy {
  return {
    roots: stringArray(env.SIM_VSCODE_PROJECT_ROOTS),
    remoteAuthorities: stringArray(env.SIM_VSCODE_REMOTE_AUTHORITIES),
  }
}

export function projectPathFromUri(
  origin: VscodeSessionOrigin,
  policy: LocalProjectPolicy
): string {
  let uri: URL
  try {
    uri = new URL(origin.project.uri)
  } catch {
    throw new OrchestrationError('validation', 'Invalid project URI')
  }
  if (uri.search || uri.hash || uri.username || uri.password)
    throw new OrchestrationError('validation', 'Invalid project URI')
  if (uri.protocol === 'file:') {
    if (origin.physicalWorkspace.remoteAuthority)
      throw new OrchestrationError(
        'forbidden',
        'A remote workspace cannot select a local file project.'
      )
    try {
      return fileURLToPath(uri)
    } catch {
      throw new OrchestrationError('validation', 'Invalid local project URI')
    }
  }
  if (
    uri.protocol !== 'vscode-remote:' ||
    uri.host !== origin.physicalWorkspace.remoteAuthority ||
    !policy.remoteAuthorities.includes(uri.host)
  ) {
    throw new OrchestrationError(
      'forbidden',
      'This VS Code remote authority is not mapped to the local Sim runner.'
    )
  }
  try {
    return decodeURIComponent(uri.pathname)
  } catch {
    throw new OrchestrationError('validation', 'Invalid remote project URI')
  }
}

export async function resolveLocalProject(
  origin: VscodeSessionOrigin,
  policy = getLocalProjectPolicy()
): Promise<string> {
  const projectPath = projectPathFromUri(origin, policy)
  if (!isAbsolute(projectPath) || projectPath.includes('\0') || !policy.roots.length) {
    throw new OrchestrationError(
      'forbidden',
      'Local project execution is not configured for this project.'
    )
  }
  let resolved: string
  try {
    resolved = await realpath(projectPath)
  } catch {
    throw new OrchestrationError(
      'not_found',
      'The project directory is unavailable on the Sim runner.'
    )
  }
  for (const root of policy.roots) {
    if (!isAbsolute(root)) continue
    const canonicalRoot = await realpath(root).catch(() => null)
    if (!canonicalRoot) continue
    const path = relative(canonicalRoot, resolved)
    if (
      (path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))) &&
      (await stat(resolved)).isDirectory()
    )
      return resolved
  }
  throw new OrchestrationError(
    'forbidden',
    'The project is outside the configured local runner roots.'
  )
}

export function localCodexArguments(
  cwd: string,
  threadId?: string,
  settings?: Pick<ProjectAgentSettings, 'model' | 'reasoningEffort'>
): string[] {
  const args = [
    'exec',
    '--json',
    '--color',
    'never',
    '--sandbox',
    env.SIM_VSCODE_CODEX_SANDBOX ?? 'read-only',
    '--skip-git-repo-check',
    '-c',
    'approval_policy="never"',
    '-c',
    'features.multi_agent=false',
    '-C',
    cwd,
  ]
  if (settings?.model) args.push('--model', settings.model)
  if (settings?.reasoningEffort)
    args.push('-c', `model_reasoning_effort="${settings.reasoningEffort}"`)
  if (threadId) args.push('resume', threadId)
  args.push('-')
  return args
}

/** No shell interpolation, inherited application secrets, or destructive CODEX_HOME setup. */
export async function runLocalCodex(
  options: LocalAgentTurn & { settings?: ProjectAgentSettings }
): Promise<void> {
  await runLocalAgentProcess({
    ...options,
    executable: env.SIM_VSCODE_CODEX_BINARY ?? 'codex',
    label: 'Codex',
    args: localCodexArguments(options.cwd, options.threadId, options.settings),
    environment: { CODEX_HOME: env.SIM_VSCODE_CODEX_HOME ?? process.env.CODEX_HOME },
    parseLine: parseCodexJsonLine,
  })
}
