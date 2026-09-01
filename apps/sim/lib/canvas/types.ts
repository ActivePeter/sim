export const CANVAS_DOCUMENT_KINDS = ['workflow', 'dag'] as const

export type CanvasDocumentKind = (typeof CANVAS_DOCUMENT_KINDS)[number]
