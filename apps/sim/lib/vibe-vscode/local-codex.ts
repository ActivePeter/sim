import { spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { VscodeSessionOrigin } from '@/lib/vibe-vscode/types'
import { type CodexEvent, parseCodexJsonLine } from '@/executor/handlers/codex/core/events'

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

export function localCodexArguments(cwd: string, threadId?: string): string[] {
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
  if (threadId) args.push('resume', threadId)
  args.push('-')
  return args
}

/** No shell interpolation, inherited application secrets, or destructive CODEX_HOME setup. */
export async function runLocalCodex(options: {
  cwd: string
  threadId?: string
  prompt: string
  signal: AbortSignal
  onEvent(event: CodexEvent): Promise<void>
}): Promise<void> {
  if (options.signal.aborted) throw new Error('Agent turn cancelled')
  const childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'production' }
  for (const key of [
    'HOME',
    'PATH',
    'LANG',
    'TMPDIR',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
  ]) {
    if (process.env[key]) childEnv[key] = process.env[key]
  }
  childEnv.CODEX_HOME = env.SIM_VSCODE_CODEX_HOME ?? process.env.CODEX_HOME
  const child = spawn(
    env.SIM_VSCODE_CODEX_BINARY ?? 'codex',
    localCodexArguments(options.cwd, options.threadId),
    {
      cwd: options.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    }
  )
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const kill = (signal: NodeJS.Signals) => {
    if (closed || !child.pid) return
    try {
      if (process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch {
      /* Process already exited. */
    }
  }
  const abort = () => {
    kill('SIGTERM')
    killTimer ??= setTimeout(() => kill('SIGKILL'), 3000)
  }
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', () =>
      reject(
        new Error(
          'The local Codex runner could not start. Check the configured executable and credentials.'
        )
      )
    )
    child.once('close', (code) => {
      closed = true
      if (killTimer) clearTimeout(killTimer)
      resolve(code)
    })
  })
  // Observe failures immediately, including ENOENT before the stdout loop settles.
  void completion.catch(() => {})
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) abort()
  // CLI diagnostics are not a transcript and may contain sensitive environment details.
  child.stderr.resume()
  child.stdin.on('error', () => {})
  child.stdin.end(options.prompt)
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    for await (const line of lines) {
      if (line.length > 2_000_000)
        throw new Error('The local runner exceeded the event size limit.')
      for (const event of parseCodexJsonLine(line)) await options.onEvent(event)
    }
    const code = await completion
    if (options.signal.aborted) throw new Error('Agent turn cancelled')
    if (code !== 0)
      throw new Error(
        'The local Codex runner exited unsuccessfully. Check its authentication and configuration.'
      )
  } finally {
    options.signal.removeEventListener('abort', abort)
    lines.close()
    if (!closed) {
      abort()
      await completion.catch(() => {})
    }
    if (killTimer) clearTimeout(killTimer)
  }
}
