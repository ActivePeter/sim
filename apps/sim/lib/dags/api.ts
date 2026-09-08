import {
  createInternalResourceConcealmentPolicy,
  createV2ResourceConcealmentPolicy,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'

export const v2DagErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'DAG not found',
})
export const internalDagErrorPolicy = createInternalResourceConcealmentPolicy({
  base: internalOrchestrationErrorPolicy,
  notFoundMessage: 'DAG not found',
})
