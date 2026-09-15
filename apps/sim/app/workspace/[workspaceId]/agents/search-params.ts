import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const agentMonitorParsers = {
  search: parseAsString.withDefault(''),
  status: parseAsStringLiteral([
    'all',
    'running',
    'idle',
    'complete',
    'cancelled',
    'error',
    'interrupted',
    'unknown',
  ]).withDefault('all'),
  workspace: parseAsString.withDefault('all'),
  project: parseAsString.withDefault('all'),
}
export const agentMonitorUrlKeys = { history: 'replace', clearOnDefault: true } as const
// Empty means the current page-local VS Code project, or the first persisted project outside VS Code.
export const projectSelectionParam = { key: 'agent-project', parser: parseAsString.withDefault('') }
