import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  archiveThread,
  getAccountInfo,
  getAccountRateLimits,
  getAvailableModelIds,
  getCurrentModelConfig,
  getChatState,
  getGitStatus,
  getPendingServerRequests,
  patchChatState,
  interruptThreadTurn,
  replyToServerRequest,
  getThreadGroups,
  getThreadMessages,
  readEffectiveConfig,
  resumeThread,
  forkThread,
  setThreadName as setThreadNameApi,
  startThread,
  subscribeCodexNotifications,
  startThreadTurn,
  type RpcNotification,
  type ThreadFlagSyncEntry,
  type ThreadRunStateEntry,
} from '../api/codexGateway'
import type {
  GetAccountRateLimitsResponse,
  RateLimitSnapshot,
} from '../api/appServerDtos'
import {
  loadCodexSessionCache,
  mergeCodexSessionCache,
  persistModelPrefsFromState,
} from '../utils/codexSessionCache'
import { tryParseBareSlashCommand } from '../utils/slashCommandParse'
import { formatSlashStatusCardText, selectRateLimitSnapshotFromPayload } from '../utils/slashStatusFormat'
import { isThreadReadNotMaterializedError } from '../api/codexErrors'
import type {
  ReasoningEffort,
  ThreadPermissionMode,
  ThreadScrollState,
  UiComposerDraft,
  UiGitStatus,
  UiLiveOverlay,
  UiMessage,
  UiProjectGroup,
  UiServerRequest,
  UiServerRequestId,
  UiServerRequestReply,
  UiThread,
} from '../types/codex'

function flattenThreads(groups: UiProjectGroup[]): UiThread[] {
  return groups.flatMap((group) => group.threads)
}

const APPROVAL_REQUEST_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'execCommandApproval',
  'applyPatchApproval',
])

function normalizeComposerDraft(draft: UiComposerDraft): UiComposerDraft {
  return {
    text: draft.text.trim(),
    images: draft.images.filter((image) => image.url.trim().length > 0),
  }
}

function isComposerDraftEmpty(draft: UiComposerDraft): boolean {
  return draft.text.length === 0 && draft.images.length === 0
}

function isApprovalServerRequest(request: UiServerRequest): boolean {
  return APPROVAL_REQUEST_METHODS.has(request.method)
}

const READ_STATE_STORAGE_KEY = 'codex-web-local.thread-read-state.v1'
const SCROLL_STATE_STORAGE_KEY = 'codex-web-local.thread-scroll-state.v1'
const SELECTED_THREAD_STORAGE_KEY = 'codex-web-local.selected-thread-id.v1'
const PROJECT_ORDER_STORAGE_KEY = 'codex-web-local.project-order.v1'
const PROJECT_DISPLAY_NAME_STORAGE_KEY = 'codex-web-local.project-display-name.v1'
const PROJECT_CWD_STORAGE_KEY = 'codex-web-local.project-cwd.v1'
const THREAD_DISPLAY_NAME_STORAGE_KEY = 'codex-web-local.thread-display-name.v1'
const MANUAL_UNREAD_STORAGE_KEY = 'codex-web-local.manual-unread.v1'
const MANUAL_UNREAD_SYNC_STORAGE_KEY = 'codex-web-local.manual-unread-sync.v1'
const EVENT_UNREAD_SYNC_STORAGE_KEY = 'codex-web-local.event-unread-sync.v1'
const THREAD_RUN_STATE_STORAGE_KEY = 'codex-web-local.thread-run-state-sync.v1'
const AUTO_REFRESH_ENABLED_STORAGE_KEY = 'codex-web-local.auto-refresh-enabled.v1'
const EVENT_SYNC_DEBOUNCE_MS = 220
const AUTO_REFRESH_INTERVAL_MS = 4000
const GIT_STATUS_MIN_GAP_MS = 2000
const CHAT_STATE_SYNC_DEBOUNCE_MS = 450
const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const GLOBAL_SERVER_REQUEST_SCOPE = '__global__'
const INITIAL_CODEX_FETCH_ATTEMPTS = 4
const INITIAL_CODEX_FETCH_BASE_DELAY_MS = 400

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const THREAD_READ_MATERIALIZE_MAX_ATTEMPTS = 24
const THREAD_READ_MATERIALIZE_RETRY_GAP_MS = 350

/**
 * In production, thread/read may briefly fail with "not materialized yet" while the session warms up.
 * Retry silently; in dev, surface the error immediately for debugging.
 */
async function getThreadMessagesWithProdWarmupRetry(threadId: string): Promise<UiMessage[]> {
  if (import.meta.env.DEV) {
    return getThreadMessages(threadId)
  }
  for (let attempt = 0; attempt < THREAD_READ_MATERIALIZE_MAX_ATTEMPTS; attempt++) {
    try {
      return await getThreadMessages(threadId)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (isThreadReadNotMaterializedError(msg) && attempt < THREAD_READ_MATERIALIZE_MAX_ATTEMPTS - 1) {
        await sleepMs(THREAD_READ_MATERIALIZE_RETRY_GAP_MS)
        continue
      }
      throw error
    }
  }
  throw new Error('thread/read retry loop exited unexpectedly')
}

async function retryCodexFetch<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < INITIAL_CODEX_FETCH_ATTEMPTS; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < INITIAL_CODEX_FETCH_ATTEMPTS - 1) {
        await sleepMs(INITIAL_CODEX_FETCH_BASE_DELAY_MS * (attempt + 1))
      }
    }
  }
  throw lastError
}

function loadReadStateMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(READ_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function saveReadStateMap(state: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(READ_STATE_STORAGE_KEY, JSON.stringify(state))
}

function mergeReadStateByThreadId(
  local: Record<string, string>,
  remote: Record<string, string>,
): Record<string, string> {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
  const next: Record<string, string> = {}
  for (const threadId of keys) {
    const a = local[threadId]?.trim() ?? ''
    const b = remote[threadId]?.trim() ?? ''
    if (!a && !b) continue
    if (!a) {
      next[threadId] = b
    } else if (!b) {
      next[threadId] = a
    } else {
      next[threadId] = a >= b ? a : b
    }
  }
  return next
}

function areReadStateMapsEqual(first: Record<string, string>, second: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)])
  for (const k of keys) {
    if ((first[k] ?? '') !== (second[k] ?? '')) return false
  }
  return true
}

function migrateLegacyManualBoolsToSync(legacy: Record<string, boolean>): Record<string, ThreadFlagSyncEntry> {
  const out: Record<string, ThreadFlagSyncEntry> = {}
  for (const [tid, v] of Object.entries(legacy)) {
    if (v === true) {
      out[tid] = { value: true, bumpMs: 0 }
    }
  }
  return out
}

function loadFlagSyncRecord(storageKey: string): Record<string, ThreadFlagSyncEntry> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record: Record<string, ThreadFlagSyncEntry> = {}
    for (const [key, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string' || key.length === 0) continue
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
      const e = rawEntry as Record<string, unknown>
      const bumpMs = typeof e.bumpMs === 'number' && Number.isFinite(e.bumpMs) ? e.bumpMs : 0
      if (e.value === true) {
        record[key] = { value: true, bumpMs }
      } else if (e.value === false) {
        record[key] = { value: false, bumpMs }
      }
    }
    return record
  } catch {
    return {}
  }
}

function saveFlagSyncRecord(storageKey: string, record: Record<string, ThreadFlagSyncEntry>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(record))
}

function loadRunStateRecord(storageKey: string): Record<string, ThreadRunStateEntry> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record: Record<string, ThreadRunStateEntry> = {}
    for (const [key, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string' || key.length === 0) continue
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue
      const e = rawEntry as Record<string, unknown>
      const bumpMs = typeof e.bumpMs === 'number' && Number.isFinite(e.bumpMs) ? e.bumpMs : 0
      if (e.turnId === null) {
        record[key] = { turnId: null, bumpMs }
      } else if (typeof e.turnId === 'string' && e.turnId.length > 0) {
        record[key] = { turnId: e.turnId, bumpMs }
      }
    }
    return record
  } catch {
    return {}
  }
}

function saveRunStateRecord(storageKey: string, record: Record<string, ThreadRunStateEntry>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(record))
}

function mergeFlagSyncByThreadId(
  local: Record<string, ThreadFlagSyncEntry>,
  remote: Record<string, ThreadFlagSyncEntry>,
): Record<string, ThreadFlagSyncEntry> {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
  const next: Record<string, ThreadFlagSyncEntry> = {}
  for (const tid of keys) {
    const a = local[tid]
    const b = remote[tid]
    if (!a && !b) continue
    if (!a) {
      next[tid] = b!
      continue
    }
    if (!b) {
      next[tid] = a
      continue
    }
    next[tid] = a.bumpMs >= b.bumpMs ? a : b
  }
  return next
}

function mergeThreadRunStateMap(
  local: Record<string, ThreadRunStateEntry>,
  remote: Record<string, ThreadRunStateEntry>,
): Record<string, ThreadRunStateEntry> {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
  const next: Record<string, ThreadRunStateEntry> = {}
  for (const tid of keys) {
    const a = local[tid]
    const b = remote[tid]
    if (!a && !b) continue
    if (!a) {
      next[tid] = b!
      continue
    }
    if (!b) {
      next[tid] = a
      continue
    }
    next[tid] = a.bumpMs >= b.bumpMs ? a : b
  }
  return next
}

function areFlagSyncMapsEqual(
  first: Record<string, ThreadFlagSyncEntry>,
  second: Record<string, ThreadFlagSyncEntry>,
): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)])
  for (const k of keys) {
    const a = first[k]
    const b = second[k]
    if (!a && !b) continue
    if (!a || !b) return false
    if (a.value !== b.value || a.bumpMs !== b.bumpMs) return false
  }
  return true
}

function areRunStateMapsEqual(
  first: Record<string, ThreadRunStateEntry>,
  second: Record<string, ThreadRunStateEntry>,
): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)])
  for (const k of keys) {
    const a = first[k]
    const b = second[k]
    if (!a && !b) continue
    if (!a || !b) return false
    if (a.turnId !== b.turnId || a.bumpMs !== b.bumpMs) return false
  }
  return true
}

function loadAutoRefreshEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(AUTO_REFRESH_ENABLED_STORAGE_KEY) === '1'
}

function saveAutoRefreshEnabled(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUTO_REFRESH_ENABLED_STORAGE_KEY, value ? '1' : '0')
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

function normalizeThreadScrollState(value: unknown): ThreadScrollState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const rawState = value as Record<string, unknown>
  if (typeof rawState.scrollTop !== 'number' || !Number.isFinite(rawState.scrollTop)) return null
  if (typeof rawState.isAtBottom !== 'boolean') return null

  const normalized: ThreadScrollState = {
    scrollTop: Math.max(0, rawState.scrollTop),
    isAtBottom: rawState.isAtBottom,
  }

  if (typeof rawState.scrollRatio === 'number' && Number.isFinite(rawState.scrollRatio)) {
    normalized.scrollRatio = clamp(rawState.scrollRatio, 0, 1)
  }

  return normalized
}

function loadThreadScrollStateMap(): Record<string, ThreadScrollState> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(SCROLL_STATE_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const normalizedMap: Record<string, ThreadScrollState> = {}
    for (const [threadId, state] of Object.entries(parsed as Record<string, unknown>)) {
      if (!threadId) continue
      const normalizedState = normalizeThreadScrollState(state)
      if (normalizedState) {
        normalizedMap[threadId] = normalizedState
      }
    }
    return normalizedMap
  } catch {
    return {}
  }
}

function saveThreadScrollStateMap(state: Record<string, ThreadScrollState>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SCROLL_STATE_STORAGE_KEY, JSON.stringify(state))
}

function loadSelectedThreadId(): string {
  if (typeof window === 'undefined') return ''
  const raw = window.localStorage.getItem(SELECTED_THREAD_STORAGE_KEY)
  return raw ?? ''
}

function saveSelectedThreadId(threadId: string): void {
  if (typeof window === 'undefined') return
  if (!threadId) {
    window.localStorage.removeItem(SELECTED_THREAD_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SELECTED_THREAD_STORAGE_KEY, threadId)
}

function loadProjectOrder(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(PROJECT_ORDER_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const order: string[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && item.length > 0 && !order.includes(item)) {
        order.push(item)
      }
    }
    return order
  } catch {
    return []
  }
}

function saveProjectOrder(order: string[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(order))
}

function loadProjectDisplayNames(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(PROJECT_DISPLAY_NAME_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const displayNames: Record<string, string> = {}
    for (const [projectName, displayName] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof projectName === 'string' && projectName.length > 0 && typeof displayName === 'string') {
        displayNames[projectName] = displayName
      }
    }
    return displayNames
  } catch {
    return {}
  }
}

function saveProjectDisplayNames(displayNames: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROJECT_DISPLAY_NAME_STORAGE_KEY, JSON.stringify(displayNames))
}

function loadStringRecord(storageKey: string): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const record: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.length > 0 && typeof value === 'string' && value.length > 0) {
        record[key] = value
      }
    }
    return record
  } catch {
    return {}
  }
}

function saveStringRecord(storageKey: string, record: Record<string, string>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(record))
}

function loadBooleanRecord(storageKey: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const record: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.length > 0 && value === true) {
        record[key] = true
      }
    }
    return record
  } catch {
    return {}
  }
}

function saveBooleanRecord(storageKey: string, record: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey, JSON.stringify(record))
}

