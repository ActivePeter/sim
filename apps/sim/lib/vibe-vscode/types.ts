import { z } from 'zod'

const identity = z.string().min(1).max(512)
const label = z.string().min(1).max(256)
const uri = z.string().min(1).max(8192)
const logicalWorkspace = z.object({ id: identity, name: label })

export const vscodeCatalogSchema = z
  .object({
    physicalWorkspace: z.object({
      id: identity,
      name: label,
      remoteAuthority: z.string().max(512),
      folders: z
        .array(
          z.object({
            name: label,
            uri,
            index: z.number().int().nonnegative(),
          })
        )
        .max(256),
    }),
    logicalWorkspaces: z.array(logicalWorkspace).max(256),
  })
  .superRefine((catalog, context) => {
    const folders = catalog.physicalWorkspace.folders
    if (new Set(folders.map((folder) => folder.uri)).size !== folders.length) {
      context.addIssue({ code: 'custom', message: 'Project URIs must be unique' })
    }
    if (
      new Set(catalog.logicalWorkspaces.map((item) => item.id)).size !==
      catalog.logicalWorkspaces.length
    ) {
      context.addIssue({ code: 'custom', message: 'Logical workspace IDs must be unique' })
    }
  })

/** A user-captured source snapshot, not permission to read or execute an arbitrary file. */
export const vscodeSelectionSchema = z.object({
  uri,
  language: z.string().max(128),
  range: z
    .object({
      startLine: z.number().int().nonnegative(),
      startCharacter: z.number().int().nonnegative(),
      endLine: z.number().int().nonnegative(),
      endCharacter: z.number().int().nonnegative(),
    })
    .refine(
      (range) =>
        range.endLine > range.startLine ||
        (range.endLine === range.startLine && range.endCharacter > range.startCharacter),
      'Select a non-empty source range'
    ),
  text: z.string().min(1).max(32_000),
})
export type VscodeSelection = z.output<typeof vscodeSelectionSchema>

export const vscodeSessionIdentitySchema = z.object({
  physicalWorkspace: z.object({ id: identity, name: label, remoteAuthority: z.string().max(512) }),
  project: z.object({ name: label, uri }),
  logicalWorkspace: logicalWorkspace.optional(),
})
export const vscodeSessionOriginSchema = vscodeSessionIdentitySchema.extend({
  selection: vscodeSelectionSchema.optional(),
})

/** The initiating host and Sim workspace are captured before asynchronous creation. */
export const vscodeCreateChatRequestSchema = z.object({
  requestId: z.string().uuid(),
  workspaceId: identity,
  catalog: vscodeCatalogSchema,
  projectUri: uri,
  logicalWorkspaceId: identity.optional(),
  selection: vscodeSelectionSchema,
})
export type VscodeCreateChatRequest = z.output<typeof vscodeCreateChatRequestSchema>

export type VscodeCatalog = z.output<typeof vscodeCatalogSchema>
export type VscodeSessionOrigin = z.output<typeof vscodeSessionOriginSchema>

/** JSONB ordering and object construction order cannot change creation-request identity. */
export function vscodeSelectionFingerprint(selection: VscodeSelection | undefined): string {
  if (!selection) return ''
  const { range } = selection
  return JSON.stringify([
    selection.uri,
    selection.language,
    range.startLine,
    range.startCharacter,
    range.endLine,
    range.endCharacter,
    selection.text,
  ])
}

export function isVscodeSelectionInProject(
  selection: VscodeSelection,
  projectUri: string
): boolean {
  try {
    const project = new URL(projectUri)
    const file = new URL(selection.uri)
    const projectPath = decodeURIComponent(project.pathname).replace(/\/$/, '')
    const filePath = decodeURIComponent(file.pathname)
    return (
      ['file:', 'vscode-remote:'].includes(project.protocol) &&
      file.protocol === project.protocol &&
      file.host === project.host &&
      !file.username &&
      !file.password &&
      !file.search &&
      !file.hash &&
      !/[\\\u0000]/.test(filePath) &&
      !filePath.split('/').some((part) => part === '.' || part === '..') &&
      filePath.startsWith(`${projectPath}/`)
    )
  } catch {
    return false
  }
}

/** Stable across JSONB property ordering; includes the authority namespace, not only labels. */
export function vscodeCatalogFingerprint(catalog: VscodeCatalog): string {
  const physical = catalog.physicalWorkspace
  return JSON.stringify([
    physical.id,
    physical.name,
    physical.remoteAuthority,
    physical.folders.map((folder) => [folder.name, folder.uri, folder.index]),
    catalog.logicalWorkspaces.map((workspace) => [workspace.id, workspace.name]),
  ])
}

export interface VibeVscodeHostContext {
  language: string
  physicalWorkspace?: VscodeCatalog['physicalWorkspace']
  logicalWorkspaces?: VscodeCatalog['logicalWorkspaces']
  logicalWorkspace?: { id: string; name: string }
  project?: { name: string; uri: string }
  activeFile?: {
    uri: string
    selection?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number }
  }
}

export interface VscodeHost {
  id: string
  catalog: VscodeCatalog
  revision: number
  updatedAt: string
}

export type ProjectSessionStatus =
  | 'idle'
  | 'running'
  | 'complete'
  | 'cancelled'
  | 'error'
  | 'interrupted'
  | 'unknown'

export interface ProjectSession {
  id: string
  workspaceId: string
  title: string | null
  updatedAt: string
  activeStreamId: string | null
  status: ProjectSessionStatus
  origin: z.output<typeof vscodeSessionIdentitySchema> | null
  runtime: 'local-codex' | 'local-claude' | 'sim'
}
