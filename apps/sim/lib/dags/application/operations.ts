import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

const DAG_PRINCIPALS = ['session', 'personal_api_key', 'workspace_api_key'] as const

export const dagOperations = {
  list: defineWorkspaceOperation({
    id: 'dags.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: [...DAG_PRINCIPALS],
  }),
  read: defineWorkspaceOperation({
    id: 'dags.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    principalKinds: [...DAG_PRINCIPALS],
  }),
  create: defineWorkspaceOperation({
    id: 'dags.create',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: [...DAG_PRINCIPALS],
  }),
  update: defineWorkspaceOperation({
    id: 'dags.update',
    minimumRole: 'write',
    workspaceApiKey: 'allow',
    principalKinds: [...DAG_PRINCIPALS],
  }),
  importLegacy: defineWorkspaceOperation({
    id: 'dags.import_legacy',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