function serializeDesktopChatSlice(
  order: string[],
  display: Record<string, string>,
  projectCwd: Record<string, string>,
  manualUnreadSync: Record<string, ThreadFlagSyncEntry>,
  eventUnreadSync: Record<string, ThreadFlagSyncEntry>,
  threadRunState: Record<string, ThreadRunStateEntry>,
  readState: Record<string, string>,
  permissionModes: Record<string, ThreadPermissionMode>,
  fullAccessAck: Record<string, boolean>,
): string {
  return JSON.stringify({
    projectOrder: order,
    projectDisplayNames: display,
    projectCwdByProjectName: projectCwd,
    manualUnreadSyncByThreadId: manualUnreadSync,
    eventUnreadSyncByThreadId: eventUnreadSync,
    threadRunStateByThreadId: threadRunState,
    readStateByThreadId: readState,
    threadPermissionModeByThreadId: permissionModes,
    threadFullAccessAcknowledgedByThreadId: fullAccessAck,
  })
}

const EMPTY_DESKTOP_CHAT_SLICE = serializeDesktopChatSlice([], {}, {}, {}, {}, {}, {}, {}, {})

function mergeProjectOrder(previousOrder: string[], incomingGroups: UiProjectGroup[]): string[] {
  const nextOrder = [...previousOrder]

  for (const group of incomingGroups) {
    if (!nextOrder.includes(group.projectName)) {
      nextOrder.push(group.projectName)
    }
  }

  return areStringArraysEqual(previousOrder, nextOrder) ? previousOrder : nextOrder
}

function orderGroupsByProjectOrder(incoming: UiProjectGroup[], projectOrder: string[]): UiProjectGroup[] {
  const incomingByName = new Map(incoming.map((group) => [group.projectName, group]))
  const ordered: UiProjectGroup[] = projectOrder.map((projectName) => {
    const incomingGroup = incomingByName.get(projectName)
    if (incomingGroup) {
      return incomingGroup
    }
    return {
      projectName,
      threads: [],
    }
  })

  for (const group of incoming) {
    if (!projectOrder.includes(group.projectName)) {
      ordered.push(group)
    }
  }

  return ordered
}

