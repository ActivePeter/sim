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

export const vscodeSessionOriginSchema = z.object({
  physicalWorkspace: z.object({ id: identity, name: label, remoteAuthority: z.string().max(512) }),
  project: z.object({ name: label, uri }),
  logicalWorkspace: logicalWorkspace.optional(),
})

export type VscodeCatalog = z.output<typeof vscodeCatalogSchema>
export type VscodeSessionOrigin = z.output<typeof vscodeSessionOriginSchema>

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
  origin: VscodeSessionOrigin | null
  runtime: 'local-codex' | 'sim'
}
