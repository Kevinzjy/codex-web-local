import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

type ThreadPermissionMode = 'default' | 'full-access'

type ChatStateDocument = {
  version: 1
  updatedAtIso: string
  pinnedThreadIds: string[]
  collapsedProjects: Record<string, boolean>
  projectOrder: string[]
  projectDisplayNames: Record<string, string>
  /** Last-known absolute cwd per project basename key (survives zero-thread project rows). */
  projectCwdByProjectName: Record<string, string>
  manualUnreadByThreadId: Record<string, boolean>
  threadPermissionModeByThreadId: Record<string, ThreadPermissionMode>
  threadFullAccessAcknowledgedByThreadId: Record<string, boolean>
}

export type ChatStatePayload = {
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
    ChatStateDocument,
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

const CHAT_STATE_VERSION = 1

function getChatStatePath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
  if (xdgConfigHome) {
    return join(xdgConfigHome, 'codex-web-local', 'chat-state.json')
  }
  return join(homedir(), '.config', 'codex-web-local', 'chat-state.json')
}

function normalizePinnedThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (!normalized || ids.includes(normalized)) continue
    ids.push(normalized)
  }
  return ids
}

function normalizeCollapsedProjects(value: unknown): Record<string, boolean> {
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

function normalizeProjectOrder(value: unknown): string[] {
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

function normalizeProjectDisplayNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const record: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (typeof raw !== 'string') continue
    record[key] = raw
  }
  return record
}

