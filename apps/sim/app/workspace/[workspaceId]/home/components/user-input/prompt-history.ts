/** A temporary cursor over the native transcript, never another message store. */
export class PromptHistoryNavigation {
  private scope: string | undefined
  private entries: string[] = []
  private index = -1
  private draft = ''
  private recalled: string | undefined

  reset(): void {
    this.entries = []
    this.index = -1
    this.draft = ''
    this.recalled = undefined
  }

  navigate(
    direction: 'previous' | 'next',
    value: string,
    history: readonly string[],
    scope: string | undefined
  ): string | undefined {
    if (scope !== this.scope) {
      this.reset()
      this.scope = scope
    }
    if (this.index !== -1 && value !== this.recalled) {
      /** Edits belong to this navigation only; the transcript and original draft stay intact. */
      this.entries[this.index] = value
    }
    if (this.index === -1) {
      if (direction === 'next') return undefined
      const entries = history.filter((text) => text.trim().length > 0)
      if (entries.length === 0) return undefined
      /** Freeze navigation order while a turn or transcript refresh is arriving. */
      this.entries = entries
      this.draft = value
      this.index = entries.length
    }

    const nextIndex = this.index + (direction === 'previous' ? -1 : 1)
    if (nextIndex < 0) return undefined
    if (nextIndex >= this.entries.length) {
      const draft = this.draft
      this.reset()
      return draft
    }
    this.index = nextIndex
    this.recalled = this.entries[nextIndex]
    return this.recalled
  }
}
