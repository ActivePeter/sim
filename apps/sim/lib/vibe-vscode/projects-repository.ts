import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { copilotChats, vscodeProjectSessions, vscodeWorkspaceHosts } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getLatestRunsForChats } from '@/lib/copilot/async-runs/repository'
import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  isProjectAgentLocked,
  type ProjectAgentSettings,
  readProjectAgentConfig,
} from '@/lib/vibe-vscode/agent-config'
import {
  isVscodeSelectionInProject,
  type ProjectSession,
  type ProjectSessionStatus,
  type VscodeCatalog,
  type VscodeHost,
  type VscodeSelection,
  vscodeCatalogFingerprint,
  vscodeCatalogSchema,
  vscodeSelectionFingerprint,
  vscodeSessionIdentitySchema,
  vscodeSessionOriginSchema,
} from '@/lib/vibe-vscode/types'

function projectHost(row: typeof vscodeWorkspaceHosts.$inferSelect): VscodeHost {
  return {
    id: row.id,
    catalog: vscodeCatalogSchema.parse(row.catalog),
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listHosts(userId: string, workspaceId: string): Promise<VscodeHost[]> {
  const rows = await db
    .select()
    .from(vscodeWorkspaceHosts)
    .where(
      and(
        eq(vscodeWorkspaceHosts.userId, userId),
        eq(vscodeWorkspaceHosts.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(vscodeWorkspaceHosts.updatedAt))
  return rows.map(projectHost)
}

export async function syncHost(
  userId: string,
  workspaceId: string,
  catalog: VscodeCatalog,
  expectedRevision: number
): Promise<VscodeHost> {
  const physical = catalog.physicalWorkspace
  const identity = and(
    eq(vscodeWorkspaceHosts.userId, userId),
    eq(vscodeWorkspaceHosts.workspaceId, workspaceId),
    eq(vscodeWorkspaceHosts.physicalWorkspaceId, physical.id),
    eq(vscodeWorkspaceHosts.remoteAuthority, physical.remoteAuthority)
  )
  return db.transaction(async (tx) => {
    await tx
      .insert(vscodeWorkspaceHosts)
      .values({
        id: generateId(),
        userId,
        workspaceId,
        physicalWorkspaceId: physical.id,
        remoteAuthority: physical.remoteAuthority,
        catalog,
        revision: 1,
      })
      .onConflictDoNothing()
    const [current] = await tx
      .select()
      .from(vscodeWorkspaceHosts)
      .where(identity)
      .for('update')
      .limit(1)
    if (!current) throw new OrchestrationError('internal', 'Host projection was not created')
    if (
      vscodeCatalogFingerprint(vscodeCatalogSchema.parse(current.catalog)) ===
      vscodeCatalogFingerprint(catalog)
    )
      return projectHost(current)
    if (current.revision !== expectedRevision)
      throw new OrchestrationError('conflict', 'The project catalog changed. Refresh and retry.')
    const [updated] = await tx
      .update(vscodeWorkspaceHosts)
      .set({
        catalog,
        revision: sql`${vscodeWorkspaceHosts.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(vscodeWorkspaceHosts.id, current.id))
      .returning()
    return projectHost(updated)
  })
}

export interface CreateProjectSessionInput {
  workspaceId: string
  hostId: string
  projectUri: string
  logicalWorkspaceId?: string
  requestId: string
  selection?: VscodeSelection
}

export async function createProjectSession(userId: string, input: CreateProjectSessionInput) {
  const requestKey = createHash('sha256')
    .update(JSON.stringify([userId, input.workspaceId, input.requestId]))
    .digest('hex')
  return db
    .transaction(async (tx) => {
      const [host] = await tx
        .select()
        .from(vscodeWorkspaceHosts)
        .where(
          and(
            eq(vscodeWorkspaceHosts.id, input.hostId),
            eq(vscodeWorkspaceHosts.userId, userId),
            eq(vscodeWorkspaceHosts.workspaceId, input.workspaceId)
          )
        )
        .for('update')
        .limit(1)
      if (!host) throw new OrchestrationError('not_found', 'VS Code workspace not found')
      const [existing] = await tx
        .select({ binding: vscodeProjectSessions, chat: copilotChats })
        .from(vscodeProjectSessions)
        .innerJoin(copilotChats, eq(copilotChats.id, vscodeProjectSessions.chatId))
        .where(eq(vscodeProjectSessions.requestKey, requestKey))
        .limit(1)
      if (existing) {
        const origin = vscodeSessionOriginSchema.parse(existing.binding.origin)
        if (
          existing.chat.deletedAt ||
          existing.binding.hostId !== input.hostId ||
          origin.project.uri !== input.projectUri ||
          origin.logicalWorkspace?.id !== input.logicalWorkspaceId ||
          vscodeSelectionFingerprint(origin.selection) !==
            vscodeSelectionFingerprint(input.selection)
        ) {
          throw new OrchestrationError(
            'conflict',
            'This creation request is already bound to another session context'
          )
        }
        return { id: existing.chat.id, workspaceId: input.workspaceId }
      }
      const catalog = vscodeCatalogSchema.parse(host.catalog)
      const project = catalog.physicalWorkspace.folders.find(
        (folder) => folder.uri === input.projectUri
      )
      const logical = catalog.logicalWorkspaces.find((item) => item.id === input.logicalWorkspaceId)
      if (!project || (input.logicalWorkspaceId && !logical)) {
        throw new OrchestrationError(
          'conflict',
          'The selected project or logical workspace is no longer in the VS Code catalog'
        )
      }
      if (input.selection && !isVscodeSelectionInProject(input.selection, project.uri)) {
        throw new OrchestrationError('validation', 'The selected file is outside this project')
      }
      const { folders: _folders, ...physicalWorkspace } = catalog.physicalWorkspace
      const id = generateId()
      await tx.insert(copilotChats).values({
        id,
        userId,
        workspaceId: input.workspaceId,
        type: 'mothership',
        title: `${project.name} · Agent`,
        model: 'local-codex',
        lastSeenAt: new Date(),
      })
      await tx.insert(vscodeProjectSessions).values({
        chatId: id,
        hostId: host.id,
        requestKey,
        origin: {
          physicalWorkspace,
          project: { name: project.name, uri: project.uri },
          logicalWorkspace: logical,
          ...(input.selection ? { selection: input.selection } : {}),
        },
      })
      return { id, workspaceId: input.workspaceId }
    })
    .catch((error) => {
      if (getPostgresErrorCode(error) === '23505') {
        throw new OrchestrationError(
          'conflict',
          'This creation request is already bound to another session context'
        )
      }
      throw error
    })
}

export async function loadOwnedChat(userId: string, chatId: string) {
  const [row] = await db
    .select({ chat: copilotChats, binding: vscodeProjectSessions })
    .from(copilotChats)
    .leftJoin(vscodeProjectSessions, eq(copilotChats.id, vscodeProjectSessions.chatId))
    .where(
      and(
        eq(copilotChats.id, chatId),
        eq(copilotChats.userId, userId),
        isNull(copilotChats.deletedAt)
      )
    )
    .limit(1)
  if (!row?.chat.workspaceId) throw new OrchestrationError('not_found', 'Session not found')
  return row
}

export async function listProjectSessions(
  userId: string,
  workspaceId: string
): Promise<ProjectSession[]> {
  const rows = await db
    .select({ chat: copilotChats, binding: vscodeProjectSessions })
    .from(copilotChats)
    .leftJoin(vscodeProjectSessions, eq(copilotChats.id, vscodeProjectSessions.chatId))
    .where(
      and(
        eq(copilotChats.userId, userId),
        eq(copilotChats.workspaceId, workspaceId),
        eq(copilotChats.type, 'mothership'),
        isNull(copilotChats.deletedAt)
      )
    )
    .orderBy(desc(copilotChats.updatedAt))
    .limit(500)
  const [markers, latestRuns] = await Promise.all([
    reconcileChatStreamMarkers(
      rows.map(({ chat }) => ({ chatId: chat.id, streamId: chat.conversationId }))
    ),
    getLatestRunsForChats(
      rows.map(({ chat }) => chat.id),
      userId
    ),
  ])
  const runsByChat = new Map(latestRuns.map((run) => [run.chatId, run]))
  return rows.map(({ chat, binding }) => {
    const marker = markers.get(chat.id)
    const run = runsByChat.get(chat.id)
    const turnId = binding?.lastTurnId ?? chat.conversationId
    const terminalStatus = run
      ? !turnId || run.streamId === turnId
        ? run.status
        : null
      : binding?.lastOutcome
    /** lastOutcome is read-only compatibility for project turns created before native run records. */
    let status: ProjectSessionStatus = 'idle'
    if (marker?.status === 'active') status = 'running'
    else if (marker?.status === 'unknown') status = 'unknown'
    else if (
      terminalStatus === 'complete' ||
      terminalStatus === 'cancelled' ||
      terminalStatus === 'error'
    )
      status = terminalStatus
    else if (turnId || run) status = 'interrupted'
    return {
      id: chat.id,
      workspaceId,
      title: chat.title,
      updatedAt: chat.updatedAt.toISOString(),
      activeStreamId: marker?.streamId ?? null,
      status,
      origin: binding ? vscodeSessionIdentitySchema.parse(binding.origin) : null,
      runtime: binding ? readProjectAgentConfig(binding.agentConfig).agentId : 'sim',
    }
  })
}

export interface UpdateProjectAgentConfigInput {
  workspaceId: string
  chatId: string
  expectedRevision: number
  settings: ProjectAgentSettings
}

/** Serializes with turn admission so a started thread can never be rebound to another runtime. */
export async function updateProjectAgentConfig(
  userId: string,
  input: UpdateProjectAgentConfigInput
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ binding: vscodeProjectSessions })
      .from(copilotChats)
      .innerJoin(vscodeProjectSessions, eq(vscodeProjectSessions.chatId, copilotChats.id))
      .where(
        and(
          eq(copilotChats.id, input.chatId),
          eq(copilotChats.userId, userId),
          eq(copilotChats.workspaceId, input.workspaceId),
          isNull(copilotChats.deletedAt)
        )
      )
      .for('update')
      .limit(1)
    if (!row) throw new OrchestrationError('not_found', 'Project session not found')
    const current = readProjectAgentConfig(row.binding.agentConfig)
    const agentLocked = isProjectAgentLocked(row.binding)
    if (current.revision !== input.expectedRevision) {
      throw new OrchestrationError('conflict', 'Agent configuration changed. Refresh and retry.')
    }
    if (agentLocked && current.agentId !== input.settings.agentId) {
      throw new OrchestrationError(
        'conflict',
        'This conversation has already started. Create a new chat to use a different Agent.'
      )
    }
    const { version: _version, revision: _revision, ...settings } = current
    if (
      Object.keys(settings).every(
        (key) =>
          settings[key as keyof ProjectAgentSettings] ===
          input.settings[key as keyof ProjectAgentSettings]
      )
    ) {
      return { config: current, agentLocked }
    }
    const config = { ...input.settings, version: 1 as const, revision: current.revision + 1 }
    await tx
      .update(vscodeProjectSessions)
      .set({ agentConfig: config })
      .where(eq(vscodeProjectSessions.chatId, input.chatId))
    return { config, agentLocked }
  })
}
