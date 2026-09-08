/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Chip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ChipInput: () => null,
  ChipTextarea: () => null,
  cn: (...classes: string[]) => classes.join(' '),
}))
vi.mock('@sim/emcn/icons', () => ({
  BrainCircuit: () => null,
  CircleCheck: () => <i data-gate-passed='true' />,
  CirclePause: () => <i data-gate-passed='false' />,
  Code: () => null,
  Fingerprint: () => null,
  FolderCode: () => null,
  Play: () => null,
  Split: () => null,
  Task: () => null,
  Trash: () => null,
  User: () => null,
  Workflow: () => null,
}))
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}))

import {
  addDagItem,
  createDagDocument,
  type PlanPullRequestBinding,
  resolvePlanItems,
} from '@/lib/dags/model'
import { NodeInspector } from '@/app/workspace/[workspaceId]/d/[dagId]/components/node-inspector'

function renderGateResults(primaryPr: Partial<PlanPullRequestBinding>) {
  const document = addDagItem(
    createDagDocument({
      id: 'stored-dag',
      name: 'Stored DAG',
      repository: 'example/repo',
      remote: 'origin',
      defaultBranch: 'main',
    }),
    'node-1',
    'Stored node'
  )
  document.items[0].primaryPr = { ...document.items[0].primaryPr, ...primaryPr }
  const items = resolvePlanItems(document.items, document.dependencies)
  const container = window.document.createElement('div')
  container.innerHTML = renderToStaticMarkup(
    <NodeInspector
      dependencies={document.dependencies}
      item={items[0]}
      items={items}
      onRemoveDependency={vi.fn()}
      onRemoveItem={vi.fn()}
      onUpdateDependencyKind={vi.fn()}
      onUpdateItem={vi.fn()}
      repository={document.repository}
      selectedItemCount={1}
    />
  )
  const section = [...container.querySelectorAll('section')].find(
    (candidate) => candidate.querySelector('p')?.textContent === 'plan.inspector.mergeGates'
  )
  if (!section) throw new Error('Missing merge gates')
  return Object.fromEntries(
    [...section.querySelectorAll('[data-gate-passed]')].map((icon) => [
      icon.parentElement?.querySelector('span')?.textContent,
      icon.getAttribute('data-gate-passed') === 'true',
    ])
  )
}

describe('persisted merge-gate projection', () => {
  it.each([
    { label: 'no recorded PR facts', primaryPr: {}, checks: false, review: false },
    {
      label: 'a merge without passed checks or approval',
      primaryPr: { state: 'Merged', checks: 'Failed', review: 'Changes requested' },
      checks: false,
      review: false,
    },
    {
      label: 'recorded successful checks and approval',
      primaryPr: { state: 'Open', checks: 'Passed', review: 'Approved' },
      checks: true,
      review: true,
    },
  ] as const)('shows only supported facts for $label', ({ primaryPr, checks, review }) => {
    expect(renderGateResults(primaryPr)).toEqual({
      'plan.inspector.startDependenciesSatisfied': true,
      'plan.inspector.mergeDependenciesSatisfied': true,
      'plan.inspector.requiredChecksPassed': checks,
      'plan.inspector.reviewApproved': review,
    })
  })
})
