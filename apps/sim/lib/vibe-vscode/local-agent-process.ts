import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'
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

interface LocalAgentProcessOptions {
  executable: string
  label: string
  args: string[]
  environment: Record<string, string | undefined>
  cwd: string
}

/** Turns and capability discovery share the credential boundary and process-group release owner. */
function startLocalAgentProcess(options: LocalAgentProcessOptions) {
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
  const supervisor = process.env.SIM_VSCODE_PROCESS_SUPERVISOR
  if (process.env.SIM_VSCODE_PLUGIN === 'true' && (!supervisor || !isAbsolute(supervisor))) {
    throw new Error('The plugin agent process owner is unavailable.')
  }
  const child = spawn(
    supervisor || options.executable,
    supervisor ? [options.executable, ...options.args] : options.args,
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
      if (supervisor || process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch {
      /** Process already exited. */
    }
  }
  const terminate = () => {
    if (closed) return
    kill('SIGTERM')
    /** The packaged supervisor escalates its own descendants and must remain alive to reap them. */
    if (!supervisor) killTimer ??= setTimeout(() => kill('SIGKILL'), 3000)
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
  /** Diagnostics may contain credentials or paths; they are never a transcript. */
  child.stderr.resume()
  child.stdin.on('error', () => {})
  return { child, completion, terminate }
}

/** Owns the process group and cleanup once, independently of each runner's JSONL protocol. */
export async function runLocalAgentProcess(
  options: LocalAgentTurn &
    LocalAgentProcessOptions & {
      parseLine(line: string): readonly LocalAgentEvent[]
    }
): Promise<void> {
  if (options.signal.aborted) throw new Error('Agent turn cancelled')
  const { child, completion, terminate } = startLocalAgentProcess(options)
  options.signal.addEventListener('abort', terminate, { once: true })
  if (options.signal.aborted) terminate()
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
    options.signal.removeEventListener('abort', terminate)
    lines.close()
    terminate()
    await completion.catch(() => {})
  }
}

/** Bounded, stdio-only discovery never sends a user prompt or enters a project directory. */
export async function queryLocalAgentProcess<T>(
  options: Omit<LocalAgentProcessOptions, 'cwd'> & {
    initialMessage: Record<string, unknown>
    onMessage(message: unknown, send: (message: Record<string, unknown>) => void): T | undefined
  }
): Promise<T> {
  const { child, completion, terminate } = startLocalAgentProcess({ ...options, cwd: tmpdir() })
  let timer: ReturnType<typeof setTimeout> | undefined
  let onData: ((chunk: string) => void) | undefined
  let settled = false
  const send = (message: Record<string, unknown>) => {
    if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`)
  }
  try {
    return await new Promise<T>((resolve, reject) => {
      let buffer = ''
      let bytes = 0
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }
      timer = setTimeout(() => fail(new Error('Agent model discovery timed out.')), 10_000)
      void completion.then(
        () => fail(new Error('Agent model discovery ended before returning a catalog.')),
        () => fail(new Error('Agent model discovery could not start.'))
      )
      child.stdout.setEncoding('utf8')
      onData = (chunk) => {
        if (settled) return
        bytes += Buffer.byteLength(chunk)
        if (bytes > 2_000_000) {
          fail(new Error('Agent model discovery exceeded the response size limit.'))
          return
        }
        buffer += chunk
        let end = buffer.indexOf('\n')
        while (end !== -1 && !settled) {
          const line = buffer.slice(0, end).trim()
          buffer = buffer.slice(end + 1)
          if (line) {
            try {
              const result = options.onMessage(JSON.parse(line), send)
              if (result !== undefined) {
                settled = true
                resolve(result)
              }
            } catch {
              fail(new Error('Agent model discovery returned an invalid or unsupported response.'))
            }
          }
          end = buffer.indexOf('\n')
        }
      }
      child.stdout.on('data', onData)
      send(options.initialMessage)
    })
  } finally {
    settled = true
    if (timer) clearTimeout(timer)
    if (onData) child.stdout.removeListener('data', onData)
    child.stdout.resume()
    child.stdin.end()
    terminate()
    await completion.catch(() => {})
  }
}
