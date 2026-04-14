import type { RateLimitSnapshot, ReasoningEffort } from '../api/appServerDtos'

export const CODEX_SESSION_CACHE_KEY = 'codex-web-local.session-cache.v1'

export type CodexSessionCacheV1 = {
  v: 1
  savedAt: number
  rateLimits: RateLimitSnapshot | null
  modelIds: string[]
  selectedModelId: string
  selectedReasoningEffort: string
}

function emptyCache(): CodexSessionCacheV1 {
  return {
    v: 1,
    savedAt: 0,
    rateLimits: null,
    modelIds: [],
    selectedModelId: '',
    selectedReasoningEffort: 'medium',
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function loadCodexSessionCache(): CodexSessionCacheV1 | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(CODEX_SESSION_CACHE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

    const record = parsed as Record<string, unknown>
    if (record.v !== 1) return null

    const modelIds = Array.isArray(record.modelIds)
      ? record.modelIds.filter(isNonEmptyString)
      : []

    const selectedModelId = isNonEmptyString(record.selectedModelId) ? record.selectedModelId : ''
    const selectedReasoningEffort = isNonEmptyString(record.selectedReasoningEffort)
      ? record.selectedReasoningEffort
      : 'medium'

    return {
      v: 1,
      savedAt: typeof record.savedAt === 'number' && Number.isFinite(record.savedAt) ? record.savedAt : 0,
      rateLimits: (record.rateLimits ?? null) as RateLimitSnapshot | null,
      modelIds,
      selectedModelId,
      selectedReasoningEffort,
    }
  } catch {
    return null
  }
}

export function mergeCodexSessionCache(
  patch: Partial<
    Pick<CodexSessionCacheV1, 'rateLimits' | 'modelIds' | 'selectedModelId' | 'selectedReasoningEffort'>
  >,
): void {
  if (typeof window === 'undefined') return

  const base = loadCodexSessionCache() ?? emptyCache()
  const next: CodexSessionCacheV1 = {
    ...base,
    ...patch,
    v: 1,
    savedAt: Date.now(),
  }

  try {
    window.localStorage.setItem(CODEX_SESSION_CACHE_KEY, JSON.stringify(next))
  } catch {
    // Ignore quota / private mode errors.
  }
}

export function persistModelPrefsFromState(
  modelIds: string[],
  selectedModelId: string,
  selectedReasoningEffort: ReasoningEffort | '',
): void {
  mergeCodexSessionCache({
    modelIds: [...modelIds],
    selectedModelId: selectedModelId.trim(),
    selectedReasoningEffort: selectedReasoningEffort || '',
  })
}
