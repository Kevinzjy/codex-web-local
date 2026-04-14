import type { FsDirectoriesResponse, FsMkdirResponse } from '../types/fsDirectories'

export async function fetchFsDirectories(pathQuery: string): Promise<FsDirectoriesResponse> {
  const params = new URLSearchParams()
  if (pathQuery.trim().length > 0) {
    params.set('path', pathQuery)
  }

  const query = params.toString()
  const response = await fetch(`/codex-api/fs/directories${query ? `?${query}` : ''}`)
  const payload: unknown = await response.json().catch(() => ({}))
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}

  if (!response.ok) {
    const message = typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`
    throw new Error(message)
  }

  return payload as FsDirectoriesResponse
}

export async function createFsDirectory(parentPath: string, name: string): Promise<FsMkdirResponse> {
  const response = await fetch('/codex-api/fs/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentPath: parentPath.trim(), name: name.trim() }),
  })

  const payload: unknown = await response.json().catch(() => ({}))
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}

  if (!response.ok) {
    const message = typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`
    throw new Error(message)
  }

  return payload as FsMkdirResponse
}
