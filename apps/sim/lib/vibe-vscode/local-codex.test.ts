/** @vitest-environment node */
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deployment = vi.hoisted(() => ({ SIM_VSCODE_CODEX_SANDBOX: undefined as string | undefined }))
vi.mock('@/lib/core/config/env', () => ({ env: deployment }))

import {
  localCodexArguments,
  projectPathFromUri,
  resolveLocalProject,
} from '@/lib/vibe-vscode/local-codex'
import type { VscodeSessionOrigin } from '@/lib/vibe-vscode/types'

const temporary: string[] = []
const origin = (uri: string, remoteAuthority = ''): VscodeSessionOrigin => ({
  physicalWorkspace: { id: 'physical-1', name: 'Physical workspace', remoteAuthority },
  project: { name: 'project', uri },
})
beforeEach(() => {
  deployment.SIM_VSCODE_CODEX_SANDBOX = undefined
})
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('local project runner boundary', () => {
  it.each(['not a URI', 'file://other-host/project'])(
    'reports invalid project locations as validation errors: %s',
    (uri) => {
      expect(() =>
        projectPathFromUri(origin(uri), { roots: ['/projects'], remoteAuthorities: [] })
      ).toThrow(expect.objectContaining({ code: 'validation' }))
    }
  )
  it('never enables an unrestricted sandbox or a shell-evaluated command', () => {
    const path = '/tmp/project with spaces;$(not-a-command)'
    const args = localCodexArguments(path, 'thread-1')
    expect(args).toEqual([
      'exec',
      '--json',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '-c',
      'approval_policy="never"',
      '-c',
      'features.multi_agent=false',
      '-C',
      path,
      'resume',
      'thread-1',
      '-',
    ])
  })
  it('requires an explicit mapping for remote authorities', () => {
    const value = origin('vscode-remote://host.example.test/project', 'host.example.test')
    expect(() => projectPathFromUri(value, { roots: ['/'], remoteAuthorities: [] })).toThrow(
      'not mapped'
    )
    expect(
      projectPathFromUri(value, { roots: ['/'], remoteAuthorities: ['host.example.test'] })
    ).toBe('/project')
    expect(() =>
      projectPathFromUri(
        { ...value, physicalWorkspace: { ...value.physicalWorkspace, remoteAuthority: 'other' } },
        { roots: ['/'], remoteAuthorities: ['host.example.test'] }
      )
    ).toThrow('not mapped')
  })
  it('forwards configured model and reasoning without replacing deployment-owned sandbox policy', () => {
    const args = localCodexArguments('/projects/a', 'thread', {
      model: 'configured-model',
      reasoningEffort: 'high',
      permissionMode: null,
    })
    expect(args.slice(-7)).toEqual([
      '--model',
      'configured-model',
      '-c',
      'model_reasoning_effort="high"',
      'resume',
      'thread',
      '-',
    ])
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
  })
  it.each([undefined, 'stored-thread'])(
    'applies the saved permission on fresh and resumed turns: %s',
    (threadId) => {
      deployment.SIM_VSCODE_CODEX_SANDBOX = 'workspace-write'
      for (const permissionMode of ['read-only', 'workspace-write'] as const) {
        const args = localCodexArguments('/projects/a', threadId, {
          model: null,
          reasoningEffort: null,
          permissionMode,
        })
        expect(args[args.indexOf('--sandbox') + 1]).toBe(permissionMode)
        expect(args).toContain('approval_policy="never"')
        expect(args.join(' ')).not.toMatch(/danger-full-access|dangerously|--full-auto/)
      }
      deployment.SIM_VSCODE_CODEX_SANDBOX = 'read-only'
      expect(() =>
        localCodexArguments('/projects/a', threadId, {
          model: null,
          reasoningEffort: null,
          permissionMode: 'workspace-write',
        })
      ).toThrow(expect.objectContaining({ code: 'forbidden' }))
    }
  )
  it('preserves the port and Unicode path in a real VS Code remote URI', () => {
    expect(
      projectPathFromUri(
        origin(
          'vscode-remote://vscode.test:18082/projects/%E9%A1%B9%E7%9B%AE',
          'vscode.test:18082'
        ),
        { roots: ['/projects'], remoteAuthorities: ['vscode.test:18082'] }
      )
    ).toBe('/projects/项目')
  })
  it('does not coerce a remote project into a same-named local project', () => {
    expect(() =>
      projectPathFromUri(origin('file:///tmp/project', 'remote'), {
        roots: ['/tmp'],
        remoteAuthorities: ['remote'],
      })
    ).toThrow()
    expect(() =>
      projectPathFromUri(origin('https://host/project'), { roots: ['/tmp'], remoteAuthorities: [] })
    ).toThrow()
  })
  it('resolves paths and blocks symlink escapes and prefix siblings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sim-project-boundary-'))
    temporary.push(root)
    const allowed = join(root, 'allowed')
    const outside = join(root, 'allowed-sibling')
    await Promise.all([mkdir(allowed), mkdir(outside)])
    await symlink(outside, join(allowed, 'escape'))
    const policy = { roots: [allowed], remoteAuthorities: [] }
    await expect(resolveLocalProject(origin(pathToFileURL(allowed).href), policy)).resolves.toBe(
      allowed
    )
    await expect(
      resolveLocalProject(origin(pathToFileURL(outside).href), policy)
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      resolveLocalProject(origin(pathToFileURL(join(allowed, 'escape')).href), policy)
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
