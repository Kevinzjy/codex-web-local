import type { RpcEnvelope, RpcMethodCatalog, UiGitStatus, UiServerRequestId } from '../types/codex'
import { CodexApiError, extractErrorMessage } from './codexErrors'

type RpcRequestBody = {
  method: string
  params?: unknown
}

export type RpcNotification = {
  method: string
  params: unknown
  atIso: string
}

type ServerRequestReplyBody = {
  id: UiServerRequestId
  result?: unknown
  error?: {
    code?: number
    message: string
  }
}

export type ThreadPermissionMode = 'default' | 'full-access'

export type ChatState = {
  pinnedThreadIds: string[]
  collapsedProjects: Record<string, boolean>
  projectOrder: string[]
  projectDisplayNames: Record<string, string>
  projectCwdByProjectName: Record<string, string>
  manualUnreadByThreadId: Record<string, boolean>
  threadPermissionModeByThreadId: Record<string, ThreadPermissionMode>
  threadFullAccessAcknowledgedByThreadId: Record<string, boolean>
  updatedAtIso: string
}

export type ChatStatePatch = Partial<
  Pick<
    ChatState,
    | 'pinnedThreadIds'
    | 'collapsedProjects'
    | 'projectOrder'
    | 'projectDisplayNames'
    | 'projectCwdByProjectName'
    | 'manualUnreadByThreadId'
    | 'threadPermissionModeByThreadId'
    | 'threadFullAccessAcknowledgedByThreadId'
  >
>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizePinnedThreadIdsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const pinnedThreadIds: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (!normalized || pinnedThreadIds.includes(normalized)) continue
    pinnedThreadIds.push(normalized)
  }
  return pinnedThreadIds
}

function normalizeCollapsedProjectsFromUnknown(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (raw === true) {
      record[key] = true
    } else if (raw === false) {
      record[key] = false
    }
  }
  return record
}

function normalizeProjectOrderFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const order: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (!normalized || order.includes(normalized)) continue
    order.push(normalized)
  }
  return order
}

function normalizeProjectDisplayNamesFromUnknown(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (typeof raw !== 'string') continue
    record[key] = raw
  }
  return record
}

function normalizeProjectCwdByProjectNameFromUnknown(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    record[key] = trimmed
  }
  return record
}

function normalizeManualUnreadFromUnknown(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (raw === true) {
      record[key] = true
    }
  }
  return record
}

function normalizeThreadPermissionModesFromUnknown(value: unknown): Record<string, ThreadPermissionMode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, ThreadPermissionMode> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (raw === 'default' || raw === 'full-access') {
      record[key] = raw
    }
  }
  return record
}

function normalizeThreadFullAccessAckFromUnknown(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (raw === true) {
      record[key] = true
    }
  }
  return record
}

function parseChatStatePayload(payload: unknown): ChatState {
  const record = asRecord(payload)
  const updatedAtIso =
    record && typeof record.updatedAtIso === 'string' && record.updatedAtIso.length > 0
      ? record.updatedAtIso
      : new Date(0).toISOString()

  if (!record) {
    return {
      pinnedThreadIds: [],
      collapsedProjects: {},
      projectOrder: [],
      projectDisplayNames: {},
      projectCwdByProjectName: {},
      manualUnreadByThreadId: {},
      threadPermissionModeByThreadId: {},
      threadFullAccessAcknowledgedByThreadId: {},
      updatedAtIso,
    }
  }

  return {
    pinnedThreadIds: normalizePinnedThreadIdsFromUnknown(record.pinnedThreadIds),
    collapsedProjects: normalizeCollapsedProjectsFromUnknown(record.collapsedProjects),
    projectOrder: normalizeProjectOrderFromUnknown(record.projectOrder),
    projectDisplayNames: normalizeProjectDisplayNamesFromUnknown(record.projectDisplayNames),
    projectCwdByProjectName: normalizeProjectCwdByProjectNameFromUnknown(record.projectCwdByProjectName),
    manualUnreadByThreadId: normalizeManualUnreadFromUnknown(record.manualUnreadByThreadId),
    threadPermissionModeByThreadId: normalizeThreadPermissionModesFromUnknown(record.threadPermissionModeByThreadId),
    threadFullAccessAcknowledgedByThreadId: normalizeThreadFullAccessAckFromUnknown(
      record.threadFullAccessAcknowledgedByThreadId,
    ),
    updatedAtIso,
  }
}

