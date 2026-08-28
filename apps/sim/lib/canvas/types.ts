export const CANVAS_DOCUMENT_KINDS = ['workflow', 'roadmap'] as const

export type CanvasDocumentKind = (typeof CANVAS_DOCUMENT_KINDS)[number]
