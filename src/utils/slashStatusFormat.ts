import type { Account } from '../../documentation/app-server-schemas/typescript/v2/Account'
import type { Config } from '../../documentation/app-server-schemas/typescript/v2/Config'
import type { GetAccountRateLimitsResponse } from '../../documentation/app-server-schemas/typescript/v2/GetAccountRateLimitsResponse'
import type { RateLimitSnapshot } from '../../documentation/app-server-schemas/typescript/v2/RateLimitSnapshot'
import type { RateLimitWindow } from '../../documentation/app-server-schemas/typescript/v2/RateLimitWindow'
import type { ReasoningEffort } from '../../documentation/app-server-schemas/typescript/ReasoningEffort'
import type { ReasoningSummary } from '../../documentation/app-server-schemas/typescript/ReasoningSummary'
import type { ThreadPermissionMode } from '../types/codex'

const FIVE_HOUR_LIMIT_MINS = 5 * 60
const ONE_WEEK_LIMIT_MINS = 7 * 24 * 60

/**
 * Label column width (characters) so values align like Codex CLI `/status`.
 * Longest label: `Collaboration mode:`
 */
const SLASH_STATUS_KV_LABEL_WIDTH = 22

function kvLine(labelWithColon: string, value: string): string {
  return `${labelWithColon.padEnd(SLASH_STATUS_KV_LABEL_WIDTH)}${value}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isRateLimitSnapshot(value: unknown): value is RateLimitSnapshot {
  const record = asRecord(value)
  if (!record) return false
  return 'primary' in record || 'secondary' in record || 'credits' in record
}

export function selectRateLimitSnapshotFromPayload(payload: GetAccountRateLimitsResponse): RateLimitSnapshot | null {
  const byLimitId = payload.rateLimitsByLimitId
  const codexSnapshot = byLimitId?.codex
  if (isRateLimitSnapshot(codexSnapshot)) return codexSnapshot

  if (isRateLimitSnapshot(payload.rateLimits)) return payload.rateLimits

  if (byLimitId) {
    for (const snapshot of Object.values(byLimitId)) {
      if (isRateLimitSnapshot(snapshot)) return snapshot
    }
  }

  return null
}

function selectRateLimitWindow(targetDurationMins: number, snapshot: RateLimitSnapshot | null): RateLimitWindow | null {
  const windows = [snapshot?.primary ?? null, snapshot?.secondary ?? null].filter(
    (w): w is RateLimitWindow => w !== null,
  )
  const tolerance = targetDurationMins === FIVE_HOUR_LIMIT_MINS ? 5 : 60
  const exactWindow = windows.find(
    (window) =>
      typeof window.windowDurationMins === 'number' &&
      Math.abs(window.windowDurationMins - targetDurationMins) <= tolerance,
  )
  return exactWindow ?? snapshot?.primary ?? snapshot?.secondary ?? null
}

const resetFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function normalizedResetTimeMs(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function meterRemainingPercent(window: RateLimitWindow | null): number {
  if (!window) return 0
  return Math.round(clampPercent(100 - window.usedPercent))
}

function formatMeterBar(remainingPercent: number): string {
  const w = 20
  const filled = Math.round((w * remainingPercent) / 100)
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, w - filled))
  return `[${bar}] ${String(Math.round(remainingPercent))}% left`
}

function formatMeterValue(window: RateLimitWindow | null): string {
  if (!window) {
    return 'unavailable'
  }
  const rem = meterRemainingPercent(window)
  const bar = formatMeterBar(rem)
  const resetMs = normalizedResetTimeMs(window.resetsAt)
  const reset =
    resetMs !== null ? ` (resets ${resetFormatter.format(new Date(resetMs))})` : ''
  return `${bar}${reset}`
}

function formatAccountValue(account: Account | null): string {
  if (!account) {
    return 'not signed in'
  }
  if (account.type === 'apiKey') {
    return 'API key'
  }
  const plan =
    account.planType === 'unknown' || !account.planType
      ? 'Unknown'
      : account.planType.charAt(0).toUpperCase() + account.planType.slice(1)
  return `${account.email} (${plan})`
}

function formatPermissionsValue(perm: ThreadPermissionMode, config: Config | null): string {
  if (perm === 'full-access') {
    return 'Full access (unsandboxed)'
  }
  const sb = config?.sandbox_mode ?? '—'
  const ap = config?.approval_policy ?? '—'
  return `Custom (${sb}, ${ap})`
}

function formatModelValue(
  modelId: string,
  effort: ReasoningEffort | '',
  summary: ReasoningSummary | null | undefined,
): string {
  const m = modelId.trim() || '(default)'
  const e = effort && effort.length > 0 ? effort : 'default'
  const s = summary && summary !== 'none' ? summary : 'auto'
  return `${m} (reasoning ${e}, summaries ${s})`
}

function formatAgentsValue(config: Config | null): string {
  const p = config?.instructions?.trim()
  if (p && p.length > 0) {
    return p.length > 72 ? `${p.slice(0, 69)}…` : p
  }
  return '<none>'
}

export type SlashStatusFormatInput = {
  threadId: string
  cwd: string
  modelId: string
  reasoningEffort: ReasoningEffort | ''
  threadPermission: ThreadPermissionMode
  account: Account | null
  ratePayload: GetAccountRateLimitsResponse
  config: Config | null
}

/**
 * Plain-text panel similar to Codex CLI `/status` (see `codex-rs/tui` status card).
 * Two-column layout: fixed-width labels so values (and `[` progress bars) align vertically.
 */
export function formatSlashStatusCardText(input: SlashStatusFormatInput): string {
  const snapshot = selectRateLimitSnapshotFromPayload(input.ratePayload)
  const primary5h = selectRateLimitWindow(FIVE_HOUR_LIMIT_MINS, snapshot)
  const secondaryWeek = selectRateLimitWindow(ONE_WEEK_LIMIT_MINS, snapshot)

  const lines: string[] = [
    '> OpenAI Codex (web)',
    '',
    'Visit https://chatgpt.com/codex/settings/usage for up-to-date',
    'information on rate limits and credits',
    '',
    kvLine('Model:', formatModelValue(input.modelId, input.reasoningEffort, input.config?.model_reasoning_summary)),
    kvLine('Directory:', input.cwd.trim() || '—'),
    kvLine('Permissions:', formatPermissionsValue(input.threadPermission, input.config)),
    kvLine('Agents.md:', formatAgentsValue(input.config)),
    kvLine('Account:', formatAccountValue(input.account)),
    kvLine('Collaboration mode:', 'Default'),
    kvLine('Session:', input.threadId),
    '',
    kvLine('5h limit:', formatMeterValue(primary5h)),
    kvLine('Weekly limit:', formatMeterValue(secondaryWeek)),
  ]

  return lines.join('\n')
}