function areStringArraysEqual(first?: string[], second?: string[]): boolean {
  const left = Array.isArray(first) ? first : []
  const right = Array.isArray(second) ? second : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function reorderStringArray(items: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items
  }

  if (fromIndex === toIndex) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function areMessageFieldsEqual(first: UiMessage, second: UiMessage): boolean {
  return (
    first.id === second.id &&
    first.role === second.role &&
    first.text === second.text &&
    areStringArraysEqual(first.images, second.images) &&
    first.messageType === second.messageType &&
    first.rawPayload === second.rawPayload &&
    first.isUnhandled === second.isUnhandled
  )
}

function areMessageArraysEqual(first: UiMessage[], second: UiMessage[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function mergeMessages(
  previous: UiMessage[],
  incoming: UiMessage[],
  options: { preserveMissing?: boolean } = {},
): UiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  const incomingById = new Map(incoming.map((message) => [message.id, message]))

  const mergedIncoming = incoming.map((incomingMessage) => {
    const previousMessage = previousById.get(incomingMessage.id)
    if (previousMessage && areMessageFieldsEqual(previousMessage, incomingMessage)) {
      return previousMessage
    }
    return incomingMessage
  })

  if (options.preserveMissing !== true) {
    return areMessageArraysEqual(previous, mergedIncoming) ? previous : mergedIncoming
  }

  const mergedFromPrevious = previous.map((previousMessage) => {
    const nextMessage = incomingById.get(previousMessage.id)
    if (!nextMessage) {
      return previousMessage
    }
    if (areMessageFieldsEqual(previousMessage, nextMessage)) {
      return previousMessage
    }
    return nextMessage
  })

  const previousIdSet = new Set(previous.map((message) => message.id))
  const appended = mergedIncoming.filter((message) => !previousIdSet.has(message.id))
  const merged = [...mergedFromPrevious, ...appended]

  return areMessageArraysEqual(previous, merged) ? previous : merged
}

function normalizeMessageText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function removeRedundantLiveAgentMessages(previous: UiMessage[], incoming: UiMessage[]): UiMessage[] {
  const incomingAssistantTexts = new Set(
    incoming
      .filter((message) => message.role === 'assistant')
      .map((message) => normalizeMessageText(message.text))
      .filter((text) => text.length > 0),
  )

  if (incomingAssistantTexts.size === 0) {
    return previous
  }

  const next = previous.filter((message) => {
    if (message.messageType !== 'agentMessage.live') return true
    const normalized = normalizeMessageText(message.text)
    if (normalized.length === 0) return false
    return !incomingAssistantTexts.has(normalized)
  })

  return next.length === previous.length ? previous : next
}

function upsertMessage(previous: UiMessage[], nextMessage: UiMessage): UiMessage[] {
  const existingIndex = previous.findIndex((message) => message.id === nextMessage.id)
  if (existingIndex < 0) {
    return [...previous, nextMessage]
  }

  const existing = previous[existingIndex]
  if (areMessageFieldsEqual(existing, nextMessage)) {
    return previous
  }

  const next = [...previous]
  next.splice(existingIndex, 1, nextMessage)
  return next
}

type TurnSummaryState = {
  turnId: string
  durationMs: number
}

type TurnActivityState = {
  label: string
  details: string[]
}

type TurnErrorState = {
  message: string
}

type TurnStartedInfo = {
  threadId: string
  turnId: string
  startedAtMs: number
}

type TurnCompletedInfo = {
  threadId: string
  turnId: string
  completedAtMs: number
  startedAtMs?: number
}

const WORKED_MESSAGE_TYPE = 'worked'

function parseIsoTimestamp(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function formatTurnDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '<1s'
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`)
  }

  const displaySeconds = seconds > 0 || parts.length === 0 ? seconds : 0
  parts.push(`${displaySeconds}s`)
  return parts.join(' ')
}

function areTurnSummariesEqual(first?: TurnSummaryState, second?: TurnSummaryState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  return first.turnId === second.turnId && first.durationMs === second.durationMs
}

function areTurnActivitiesEqual(first?: TurnActivityState, second?: TurnActivityState): boolean {
  if (!first && !second) return true
  if (!first || !second) return false
  if (first.label !== second.label) return false
  if (first.details.length !== second.details.length) return false
  for (let index = 0; index < first.details.length; index += 1) {
    if (first.details[index] !== second.details[index]) return false
  }
  return true
}

function buildTurnSummaryMessage(summary: TurnSummaryState): UiMessage {
  return {
    id: `turn-summary:${summary.turnId}`,
    role: 'system',
    text: `Worked for ${formatTurnDuration(summary.durationMs)}`,
    messageType: WORKED_MESSAGE_TYPE,
  }
}

function findLastAssistantMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return index
    }
  }
  return -1
}

function insertTurnSummaryMessage(messages: UiMessage[], summary: TurnSummaryState): UiMessage[] {
  const summaryMessage = buildTurnSummaryMessage(summary)
  const sanitizedMessages = messages.filter((message) => message.messageType !== WORKED_MESSAGE_TYPE)
  const insertIndex = findLastAssistantMessageIndex(sanitizedMessages)
  if (insertIndex < 0) {
    return [...sanitizedMessages, summaryMessage]
  }
  const next = [...sanitizedMessages]
  next.splice(insertIndex, 0, summaryMessage)
  return next
}

function omitKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function areThreadFieldsEqual(first: UiThread, second: UiThread): boolean {
  return (
    first.id === second.id &&
    first.title === second.title &&
    first.projectName === second.projectName &&
    first.cwd === second.cwd &&
    first.createdAtIso === second.createdAtIso &&
    first.updatedAtIso === second.updatedAtIso &&
    first.preview === second.preview &&
    first.unread === second.unread &&
    first.inProgress === second.inProgress
  )
}

function areThreadArraysEqual(first: UiThread[], second: UiThread[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function areGroupArraysEqual(first: UiProjectGroup[], second: UiProjectGroup[]): boolean {
  if (first.length !== second.length) return false
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false
  }
  return true
}

function pruneThreadStateMap<T>(stateMap: Record<string, T>, threadIds: Set<string>): Record<string, T> {
  const nextEntries = Object.entries(stateMap).filter(([threadId]) => threadIds.has(threadId))
  if (nextEntries.length === Object.keys(stateMap).length) {
    return stateMap
  }
  return Object.fromEntries(nextEntries) as Record<string, T>
}

function mergeThreadGroups(
  previous: UiProjectGroup[],
  incoming: UiProjectGroup[],
): UiProjectGroup[] {
  const previousGroupsByName = new Map(previous.map((group) => [group.projectName, group]))
  const mergedGroups: UiProjectGroup[] = incoming.map((incomingGroup) => {
    const previousGroup = previousGroupsByName.get(incomingGroup.projectName)
    const previousThreadsById = new Map(previousGroup?.threads.map((thread) => [thread.id, thread]) ?? [])

    const mergedThreads = incomingGroup.threads.map((incomingThread) => {
      const previousThread = previousThreadsById.get(incomingThread.id)
      if (previousThread && areThreadFieldsEqual(previousThread, incomingThread)) {
        return previousThread
      }
      return incomingThread
    })

    if (
      previousGroup &&
      previousGroup.projectName === incomingGroup.projectName &&
      areThreadArraysEqual(previousGroup.threads, mergedThreads)
    ) {
      return previousGroup
    }

    return {
      projectName: incomingGroup.projectName,
      threads: mergedThreads,
    }
  })

  return areGroupArraysEqual(previous, mergedGroups) ? previous : mergedGroups
}

export function useDesktopState() {
  const projectGroups = ref<UiProjectGroup[]>([])
  const sourceGroups = ref<UiProjectGroup[]>([])
  const selectedThreadId = ref(loadSelectedThreadId())
  const persistedMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  /** User-issued slash commands handled in the web UI (not sent as model turns), e.g. /status */
  const clientSlashMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveAgentMessagesByThreadId = ref<Record<string, UiMessage[]>>({})
  const liveReasoningTextByThreadId = ref<Record<string, string>>({})
  const inProgressById = ref<Record<string, boolean>>({})
  /** Thread ids created locally that are not yet returned by thread list API (can lag several seconds). */
  const threadIdsAwaitingSidebar = ref<Set<string>>(new Set())
  const manualUnreadSyncByThreadId = ref<Record<string, ThreadFlagSyncEntry>>(
    mergeFlagSyncByThreadId(
      migrateLegacyManualBoolsToSync(loadBooleanRecord(MANUAL_UNREAD_STORAGE_KEY)),
      loadFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY),
    ),
  )
  const eventUnreadSyncByThreadId = ref<Record<string, ThreadFlagSyncEntry>>(loadFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY))
  const threadRunStateByThreadId = ref<Record<string, ThreadRunStateEntry>>(loadRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY))
  const availableModelIds = ref<string[]>([])
  const selectedModelId = ref('')
  const selectedReasoningEffort = ref<ReasoningEffort | ''>('medium')
  const contextUsagePercentByThreadId = ref<Record<string, number>>({})
  const accountRateLimits = ref<RateLimitSnapshot | null>(null)
  const accountRateLimitsError = ref('')
  const gitStatusByCwd = ref<Record<string, UiGitStatus>>({})
  const gitStatusLoadingByCwd = ref<Record<string, boolean>>({})
  const lastGitFetchAtByCwd = ref<Record<string, number>>({})
  const readStateByThreadId = ref<Record<string, string>>(loadReadStateMap())
  const scrollStateByThreadId = ref<Record<string, ThreadScrollState>>(loadThreadScrollStateMap())
  const projectOrder = ref<string[]>(loadProjectOrder())
  const projectDisplayNameById = ref<Record<string, string>>(loadProjectDisplayNames())
  const projectCwdByProjectName = ref<Record<string, string>>(loadStringRecord(PROJECT_CWD_STORAGE_KEY))
  const threadDisplayNameById = ref<Record<string, string>>(loadStringRecord(THREAD_DISPLAY_NAME_STORAGE_KEY))
  /** True while applying chat-state from server to avoid feedback loops with push + watch. */
  const isApplyingRemoteDesktopChatState = ref(false)
  const threadPermissionModeByThreadId = ref<Record<string, ThreadPermissionMode>>({})
  /** Permission for the first message on the home / new-thread route (no thread id yet). */
  const newThreadPermissionMode = ref<ThreadPermissionMode>('default')
  const pendingFullAccessNewThreadCwd = ref('')
  const threadFullAccessAcknowledgedByThreadId = ref<Record<string, boolean>>({})
  const fullAccessRiskModalOpen = ref(false)
  const pendingDraftForFullAccessAck = ref<UiComposerDraft | null>(null)
  const loadedVersionByThreadId = ref<Record<string, string>>({})
  const loadedMessagesByThreadId = ref<Record<string, boolean>>({})
  const resumedThreadById = ref<Record<string, boolean>>({})
  const turnSummaryByThreadId = ref<Record<string, TurnSummaryState>>({})
  const turnActivityByThreadId = ref<Record<string, TurnActivityState>>({})
  const turnErrorByThreadId = ref<Record<string, TurnErrorState>>({})
  const activeTurnIdByThreadId = ref<Record<string, string>>({})
  const pendingServerRequestsByThreadId = ref<Record<string, UiServerRequest[]>>({})

  const isLoadingThreads = ref(false)
  const isLoadingMessages = ref(false)
  const isSendingMessage = ref(false)
  const isInterruptingTurn = ref(false)
  const isLoadingRateLimits = ref(false)
  {
    const cached = loadCodexSessionCache()
    if (cached) {
      if (cached.rateLimits) {
        accountRateLimits.value = cached.rateLimits
      }
      if (cached.modelIds.length > 0) {
        availableModelIds.value = cached.modelIds
        const preferred = cached.selectedModelId.trim()
        if (preferred && cached.modelIds.includes(preferred)) {
          selectedModelId.value = preferred
        } else {
          selectedModelId.value = cached.modelIds[0]
        }
      }
      const effortRaw = cached.selectedReasoningEffort
      if (effortRaw === '') {
        selectedReasoningEffort.value = 'medium'
      } else if (REASONING_EFFORT_OPTIONS.includes(effortRaw as ReasoningEffort)) {
        selectedReasoningEffort.value = effortRaw as ReasoningEffort
      }
    }
  }
  const error = ref('')
  const isPolling = ref(false)
  const hasLoadedThreads = ref(false)
  const isAutoRefreshEnabled = ref(loadAutoRefreshEnabled())
  const autoRefreshSecondsLeft = ref(Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000))
  let stopNotificationStream: (() => void) | null = null
  let eventSyncTimer: number | null = null
  let autoRefreshIntervalTimer: number | null = null
  let autoRefreshCountdownTimer: number | null = null
  let pendingThreadsRefresh = false
  const pendingThreadMessageRefresh = new Set<string>()
  let activeReasoningItemId = ''
  let shouldAutoScrollOnNextAgentEvent = false
  const pendingTurnStartsById = new Map<string, TurnStartedInfo>()

  const allThreads = computed(() => flattenThreads(projectGroups.value))
  const selectedThread = computed(() =>
    allThreads.value.find((thread) => thread.id === selectedThreadId.value) ?? null,
  )
  const selectedThreadScrollState = computed<ThreadScrollState | null>(
    () => scrollStateByThreadId.value[selectedThreadId.value] ?? null,
  )
  const selectedContextUsagePercent = computed<number | null>(
    () => contextUsagePercentByThreadId.value[selectedThreadId.value] ?? null,
  )
  const activeGitCwd = computed(() => selectedThread.value?.cwd?.trim() ?? '')
  const selectedThreadGitStatus = computed<UiGitStatus | null>(() => {
    const cwd = activeGitCwd.value
    if (!cwd) return null
    return gitStatusByCwd.value[cwd] ?? null
  })
  const selectedThreadGitStatusLoading = computed(() => {
    const cwd = activeGitCwd.value
    if (!cwd) return false
    return gitStatusLoadingByCwd.value[cwd] === true
  })
  const selectedThreadServerRequests = computed<UiServerRequest[]>(() => {
    const rows: UiServerRequest[] = []
    const selected = selectedThreadId.value
    if (selected && Array.isArray(pendingServerRequestsByThreadId.value[selected])) {
      rows.push(...pendingServerRequestsByThreadId.value[selected])
    }
    if (Array.isArray(pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])) {
      rows.push(...pendingServerRequestsByThreadId.value[GLOBAL_SERVER_REQUEST_SCOPE])
    }
    return rows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso))
  })
  const pendingApprovalRequests = computed<UiServerRequest[]>(() =>
    Object.values(pendingServerRequestsByThreadId.value)
      .flat()
      .filter(isApprovalServerRequest)
      .sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
  )
  const selectedLiveOverlay = computed<UiLiveOverlay | null>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return null

    const activity = turnActivityByThreadId.value[threadId]
    const reasoningText = (liveReasoningTextByThreadId.value[threadId] ?? '').trim()
    const errorText = (turnErrorByThreadId.value[threadId]?.message ?? '').trim()

    if (!activity && !reasoningText && !errorText) return null
    return {
      activityLabel: activity?.label || 'Thinking',
      activityDetails: activity?.details ?? [],
      reasoningText,
      errorText,
    }
  })
  const messages = computed<UiMessage[]>(() => {
    const threadId = selectedThreadId.value
    if (!threadId) return []

    const persisted = persistedMessagesByThreadId.value[threadId] ?? []
    const liveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
    const combined = persisted === liveAgent ? persisted : [...persisted, ...liveAgent]
    const slash = clientSlashMessagesByThreadId.value[threadId] ?? []
    const withSlash = slash.length > 0 ? [...combined, ...slash] : combined

    const summary = turnSummaryByThreadId.value[threadId]
    if (!summary) return withSlash
    return insertTurnSummaryMessage(withSlash, summary)
  })

  function setSelectedThreadId(nextThreadId: string): void {
    if (selectedThreadId.value === nextThreadId) return
    selectedThreadId.value = nextThreadId
    saveSelectedThreadId(nextThreadId)
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
  }

  function setSelectedModelId(modelId: string): void {
    const next = modelId.trim()
    if (selectedModelId.value === next) return
    selectedModelId.value = next
    if (availableModelIds.value.length > 0) {
      persistModelPrefsFromState(availableModelIds.value, next, selectedReasoningEffort.value)
    }
  }

  function setSelectedReasoningEffort(effort: ReasoningEffort | ''): void {
    if (effort && !REASONING_EFFORT_OPTIONS.includes(effort)) {
      return
    }
    if (selectedReasoningEffort.value === effort) return
    selectedReasoningEffort.value = effort
    if (availableModelIds.value.length > 0) {
      persistModelPrefsFromState(availableModelIds.value, selectedModelId.value, effort)
    }
  }

  function buildPendingTurnDetails(modelId: string, effort: ReasoningEffort | ''): string[] {
    const modelLabel = modelId.trim() || 'default'
    const effortLabel = effort || 'default'
    return [`Model: ${modelLabel}`, `Thinking: ${effortLabel}`]
  }

  async function refreshModelPreferences(): Promise<void> {
    try {
      const [modelIds, currentConfig] = await retryCodexFetch(() =>
        Promise.all([getAvailableModelIds(), getCurrentModelConfig()]),
      )

      availableModelIds.value = modelIds

      const hasSelectedModel = selectedModelId.value.length > 0 && modelIds.includes(selectedModelId.value)
      if (!hasSelectedModel) {
        if (currentConfig.model && modelIds.includes(currentConfig.model)) {
          selectedModelId.value = currentConfig.model
        } else if (modelIds.length > 0) {
          selectedModelId.value = modelIds[0]
        } else {
          selectedModelId.value = ''
        }
      }

      if (
        currentConfig.reasoningEffort &&
        REASONING_EFFORT_OPTIONS.includes(currentConfig.reasoningEffort)
      ) {
        selectedReasoningEffort.value = currentConfig.reasoningEffort
      }

      if (modelIds.length > 0) {
        persistModelPrefsFromState(modelIds, selectedModelId.value, selectedReasoningEffort.value)
      }
    } catch {
      // Keep chat UI usable even if model metadata is temporarily unavailable.
    }
  }

  async function refreshGitStatusForCwd(cwd: string, options: { force?: boolean } = {}): Promise<void> {
    const normalized = cwd.trim()
    if (!normalized) return

    const now = Date.now()
    const last = lastGitFetchAtByCwd.value[normalized] ?? 0
    if (!options.force && now - last < GIT_STATUS_MIN_GAP_MS) {
      return
    }

    gitStatusLoadingByCwd.value = {
      ...gitStatusLoadingByCwd.value,
      [normalized]: true,
    }

    try {
      const status = await getGitStatus(normalized)
      gitStatusByCwd.value = {
        ...gitStatusByCwd.value,
        [normalized]: status,
      }
      lastGitFetchAtByCwd.value = {
        ...lastGitFetchAtByCwd.value,
        [normalized]: now,
      }
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Failed to load git status'
      gitStatusByCwd.value = {
        ...gitStatusByCwd.value,
        [normalized]: {
          ok: false,
          cwd: normalized,
          code: 'internal',
          message,
          lastUpdatedAt: Date.now(),
        },
      }
    } finally {
      gitStatusLoadingByCwd.value = omitKey(gitStatusLoadingByCwd.value, normalized)
    }
  }

  watch(
    activeGitCwd,
    (cwd) => {
      if (!cwd) return
      void refreshGitStatusForCwd(cwd)
    },
    { flush: 'post' },
  )

  function patchThreadTitleInSourceGroups(threadId: string, title: string): void {
    const normalizedTitle = title.trim()
    if (!threadId || !normalizedTitle) return

    let changed = false
    const next = sourceGroups.value.map((group) => ({
      ...group,
      threads: group.threads.map((thread) => {
        if (thread.id !== threadId) return thread
        changed = true
        return { ...thread, title: normalizedTitle }
      }),
    }))
    if (changed) {
      sourceGroups.value = next
    }
  }

  function applyThreadFlags(): void {
    const flaggedGroups: UiProjectGroup[] = sourceGroups.value.map((group) => ({
      projectName: group.projectName,
      threads: group.threads.map((thread) => {
        const runSync = threadRunStateByThreadId.value[thread.id]
        const remoteRunning =
          runSync != null && runSync.turnId != null && runSync.turnId.length > 0
        const localRunning = inProgressById.value[thread.id] === true
        const inProgress = localRunning || remoteRunning
        const manualUnread = manualUnreadSyncByThreadId.value[thread.id]?.value === true
        const isSelected = selectedThreadId.value === thread.id
        const lastReadIso = readStateByThreadId.value[thread.id]
        const unreadByEvent = eventUnreadSyncByThreadId.value[thread.id]?.value === true
        const unread = !inProgress && (manualUnread || (!isSelected && (unreadByEvent || lastReadIso !== thread.updatedAtIso)))
        const displayName = threadDisplayNameById.value[thread.id]?.trim()

        return {
          ...thread,
          title: displayName || thread.title,
          inProgress,
          unread,
        }
      }),
    }))
    projectGroups.value = mergeThreadGroups(projectGroups.value, flaggedGroups)
  }

  function pruneThreadScopedState(flatThreads: UiThread[]): void {
    const activeThreadIds = new Set(flatThreads.map((thread) => thread.id))
    const selected = selectedThreadId.value.trim()
    if (selected) {
      activeThreadIds.add(selected)
    }
    for (const id of threadIdsAwaitingSidebar.value) {
      activeThreadIds.add(id)
    }
    for (const [tid, v] of Object.entries(inProgressById.value)) {
      if (v === true) {
        activeThreadIds.add(tid)
      }
    }
    const nextReadState = pruneThreadStateMap(readStateByThreadId.value, activeThreadIds)
    if (nextReadState !== readStateByThreadId.value) {
      readStateByThreadId.value = nextReadState
      saveReadStateMap(nextReadState)
    }
    const nextScrollState = pruneThreadStateMap(scrollStateByThreadId.value, activeThreadIds)
    if (nextScrollState !== scrollStateByThreadId.value) {
      scrollStateByThreadId.value = nextScrollState
      saveThreadScrollStateMap(nextScrollState)
    }
    loadedMessagesByThreadId.value = pruneThreadStateMap(loadedMessagesByThreadId.value, activeThreadIds)
    loadedVersionByThreadId.value = pruneThreadStateMap(loadedVersionByThreadId.value, activeThreadIds)
    resumedThreadById.value = pruneThreadStateMap(resumedThreadById.value, activeThreadIds)
    persistedMessagesByThreadId.value = pruneThreadStateMap(persistedMessagesByThreadId.value, activeThreadIds)
    liveAgentMessagesByThreadId.value = pruneThreadStateMap(liveAgentMessagesByThreadId.value, activeThreadIds)
    clientSlashMessagesByThreadId.value = pruneThreadStateMap(clientSlashMessagesByThreadId.value, activeThreadIds)
    liveReasoningTextByThreadId.value = pruneThreadStateMap(liveReasoningTextByThreadId.value, activeThreadIds)
    turnSummaryByThreadId.value = pruneThreadStateMap(turnSummaryByThreadId.value, activeThreadIds)
    turnActivityByThreadId.value = pruneThreadStateMap(turnActivityByThreadId.value, activeThreadIds)
    turnErrorByThreadId.value = pruneThreadStateMap(turnErrorByThreadId.value, activeThreadIds)
    contextUsagePercentByThreadId.value = pruneThreadStateMap(contextUsagePercentByThreadId.value, activeThreadIds)
    activeTurnIdByThreadId.value = pruneThreadStateMap(activeTurnIdByThreadId.value, activeThreadIds)
    const nextEventUnreadSync = pruneThreadStateMap(eventUnreadSyncByThreadId.value, activeThreadIds)
    if (nextEventUnreadSync !== eventUnreadSyncByThreadId.value) {
      eventUnreadSyncByThreadId.value = nextEventUnreadSync
      saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, nextEventUnreadSync)
    }
    const nextManualUnreadSync = pruneThreadStateMap(manualUnreadSyncByThreadId.value, activeThreadIds)
    if (nextManualUnreadSync !== manualUnreadSyncByThreadId.value) {
      manualUnreadSyncByThreadId.value = nextManualUnreadSync
      saveFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY, nextManualUnreadSync)
    }
    const nextThreadRunState = pruneThreadStateMap(threadRunStateByThreadId.value, activeThreadIds)
    if (nextThreadRunState !== threadRunStateByThreadId.value) {
      threadRunStateByThreadId.value = nextThreadRunState
      saveRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY, nextThreadRunState)
    }
    const nextPerm = pruneThreadStateMap(threadPermissionModeByThreadId.value, activeThreadIds)
    if (nextPerm !== threadPermissionModeByThreadId.value) {
      threadPermissionModeByThreadId.value = nextPerm
    }
    const nextFaAck = pruneThreadStateMap(threadFullAccessAcknowledgedByThreadId.value, activeThreadIds)
    if (nextFaAck !== threadFullAccessAcknowledgedByThreadId.value) {
      threadFullAccessAcknowledgedByThreadId.value = nextFaAck
    }
    const nextThreadNames = pruneThreadStateMap(threadDisplayNameById.value, activeThreadIds)
    if (nextThreadNames !== threadDisplayNameById.value) {
      threadDisplayNameById.value = nextThreadNames
      saveStringRecord(THREAD_DISPLAY_NAME_STORAGE_KEY, nextThreadNames)
    }
    inProgressById.value = pruneThreadStateMap(inProgressById.value, activeThreadIds)
    const nextPending: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      if (threadId === GLOBAL_SERVER_REQUEST_SCOPE || activeThreadIds.has(threadId)) {
        nextPending[threadId] = requests
      }
    }
    pendingServerRequestsByThreadId.value = nextPending
  }

  function markThreadAsRead(threadId: string): void {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    if (!thread) return

    readStateByThreadId.value = {
      ...readStateByThreadId.value,
      [threadId]: thread.updatedAtIso,
    }
    saveReadStateMap(readStateByThreadId.value)
    const flagBumpMs = Date.now()
    manualUnreadSyncByThreadId.value = {
      ...manualUnreadSyncByThreadId.value,
      [threadId]: { value: false, bumpMs: flagBumpMs },
    }
    saveFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY, manualUnreadSyncByThreadId.value)
    eventUnreadSyncByThreadId.value = {
      ...eventUnreadSyncByThreadId.value,
      [threadId]: { value: false, bumpMs: flagBumpMs },
    }
    saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, eventUnreadSyncByThreadId.value)
    applyThreadFlags()
  }

  function setTurnSummaryForThread(threadId: string, summary: TurnSummaryState | null): void {
    if (!threadId) return

    const previous = turnSummaryByThreadId.value[threadId]
    if (summary) {
      if (areTurnSummariesEqual(previous, summary)) return
      turnSummaryByThreadId.value = {
        ...turnSummaryByThreadId.value,
        [threadId]: summary,
      }
    } else {
      if (previous) {
        turnSummaryByThreadId.value = omitKey(turnSummaryByThreadId.value, threadId)
      }
    }
  }

  function setThreadInProgress(threadId: string, nextInProgress: boolean): void {
    if (!threadId) return
    const currentValue = inProgressById.value[threadId] === true
    if (currentValue === nextInProgress) return
    if (nextInProgress) {
      inProgressById.value = {
        ...inProgressById.value,
        [threadId]: true,
      }
    } else {
      inProgressById.value = omitKey(inProgressById.value, threadId)
    }
    const bumpMs = Date.now()
    if (nextInProgress) {
      const tid = activeTurnIdByThreadId.value[threadId]?.trim() || 'pending'
      threadRunStateByThreadId.value = {
        ...threadRunStateByThreadId.value,
        [threadId]: { turnId: tid.length > 0 ? tid : 'pending', bumpMs },
      }
    } else {
      threadRunStateByThreadId.value = {
        ...threadRunStateByThreadId.value,
        [threadId]: { turnId: null, bumpMs },
      }
    }
    saveRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY, threadRunStateByThreadId.value)
    applyThreadFlags()
  }

  function markThreadUnreadByEvent(threadId: string): void {
    if (!threadId) return
    if (threadId === selectedThreadId.value) return
    if (eventUnreadSyncByThreadId.value[threadId]?.value === true) return
    eventUnreadSyncByThreadId.value = {
      ...eventUnreadSyncByThreadId.value,
      [threadId]: { value: true, bumpMs: Date.now() },
    }
    saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, eventUnreadSyncByThreadId.value)
    applyThreadFlags()
  }

  function setTurnActivityForThread(threadId: string, activity: TurnActivityState | null): void {
    if (!threadId) return

    const previous = turnActivityByThreadId.value[threadId]
    if (!activity) {
      if (previous) {
        turnActivityByThreadId.value = omitKey(turnActivityByThreadId.value, threadId)
      }
      return
    }

    const normalizedLabel = sanitizeDisplayText(activity.label) || 'Thinking'
    const incomingDetails = activity.details
      .map((line) => sanitizeDisplayText(line))
      .filter((line) => line.length > 0 && line !== normalizedLabel)
    const mergedDetails = Array.from(new Set([...(previous?.details ?? []), ...incomingDetails])).slice(-3)
    const nextActivity: TurnActivityState = {
      label: normalizedLabel,
      details: mergedDetails,
    }

    if (areTurnActivitiesEqual(previous, nextActivity)) return
    turnActivityByThreadId.value = {
      ...turnActivityByThreadId.value,
      [threadId]: nextActivity,
    }
  }

  function setTurnErrorForThread(threadId: string, message: string | null): void {
    if (!threadId) return

    const previous = turnErrorByThreadId.value[threadId]
    const normalizedMessage = message ? normalizeMessageText(message) : ''
    if (!normalizedMessage) {
      if (previous) {
        turnErrorByThreadId.value = omitKey(turnErrorByThreadId.value, threadId)
      }
      return
    }

    if (previous?.message === normalizedMessage) return

    turnErrorByThreadId.value = {
      ...turnErrorByThreadId.value,
      [threadId]: { message: normalizedMessage },
    }
  }

  function currentThreadVersion(threadId: string): string {
    const thread = flattenThreads(sourceGroups.value).find((row) => row.id === threadId)
    return thread?.updatedAtIso ?? ''
  }

  function setThreadScrollState(threadId: string, nextState: ThreadScrollState): void {
    if (!threadId) return

    const normalizedState: ThreadScrollState = {
      scrollTop: Math.max(0, nextState.scrollTop),
      isAtBottom: nextState.isAtBottom === true,
    }
    if (typeof nextState.scrollRatio === 'number' && Number.isFinite(nextState.scrollRatio)) {
      normalizedState.scrollRatio = clamp(nextState.scrollRatio, 0, 1)
    }

    const previousState = scrollStateByThreadId.value[threadId]
    if (
      previousState &&
      previousState.scrollTop === normalizedState.scrollTop &&
      previousState.isAtBottom === normalizedState.isAtBottom &&
      previousState.scrollRatio === normalizedState.scrollRatio
    ) {
      return
    }

    scrollStateByThreadId.value = {
      ...scrollStateByThreadId.value,
      [threadId]: normalizedState,
    }
    saveThreadScrollStateMap(scrollStateByThreadId.value)
  }

  function setPersistedMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = persistedMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    persistedMessagesByThreadId.value = {
      ...persistedMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function setLiveAgentMessagesForThread(threadId: string, nextMessages: UiMessage[]): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    if (areMessageArraysEqual(previous, nextMessages)) return
    liveAgentMessagesByThreadId.value = {
      ...liveAgentMessagesByThreadId.value,
      [threadId]: nextMessages,
    }
  }

  function upsertLiveAgentMessage(threadId: string, nextMessage: UiMessage): void {
    const previous = liveAgentMessagesByThreadId.value[threadId] ?? []
    const next = upsertMessage(previous, nextMessage)
    setLiveAgentMessagesForThread(threadId, next)
  }

  function setLiveReasoningText(threadId: string, text: string): void {
    if (!threadId) return
    const normalized = text.trim()
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    if (normalized.length === 0) {
      if (!previous) return
      liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
      return
    }
    if (previous === normalized) return
    liveReasoningTextByThreadId.value = {
      ...liveReasoningTextByThreadId.value,
      [threadId]: normalized,
    }
  }

  function appendLiveReasoningText(threadId: string, delta: string): void {
    if (!threadId) return
    const previous = liveReasoningTextByThreadId.value[threadId] ?? ''
    setLiveReasoningText(threadId, `${previous}${delta}`)
  }

  function clearLiveReasoningForThread(threadId: string): void {
    if (!threadId) return
    if (!(threadId in liveReasoningTextByThreadId.value)) return
    liveReasoningTextByThreadId.value = omitKey(liveReasoningTextByThreadId.value, threadId)
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  function readString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  function isRateLimitSnapshot(value: unknown): value is RateLimitSnapshot {
    const record = asRecord(value)
    if (!record) return false
    return 'primary' in record || 'secondary' in record || 'credits' in record
  }

  function selectAccountRateLimitSnapshot(payload: GetAccountRateLimitsResponse): RateLimitSnapshot | null {
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

  function readRateLimitSnapshotFromNotification(notification: RpcNotification): RateLimitSnapshot | null {
    if (notification.method !== 'account/rateLimits/updated') return null
    const params = asRecord(notification.params)
    const snapshot = params?.rateLimits
    return isRateLimitSnapshot(snapshot) ? snapshot : null
  }

  function readContextUsageUpdate(notification: RpcNotification): { threadId: string; percent: number | null } | null {
    if (notification.method !== 'thread/tokenUsage/updated') return null

    const params = asRecord(notification.params)
    const threadId = readString(params?.threadId)
    if (!threadId) return null

    const tokenUsage = asRecord(params?.tokenUsage)
    const lastUsage = asRecord(tokenUsage?.last)
    const modelContextWindow = readNumber(tokenUsage?.modelContextWindow)
    const inputTokens = readNumber(lastUsage?.inputTokens)
    if (!modelContextWindow || modelContextWindow <= 0 || inputTokens === null) {
      return { threadId, percent: null }
    }

    return {
      threadId,
      percent: clamp((inputTokens / modelContextWindow) * 100, 0, 100),
    }
  }

  function extractThreadIdFromNotification(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    const directThreadId = readString(params.threadId)
    if (directThreadId) return directThreadId
    const snakeThreadId = readString(params.thread_id)
    if (snakeThreadId) return snakeThreadId

    const conversationId = readString(params.conversationId)
    if (conversationId) return conversationId
    const snakeConversationId = readString(params.conversation_id)
    if (snakeConversationId) return snakeConversationId

    const thread = asRecord(params.thread)
    const nestedThreadId = readString(thread?.id)
    if (nestedThreadId) return nestedThreadId

    const turn = asRecord(params.turn)
    const turnThreadId = readString(turn?.threadId)
    if (turnThreadId) return turnThreadId
    const turnSnakeThreadId = readString(turn?.thread_id)
    if (turnSnakeThreadId) return turnSnakeThreadId

    return ''
  }

  function readTurnErrorMessage(notification: RpcNotification): string {
    if (notification.method !== 'turn/completed') return ''
    const params = asRecord(notification.params)
    const turn = asRecord(params?.turn)
    if (!turn || turn.status !== 'failed') return ''
    const errorPayload = asRecord(turn.error)
    return readString(errorPayload?.message)
  }

  function normalizeServerRequest(params: unknown): UiServerRequest | null {
    const row = asRecord(params)
    if (!row) return null

    const id = row.id
    const method = readString(row.method)
    const requestParams = row.params
    if ((typeof id !== 'number' && typeof id !== 'string') || !method) {
      return null
    }

    const requestParamRecord = asRecord(requestParams)
    const threadId =
      readString(requestParamRecord?.threadId) ||
      readString(requestParamRecord?.conversationId) ||
      GLOBAL_SERVER_REQUEST_SCOPE
    const turnId = readString(requestParamRecord?.turnId)
    const itemId = readString(requestParamRecord?.itemId)
    const receivedAtIso = readString(row.receivedAtIso) || new Date().toISOString()

    return {
      id,
      method,
      threadId,
      turnId,
      itemId,
      receivedAtIso,
      params: requestParams ?? null,
    }
  }

  function upsertPendingServerRequest(request: UiServerRequest): void {
    const threadId = request.threadId || GLOBAL_SERVER_REQUEST_SCOPE
    const current = pendingServerRequestsByThreadId.value[threadId] ?? []
    const index = current.findIndex((row) => row.id === request.id)
    const nextRows = [...current]
    if (index >= 0) {
      nextRows.splice(index, 1, request)
    } else {
      nextRows.push(request)
    }

    pendingServerRequestsByThreadId.value = {
      ...pendingServerRequestsByThreadId.value,
      [threadId]: nextRows.sort((first, second) => first.receivedAtIso.localeCompare(second.receivedAtIso)),
    }
  }

  function removePendingServerRequestById(requestId: UiServerRequestId): void {
    const next: Record<string, UiServerRequest[]> = {}
    for (const [threadId, requests] of Object.entries(pendingServerRequestsByThreadId.value)) {
      const filtered = requests.filter((request) => request.id !== requestId)
      if (filtered.length > 0) {
        next[threadId] = filtered
      }
    }
    pendingServerRequestsByThreadId.value = next
  }

  function handleServerRequestNotification(notification: RpcNotification): boolean {
    if (notification.method === 'server/request') {
      const request = normalizeServerRequest(notification.params)
      if (!request) return true
      upsertPendingServerRequest(request)
      return true
    }

    if (notification.method === 'server/request/resolved') {
      const row = asRecord(notification.params)
      const id = row?.id
      if (typeof id === 'number' || typeof id === 'string') {
        removePendingServerRequestById(id)
      }
      return true
    }

    return false
  }

  function sanitizeDisplayText(value: string): string {
    return value.replace(/\s+/gu, ' ').trim()
  }

  function readTurnActivity(notification: RpcNotification): { threadId: string; activity: TurnActivityState } | null {
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    if (notification.method === 'turn/started') {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/started') {
      const params = asRecord(notification.params)
      const item = asRecord(params?.item)
      const itemType = readString(item?.type).toLowerCase()
      if (itemType === 'reasoning') {
        return {
          threadId,
          activity: {
            label: 'Thinking',
            details: [],
          },
        }
      }
      if (itemType === 'agentmessage') {
        return {
          threadId,
          activity: {
            label: 'Writing response',
            details: [],
          },
        }
      }
    }

    if (
      notification.method === 'item/reasoning/summaryTextDelta' ||
      notification.method === 'item/reasoning/summaryPartAdded'
    ) {
      return {
        threadId,
        activity: {
          label: 'Thinking',
          details: [],
        },
      }
    }

    if (notification.method === 'item/agentMessage/delta') {
      return {
        threadId,
        activity: {
          label: 'Writing response',
          details: [],
        },
      }
    }

    return null
  }

  function readTurnStartedInfo(notification: RpcNotification): TurnStartedInfo | null {
    if (notification.method !== 'turn/started') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    return {
      threadId,
      turnId,
      startedAtMs,
    }
  }

  function readTurnCompletedInfo(notification: RpcNotification): TurnCompletedInfo | null {
    if (notification.method !== 'turn/completed') {
      return null
    }

    const params = asRecord(notification.params)
    if (!params) return null
    const threadId = extractThreadIdFromNotification(notification)
    if (!threadId) return null

    const turnPayload = asRecord(params.turn)
    const turnId =
      readString(turnPayload?.id) ||
      readString(params.turnId) ||
      `${threadId}:unknown`
    if (!turnId) return null

    const completedAtMs =
      parseIsoTimestamp(readString(turnPayload?.completedAt)) ??
      parseIsoTimestamp(readString(params.completedAt)) ??
      parseIsoTimestamp(notification.atIso) ??
      Date.now()

    const startedAtMs =
      parseIsoTimestamp(readString(turnPayload?.startedAt)) ??
      parseIsoTimestamp(readString(params.startedAt)) ??
      undefined

    return {
      threadId,
      turnId,
      completedAtMs,
      startedAtMs,
    }
  }

  function liveReasoningMessageId(reasoningItemId: string): string {
    return `${reasoningItemId}:live-reasoning`
  }

  function readReasoningStartedItemId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return readString(item.id)
    }

    return ''
  }

  function readReasoningDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический источник дельт для UI — уже нормализованный item/*.
    if (notification.method === 'item/reasoning/summaryTextDelta') {
      const itemId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!itemId || !delta) return null
      return { messageId: liveReasoningMessageId(itemId), delta }
    }

    return null
  }

  function readReasoningSectionBreakMessageId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    // Канонический source для section break — item/*
    if (notification.method === 'item/reasoning/summaryPartAdded') {
      const itemId = readString(params.itemId)
      if (!itemId) return ''
      return liveReasoningMessageId(itemId)
    }

    return ''
  }

  function readReasoningCompletedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'reasoning') return ''
      return liveReasoningMessageId(readString(item.id))
    }

    return ''
  }

  function readAgentMessageStartedId(notification: RpcNotification): string {
    const params = asRecord(notification.params)
    if (!params) return ''

    if (notification.method === 'item/started') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return ''
      return readString(item.id)
    }

    return ''
  }

  function readAgentMessageDelta(notification: RpcNotification): { messageId: string; delta: string } | null {
    const params = asRecord(notification.params)
    if (!params) return null

    // Канонический live-канал агентского текста.
    if (notification.method === 'item/agentMessage/delta') {
      const messageId = readString(params.itemId)
      const delta = readString(params.delta)
      if (!messageId || !delta) return null
      return { messageId, delta }
    }

    return null
  }

  function readAgentMessageCompleted(notification: RpcNotification): UiMessage | null {
    const params = asRecord(notification.params)
    if (!params) return null

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      if (!item || item.type !== 'agentMessage') return null
      const id = readString(item.id)
      const text = readString(item.text)
      if (!id || !text) return null
      return {
        id,
        role: 'assistant',
        text,
        messageType: 'agentMessage.live',
      }
    }

    return null
  }

  function isAgentContentEvent(notification: RpcNotification): boolean {
    if (notification.method === 'item/agentMessage/delta') {
      return true
    }

    const params = asRecord(notification.params)
    if (!params) return false

    if (notification.method === 'item/completed') {
      const item = asRecord(params.item)
      return item?.type === 'agentMessage'
    }

    return false
  }

  function applyRealtimeUpdates(notification: RpcNotification): void {
    const contextUsageUpdate = readContextUsageUpdate(notification)
    if (contextUsageUpdate) {
      if (contextUsageUpdate.percent === null) {
        contextUsagePercentByThreadId.value = omitKey(contextUsagePercentByThreadId.value, contextUsageUpdate.threadId)
      } else {
        contextUsagePercentByThreadId.value = {
          ...contextUsagePercentByThreadId.value,
          [contextUsageUpdate.threadId]: contextUsageUpdate.percent,
        }
      }
      return
    }

    const nextRateLimits = readRateLimitSnapshotFromNotification(notification)
    if (nextRateLimits) {
      accountRateLimits.value = nextRateLimits
      accountRateLimitsError.value = ''
      mergeCodexSessionCache({ rateLimits: nextRateLimits })
      return
    }

    if (handleServerRequestNotification(notification)) {
      return
    }

    const turnActivity = readTurnActivity(notification)
    if (turnActivity) {
      setTurnActivityForThread(turnActivity.threadId, turnActivity.activity)
    }

    const startedTurn = readTurnStartedInfo(notification)
    if (startedTurn) {
      pendingTurnStartsById.set(startedTurn.turnId, startedTurn)
      activeTurnIdByThreadId.value = {
        ...activeTurnIdByThreadId.value,
        [startedTurn.threadId]: startedTurn.turnId,
      }
      setTurnSummaryForThread(startedTurn.threadId, null)
      setTurnErrorForThread(startedTurn.threadId, null)
      setThreadInProgress(startedTurn.threadId, true)
      if (eventUnreadSyncByThreadId.value[startedTurn.threadId]?.value === true) {
        const b = Date.now()
        eventUnreadSyncByThreadId.value = {
          ...eventUnreadSyncByThreadId.value,
          [startedTurn.threadId]: { value: false, bumpMs: b },
        }
        saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, eventUnreadSyncByThreadId.value)
      }
      const curRun = threadRunStateByThreadId.value[startedTurn.threadId]
      if (curRun?.turnId === 'pending') {
        threadRunStateByThreadId.value = {
          ...threadRunStateByThreadId.value,
          [startedTurn.threadId]: { turnId: startedTurn.turnId, bumpMs: Date.now() },
        }
        saveRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY, threadRunStateByThreadId.value)
        schedulePushDesktopChatState()
      }
    }

    const completedTurn = readTurnCompletedInfo(notification)
    if (completedTurn) {
      const startedTurnState = pendingTurnStartsById.get(completedTurn.turnId)
      if (startedTurnState) {
        pendingTurnStartsById.delete(completedTurn.turnId)
      }

      const rawDurationMs =
        readNumber(asRecord(notification.params)?.durationMs) ??
        readNumber(asRecord(asRecord(notification.params)?.turn)?.durationMs) ??
        (typeof completedTurn.startedAtMs === 'number'
          ? completedTurn.completedAtMs - completedTurn.startedAtMs
          : null) ??
        (startedTurnState ? completedTurn.completedAtMs - startedTurnState.startedAtMs : null)

      const durationMs = typeof rawDurationMs === 'number' ? Math.max(0, rawDurationMs) : 0
      setTurnSummaryForThread(completedTurn.threadId, {
        turnId: completedTurn.turnId,
        durationMs,
      })
      if (activeTurnIdByThreadId.value[completedTurn.threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, completedTurn.threadId)
      }
      setThreadInProgress(completedTurn.threadId, false)
      setTurnActivityForThread(completedTurn.threadId, null)
      markThreadUnreadByEvent(completedTurn.threadId)
    }

    const turnErrorMessage = readTurnErrorMessage(notification)
    if (turnErrorMessage) {
      const failedThreadId = completedTurn?.threadId || extractThreadIdFromNotification(notification)
      if (failedThreadId) {
        setTurnErrorForThread(failedThreadId, turnErrorMessage)
      }
      error.value = turnErrorMessage
    } else if (completedTurn) {
      setTurnErrorForThread(completedTurn.threadId, null)
    }

    const notificationThreadId = extractThreadIdFromNotification(notification)
    if (!notificationThreadId || notificationThreadId !== selectedThreadId.value) return

    const startedAgentMessageId = readAgentMessageStartedId(notification)
    if (startedAgentMessageId) {
      activeReasoningItemId = ''
    }

    const liveAgentMessageDelta = readAgentMessageDelta(notification)
    if (liveAgentMessageDelta) {
      const existing = (liveAgentMessagesByThreadId.value[notificationThreadId] ?? [])
        .find((message) => message.id === liveAgentMessageDelta.messageId)
      const nextText = `${existing?.text ?? ''}${liveAgentMessageDelta.delta}`
      upsertLiveAgentMessage(notificationThreadId, {
        id: liveAgentMessageDelta.messageId,
        role: 'assistant',
        text: nextText,
        messageType: 'agentMessage.live',
      })
    }

    const completedAgentMessage = readAgentMessageCompleted(notification)
    if (completedAgentMessage) {
      upsertLiveAgentMessage(notificationThreadId, completedAgentMessage)
    }

    const startedReasoningItemId = readReasoningStartedItemId(notification)
    if (startedReasoningItemId) {
      activeReasoningItemId = startedReasoningItemId
    }

    const liveReasoningDelta = readReasoningDelta(notification)
    if (liveReasoningDelta) {
      appendLiveReasoningText(notificationThreadId, liveReasoningDelta.delta)
    }

    const sectionBreakMessageId = readReasoningSectionBreakMessageId(notification)
    if (sectionBreakMessageId) {
      const current = liveReasoningTextByThreadId.value[notificationThreadId] ?? ''
      if (current.trim().length > 0 && !current.endsWith('\n\n')) {
        setLiveReasoningText(notificationThreadId, `${current}\n\n`)
      }
    }

    const completedReasoningMessageId = readReasoningCompletedId(notification)
    if (completedReasoningMessageId) {
      if (completedReasoningMessageId === liveReasoningMessageId(activeReasoningItemId)) {
        activeReasoningItemId = ''
      }
    }

    if (isAgentContentEvent(notification)) {
      if (shouldAutoScrollOnNextAgentEvent && selectedThreadId.value) {
        setThreadScrollState(selectedThreadId.value, {
          scrollTop: 0,
          isAtBottom: true,
          scrollRatio: 1,
        })
      }
      activeReasoningItemId = ''
      clearLiveReasoningForThread(notificationThreadId)
    }

    if (notification.method === 'turn/completed') {
      activeReasoningItemId = ''
      shouldAutoScrollOnNextAgentEvent = false
      clearLiveReasoningForThread(notificationThreadId)
      const completedThreadId = extractThreadIdFromNotification(notification)
      if (completedThreadId) {
        setThreadInProgress(completedThreadId, false)
        setTurnActivityForThread(completedThreadId, null)
        markThreadUnreadByEvent(completedThreadId)
      }
    }

  }

  function queueEventDrivenSync(notification: RpcNotification): void {
    const threadId = extractThreadIdFromNotification(notification)
    if (threadId) {
      pendingThreadMessageRefresh.add(threadId)
    }

    const method = notification.method
    if (
      method.startsWith('thread/') ||
      method.startsWith('turn/') ||
      method.startsWith('item/')
    ) {
      pendingThreadsRefresh = true
    }

    if (eventSyncTimer !== null || typeof window === 'undefined') return
    eventSyncTimer = window.setTimeout(() => {
      eventSyncTimer = null
      void syncFromNotifications()
    }, EVENT_SYNC_DEBOUNCE_MS)
  }

  function syncPersistedProjectCwdsFromSourceGroups(): void {
    let next = projectCwdByProjectName.value
    let changed = false
    for (const group of sourceGroups.value) {
      let cwd = ''
      for (const thread of group.threads) {
        const t = thread.cwd?.trim() ?? ''
        if (t) {
          cwd = t
          break
        }
      }
      if (!cwd) continue
      if (next[group.projectName] !== cwd) {
        if (!changed) {
          next = { ...next }
          changed = true
        }
        next[group.projectName] = cwd
      }
    }
    if (changed) {
      projectCwdByProjectName.value = next
      saveStringRecord(PROJECT_CWD_STORAGE_KEY, next)
    }
  }

  /** Drop display names + cwd map entries for project keys no longer returned by Codex. */
  function pruneGhostProjectMetadata(ghostProjectNames: string[]): void {
    if (ghostProjectNames.length === 0) return
    const ghost = new Set(ghostProjectNames)
    let nextDisplay = projectDisplayNameById.value
    let nextCwd = projectCwdByProjectName.value
    let displayChanged = false
    let cwdChanged = false
    for (const name of ghost) {
      if (nextDisplay[name] !== undefined) {
        if (!displayChanged) nextDisplay = { ...nextDisplay }
        displayChanged = true
        delete nextDisplay[name]
      }
      if (nextCwd[name] !== undefined) {
        if (!cwdChanged) nextCwd = { ...nextCwd }
        cwdChanged = true
        delete nextCwd[name]
      }
    }
    if (displayChanged) {
      projectDisplayNameById.value = nextDisplay
      saveProjectDisplayNames(nextDisplay)
    }
    if (cwdChanged) {
      projectCwdByProjectName.value = nextCwd
      saveStringRecord(PROJECT_CWD_STORAGE_KEY, nextCwd)
    }
  }

  function markThreadAwaitingSidebar(threadId: string): void {
    const tid = threadId.trim()
    if (!tid) return
    const next = new Set(threadIdsAwaitingSidebar.value)
    next.add(tid)
    threadIdsAwaitingSidebar.value = next
  }

  function isThreadAwaitingSidebar(threadId: string): boolean {
    const tid = threadId.trim()
    if (!tid) return false
    return threadIdsAwaitingSidebar.value.has(tid)
  }

  async function loadThreads() {
    if (!hasLoadedThreads.value) {
      isLoadingThreads.value = true
    }

    try {
      const groups = await getThreadGroups()
      const incomingNames = new Set(groups.map((group) => group.projectName))
      const previousOrder = projectOrder.value
      const prunedOrder = previousOrder.filter((name) => incomingNames.has(name))
      const ghostProjectNames = previousOrder.filter((name) => !incomingNames.has(name))
      pruneGhostProjectMetadata(ghostProjectNames)

      const nextProjectOrder = mergeProjectOrder(prunedOrder, groups)
      if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
        projectOrder.value = nextProjectOrder
        saveProjectOrder(projectOrder.value)
      }

      const orderedGroups = orderGroupsByProjectOrder(groups, projectOrder.value)
      sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
      const serverThreadIds = new Set(flattenThreads(sourceGroups.value).map((thread) => thread.id))
      const inProgressKeepIds = new Set(serverThreadIds)
      for (const [tid, v] of Object.entries(inProgressById.value)) {
        if (v === true) {
          inProgressKeepIds.add(tid)
        }
      }
      inProgressById.value = pruneThreadStateMap(inProgressById.value, inProgressKeepIds)
      applyThreadFlags()
      syncPersistedProjectCwdsFromSourceGroups()
      hasLoadedThreads.value = true

      const flatThreads = flattenThreads(projectGroups.value)
      if (threadIdsAwaitingSidebar.value.size > 0) {
        const listed = new Set(flatThreads.map((thread) => thread.id))
        const nextAwaiting = new Set(threadIdsAwaitingSidebar.value)
        for (const id of nextAwaiting) {
          if (listed.has(id)) {
            nextAwaiting.delete(id)
          }
        }
        if (nextAwaiting.size !== threadIdsAwaitingSidebar.value.size) {
          threadIdsAwaitingSidebar.value = nextAwaiting
        }
      }
      pruneThreadScopedState(flatThreads)

      const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)

      if (!currentExists) {
        const sid = selectedThreadId.value
        if (sid && inProgressById.value[sid] === true) {
          // Thread list can lag behind startThread; keep optimistic selection until the list catches up.
          return
        }
        setSelectedThreadId(flatThreads[0]?.id ?? '')
      }
    } finally {
      isLoadingThreads.value = false
    }
  }

  async function refreshAccountRateLimits(): Promise<void> {
    isLoadingRateLimits.value = true
    const hadCachedSnapshot = accountRateLimits.value !== null
    if (!hadCachedSnapshot) {
      accountRateLimitsError.value = ''
    }

    try {
      const payload = await retryCodexFetch(() => getAccountRateLimits())
      const snapshot = selectAccountRateLimitSnapshot(payload)
      accountRateLimits.value = snapshot
      accountRateLimitsError.value = ''
      if (snapshot) {
        mergeCodexSessionCache({ rateLimits: snapshot })
      }
    } catch (unknownError) {
      if (!accountRateLimits.value) {
        accountRateLimitsError.value =
          unknownError instanceof Error ? unknownError.message : 'Failed to load quota'
      }
    } finally {
      isLoadingRateLimits.value = false
    }
  }

  async function loadMessages(threadId: string, options: { silent?: boolean } = {}) {
    if (!threadId) {
      return
    }

    const alreadyLoaded = loadedMessagesByThreadId.value[threadId] === true
    const shouldShowLoading = options.silent !== true && !alreadyLoaded
    if (shouldShowLoading) {
      isLoadingMessages.value = true
    }

    try {
      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }

      const nextMessages = await getThreadMessagesWithProdWarmupRetry(threadId)
      const previousPersisted = persistedMessagesByThreadId.value[threadId] ?? []
      const mergedMessages = mergeMessages(previousPersisted, nextMessages, {
        preserveMissing: options.silent === true,
      })
      setPersistedMessagesForThread(threadId, mergedMessages)

      const previousLiveAgent = liveAgentMessagesByThreadId.value[threadId] ?? []
      const nextLiveAgent = removeRedundantLiveAgentMessages(previousLiveAgent, nextMessages)
      setLiveAgentMessagesForThread(threadId, nextLiveAgent)

      loadedMessagesByThreadId.value = {
        ...loadedMessagesByThreadId.value,
        [threadId]: true,
      }

      const version = currentThreadVersion(threadId)
      if (version) {
        loadedVersionByThreadId.value = {
          ...loadedVersionByThreadId.value,
          [threadId]: version,
        }
      }
      markThreadAsRead(threadId)
    } finally {
      if (shouldShowLoading) {
        isLoadingMessages.value = false
      }
    }
  }

  async function refreshAll() {
    error.value = ''

    try {
      await Promise.all([
        loadThreads(),
        refreshModelPreferences(),
        refreshAccountRateLimits(),
      ])
      await loadMessages(selectedThreadId.value)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function selectThread(threadId: string) {
    setSelectedThreadId(threadId)

    try {
      await loadMessages(threadId)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  async function archiveThreadById(threadId: string) {
    try {
      await archiveThread(threadId)
      await loadThreads()

      if (selectedThreadId.value === threadId) {
        await loadMessages(selectedThreadId.value)
      }
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
    }
  }

  function appendClientSlashMessages(threadId: string, next: UiMessage[]): void {
    const tid = threadId.trim()
    if (!tid) return
    const prev = clientSlashMessagesByThreadId.value[tid] ?? []
    clientSlashMessagesByThreadId.value = {
      ...clientSlashMessagesByThreadId.value,
      [tid]: [...prev, ...next],
    }
  }

  function newClientSlashMessageId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    return `slash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }

  async function handleClientSlashStatusCommand(threadId: string): Promise<void> {
    const userMsg: UiMessage = {
      id: newClientSlashMessageId(),
      role: 'user',
      text: '/status',
      messageType: 'clientSlash.user',
    }
    appendClientSlashMessages(threadId, [userMsg])
    shouldAutoScrollOnNextAgentEvent = true

    try {
      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
        resumedThreadById.value = {
          ...resumedThreadById.value,
          [threadId]: true,
        }
      }

      const [ratePayload, accountPayload, configPayload] = await Promise.all([
        getAccountRateLimits(),
        getAccountInfo(),
        readEffectiveConfig(),
      ])

      const snapshot = selectRateLimitSnapshotFromPayload(ratePayload)
      if (snapshot) {
        accountRateLimits.value = snapshot
        mergeCodexSessionCache({ rateLimits: snapshot })
        accountRateLimitsError.value = ''
      }

      const cwd = selectedThread.value?.cwd?.trim() ?? ''
      const perm = threadPermissionModeByThreadId.value[threadId] ?? 'default'

      const statusText = formatSlashStatusCardText({
        threadId,
        cwd,
        modelId: selectedModelId.value,
        reasoningEffort: selectedReasoningEffort.value,
        threadPermission: perm,
        account: accountPayload.account ?? null,
        ratePayload,
        config: configPayload.config,
      })

      const assistantMsg: UiMessage = {
        id: newClientSlashMessageId(),
        role: 'assistant',
        text: statusText,
        messageType: 'clientSlash.status',
      }
      appendClientSlashMessages(threadId, [assistantMsg])
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Unknown error'
      const assistantMsg: UiMessage = {
        id: newClientSlashMessageId(),
        role: 'assistant',
        text: `Failed to load session status.\n\n${message}`,
        messageType: 'clientSlash.status',
      }
      appendClientSlashMessages(threadId, [assistantMsg])
    }
  }

  async function sendMessageToSelectedThread(draft: UiComposerDraft): Promise<void> {
    const threadId = selectedThreadId.value
    const nextDraft = normalizeComposerDraft(draft)
    if (!threadId || isComposerDraftEmpty(nextDraft)) return

    const bareSlash = tryParseBareSlashCommand(nextDraft.text)
    if (nextDraft.images.length === 0 && bareSlash === 'status') {
      await handleClientSlashStatusCommand(threadId)
      return
    }

    const perm = threadPermissionModeByThreadId.value[threadId] ?? 'default'
    if (
      perm === 'full-access' &&
      threadFullAccessAcknowledgedByThreadId.value[threadId] !== true
    ) {
      pendingDraftForFullAccessAck.value = nextDraft
      fullAccessRiskModalOpen.value = true
      return
    }

    isSendingMessage.value = true
    error.value = ''
    shouldAutoScrollOnNextAgentEvent = true
    setTurnSummaryForThread(threadId, null)
    setTurnActivityForThread(
      threadId,
      { label: 'Thinking', details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value) },
    )
    setTurnErrorForThread(threadId, null)
    setThreadInProgress(threadId, true)

    try {
      await startTurnForThread(threadId, nextDraft)
      const cwd = selectedThread.value?.cwd?.trim() ?? ''
      if (cwd && typeof window !== 'undefined') {
        window.setTimeout(() => {
          void refreshGitStatusForCwd(cwd, { force: true })
        }, 1200)
      }
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
      throw unknownError
    } finally {
      isSendingMessage.value = false
    }
  }

  async function sendMessageToNewThread(
    draft: UiComposerDraft,
    cwd: string,
    options?: { fullAccessAlreadyAcknowledged?: boolean },
  ): Promise<string> {
    const nextDraft = normalizeComposerDraft(draft)
    const targetCwd = cwd.trim()
    const selectedModel = selectedModelId.value.trim()
    if (isComposerDraftEmpty(nextDraft)) return ''

    const perm = newThreadPermissionMode.value
    if (
      perm === 'full-access' &&
      !options?.fullAccessAlreadyAcknowledged
    ) {
      pendingDraftForFullAccessAck.value = nextDraft
      pendingFullAccessNewThreadCwd.value = targetCwd
      fullAccessRiskModalOpen.value = true
      return ''
    }

    isSendingMessage.value = true
    error.value = ''
    let threadId = ''

    try {
      threadId = await startThread(targetCwd || undefined, selectedModel || undefined)
      if (!threadId) return ''

      setThreadPermissionMode(threadId, perm)
      if (perm === 'full-access') {
        threadFullAccessAcknowledgedByThreadId.value = {
          ...threadFullAccessAcknowledgedByThreadId.value,
          [threadId]: true,
        }
      }

      markThreadAwaitingSidebar(threadId)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }
      setSelectedThreadId(threadId)
      shouldAutoScrollOnNextAgentEvent = true
      setTurnSummaryForThread(threadId, null)
      setTurnActivityForThread(
        threadId,
        { label: 'Thinking', details: buildPendingTurnDetails(selectedModelId.value, selectedReasoningEffort.value) },
      )
      setTurnErrorForThread(threadId, null)
      setThreadInProgress(threadId, true)

      await startTurnForThread(threadId, nextDraft)
      return threadId
    } catch (unknownError) {
      shouldAutoScrollOnNextAgentEvent = false
      if (threadId) {
        setThreadInProgress(threadId, false)
        setTurnActivityForThread(threadId, null)
      }
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Unknown application error'
      if (threadId) {
        setTurnErrorForThread(threadId, errorMessage)
      }
      error.value = errorMessage
      throw unknownError
    } finally {
      isSendingMessage.value = false
    }
  }

  async function startTurnForThread(threadId: string, draft: UiComposerDraft): Promise<void> {
    const modelId = selectedModelId.value.trim()
    const reasoningEffort = selectedReasoningEffort.value

    try {
      if (resumedThreadById.value[threadId] !== true) {
        await resumeThread(threadId)
      }

      const perm = threadPermissionModeByThreadId.value[threadId] ?? 'default'
      await startThreadTurn(
        threadId,
        draft,
        modelId || undefined,
        reasoningEffort || undefined,
        perm === 'full-access' ? 'full-access' : undefined,
        selectedThread.value?.cwd?.trim() || undefined,
      )

      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }

      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      throw unknownError
    }
  }

  async function interruptSelectedThreadTurn(): Promise<void> {
    const threadId = selectedThreadId.value
    if (!threadId) return
    if (inProgressById.value[threadId] !== true) return
    const turnId = activeTurnIdByThreadId.value[threadId]

    isInterruptingTurn.value = true
    error.value = ''
    try {
      await interruptThreadTurn(threadId, turnId)
      setThreadInProgress(threadId, false)
      setTurnActivityForThread(threadId, null)
      setTurnErrorForThread(threadId, null)
      if (activeTurnIdByThreadId.value[threadId]) {
        activeTurnIdByThreadId.value = omitKey(activeTurnIdByThreadId.value, threadId)
      }
      pendingThreadMessageRefresh.add(threadId)
      pendingThreadsRefresh = true
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to interrupt active turn'
      setTurnErrorForThread(threadId, errorMessage)
      error.value = errorMessage
    } finally {
      isInterruptingTurn.value = false
    }
  }

  function renameProject(projectName: string, displayName: string): void {
    if (projectName.length === 0) return

    const currentValue = projectDisplayNameById.value[projectName] ?? ''
    if (currentValue === displayName) return

    projectDisplayNameById.value = {
      ...projectDisplayNameById.value,
      [projectName]: displayName,
    }
    saveProjectDisplayNames(projectDisplayNameById.value)
  }

  async function renameThreadById(threadId: string, title: string): Promise<void> {
    const normalizedThreadId = threadId.trim()
    const normalizedTitle = title.trim()
    if (!normalizedThreadId || !normalizedTitle) return

    error.value = ''
    try {
      await setThreadNameApi(normalizedThreadId, normalizedTitle)
      patchThreadTitleInSourceGroups(normalizedThreadId, normalizedTitle)
      threadDisplayNameById.value = omitKey(threadDisplayNameById.value, normalizedThreadId)
      saveStringRecord(THREAD_DISPLAY_NAME_STORAGE_KEY, threadDisplayNameById.value)
      applyThreadFlags()
      await loadThreads()
      await syncFromNotifications()
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to rename thread'
      error.value = errorMessage
      throw unknownError
    }
  }

  function markThreadUnreadById(threadId: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    manualUnreadSyncByThreadId.value = {
      ...manualUnreadSyncByThreadId.value,
      [normalizedThreadId]: { value: true, bumpMs: Date.now() },
    }
    saveFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY, manualUnreadSyncByThreadId.value)
    applyThreadFlags()
  }

  function markThreadReadById(threadId: string): void {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return
    markThreadAsRead(normalizedThreadId)
  }

  function removeProjectFromLocalState(projectName: string): void {
    if (projectName.length === 0) return

    const nextProjectOrder = projectOrder.value.filter((name) => name !== projectName)
    if (!areStringArraysEqual(projectOrder.value, nextProjectOrder)) {
      projectOrder.value = nextProjectOrder
      saveProjectOrder(projectOrder.value)
    }

    sourceGroups.value = sourceGroups.value.filter((group) => group.projectName !== projectName)

    if (projectDisplayNameById.value[projectName] !== undefined) {
      const nextDisplayNames = { ...projectDisplayNameById.value }
      delete nextDisplayNames[projectName]
      projectDisplayNameById.value = nextDisplayNames
      saveProjectDisplayNames(nextDisplayNames)
    }

    if (projectCwdByProjectName.value[projectName] !== undefined) {
      const nextCwds = { ...projectCwdByProjectName.value }
      delete nextCwds[projectName]
      projectCwdByProjectName.value = nextCwds
      saveStringRecord(PROJECT_CWD_STORAGE_KEY, nextCwds)
    }

    applyThreadFlags()

    const flatThreads = flattenThreads(projectGroups.value)
    pruneThreadScopedState(flatThreads)

    const currentExists = flatThreads.some((thread) => thread.id === selectedThreadId.value)
    if (!currentExists) {
      setSelectedThreadId(flatThreads[0]?.id ?? '')
    }
  }

  async function removeProject(projectName: string): Promise<void> {
    if (projectName.length === 0) return

    const group = sourceGroups.value.find((g) => g.projectName === projectName)
    const threadIds = group?.threads.map((thread) => thread.id) ?? []

    error.value = ''
    try {
      if (threadIds.length > 0) {
        await Promise.all(threadIds.map((id) => archiveThread(id)))
      }
      await loadThreads()
      removeProjectFromLocalState(projectName)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to remove project'
    }
  }

  function reorderProject(projectName: string, toIndex: number): void {
    if (projectName.length === 0) return
    if (projectOrder.value.length === 0) return

    const fromIndex = projectOrder.value.indexOf(projectName)
    if (fromIndex === -1) return

    const clampedToIndex = Math.max(0, Math.min(toIndex, projectOrder.value.length - 1))
    const nextProjectOrder = reorderStringArray(projectOrder.value, fromIndex, clampedToIndex)
    if (nextProjectOrder === projectOrder.value) return

    projectOrder.value = nextProjectOrder
    saveProjectOrder(projectOrder.value)

    const orderedGroups = orderGroupsByProjectOrder(sourceGroups.value, projectOrder.value)
    sourceGroups.value = mergeThreadGroups(sourceGroups.value, orderedGroups)
    applyThreadFlags()
  }

  async function mergeRemoteThreadUiFromServer(): Promise<void> {
    if (typeof window === 'undefined') return
    try {
      const remote = await getChatState()
      const mergedRead = mergeReadStateByThreadId(readStateByThreadId.value, remote.readStateByThreadId)
      const mergedManual = mergeFlagSyncByThreadId(manualUnreadSyncByThreadId.value, remote.manualUnreadSyncByThreadId)
      const mergedEvent = mergeFlagSyncByThreadId(eventUnreadSyncByThreadId.value, remote.eventUnreadSyncByThreadId)
      const mergedRun = mergeThreadRunStateMap(threadRunStateByThreadId.value, remote.threadRunStateByThreadId)
      if (
        areReadStateMapsEqual(mergedRead, readStateByThreadId.value) &&
        areFlagSyncMapsEqual(mergedManual, manualUnreadSyncByThreadId.value) &&
        areFlagSyncMapsEqual(mergedEvent, eventUnreadSyncByThreadId.value) &&
        areRunStateMapsEqual(mergedRun, threadRunStateByThreadId.value)
      ) {
        return
      }
      isApplyingRemoteDesktopChatState.value = true
      readStateByThreadId.value = mergedRead
      saveReadStateMap(mergedRead)
      manualUnreadSyncByThreadId.value = mergedManual
      saveFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY, mergedManual)
      eventUnreadSyncByThreadId.value = mergedEvent
      saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, mergedEvent)
      threadRunStateByThreadId.value = mergedRun
      saveRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY, mergedRun)
      applyThreadFlags()
    } catch {
      // ignore transient bridge failures
    } finally {
      isApplyingRemoteDesktopChatState.value = false
    }
  }

  async function syncThreadStatus(): Promise<void> {
    if (isPolling.value) return
    isPolling.value = true

    try {
      await loadThreads()

      if (!selectedThreadId.value) return

      const threadId = selectedThreadId.value
      const currentVersion = currentThreadVersion(threadId)
      const loadedVersion = loadedVersionByThreadId.value[threadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion
      const isInProgress = inProgressById.value[threadId] === true

      if (isInProgress || hasVersionChange) {
        await loadMessages(threadId, { silent: true })
      }

      const pollCwd = activeGitCwd.value
      if (pollCwd) {
        void refreshGitStatusForCwd(pollCwd)
      }
    } catch {
      // ignore poll failures and keep last known state
    } finally {
      isPolling.value = false
      void mergeRemoteThreadUiFromServer()
    }
  }

  async function syncFromNotifications(): Promise<void> {
    if (isPolling.value) {
      if (typeof window !== 'undefined' && eventSyncTimer === null) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
      return
    }

    isPolling.value = true

    const shouldRefreshThreads = pendingThreadsRefresh
    const threadIdsToRefresh = new Set(pendingThreadMessageRefresh)
    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()

    try {
      if (shouldRefreshThreads) {
        await loadThreads()
      }

      const activeThreadId = selectedThreadId.value
      if (!activeThreadId) return

      const isActiveDirty = threadIdsToRefresh.has(activeThreadId)
      const isInProgress = inProgressById.value[activeThreadId] === true
      const currentVersion = currentThreadVersion(activeThreadId)
      const loadedVersion = loadedVersionByThreadId.value[activeThreadId] ?? ''
      const hasVersionChange = currentVersion.length > 0 && currentVersion !== loadedVersion

      if (isActiveDirty || isInProgress || hasVersionChange || shouldRefreshThreads) {
        await loadMessages(activeThreadId, { silent: true })
      }

      const syncCwd = activeGitCwd.value
      if (syncCwd) {
        void refreshGitStatusForCwd(syncCwd)
      }
    } catch {
      // Keep UI stable on transient event sync failures.
    } finally {
      isPolling.value = false

      if (
        (pendingThreadsRefresh || pendingThreadMessageRefresh.size > 0) &&
        typeof window !== 'undefined' &&
        eventSyncTimer === null
      ) {
        eventSyncTimer = window.setTimeout(() => {
          eventSyncTimer = null
          void syncFromNotifications()
        }, EVENT_SYNC_DEBOUNCE_MS)
      }
    }
  }

  function startPolling(): void {
    if (typeof window === 'undefined') return

    if (stopNotificationStream) return
    if (isAutoRefreshEnabled.value) {
      startAutoRefreshTimer()
    }
    void loadPendingServerRequestsFromBridge()
    stopNotificationStream = subscribeCodexNotifications((notification) => {
      applyRealtimeUpdates(notification)
      queueEventDrivenSync(notification)
    })
  }

  async function loadPendingServerRequestsFromBridge(): Promise<void> {
    try {
      const rows = await getPendingServerRequests()
      for (const row of rows) {
        const request = normalizeServerRequest(row)
        if (request) {
          upsertPendingServerRequest(request)
        }
      }
    } catch {
      // Keep UI usable when pending request endpoint is temporarily unavailable.
    }
  }

  async function respondToPendingServerRequest(reply: UiServerRequestReply): Promise<void> {
    try {
      await replyToServerRequest(reply.id, {
        result: reply.result,
        error: reply.error,
      })
      removePendingServerRequestById(reply.id)
    } catch (unknownError) {
      error.value = unknownError instanceof Error ? unknownError.message : 'Failed to reply to server request'
    }
  }

  function stopAutoRefreshTimer(options: { updatePreference?: boolean } = {}): void {
    const updatePreference = options.updatePreference ?? true

    if (autoRefreshIntervalTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(autoRefreshIntervalTimer)
      autoRefreshIntervalTimer = null
    }
    if (autoRefreshCountdownTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(autoRefreshCountdownTimer)
      autoRefreshCountdownTimer = null
    }
    if (updatePreference) {
      isAutoRefreshEnabled.value = false
      saveAutoRefreshEnabled(false)
    }
    autoRefreshSecondsLeft.value = Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000)
  }

  function startAutoRefreshTimer(): void {
    if (typeof window === 'undefined') return
    if (autoRefreshIntervalTimer !== null || autoRefreshCountdownTimer !== null) return

    isAutoRefreshEnabled.value = true
    saveAutoRefreshEnabled(true)
    autoRefreshSecondsLeft.value = Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000)

    autoRefreshIntervalTimer = window.setInterval(() => {
      autoRefreshSecondsLeft.value = Math.floor(AUTO_REFRESH_INTERVAL_MS / 1000)
      void syncThreadStatus()
    }, AUTO_REFRESH_INTERVAL_MS)

    autoRefreshCountdownTimer = window.setInterval(() => {
      autoRefreshSecondsLeft.value = Math.max(0, autoRefreshSecondsLeft.value - 1)
    }, 1000)
  }

  function toggleAutoRefreshTimer(): void {
    if (isAutoRefreshEnabled.value) {
      stopAutoRefreshTimer()
      return
    }
    startAutoRefreshTimer()
  }

  function stopPolling(): void {
    stopAutoRefreshTimer({ updatePreference: false })

    if (stopNotificationStream) {
      stopNotificationStream()
      stopNotificationStream = null
    }

    pendingThreadsRefresh = false
    pendingThreadMessageRefresh.clear()
    pendingTurnStartsById.clear()
    if (eventSyncTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(eventSyncTimer)
      eventSyncTimer = null
    }
    activeReasoningItemId = ''
    shouldAutoScrollOnNextAgentEvent = false
    persistedMessagesByThreadId.value = {}
    liveAgentMessagesByThreadId.value = {}
    liveReasoningTextByThreadId.value = {}
    contextUsagePercentByThreadId.value = {}
    turnActivityByThreadId.value = {}
    turnSummaryByThreadId.value = {}
    turnErrorByThreadId.value = {}
    activeTurnIdByThreadId.value = {}
  }

  let desktopChatStateSyncTimer: number | null = null
  let lastPushedDesktopChatState = ''

  function schedulePushDesktopChatState(): void {
    if (typeof window === 'undefined') return
    if (desktopChatStateSyncTimer !== null) {
      window.clearTimeout(desktopChatStateSyncTimer)
    }
    desktopChatStateSyncTimer = window.setTimeout(() => {
      desktopChatStateSyncTimer = null
      void pushDesktopChatStateNow()
    }, CHAT_STATE_SYNC_DEBOUNCE_MS)
  }

  async function pushDesktopChatStateNow(): Promise<void> {
    if (isApplyingRemoteDesktopChatState.value) return
    const snapshot = serializeDesktopChatSlice(
      projectOrder.value,
      projectDisplayNameById.value,
      projectCwdByProjectName.value,
      manualUnreadSyncByThreadId.value,
      eventUnreadSyncByThreadId.value,
      threadRunStateByThreadId.value,
      readStateByThreadId.value,
      threadPermissionModeByThreadId.value,
      threadFullAccessAcknowledgedByThreadId.value,
    )
    if (snapshot === lastPushedDesktopChatState) return
    try {
      const saved = await patchChatState({
        projectOrder: [...projectOrder.value],
        projectDisplayNames: { ...projectDisplayNameById.value },
        projectCwdByProjectName: { ...projectCwdByProjectName.value },
        manualUnreadSyncByThreadId: { ...manualUnreadSyncByThreadId.value },
        eventUnreadSyncByThreadId: { ...eventUnreadSyncByThreadId.value },
        threadRunStateByThreadId: { ...threadRunStateByThreadId.value },
        readStateByThreadId: { ...readStateByThreadId.value },
        threadPermissionModeByThreadId: { ...threadPermissionModeByThreadId.value },
        threadFullAccessAcknowledgedByThreadId: { ...threadFullAccessAcknowledgedByThreadId.value },
      })
      isApplyingRemoteDesktopChatState.value = true
      try {
        readStateByThreadId.value = mergeReadStateByThreadId(readStateByThreadId.value, saved.readStateByThreadId)
        saveReadStateMap(readStateByThreadId.value)
        manualUnreadSyncByThreadId.value = mergeFlagSyncByThreadId(
          manualUnreadSyncByThreadId.value,
          saved.manualUnreadSyncByThreadId,
        )
        saveFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY, manualUnreadSyncByThreadId.value)
        eventUnreadSyncByThreadId.value = mergeFlagSyncByThreadId(
          eventUnreadSyncByThreadId.value,
          saved.eventUnreadSyncByThreadId,
        )
        saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, eventUnreadSyncByThreadId.value)
        threadRunStateByThreadId.value = mergeThreadRunStateMap(
          threadRunStateByThreadId.value,
          saved.threadRunStateByThreadId,
        )
        saveRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY, threadRunStateByThreadId.value)
      } finally {
        isApplyingRemoteDesktopChatState.value = false
      }
      lastPushedDesktopChatState = serializeDesktopChatSlice(
        saved.projectOrder,
        saved.projectDisplayNames,
        saved.projectCwdByProjectName,
        saved.manualUnreadSyncByThreadId,
        saved.eventUnreadSyncByThreadId,
        saved.threadRunStateByThreadId,
        saved.readStateByThreadId,
        saved.threadPermissionModeByThreadId,
        saved.threadFullAccessAcknowledgedByThreadId,
      )
    } catch {
      // Keep local state when the bridge is unavailable.
    }
  }

  onMounted(async () => {
    if (typeof window === 'undefined') return
    isApplyingRemoteDesktopChatState.value = true
    try {
      const remote = await getChatState()
      readStateByThreadId.value = mergeReadStateByThreadId(readStateByThreadId.value, remote.readStateByThreadId)
      saveReadStateMap(readStateByThreadId.value)
      manualUnreadSyncByThreadId.value = mergeFlagSyncByThreadId(
        manualUnreadSyncByThreadId.value,
        remote.manualUnreadSyncByThreadId,
      )
      saveFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY, manualUnreadSyncByThreadId.value)
      eventUnreadSyncByThreadId.value = mergeFlagSyncByThreadId(
        eventUnreadSyncByThreadId.value,
        remote.eventUnreadSyncByThreadId,
      )
      saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, eventUnreadSyncByThreadId.value)
      threadRunStateByThreadId.value = mergeThreadRunStateMap(
        threadRunStateByThreadId.value,
        remote.threadRunStateByThreadId,
      )
      saveRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY, threadRunStateByThreadId.value)

      const hasDesktopRemote =
        remote.projectOrder.length > 0 ||
        Object.keys(remote.projectDisplayNames).length > 0 ||
        Object.keys(remote.projectCwdByProjectName).length > 0 ||
        Object.keys(remote.threadPermissionModeByThreadId).length > 0 ||
        Object.keys(remote.threadFullAccessAcknowledgedByThreadId).length > 0

      if (hasDesktopRemote) {
        projectOrder.value = [...remote.projectOrder]
        projectDisplayNameById.value = { ...remote.projectDisplayNames }
        projectCwdByProjectName.value = { ...remote.projectCwdByProjectName }
        threadPermissionModeByThreadId.value = { ...remote.threadPermissionModeByThreadId }
        threadFullAccessAcknowledgedByThreadId.value = { ...remote.threadFullAccessAcknowledgedByThreadId }
        saveProjectOrder(projectOrder.value)
        saveProjectDisplayNames(projectDisplayNameById.value)
        saveStringRecord(PROJECT_CWD_STORAGE_KEY, projectCwdByProjectName.value)
        applyThreadFlags()
        lastPushedDesktopChatState = serializeDesktopChatSlice(
          projectOrder.value,
          projectDisplayNameById.value,
          projectCwdByProjectName.value,
          manualUnreadSyncByThreadId.value,
          eventUnreadSyncByThreadId.value,
          threadRunStateByThreadId.value,
          readStateByThreadId.value,
          threadPermissionModeByThreadId.value,
          threadFullAccessAcknowledgedByThreadId.value,
        )
        return
      }

      const localSnapshot = serializeDesktopChatSlice(
        projectOrder.value,
        projectDisplayNameById.value,
        projectCwdByProjectName.value,
        manualUnreadSyncByThreadId.value,
        eventUnreadSyncByThreadId.value,
        threadRunStateByThreadId.value,
        readStateByThreadId.value,
        threadPermissionModeByThreadId.value,
        threadFullAccessAcknowledgedByThreadId.value,
      )
      if (localSnapshot === EMPTY_DESKTOP_CHAT_SLICE) {
        lastPushedDesktopChatState = localSnapshot
        return
      }

      const saved = await patchChatState({
        projectOrder: [...projectOrder.value],
        projectDisplayNames: { ...projectDisplayNameById.value },
        projectCwdByProjectName: { ...projectCwdByProjectName.value },
        manualUnreadSyncByThreadId: { ...manualUnreadSyncByThreadId.value },
        eventUnreadSyncByThreadId: { ...eventUnreadSyncByThreadId.value },
        threadRunStateByThreadId: { ...threadRunStateByThreadId.value },
        readStateByThreadId: { ...readStateByThreadId.value },
        threadPermissionModeByThreadId: { ...threadPermissionModeByThreadId.value },
        threadFullAccessAcknowledgedByThreadId: { ...threadFullAccessAcknowledgedByThreadId.value },
      })
      readStateByThreadId.value = mergeReadStateByThreadId(readStateByThreadId.value, saved.readStateByThreadId)
      saveReadStateMap(readStateByThreadId.value)
      manualUnreadSyncByThreadId.value = mergeFlagSyncByThreadId(
        manualUnreadSyncByThreadId.value,
        saved.manualUnreadSyncByThreadId,
      )
      saveFlagSyncRecord(MANUAL_UNREAD_SYNC_STORAGE_KEY, manualUnreadSyncByThreadId.value)
      eventUnreadSyncByThreadId.value = mergeFlagSyncByThreadId(
        eventUnreadSyncByThreadId.value,
        saved.eventUnreadSyncByThreadId,
      )
      saveFlagSyncRecord(EVENT_UNREAD_SYNC_STORAGE_KEY, eventUnreadSyncByThreadId.value)
      threadRunStateByThreadId.value = mergeThreadRunStateMap(
        threadRunStateByThreadId.value,
        saved.threadRunStateByThreadId,
      )
      saveRunStateRecord(THREAD_RUN_STATE_STORAGE_KEY, threadRunStateByThreadId.value)
      lastPushedDesktopChatState = serializeDesktopChatSlice(
        saved.projectOrder,
        saved.projectDisplayNames,
        saved.projectCwdByProjectName,
        saved.manualUnreadSyncByThreadId,
        saved.eventUnreadSyncByThreadId,
        saved.threadRunStateByThreadId,
        saved.readStateByThreadId,
        saved.threadPermissionModeByThreadId,
        saved.threadFullAccessAcknowledgedByThreadId,
      )
    } catch {
      lastPushedDesktopChatState = serializeDesktopChatSlice(
        projectOrder.value,
        projectDisplayNameById.value,
        projectCwdByProjectName.value,
        manualUnreadSyncByThreadId.value,
        eventUnreadSyncByThreadId.value,
        threadRunStateByThreadId.value,
        readStateByThreadId.value,
        threadPermissionModeByThreadId.value,
        threadFullAccessAcknowledgedByThreadId.value,
      )
    } finally {
      isApplyingRemoteDesktopChatState.value = false
    }

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void mergeRemoteThreadUiFromServer()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    onUnmounted(() => {
      document.removeEventListener('visibilitychange', onVisibility)
    })
  })

  watch(
    [
      projectOrder,
      projectDisplayNameById,
      projectCwdByProjectName,
      manualUnreadSyncByThreadId,
      eventUnreadSyncByThreadId,
      threadRunStateByThreadId,
      readStateByThreadId,
      threadPermissionModeByThreadId,
      threadFullAccessAcknowledgedByThreadId,
    ],
    () => {
      if (isApplyingRemoteDesktopChatState.value) return
      schedulePushDesktopChatState()
    },
    { deep: true },
  )

  const selectedThreadPermissionMode = computed<ThreadPermissionMode>(() => {
    const id = selectedThreadId.value.trim()
    if (!id) return 'default'
    return threadPermissionModeByThreadId.value[id] ?? 'default'
  })

  function setThreadPermissionMode(threadId: string, mode: ThreadPermissionMode): void {
    const id = threadId.trim()
    if (!id) return
    const next = { ...threadPermissionModeByThreadId.value }
    if (mode === 'default') {
      delete next[id]
    } else {
      next[id] = 'full-access'
    }
    threadPermissionModeByThreadId.value = next
  }

  function confirmFullAccessRiskAndSend(): void {
    const draft = pendingDraftForFullAccessAck.value
    const newThreadCwd = pendingFullAccessNewThreadCwd.value.trim()
    if (draft && newThreadCwd) {
      pendingFullAccessNewThreadCwd.value = ''
      fullAccessRiskModalOpen.value = false
      pendingDraftForFullAccessAck.value = null
      void sendMessageToNewThread(draft, newThreadCwd, { fullAccessAlreadyAcknowledged: true })
      return
    }

    const threadId = selectedThreadId.value.trim()
    if (!threadId || !draft) {
      fullAccessRiskModalOpen.value = false
      pendingDraftForFullAccessAck.value = null
      pendingFullAccessNewThreadCwd.value = ''
      return
    }
    threadFullAccessAcknowledgedByThreadId.value = {
      ...threadFullAccessAcknowledgedByThreadId.value,
      [threadId]: true,
    }
    fullAccessRiskModalOpen.value = false
    pendingDraftForFullAccessAck.value = null
    void sendMessageToSelectedThread(draft)
  }

  function cancelFullAccessRiskModal(): void {
    fullAccessRiskModalOpen.value = false
    pendingDraftForFullAccessAck.value = null
    pendingFullAccessNewThreadCwd.value = ''
  }

  function getProjectFolderCwd(projectName: string): string {
    const group = projectGroups.value.find((g) => g.projectName === projectName)
    if (group?.threads?.length) {
      for (const thread of group.threads) {
        const cwd = thread.cwd?.trim() ?? ''
        if (cwd) return cwd
      }
    }
    return projectCwdByProjectName.value[projectName]?.trim() ?? ''
  }

  async function startEmptyThreadAtWorktreeCwd(cwd: string): Promise<string> {
    const target = cwd.trim()
    if (!target) {
      throw new Error('Missing worktree path')
    }
    const model = selectedModelId.value.trim()
    const threadId = await startThread(target, model || undefined)
    markThreadAwaitingSidebar(threadId)
    await loadThreads()
    setSelectedThreadId(threadId)
    return threadId
  }

  async function forkThreadToWorktreeCwd(sourceThreadId: string, cwd: string): Promise<string> {
    const target = cwd.trim()
    const sid = sourceThreadId.trim()
    if (!target || !sid) {
      throw new Error('Missing thread or worktree path')
    }
    const model = selectedModelId.value.trim()
    error.value = ''
    try {
      const threadId = await forkThread(sid, {
        cwd: target,
        model: model || undefined,
      })
      await resumeThread(threadId)
      resumedThreadById.value = {
        ...resumedThreadById.value,
        [threadId]: true,
      }
      markThreadAwaitingSidebar(threadId)
      setSelectedThreadId(threadId)
      await loadThreads()
      return threadId
    } catch (unknownError) {
      const message = unknownError instanceof Error ? unknownError.message : 'Failed to fork thread'
      error.value = message
      throw unknownError
    }
  }

  return {
    projectGroups,
    projectDisplayNameById,
    projectCwdByProjectName,
    getProjectFolderCwd,
    selectedThread,
    selectedThreadScrollState,
    selectedThreadServerRequests,
    pendingApprovalRequests,
    selectedLiveOverlay,
    selectedThreadId,
    availableModelIds,
    selectedModelId,
    selectedReasoningEffort,
    selectedContextUsagePercent,
    selectedThreadGitStatus,
    selectedThreadGitStatusLoading,
    accountRateLimits,
    accountRateLimitsError,
    messages,
    isLoadingThreads,
    isLoadingMessages,
    isSendingMessage,
    isInterruptingTurn,
    isLoadingRateLimits,
    isAutoRefreshEnabled,
    autoRefreshSecondsLeft,
    error,
    refreshAll,
    selectThread,
    setThreadScrollState,
    archiveThreadById,
    sendMessageToSelectedThread,
    sendMessageToNewThread,
    interruptSelectedThreadTurn,
    setSelectedModelId,
    setSelectedReasoningEffort,
    selectedThreadPermissionMode,
    newThreadPermissionMode,
    setThreadPermissionMode,
    fullAccessRiskModalOpen,
    confirmFullAccessRiskAndSend,
    cancelFullAccessRiskModal,
    respondToPendingServerRequest,
    renameProject,
    renameThreadById,
    markThreadUnreadById,
    markThreadReadById,
    removeProject,
    reorderProject,
    toggleAutoRefreshTimer,
    startPolling,
    stopPolling,
    loadThreads,
    isThreadAwaitingSidebar,
    startEmptyThreadAtWorktreeCwd,
    forkThreadToWorktreeCwd,
  }
}