const RPC_GATEWAY_RETRY_ATTEMPTS = 2
const RPC_GATEWAY_RETRY_BASE_MS = 280

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function rpcCall<T>(method: string, params?: unknown): Promise<T> {
  const body: RpcRequestBody = { method, params: params ?? null }

  for (let attempt = 0; attempt <= RPC_GATEWAY_RETRY_ATTEMPTS; attempt++) {
    let response: Response
    try {
      response = await fetch('/codex-api/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new CodexApiError(
        error instanceof Error ? error.message : `RPC ${method} failed before request was sent`,
        { code: 'network_error', method },
      )
    }

    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      const transient = response.status === 502 || response.status === 503
      if (transient && attempt < RPC_GATEWAY_RETRY_ATTEMPTS) {
        await sleepMs(RPC_GATEWAY_RETRY_BASE_MS * (attempt + 1))
        continue
      }
      throw new CodexApiError(
        extractErrorMessage(payload, `RPC ${method} failed with HTTP ${response.status}`),
        {
          code: 'http_error',
          method,
          status: response.status,
        },
      )
    }

    const envelope = payload as RpcEnvelope<T> | null
    if (!envelope || typeof envelope !== 'object' || !('result' in envelope)) {
      throw new CodexApiError(`RPC ${method} returned malformed envelope`, {
        code: 'invalid_response',
        method,
        status: response.status,
      })
    }
    return envelope.result
  }

  throw new CodexApiError(`RPC ${method} failed`, { code: 'http_error', method })
}

export async function fetchRpcMethodCatalog(): Promise<string[]> {
  const response = await fetch('/codex-api/meta/methods')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Method catalog failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'meta/methods',
        status: response.status,
      },
    )
  }

  const catalog = payload as RpcMethodCatalog
  return Array.isArray(catalog.data) ? catalog.data : []
}

export async function fetchRpcNotificationCatalog(): Promise<string[]> {
  const response = await fetch('/codex-api/meta/notifications')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Notification catalog failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'meta/notifications',
        status: response.status,
      },
    )
  }

  const catalog = payload as RpcMethodCatalog
  return Array.isArray(catalog.data) ? catalog.data : []
}

function toNotification(value: unknown): RpcNotification | null {
  const record = asRecord(value)
  if (!record) return null
  if (typeof record.method !== 'string' || record.method.length === 0) return null

  const atIso = typeof record.atIso === 'string' && record.atIso.length > 0
    ? record.atIso
    : new Date().toISOString()

  return {
    method: record.method,
    params: record.params ?? null,
    atIso,
  }
}

export function subscribeRpcNotifications(onNotification: (value: RpcNotification) => void): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {}
  }

  const source = new EventSource('/codex-api/events')

  source.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as unknown
      const notification = toNotification(parsed)
      if (notification) {
        onNotification(notification)
      }
    } catch {
      // Ignore malformed event payloads and keep stream alive.
    }
  }

  return () => {
    source.close()
  }
}

export async function respondServerRequest(body: ServerRequestReplyBody): Promise<void> {
  let response: Response
  try {
    response = await fetch('/codex-api/server-requests/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : 'Failed to reply to server request',
      { code: 'network_error', method: 'server-requests/respond' },
    )
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Server request reply failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'server-requests/respond',
        status: response.status,
      },
    )
  }
}

export async function fetchGitStatus(cwd: string): Promise<UiGitStatus> {
  const encoded = encodeURIComponent(cwd)
  let response: Response
  try {
    response = await fetch(`/codex-api/git/status?cwd=${encoded}`)
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : 'Git status request failed before it was sent',
      { code: 'network_error', method: 'git/status' },
    )
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Git status failed with HTTP ${String(response.status)}`),
      {
        code: 'http_error',
        method: 'git/status',
        status: response.status,
      },
    )
  }

  return payload as UiGitStatus
}

export async function fetchPendingServerRequests(): Promise<unknown[]> {
  const response = await fetch('/codex-api/server-requests/pending')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Pending server requests failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'server-requests/pending',
        status: response.status,
      },
    )
  }

  const record = asRecord(payload)
  const data = record?.data
  return Array.isArray(data) ? data : []
}

export async function fetchChatState(): Promise<ChatState> {
  const response = await fetch('/codex-api/chat-state', { cache: 'no-store' })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Chat state request failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'chat-state',
        status: response.status,
      },
    )
  }

  return parseChatStatePayload(payload)
}

export async function patchChatState(patch: ChatStatePatch): Promise<ChatState> {
  let response: Response
  try {
    response = await fetch('/codex-api/chat-state', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    })
  } catch (error) {
    throw new CodexApiError(
      error instanceof Error ? error.message : 'Failed to patch chat state',
      { code: 'network_error', method: 'chat-state' },
    )
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new CodexApiError(
      extractErrorMessage(payload, `Chat state patch failed with HTTP ${response.status}`),
      {
        code: 'http_error',
        method: 'chat-state',
        status: response.status,
      },
    )
  }

  return parseChatStatePayload(payload)
}
