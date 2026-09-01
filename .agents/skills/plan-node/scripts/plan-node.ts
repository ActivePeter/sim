#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { generateShortId } from '@sim/utils/id'

type Command = 'bind-pr' | 'claim' | 'heartbeat' | 'inspect'

interface PlanFile {
  contentUpdatedAt: string
  id: string
  name: string
}

interface PlanDependency {
  kind: 'contract' | 'integrate-with' | 'requires'
  source: string
  target: string
}

interface PlanLease {
  claimedAt: string
  expiresAt: string
  fencingToken: number
  state: 'active' | 'expired' | 'released'
}

interface PlanExecution {
  attemptId: string
  baseBranch: string
  baseSha: string
  branch: string
  headSha: string
  lease: PlanLease
  sessionId: string
  status: 'completed' | 'failed' | 'running' | 'waiting-review'
  worktree: string
}

interface PlanItem {
  agent?: string
  execution?: PlanExecution
  id: string
  lifecycle: 'active' | 'done' | 'planned' | 'review'
  repository?: string
  primaryPr: {
    checks: 'Failed' | 'Passed' | 'Pending' | 'Running'
    number: number | null
    review: 'Approved' | 'Changes requested' | 'Pending'
    state: 'Closed' | 'Draft' | 'Merged' | 'Open' | 'Unopened'
    url?: string
  }
  summary: string
  title: string
}

interface PlanDocument {
  defaultBranch: string
  dependencies: PlanDependency[]
  id: string
  items: PlanItem[]
  name: string
  remote: string
  repository: string
  revision: number
  schemaVersion: 1
}

interface ParsedArguments {
  command: Command
  options: Map<string, string | true>
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) fail(`${name} is required`)
  return value
}

function parseArguments(argv: string[]): ParsedArguments {
  const command = argv[0] as Command | undefined
  if (!command || !['bind-pr', 'claim', 'heartbeat', 'inspect'].includes(command)) {
    fail('Usage: plan-node.ts <inspect|claim|heartbeat|bind-pr> [--node PG-01] [options]')
  }
  const options = new Map<string, string | true>()
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token?.startsWith('--')) fail(`Unexpected argument: ${token ?? ''}`)
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) options.set(key, true)
    else {
      options.set(key, next)
      index += 1
    }
  }
  return { command, options }
}

function stringOption(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name)
  return typeof value === 'string' ? value : undefined
}

function requiredOption(options: Map<string, string | true>, name: string): string {
  return stringOption(options, name) ?? fail(`--${name} is required`)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is not an object`)
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} is not a non-empty string`)
  return value
}

function parseFile(value: unknown): PlanFile {
  const record = asRecord(value, 'Plan file')
  return {
    id: requireString(record.id, 'Plan file id'),
    name: requireString(record.name, 'Plan file name'),
    contentUpdatedAt: requireString(record.contentUpdatedAt, 'Plan file content version'),
  }
}

function parseDocument(value: unknown): PlanDocument {
  const record = asRecord(value, 'Plan document')
  if (record.schemaVersion !== 1) fail('Unsupported Plan Graph schema version')
  if (!Array.isArray(record.items) || !Array.isArray(record.dependencies)) {
    fail('Plan document is missing items or dependencies')
  }
  return value as PlanDocument
}

function messageFromErrorBody(value: unknown): string | undefined {
  const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  if (typeof body?.error === 'string') return body.error
  if (body?.error && typeof body.error === 'object') {
    const message = (body.error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return undefined
}

async function requestJson(
  apiUrl: string,
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...init?.headers,
    },
  })
  const text = await response.text()
  const body: unknown = text ? JSON.parse(text) : undefined
  if (!response.ok) {
    fail(
      `Sim API returned ${response.status}: ${messageFromErrorBody(body) ?? response.statusText}`
    )
  }
  return body
}

async function loadPlan(
  apiUrl: string,
  apiKey: string,
  workspaceId: string,
  planId: string
): Promise<{ document: PlanDocument; file: PlanFile }> {
  const fileName = `sim-plan-${planId}.json`
  const list = asRecord(
    await requestJson(
      apiUrl,
      apiKey,
      `/api/v2/files?workspaceId=${encodeURIComponent(workspaceId)}&search=${encodeURIComponent(fileName)}&limit=100`
    ),
    'File list response'
  )
  if (!Array.isArray(list.data)) fail('File list response is missing data')
  const file = list.data.map(parseFile).find((candidate) => candidate.name === fileName)
  if (!file) fail(`Plan file ${fileName} was not found; open the Plan Graph once to initialize it`)
  const textResponse = asRecord(
    await requestJson(
      apiUrl,
      apiKey,
      `/api/v2/files/${encodeURIComponent(file.id)}/text?workspaceId=${encodeURIComponent(workspaceId)}&maxBytes=1048576`
    ),
    'File text response'
  )
  const data = asRecord(textResponse.data, 'File text data')
  const document = parseDocument(JSON.parse(requireString(data.text, 'Plan file text')))
  return { document, file }
}

