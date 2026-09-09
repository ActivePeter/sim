import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/** Provider adapters emit complete message blocks into Sim's existing native stream. */
export type LocalAgentEvent =
  | { type: 'thread_started'; threadId: string }
  | { type: 'turn_started' | 'final' | 'other' }
  | { type: 'text' | 'thinking'; text: string }
  | { type: 'tool_start'; id: string; toolName: string; summary?: string }
  | { type: 'tool_end'; id: string; toolName: string; isError: boolean; output?: string }
  | {
      type: 'usage'
      inputTokens: number
      cachedInputTokens: number
      cacheWriteInputTokens: number
      outputTokens: number
      reasoningOutputTokens: number
    }
  | { type: 'error'; message: string }

export interface LocalAgentTurn {
  cwd: string
  threadId?: string
  prompt: string
  signal: AbortSignal
  onEvent(event: LocalAgentEvent): Promise<void>
}

/** Owns the process group and cleanup once, independently of each runner's JSONL protocol. */
export async function runLocalAgentProcess(
  options: LocalAgentTurn & {
    executable: string
    label: string
    args: string[]
    environment: Record<string, string | undefined>
    parseLine(line: string): readonly LocalAgentEvent[]
  }
): Promise<void> {
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
  Object.assign(childEnv, options.environment)
  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const kill = (signal: NodeJS.Signals) => {
    if (closed || !child.pid) return
    try {
      if (process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch {
      /** Process already exited. */
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
          `The local ${options.label} runner could not start. Check its executable and credentials.`
        )
      )
    )
    child.once('close', (code) => {
      closed = true
      if (killTimer) clearTimeout(killTimer)
      resolve(code)
    })
  })
  /** Observe ENOENT immediately, even before the stdout loop settles. */
  void completion.catch(() => {})
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) abort()
  /** Diagnostics may contain credentials or paths; they are never a transcript. */
  child.stderr.resume()
  child.stdin.on('error', () => {})
  child.stdin.end(options.prompt)
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    for await (const line of lines) {
      if (line.length > 2_000_000)
        throw new Error('The local runner exceeded the event size limit.')
      for (const event of options.parseLine(line)) await options.onEvent(event)
    }
    const code = await completion
    if (options.signal.aborted) throw new Error('Agent turn cancelled')
    if (code !== 0) {
      throw new Error(
        `The local ${options.label} runner exited unsuccessfully. Check its authentication and configuration.`
      )
    }
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
