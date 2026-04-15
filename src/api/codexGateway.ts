import {
  fetchChatState,
  fetchGitStatus,
  fetchRpcMethodCatalog,
  fetchRpcNotificationCatalog,
  fetchPendingServerRequests,
  patchChatState as patchChatStateRpc,
  rpcCall,
  respondServerRequest,
  subscribeRpcNotifications,
  type ChatState,
  type ChatStatePatch,
  type RpcNotification,
  type ThreadFlagSyncEntry,
  type ThreadRunStateEntry,
} from './codexRpcClient'
import type {
  ConfigReadResponse,
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  ModelListResponse,
  ReasoningEffort,
  ThreadListResponse,
  ThreadReadResponse,
} from './appServerDtos'
import { normalizeCodexApiError } from './codexErrors'
import { normalizeThreadGroupsV2, normalizeThreadMessagesV2 } from './normalizers/v2'
import type {
  ThreadPermissionMode,
  UiComposerDraft,
  UiGitStatus,
  UiMessage,
  UiProjectGroup,
  UiServerRequestId,
  UserInput,
} from '../types/codex'

type CurrentModelConfig = {
  model: string
  reasoningEffort: ReasoningEffort | ''
}

async function callRpc<T>(method: string, params?: unknown): Promise<T> {
  try {
    return await rpcCall<T>(method, params)
  } catch (error) {
    throw normalizeCodexApiError(error, `RPC ${method} failed`, method)
  }
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | '' {
  const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
  return typeof value === 'string' && allowed.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : ''
}

async function getThreadGroupsV2(): Promise<UiProjectGroup[]> {
  const payload = await callRpc<ThreadListResponse>('thread/list', {
    archived: false,
    limit: 100,
    sortKey: 'updated_at',
  })
  return normalizeThreadGroupsV2(payload)
}

async function getThreadMessagesV2(threadId: string): Promise<UiMessage[]> {
  const payload = await callRpc<ThreadReadResponse>('thread/read', {
    threadId,
    includeTurns: true,
  })
  return normalizeThreadMessagesV2(payload)
}

export async function getThreadGroups(): Promise<UiProjectGroup[]> {
  try {
    return await getThreadGroupsV2()
  } catch (error) {
    throw normalizeCodexApiError(error, 'Failed to load thread groups', 'thread/list')
  }
}

export async function getThreadMessages(threadId: string): Promise<UiMessage[]> {
  try {
    return await getThreadMessagesV2(threadId)
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to load thread ${threadId}`, 'thread/read')
  }
}

export async function getMethodCatalog(): Promise<string[]> {
  return fetchRpcMethodCatalog()
}

export async function getNotificationCatalog(): Promise<string[]> {
  return fetchRpcNotificationCatalog()
}

export function subscribeCodexNotifications(onNotification: (value: RpcNotification) => void): () => void {
  return subscribeRpcNotifications(onNotification)
}

export type { RpcNotification }

export async function replyToServerRequest(
  id: UiServerRequestId,
  payload: { result?: unknown; error?: { code?: number; message: string } },
): Promise<void> {
  await respondServerRequest({
    id,
    ...payload,
  })
}

export async function getPendingServerRequests(): Promise<unknown[]> {
  return fetchPendingServerRequests()
}

export async function resumeThread(threadId: string): Promise<void> {
  await callRpc('thread/resume', { threadId })
}

export async function archiveThread(threadId: string): Promise<void> {
  await callRpc('thread/archive', { threadId })
}

export async function setThreadName(threadId: string, name: string): Promise<void> {
  const normalizedThreadId = threadId.trim()
  const normalizedName = name.trim()
  if (!normalizedThreadId || !normalizedName) return

  await callRpc('thread/name/set', {
    threadId: normalizedThreadId,
    name: normalizedName,
  })
}

function normalizeThreadIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>

  const pickId = (obj: Record<string, unknown>): string => {
    for (const key of ['id', 'threadId']) {
      const v = obj[key]
      if (typeof v === 'string' && v.trim().length > 0) {
        return v.trim()
      }
    }
    return ''
  }

  const thread = record.thread
  if (thread && typeof thread === 'object') {
    const fromNested = pickId(thread as Record<string, unknown>)
    if (fromNested) return fromNested
  }

  const top = pickId(record)
  if (top) return top

  const alt = record.threadId ?? record.thread_id
  if (typeof alt === 'string' && alt.trim().length > 0) {
    return alt.trim()
  }
  return ''
}

export async function startThread(cwd?: string, model?: string): Promise<string> {
  try {
    const params: Record<string, unknown> = {}
    if (typeof cwd === 'string' && cwd.trim().length > 0) {
      params.cwd = cwd.trim()
    }
    if (typeof model === 'string' && model.trim().length > 0) {
      params.model = model.trim()
    }
    const payload = await callRpc<{ thread?: { id?: string } }>('thread/start', params)
    const threadId = normalizeThreadIdFromPayload(payload)
    if (!threadId) {
      throw new Error('thread/start did not return a thread id')
    }
    return threadId
  } catch (error) {
    throw normalizeCodexApiError(error, 'Failed to start a new thread', 'thread/start')
  }
}

export async function forkThread(
  sourceThreadId: string,
  options: { cwd: string; model?: string; persistExtendedHistory?: boolean },
): Promise<string> {
  try {
    const trimmedId = sourceThreadId.trim()
    const cwd = options.cwd.trim()
    if (!trimmedId || !cwd) {
      throw new Error('thread/fork requires thread id and cwd')
    }
    const params: Record<string, unknown> = {
      threadId: trimmedId,
      cwd,
      // true requires Codex experimentalApi; default false matches schema default and works without it.
      persistExtendedHistory: options.persistExtendedHistory ?? false,
    }
    if (typeof options.model === 'string' && options.model.trim().length > 0) {
      params.model = options.model.trim()
    }
    const payload = await callRpc<{ thread?: { id?: string } }>('thread/fork', params)
    const threadId = normalizeThreadIdFromPayload(payload)
    if (!threadId) {
      throw new Error('thread/fork did not return a thread id')
    }
    return threadId
  } catch (error) {
    throw normalizeCodexApiError(error, 'Failed to fork thread', 'thread/fork')
  }
}

function basenameFromPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/').replace(/\/+$/gu, '')
  const tail = normalized.split('/').filter(Boolean).at(-1) ?? ''
  return tail || pathValue
}

export type SkillSummary = {
  name: string
  description: string
  path: string
}

/**
 * Lists Codex skills for slash-command completion (`/skill` style).
 */
export async function listSkillsForCwd(cwd: string): Promise<SkillSummary[]> {
  try {
    const params: Record<string, unknown> = {}
    const trimmed = cwd.trim()
    if (trimmed) {
      params.cwds = [trimmed]
    }
    const payload = await callRpc<{
      data?: Array<{
        skills?: Array<{
          name?: string
          path?: string
          description?: string
          shortDescription?: string
        }>
      }>
    }>('skills/list', params)

    const rows = Array.isArray(payload.data) ? payload.data : []
    const byName = new Map<string, SkillSummary>()
    for (const row of rows) {
      const skills = Array.isArray(row.skills) ? row.skills : []
      for (const s of skills) {
        const name = typeof s.name === 'string' ? s.name.trim() : ''
        if (!name || byName.has(name)) continue
        const shortDesc = typeof s.shortDescription === 'string' ? s.shortDescription.trim() : ''
        const longDesc = typeof s.description === 'string' ? s.description.trim() : ''
        byName.set(name, {
          name,
          description: shortDesc || longDesc || 'Skill',
          path: typeof s.path === 'string' ? s.path : '',
        })
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** Resolve `./` / `../` relative paths against thread cwd for stable mention paths (POSIX-style). */
function resolveMentionPathForServer(userPath: string, cwd: string): string {
  const u = userPath.replace(/\\/gu, '/').trim()
  if (u.startsWith('/')) return u.replace(/\/+/gu, '/')
  if (u.startsWith('~')) return u

  const baseParts = cwd.replace(/\\/gu, '/').replace(/\/+$/gu, '').split('/').filter(Boolean)
  for (const seg of u.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      baseParts.pop()
    } else {
      baseParts.push(seg)
    }
  }
  return `/${baseParts.join('/')}`
}

/**
 * Minimal structured mention parser for `@path` tokens in free text.
 * We only treat path-like tokens as mentions to avoid breaking emails.
 */
function splitTextAndMentions(rawText: string, mentionResolveCwd?: string): UserInput[] {
  const input: UserInput[] = []
  /** Path after @: absolute (~, /), dot-relative (., .., ./…), or cwd-relative without a leading "./" (e.g. src/foo). */
  const mentionRegex = /(^|\s)@((?:[~./][^\s]*)|(?:[^\s@./][^\s]*))/gu
  let cursor = 0

  const pushText = (value: string): void => {
    if (value.length === 0) return
    input.push({ type: 'text', text: value, text_elements: [] })
  }

  for (const match of rawText.matchAll(mentionRegex)) {
    const full = match[0] ?? ''
    const leading = match[1] ?? ''
    const mentionPath = match[2] ?? ''
    const offset = match.index ?? -1
    if (offset < 0) continue

    const before = rawText.slice(cursor, offset)
    pushText(before + leading)

    const normalizedPath = mentionPath.trim()
    if (normalizedPath.length > 0) {
      const cwd = mentionResolveCwd?.trim() ?? ''
      const serverPath =
        cwd && !normalizedPath.startsWith('/') && !normalizedPath.startsWith('~')
          ? resolveMentionPathForServer(normalizedPath, cwd)
          : normalizedPath
      input.push({
        type: 'mention',
        name: basenameFromPath(serverPath),
        path: serverPath,
      })
    } else {
      pushText(full)
    }

    cursor = offset + full.length
  }

  pushText(rawText.slice(cursor))
  return input
}

export async function startThreadTurn(
  threadId: string,
  draft: UiComposerDraft,
  model?: string,
  effort?: ReasoningEffort,
  permissionMode?: ThreadPermissionMode,
  mentionResolveCwd?: string,
): Promise<void> {
  try {
    const text = draft.text.trim()
    const input: UserInput[] = []
    if (text.length > 0) {
      input.push(...splitTextAndMentions(text, mentionResolveCwd))
    }
    for (const image of draft.images) {
      const url = image.url.trim()
      if (url.length > 0) {
        input.push({ type: 'image', url })
      }
    }

    const params: Record<string, unknown> = {
      threadId,
      input,
    }
    if (typeof model === 'string' && model.length > 0) {
      params.model = model
    }
    if (typeof effort === 'string' && effort.length > 0) {
      params.effort = effort
    }
    if (permissionMode === 'full-access') {
      params.approvalPolicy = 'never'
      params.sandboxPolicy = { type: 'danger-full-access' }
    }
    await callRpc('turn/start', params)
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to start turn for thread ${threadId}`, 'turn/start')
  }
}

