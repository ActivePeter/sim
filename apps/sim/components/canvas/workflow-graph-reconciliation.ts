import { isEqual } from 'es-toolkit'
import type { Edge, Node } from 'reactflow'

/**
 * A derivation that changed nothing must produce no new reference at any level, so React Flow can
 * skip the subtree. Reuse is decided by identity after projection, which also catches reordering.
 */
function reconcileById<T extends { id: string }>(
  current: T[],
  derived: T[],
  project: (derivedItem: T, currentItem: T | undefined) => T,
  isReusable: (currentItem: T, nextItem: T) => boolean
): T[] {
  const currentById = new Map<string, T>()
  for (const item of current) currentById.set(item.id, item)

  const next = derived.map((derivedItem) => {
    const currentItem = currentById.get(derivedItem.id)
    const nextItem = project(derivedItem, currentItem)
    return currentItem && isReusable(currentItem, nextItem) ? currentItem : nextItem
  })

  const unchanged =
    next.length === current.length && next.every((item, index) => item === current[index])
  return unchanged ? current : next
}

/**
 * React Flow writes measured and dragging fields onto its node objects. Compare only values supplied
 * by the document projection so those transient fields do not force a new node every drag frame.
 */
function containsDerivedValues<T extends object>(current: T, derived: T): boolean {
  for (const key of Object.keys(derived) as (keyof T)[]) {
    if (!isEqual(current[key], derived[key])) return false
  }
  return true
}

/** Reuses unchanged React Flow node objects while carrying local selection forward. */
export function reconcileCanvasNodes<NodeType extends Node>(
  currentNodes: NodeType[],
  derivedNodes: NodeType[]
): NodeType[] {
  return reconcileById(
    currentNodes,
    derivedNodes,
    (derivedNode, currentNode) => ({ ...derivedNode, selected: currentNode?.selected ?? false }),
    containsDerivedValues
  )
}

/** Reuses unchanged React Flow edge objects after graph-level derivation reruns. */
export function reconcileCanvasEdges<EdgeType extends Edge>(
  currentEdges: EdgeType[],
  derivedEdges: EdgeType[]
): EdgeType[] {
  return reconcileById(currentEdges, derivedEdges, (derivedEdge) => derivedEdge, isEqual)
}