async function savePlan(
  apiUrl: string,
  apiKey: string,
  workspaceId: string,
  file: PlanFile,
  document: PlanDocument
): Promise<PlanFile> {
  const response = asRecord(
    await requestJson(apiUrl, apiKey, `/api/v2/files/${encodeURIComponent(file.id)}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        workspaceId,
        content: `${JSON.stringify(document, null, 2)}\n`,
        encoding: 'utf-8',
        expectedContentUpdatedAt: file.contentUpdatedAt,
      }),
    }),
    'File update response'
  )
  return parseFile(response.data)
}

function nodeIsReady(document: PlanDocument, node: PlanItem, now: Date): boolean {
  if (
    node.lifecycle === 'active' &&
    node.execution?.lease.state === 'active' &&
    new Date(node.execution.lease.expiresAt).getTime() <= now.getTime()
  ) {
    return true
  }
  if (node.lifecycle !== 'planned') return false
  const byId = new Map(document.items.map((item) => [item.id, item]))
  return document.dependencies
    .filter((dependency) => dependency.target === node.id && dependency.kind !== 'integrate-with')
    .every((dependency) => byId.get(dependency.source)?.lifecycle === 'done')
}

function runGit(repositoryRoot: string, args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', repositoryRoot, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim()
    fail(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout.toString().trim()
}

function printInspection(document: PlanDocument): void {
  const now = new Date()
  process.stdout.write(
    `${document.name ?? document.id} · revision ${document.revision} · ${document.repository}\n`
  )
  for (const node of document.items) {
    const state = nodeIsReady(document, node, now) ? 'ready' : node.lifecycle
    const owner = node.agent ? ` · ${node.agent}` : ''
    const pr = node.primaryPr.number ? ` · PR #${node.primaryPr.number}` : ''
    process.stdout.write(`${node.id}  ${state.padEnd(8)}  ${node.title}${owner}${pr}\n`)
  }
}

async function claimNode(args: {
  apiKey: string
  apiUrl: string
  document: PlanDocument
  file: PlanFile
  options: Map<string, string | true>
  workspaceId: string
}): Promise<void> {
  const nodeId = requiredOption(args.options, 'node')
  const agent = requiredOption(args.options, 'agent')
  const node = args.document.items.find((candidate) => candidate.id === nodeId)
  if (!node) fail(`Plan node ${nodeId} was not found`)
  const claimedAt = new Date()
  if (!nodeIsReady(args.document, node, claimedAt)) {
    fail(`Plan node ${nodeId} is not ready; inspect its dependencies or active lease`)
  }

  const repositoryRoot = resolve(stringOption(args.options, 'repo-root') ?? process.cwd())
  runGit(repositoryRoot, ['rev-parse', '--show-toplevel'])
  runGit(repositoryRoot, ['fetch', args.document.remote, args.document.defaultBranch])
  const baseSha = runGit(repositoryRoot, [
    'rev-parse',
    `${args.document.remote}/${args.document.defaultBranch}`,
  ])
  const branch =
    stringOption(args.options, 'branch') ?? `plan/${args.document.id}/${nodeId.toLowerCase()}`
  const existingWorktree = stringOption(args.options, 'existing-worktree')
  const worktree = resolve(
    existingWorktree ?? dirname(repositoryRoot),
    existingWorktree ? '.' : `${basename(repositoryRoot)}-${nodeId.toLowerCase()}`
  )
  if (!existingWorktree && existsSync(worktree)) fail(`Worktree path already exists: ${worktree}`)
  if (existingWorktree) {
    const existingBranch = runGit(worktree, ['branch', '--show-current'])
    if (existingBranch !== branch) {
      fail(`Existing worktree is on ${existingBranch || 'detached HEAD'}, expected ${branch}`)
    }
  }

  const fencingToken =
    Math.max(0, ...args.document.items.map((item) => item.execution?.lease.fencingToken ?? 0)) + 1
  const attemptId = `attempt-${generateShortId()}`
  const sessionId = `session-${generateShortId()}`
  const claimedDocument = structuredClone(args.document)
  const claimedNode = claimedDocument.items.find((candidate) => candidate.id === nodeId)
  if (!claimedNode) fail(`Plan node ${nodeId} disappeared during claim preparation`)
  claimedNode.lifecycle = 'active'
  claimedNode.agent = agent
  claimedNode.execution = {
    attemptId,
    sessionId,
    worktree,
    branch,
    baseBranch: claimedDocument.defaultBranch,
    baseSha,
    headSha: 'working',
    status: 'running',
    lease: {
      state: 'active',
      fencingToken,
      claimedAt: claimedAt.toISOString(),
      expiresAt: new Date(claimedAt.getTime() + 60 * 60 * 1000).toISOString(),
    },
  }
  claimedDocument.revision += 1
  const claimedFile = await savePlan(
    args.apiUrl,
    args.apiKey,
    args.workspaceId,
    args.file,
    claimedDocument
  )

  if (!existingWorktree) {
    const result = Bun.spawnSync(
      [
        'git',
        '-C',
        repositoryRoot,
        'worktree',
        'add',
        '-b',
        branch,
        worktree,
        `${claimedDocument.remote}/${claimedDocument.defaultBranch}`,
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    if (result.exitCode !== 0) {
      claimedNode.execution.status = 'failed'
      claimedNode.execution.lease.state = 'released'
      claimedDocument.revision += 1
      await savePlan(args.apiUrl, args.apiKey, args.workspaceId, claimedFile, claimedDocument)
      fail(`Worktree provisioning failed: ${result.stderr.toString().trim()}`)
    }
  }

  process.stdout.write(
    `${[
      `Claimed ${nodeId} at revision ${claimedDocument.revision}`,
      `Attempt: ${attemptId}`,
      `Session: ${sessionId}`,
      `Fencing token: ${fencingToken}`,
      `Worktree: ${worktree}`,
      `Branch: ${branch}`,
      `Base: ${baseSha}`,
      '',
      `Next: cd ${JSON.stringify(worktree)} && find .. -name AGENTS.md -print`,
    ].join('\n')}\n`
  )
}

async function bindPullRequest(args: {
  apiKey: string
  apiUrl: string
  document: PlanDocument
  file: PlanFile
  options: Map<string, string | true>
  workspaceId: string
}): Promise<void> {
  const nodeId = requiredOption(args.options, 'node')
  const pullRequestNumber = Number(requiredOption(args.options, 'pr'))
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    fail('--pr must be a positive integer')
  }
  const next = structuredClone(args.document)
  const node = next.items.find((candidate) => candidate.id === nodeId)
  if (!node) fail(`Plan node ${nodeId} was not found`)
  node.primaryPr = {
    ...node.primaryPr,
    number: pullRequestNumber,
    state: 'Draft',
    checks: 'Pending',
    review: 'Pending',
    url: `https://github.com/${node.repository ?? next.repository}/pull/${pullRequestNumber}`,
  }
  next.revision += 1
  await savePlan(args.apiUrl, args.apiKey, args.workspaceId, args.file, next)
  process.stdout.write(`Bound ${nodeId} to PR #${pullRequestNumber} at revision ${next.revision}\n`)
}

async function heartbeat(args: {
  apiKey: string
  apiUrl: string
  document: PlanDocument
  file: PlanFile
  options: Map<string, string | true>
  workspaceId: string
}): Promise<void> {
  const nodeId = requiredOption(args.options, 'node')
  const attemptId = requiredOption(args.options, 'attempt')
  const next = structuredClone(args.document)
  const node = next.items.find((candidate) => candidate.id === nodeId)
  if (!node?.execution || node.execution.attemptId !== attemptId) {
    fail(`Attempt ${attemptId} is not the current writer for ${nodeId}`)
  }
  if (node.execution.lease.state !== 'active') {
    fail(`Attempt ${attemptId} no longer has an active writer lease`)
  }
  node.execution.lease.expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  next.revision += 1
  await savePlan(args.apiUrl, args.apiKey, args.workspaceId, args.file, next)
  process.stdout.write(
    `Extended ${nodeId} attempt ${attemptId} to ${node.execution.lease.expiresAt}\n`
  )
}

async function main(): Promise<void> {
  const { command, options } = parseArguments(process.argv.slice(2))
  const apiUrl = requireEnvironment('SIM_API_URL')
  const apiKey = requireEnvironment('SIM_API_KEY')
  const workspaceId = requireEnvironment('SIM_WORKSPACE_ID')
  const planId = process.env.SIM_PLAN_ID?.trim() || 'agent-session-prs'
  const loaded = await loadPlan(apiUrl, apiKey, workspaceId, planId)
  if (command === 'inspect') return printInspection(loaded.document)
  if (command === 'claim') {
    return claimNode({ apiUrl, apiKey, workspaceId, options, ...loaded })
  }
  if (command === 'heartbeat') {
    return heartbeat({ apiUrl, apiKey, workspaceId, options, ...loaded })
  }
  return bindPullRequest({ apiUrl, apiKey, workspaceId, options, ...loaded })
}

await main()