export async function interruptThreadTurn(threadId: string, turnId?: string): Promise<void> {
  const normalizedThreadId = threadId.trim()
  const normalizedTurnId = turnId?.trim() || ''
  if (!normalizedThreadId) return

  try {
    if (!normalizedTurnId) {
      throw new Error('turn/interrupt requires turnId')
    }
    await callRpc('turn/interrupt', { threadId: normalizedThreadId, turnId: normalizedTurnId })
  } catch (error) {
    throw normalizeCodexApiError(error, `Failed to interrupt turn for thread ${normalizedThreadId}`, 'turn/interrupt')
  }
}

export async function setDefaultModel(model: string): Promise<void> {
  await callRpc('setDefaultModel', { model })
}

export async function getAvailableModelIds(): Promise<string[]> {
  const payload = await callRpc<ModelListResponse>('model/list', {})
  const ids: string[] = []
  for (const row of payload.data) {
    const candidate = row.id || row.model
    if (!candidate || ids.includes(candidate)) continue
    ids.push(candidate)
  }
  return ids
}

export async function getCurrentModelConfig(): Promise<CurrentModelConfig> {
  const payload = await callRpc<ConfigReadResponse>('config/read', {})
  const model = payload.config.model ?? ''
  const reasoningEffort = normalizeReasoningEffort(payload.config.model_reasoning_effort)
  return { model, reasoningEffort }
}

export async function getAccountRateLimits(): Promise<GetAccountRateLimitsResponse> {
  return callRpc<GetAccountRateLimitsResponse>('account/rateLimits/read')
}

export async function getAccountInfo(): Promise<GetAccountResponse> {
  return callRpc<GetAccountResponse>('account/read', { refreshToken: false })
}

export async function readEffectiveConfig(): Promise<ConfigReadResponse> {
  return callRpc<ConfigReadResponse>('config/read', {})
}

export async function getGitStatus(cwd: string): Promise<UiGitStatus> {
  return fetchGitStatus(cwd)
}

export async function getChatState(): Promise<ChatState> {
  return fetchChatState()
}

export async function patchChatState(patch: ChatStatePatch): Promise<ChatState> {
  return patchChatStateRpc(patch)
}

export async function updatePinnedThreadIds(pinnedThreadIds: string[]): Promise<ChatState> {
  return patchChatStateRpc({ pinnedThreadIds })
}

export type { ChatState, ChatStatePatch, ThreadFlagSyncEntry, ThreadRunStateEntry }

// `thread/loaded/list` returns sessions loaded in memory, not currently running turns.
