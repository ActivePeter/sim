import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'

export const vscodeAgentOperations = {
  listHosts: defineWorkspaceOperation({
    id: 'vscode.hosts.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  syncHost: defineWorkspaceOperation({
    id: 'vscode.hosts.sync',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  createSession: defineWorkspaceOperation({
    id: 'vscode.sessions.create',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  listSessions: defineWorkspaceOperation({
    id: 'vscode.sessions.list',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  resolveRuntime: defineWorkspaceOperation({
    id: 'vscode.sessions.resolve-runtime',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  readConfig: defineWorkspaceOperation({
    id: 'vscode.sessions.config.read',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  updateConfig: defineWorkspaceOperation({
    id: 'vscode.sessions.config.update',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  runSession: defineWorkspaceOperation({
    id: 'vscode.sessions.run',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
  stopSession: defineWorkspaceOperation({
    id: 'vscode.sessions.stop',
    minimumRole: 'write',
    workspaceApiKey: 'deny',
    principalKinds: ['session'],
  }),
} as const
