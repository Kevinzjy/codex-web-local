export type ComposerSlashSuggestionEntry = {
  id: string
  label: string
  insertText: string
  description?: string
}

export type ComposerSlashSuggestionsResponse = {
  entries: ComposerSlashSuggestionEntry[]
}