function normalizeProjectCwdByProjectName(value: unknown): Record<string, string> {
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

function normalizeManualUnread(value: unknown): Record<string, boolean> {
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

function normalizeThreadPermissionModes(value: unknown): Record<string, ThreadPermissionMode> {
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

function normalizeThreadFullAccessAck(value: unknown): Record<string, boolean> {
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

function toPayload(doc: ChatStateDocument): ChatStatePayload {
  return {
    pinnedThreadIds: [...doc.pinnedThreadIds],
    collapsedProjects: { ...doc.collapsedProjects },
    projectOrder: [...doc.projectOrder],
    projectDisplayNames: { ...doc.projectDisplayNames },
    projectCwdByProjectName: { ...doc.projectCwdByProjectName },
    manualUnreadByThreadId: { ...doc.manualUnreadByThreadId },
    threadPermissionModeByThreadId: { ...doc.threadPermissionModeByThreadId },
    threadFullAccessAcknowledgedByThreadId: { ...doc.threadFullAccessAcknowledgedByThreadId },
    updatedAtIso: doc.updatedAtIso,
  }
}

function createDefaultDocument(): ChatStateDocument {
  return {
    version: CHAT_STATE_VERSION,
    updatedAtIso: new Date().toISOString(),
    pinnedThreadIds: [],
    collapsedProjects: {},
    projectOrder: [],
    projectDisplayNames: {},
    projectCwdByProjectName: {},
    manualUnreadByThreadId: {},
    threadPermissionModeByThreadId: {},
    threadFullAccessAcknowledgedByThreadId: {},
  }
}

async function readDocument(path: string): Promise<ChatStateDocument> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return createDefaultDocument()
    }
    const record = parsed as Record<string, unknown>
    const base = createDefaultDocument()
    return {
      ...base,
      updatedAtIso:
        typeof record.updatedAtIso === 'string' && record.updatedAtIso.trim().length > 0
          ? record.updatedAtIso
          : new Date().toISOString(),
      pinnedThreadIds: normalizePinnedThreadIds(record.pinnedThreadIds),
      collapsedProjects: normalizeCollapsedProjects(record.collapsedProjects),
      projectOrder: normalizeProjectOrder(record.projectOrder),
      projectDisplayNames: normalizeProjectDisplayNames(record.projectDisplayNames),
      projectCwdByProjectName: normalizeProjectCwdByProjectName(record.projectCwdByProjectName),
      manualUnreadByThreadId: normalizeManualUnread(record.manualUnreadByThreadId),
      threadPermissionModeByThreadId: normalizeThreadPermissionModes(record.threadPermissionModeByThreadId),
      threadFullAccessAcknowledgedByThreadId: normalizeThreadFullAccessAck(record.threadFullAccessAcknowledgedByThreadId),
    }
  } catch {
    return createDefaultDocument()
  }
}

async function writeDocument(path: string, doc: ChatStateDocument): Promise<void> {
  const parentDir = dirname(path)
  await mkdir(parentDir, { recursive: true })

  const tmpPath = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  const serialized = `${JSON.stringify(doc, null, 2)}\n`
  await writeFile(tmpPath, serialized, 'utf8')
  await rename(tmpPath, path)
}

function isSameChatStateData(first: ChatStateDocument, second: ChatStateDocument): boolean {
  const a = toPayload(first)
  const b = toPayload(second)
  return (
    JSON.stringify(a.pinnedThreadIds) === JSON.stringify(b.pinnedThreadIds) &&
    JSON.stringify(a.collapsedProjects) === JSON.stringify(b.collapsedProjects) &&
    JSON.stringify(a.projectOrder) === JSON.stringify(b.projectOrder) &&
    JSON.stringify(a.projectDisplayNames) === JSON.stringify(b.projectDisplayNames) &&
    JSON.stringify(a.projectCwdByProjectName) === JSON.stringify(b.projectCwdByProjectName) &&
    JSON.stringify(a.manualUnreadByThreadId) === JSON.stringify(b.manualUnreadByThreadId) &&
    JSON.stringify(a.threadPermissionModeByThreadId) === JSON.stringify(b.threadPermissionModeByThreadId) &&
    JSON.stringify(a.threadFullAccessAcknowledgedByThreadId) === JSON.stringify(b.threadFullAccessAcknowledgedByThreadId)
  )
}

export class ChatStateStore {
  private readonly path = getChatStatePath()
  /**
   * Serializes patch() so concurrent HTTP PATCH requests cannot read stale disk state
   * and overwrite another patch (e.g. desktop state write clobbering a pin write).
   */
  private patchQueueTail: Promise<unknown> = Promise.resolve()

  async read(): Promise<ChatStatePayload> {
    const doc = await readDocument(this.path)
    return toPayload(doc)
  }

  async patch(patch: ChatStatePatch): Promise<ChatStatePayload> {
    const resultPromise = this.patchQueueTail.then(() => this.applyPatchUnlocked(patch))
    this.patchQueueTail = resultPromise.then(
      () => {},
      () => {},
    )
    return resultPromise
  }

  private async applyPatchUnlocked(patch: ChatStatePatch): Promise<ChatStatePayload> {
    const current = await readDocument(this.path)
    const next: ChatStateDocument = {
      ...current,
      updatedAtIso: current.updatedAtIso,
    }

    if (patch.pinnedThreadIds !== undefined) {
      next.pinnedThreadIds = normalizePinnedThreadIds(patch.pinnedThreadIds)
    }
    if (patch.collapsedProjects !== undefined) {
      next.collapsedProjects = normalizeCollapsedProjects(patch.collapsedProjects)
    }
    if (patch.projectOrder !== undefined) {
      next.projectOrder = normalizeProjectOrder(patch.projectOrder)
    }
    if (patch.projectDisplayNames !== undefined) {
      next.projectDisplayNames = normalizeProjectDisplayNames(patch.projectDisplayNames)
    }
    if (patch.projectCwdByProjectName !== undefined) {
      next.projectCwdByProjectName = normalizeProjectCwdByProjectName(patch.projectCwdByProjectName)
    }
    if (patch.manualUnreadByThreadId !== undefined) {
      next.manualUnreadByThreadId = normalizeManualUnread(patch.manualUnreadByThreadId)
    }
    if (patch.threadPermissionModeByThreadId !== undefined) {
      next.threadPermissionModeByThreadId = normalizeThreadPermissionModes(patch.threadPermissionModeByThreadId)
    }
    if (patch.threadFullAccessAcknowledgedByThreadId !== undefined) {
      next.threadFullAccessAcknowledgedByThreadId = normalizeThreadFullAccessAck(patch.threadFullAccessAcknowledgedByThreadId)
    }

    if (isSameChatStateData(current, next)) {
      return toPayload(current)
    }

    const saved: ChatStateDocument = {
      ...next,
      updatedAtIso: new Date().toISOString(),
    }
    await writeDocument(this.path, saved)
    return toPayload(saved)
  }
}
