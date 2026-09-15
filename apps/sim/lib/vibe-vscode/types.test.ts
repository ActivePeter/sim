/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { createProjectSessionBodySchema } from '@/lib/api/contracts/vscode-agents'
import {
  isVscodeSelectionInProject,
  vscodeSelectionFingerprint,
  vscodeSelectionSchema,
} from '@/lib/vibe-vscode/types'

const selection = {
  uri: 'vscode-remote://host.test/projects/a/source.ts',
  language: 'typescript',
  text: 'const value = 1',
  range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 15 },
}

describe('selected source context', () => {
  it('bounds text and requires a non-empty ordered zero-based range', () => {
    expect(vscodeSelectionSchema.safeParse(selection).success).toBe(true)
    for (const value of [
      { ...selection, text: '' },
      { ...selection, text: 'x'.repeat(32_001) },
      { ...selection, range: { ...selection.range, endCharacter: 0 } },
      { ...selection, range: { ...selection.range, startLine: 1 } },
      { ...selection, range: { ...selection.range, endLine: -1 } },
      { ...selection, range: { ...selection.range, endCharacter: 0.5 } },
    ]) {
      expect(vscodeSelectionSchema.safeParse(value).success).toBe(false)
    }
  })

  it('checks project membership without treating the URI as filesystem authority', () => {
    const project = 'vscode-remote://host.test/projects/a'
    expect(isVscodeSelectionInProject(selection, project)).toBe(true)
    for (const uri of [
      'vscode-remote://host.test/projects/ab/source.ts',
      'vscode-remote://other.test/projects/a/source.ts',
      'vscode-remote://host.test/projects/a/%2e%2e/private.ts',
      'vscode-remote://host.test/projects/a/%2e%2e%2fprivate.ts',
      'vscode-remote://host.test/projects/a/source.ts?secret=1',
      'file:///projects/a/source.ts',
    ]) {
      expect(isVscodeSelectionInProject({ ...selection, uri }, project)).toBe(false)
    }
  })

  it('makes source capture optional for existing callers and invariant across JSONB ordering', () => {
    const body = {
      workspaceId: 'workspace-1',
      hostId: 'host-1',
      projectUri: 'vscode-remote://host.test/projects/a',
      requestId: '00000000-0000-4000-8000-000000000001',
    }
    expect(createProjectSessionBodySchema.parse(body)).not.toHaveProperty('selection')
    expect(createProjectSessionBodySchema.parse({ ...body, selection }).selection).toEqual(
      selection
    )
    expect(vscodeSelectionFingerprint(selection)).toBe(
      vscodeSelectionFingerprint({
        range: { endCharacter: 15, endLine: 0, startCharacter: 0, startLine: 0 },
        text: selection.text,
        language: selection.language,
        uri: selection.uri,
      })
    )
  })
})
