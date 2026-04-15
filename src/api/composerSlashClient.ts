import type { ComposerSlashSuggestionsResponse } from '../types/composerSlash'

export async function fetchComposerSlashSuggestions(cwd: string, q: string): Promise<ComposerSlashSuggestionsResponse> {
  const params = new URLSearchParams()
  const trimmedCwd = cwd.trim()
  if (trimmedCwd.length > 0) {
    params.set('cwd', trimmedCwd)
  }
  params.set('q', q)

  const response = await fetch(`/codex-api/composer/slash-suggestions?${params.toString()}`)
  const payload: unknown = await response.json().catch(() => ({}))
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}

  if (!response.ok) {
    const message = typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`
    throw new Error(message)
  }

  return payload as ComposerSlashSuggestionsResponse
}
