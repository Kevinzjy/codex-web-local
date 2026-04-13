import { realpath } from 'node:fs/promises'

type RpcCaller = (method: string, params: unknown) => Promise<unknown>

function readThreadListPage(payload: unknown): { rows: Array<{ cwd: string }>; nextCursor: string | null } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { rows: [], nextCursor: null }
  }

  const record = payload as Record<string, unknown>
  const data = record.data
  const rows: Array<{ cwd: string }> = []
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const cwd = (item as Record<string, unknown>).cwd
      if (typeof cwd === 'string' && cwd.trim().length > 0) {
        rows.push({ cwd: cwd.trim() })
      }
    }
  }

  const next = record.nextCursor
  const nextCursor = typeof next === 'string' && next.length > 0 ? next : null
  return { rows, nextCursor }
}

async function hasThreadWithCwdFilter(
  rpc: RpcCaller,
  cwd: string,
  archived: boolean,
): Promise<boolean> {
  try {
    const payload = await rpc('thread/list', {
      archived,
      cwd,
      limit: 8,
      sortKey: 'updated_at',
    })
    return readThreadListPage(payload).rows.length > 0
  } catch {
    return false
  }
}

async function resolvedMatchesThreadCwd(threadCwd: string, resolvedTarget: string): Promise<boolean> {
  try {
    const rp = await realpath(threadCwd)
    return rp === resolvedTarget
  } catch {
    return false
  }
}

async function scanThreadsForResolvedMatch(
  rpc: RpcCaller,
  resolvedTarget: string,
  archived: boolean,
): Promise<boolean> {
  let cursor: string | null = null
  for (let page = 0; page < 25; page += 1) {
    let payload: unknown
    try {
      payload = await rpc('thread/list', {
        archived,
        limit: 200,
        sortKey: 'updated_at',
        cursor,
      })
    } catch {
      return false
    }

    const { rows, nextCursor } = readThreadListPage(payload)
    for (const row of rows) {
      if (await resolvedMatchesThreadCwd(row.cwd, resolvedTarget)) {
        return true
      }
    }

    cursor = nextCursor
    if (!cursor || rows.length === 0) {
      break
    }
  }

  return false
}

/**
 * Returns true when Codex has at least one thread whose session cwd resolves to the same path
 * as `resolvedTarget`, or when thread/list accepts an exact cwd filter for the request path.
 */
export async function cwdIsKnownCodexWorkspace(
  rpc: RpcCaller,
  resolvedTarget: string,
  requestedRaw: string,
): Promise<boolean> {
  const candidates = Array.from(
    new Set(
      [requestedRaw.trim(), resolvedTarget].filter((p) => p.length > 0),
    ),
  )

  for (const cwd of candidates) {
    if (await hasThreadWithCwdFilter(rpc, cwd, false)) return true
    if (await hasThreadWithCwdFilter(rpc, cwd, true)) return true
  }

  if (await scanThreadsForResolvedMatch(rpc, resolvedTarget, false)) return true
  if (await scanThreadsForResolvedMatch(rpc, resolvedTarget, true)) return true

  return false
}
