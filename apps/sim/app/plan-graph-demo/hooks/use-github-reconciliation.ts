'use client'

import { useMutation } from '@tanstack/react-query'
import type { DagDocument } from '@/lib/dags/model'
import { reconcileDagWithGitHub } from '@/app/plan-graph-demo/github-reconciliation'

export function useGitHubReconciliation() {
  return useMutation({
    mutationFn: ({ document }: { document: DagDocument }) => reconcileDagWithGitHub(document),
  })
}
