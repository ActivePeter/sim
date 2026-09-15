import { workspaceDag } from '@sim/db/schema'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

describe('workspace DAG schema', () => {
  it('stores the complete graph as one JSONB value under a workspace-scoped primary key', () => {
    const config = getTableConfig(workspaceDag)
    expect(workspaceDag.document.getSQLType()).toBe('jsonb')
    expect(config.primaryKeys[0].columns.map((column) => column.name)).toEqual([
      'workspace_id',
      'id',
    ])
    expect(config.columns.some((column) => column.name === 'revision')).toBe(false)
    expect(config.columns.some((column) => column.name === 'name')).toBe(false)
  })
  it('links one legacy source and cascades with the owning workspace', () => {
    const config = getTableConfig(workspaceDag)
    expect(workspaceDag.legacyFileId.isUnique).toBe(true)
    expect(
      config.foreignKeys.find((key) => key.reference().columns[0].name === 'workspace_id')?.onDelete
    ).toBe('cascade')
  })
  it('requires document identity to be true, not SQL NULL from missing JSON keys', () => {
    const config = getTableConfig(workspaceDag)
    const constraint = config.checks.find(
      (check) => check.name === 'workspace_dag_document_identity'
    )
    expect(constraint).toBeDefined()
    if (!constraint) throw new Error('Missing document identity constraint')
    const query = new PgDialect().sqlToQuery(constraint.value)
    expect(query.sql).toBe(
      '(\"workspace_dag\".\"document\"->>\'id\' = \"workspace_dag\".\"id\" AND \"workspace_dag\".\"document\"->>\'kind\' = \'dag\') IS TRUE'
    )
  })
})
