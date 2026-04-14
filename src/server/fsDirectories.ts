import { mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import type { FsDirectoriesResponse, FsDirectoryEntry, FsMkdirResponse } from '../types/fsDirectories.js'

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/** True if `candidate` is exactly a root or a descendant (logical path string). */
function isPathUnderAllowedRoots(candidate: string, roots: string[]): boolean {
  const normalized = path.normalize(candidate)
  for (const root of roots) {
    if (normalized === root) return true
    if (normalized.startsWith(root + path.sep)) return true
  }
  return false
}

/**
 * Allow navigation when either the logical path is under roots, or its resolved
 * realpath is (e.g. $HOME is a symlink to a path listed as a root).
 */
async function isUnderAllowedRoots(logicalPath: string, roots: string[]): Promise<boolean> {
  const normalized = path.normalize(logicalPath)
  if (isPathUnderAllowedRoots(normalized, roots)) return true
  try {
    const rp = await realpath(normalized)
    return isPathUnderAllowedRoots(rp, roots)
  } catch {
    return false
  }
}

async function resolveAllowedRoots(): Promise<string[]> {
  const raw = process.env.CODEX_WEB_PROJECT_ROOTS?.split(',') ?? []
  const candidates =
    raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0).length > 0
      ? raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
      : [homedir(), process.cwd()]

  const resolved = new Set<string>()
  for (const p of candidates) {
    try {
      resolved.add(await realpath(path.resolve(p)))
    } catch {
      // Skip roots that do not exist or are inaccessible at startup.
    }
  }

  return [...resolved].sort((a, b) => a.localeCompare(b))
}

const MAX_FOLDER_NAME_LENGTH = 255

function isValidFolderName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_FOLDER_NAME_LENGTH) return false
  if (trimmed === '.' || trimmed === '..') return false
  if (/[/\\]/.test(trimmed)) return false
  if (trimmed.includes('\0')) return false
  return true
}

async function getParentLogicalIfAllowed(logicalCurrent: string, roots: string[]): Promise<string | null> {
  for (const root of roots) {
    if (logicalCurrent === root) return null
  }

  const parent = path.dirname(logicalCurrent)
  if (parent === logicalCurrent) return null

  return (await isUnderAllowedRoots(parent, roots)) ? parent : null
}

export async function handleFsDirectoriesGet(rawPath: string | null, res: ServerResponse): Promise<void> {
  const roots = await resolveAllowedRoots()

  if (roots.length === 0) {
    setJson(res, 503, { error: 'No accessible project roots configured' })
    return
  }

  const trimmed = rawPath?.trim() ?? ''
  if (trimmed.length === 0) {
    const payload: FsDirectoriesResponse = {
      path: '',
      parentPath: null,
      roots,
      directories: [],
    }
    setJson(res, 200, payload)
    return
  }

  let absolute: string
  try {
    absolute = path.resolve(trimmed)
  } catch {
    setJson(res, 400, { error: 'Invalid path' })
    return
  }

  const logicalCurrent = path.normalize(absolute)

  if (!(await isUnderAllowedRoots(logicalCurrent, roots))) {
    setJson(res, 403, { error: 'Path is outside allowed project roots' })
    return
  }

  let st
  try {
    st = await stat(logicalCurrent)
  } catch {
    setJson(res, 404, { error: 'Path does not exist' })
    return
  }

  if (!st.isDirectory()) {
    setJson(res, 400, { error: 'Not a directory' })
    return
  }

  const parentPath = await getParentLogicalIfAllowed(logicalCurrent, roots)

  let names: string[]
  try {
    names = await readdir(logicalCurrent)
  } catch {
    setJson(res, 403, { error: 'Permission denied' })
    return
  }

  const directories: FsDirectoryEntry[] = []
  for (const name of names) {
    if (name === '.' || name === '..') continue

    const childLogical = path.normalize(path.join(logicalCurrent, name))

    if (!(await isUnderAllowedRoots(childLogical, roots))) {
      continue
    }

    try {
      const stChild = await stat(childLogical)
      if (!stChild.isDirectory()) continue
      directories.push({ name, path: childLogical })
    } catch {
      continue
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name))

  const payload: FsDirectoriesResponse = {
    path: logicalCurrent,
    parentPath,
    roots,
    directories,
  }
  setJson(res, 200, payload)
}

export async function handleFsMkdirPost(body: unknown, res: ServerResponse): Promise<void> {
  const roots = await resolveAllowedRoots()

  if (roots.length === 0) {
    setJson(res, 503, { error: 'No accessible project roots configured' })
    return
  }

  const record = body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  const parentRaw = typeof record?.parentPath === 'string' ? record.parentPath.trim() : ''
  const nameRaw = typeof record?.name === 'string' ? record.name.trim() : ''

  if (!parentRaw || !nameRaw) {
    setJson(res, 400, { error: 'Expected parentPath and name' })
    return
  }

  if (!isValidFolderName(nameRaw)) {
    setJson(res, 400, { error: 'Invalid folder name' })
    return
  }

  let parentLogical: string
  try {
    parentLogical = path.normalize(path.resolve(parentRaw))
  } catch {
    setJson(res, 400, { error: 'Invalid path' })
    return
  }

  if (!(await isUnderAllowedRoots(parentLogical, roots))) {
    setJson(res, 403, { error: 'Path is outside allowed project roots' })
    return
  }

  let stParent
  try {
    stParent = await stat(parentLogical)
  } catch {
    setJson(res, 404, { error: 'Parent path does not exist' })
    return
  }

  if (!stParent.isDirectory()) {
    setJson(res, 400, { error: 'Parent is not a directory' })
    return
  }

  const childLogical = path.normalize(path.join(parentLogical, nameRaw))
  const rel = path.relative(parentLogical, childLogical)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    setJson(res, 400, { error: 'Invalid folder name' })
    return
  }

  if (!(await isUnderAllowedRoots(childLogical, roots))) {
    setJson(res, 403, { error: 'Path is outside allowed project roots' })
    return
  }

  try {
    await mkdir(childLogical, { recursive: false })
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? (error as NodeJS.ErrnoException).code : ''
    if (code === 'EEXIST') {
      setJson(res, 409, { error: 'Already exists' })
      return
    }
    if (code === 'EACCES' || code === 'EPERM') {
      setJson(res, 403, { error: 'Permission denied' })
      return
    }
    setJson(res, 500, { error: 'Failed to create folder' })
    return
  }

  const payload: FsMkdirResponse = { path: childLogical }
  setJson(res, 200, payload)
}
