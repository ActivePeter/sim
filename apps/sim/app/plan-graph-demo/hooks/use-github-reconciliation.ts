'use client'

import { useMutation } from '@tanstack/react-query'
import { reconcileDagWithGitHub } from '@/app/plan-graph-demo/github-reconciliation'
import type { DagDocument } from '@/app/plan-graph-demo/plan-graph-model'

export function useGitHubReconciliation() {
  return useMutation({
    mutationFn: ({ document }: { document: DagDocument }) => reconcileDagWithGitHub(document),
  })
}
