import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, normalize, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const GIT_STATUS_TIMEOUT_MS = 1500
const GIT_REV_PARSE_TIMEOUT_MS = 800
const CACHE_TTL_MS = 3000

export type GitStatusOptions = {
  /**
   * When the cwd is outside CODEX_WEB_PROJECT_ROOTS / default roots, this hook can allow git
   * if the path is a known Codex session working directory (e.g. matches thread/list).
   */
  allowIfKnownCodexCwd?: (ctx: { resolved: string; requested: string }) => Promise<boolean>
}

export type GitStatusNotRepo = {
  ok: true
  cwd: string
  isRepo: false
  reason: 'not_git_repo' | 'not_allowed' | 'not_found'
  lastUpdatedAt: number
}

export type GitStatusRepo = {
  ok: true
  cwd: string
  isRepo: true
  branch: string | null
  headShortSha: string | null
  detached: boolean
  dirty: boolean
  /** Distinct paths reported in porcelain (rename may count two paths). */
  uniquePaths: number
  /** Line insertions vs HEAD from `git diff HEAD --numstat` (tracked changes only). */
  lineInsertions: number
  /** Line deletions vs HEAD from `git diff HEAD --numstat`. */
  lineDeletions: number
  staged: number
  unstaged: number
  untracked: number
  ahead: number
  behind: number
  lastUpdatedAt: number
}

export type GitStatusError = {
  ok: false
  cwd: string
  code: 'timeout' | 'spawn_failed' | 'parse_failed' | 'internal'
  message: string
  lastUpdatedAt: number
}

export type GitStatusResponse = GitStatusNotRepo | GitStatusRepo | GitStatusError

type CacheEntry = {
  expiresAt: number
  value: Promise<GitStatusResponse>
}

const cacheByCwd = new Map<string, CacheEntry>()
const inFlightByCwd = new Map<string, Promise<GitStatusResponse>>()

function nowMs(): number {
  return Date.now()
}

function parseProjectRoots(): string[] {
  const raw = process.env.CODEX_WEB_PROJECT_ROOTS?.trim() ?? ''
  if (!raw) {
    const roots = [homedir(), process.cwd()].map((p) => normalize(p))
    return Array.from(new Set(roots))
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((p) => normalize(resolve(p)))
}

function isPathUnderAllowedRoot(resolvedPath: string, roots: string[]): boolean {
  const pathNorm = resolvedPath.replace(/\\/gu, '/')
  for (const root of roots) {
    const rootNorm = root.replace(/\\/gu, '/').replace(/\/+$/u, '')
    if (pathNorm === rootNorm) return true
    if (pathNorm.startsWith(`${rootNorm}/`)) return true
  }
  return false
}

async function resolveSafeCwd(
  cwd: string,
  options?: GitStatusOptions,
): Promise<{ resolved: string } | { error: GitStatusNotRepo['reason'] }> {
  const trimmed = cwd.trim()
  if (!trimmed || !isAbsolute(trimmed)) {
    return { error: 'not_found' }
  }

  try {
    const resolved = await realpath(trimmed)
    const roots = parseProjectRoots()
    if (isPathUnderAllowedRoot(resolved, roots)) {
      return { resolved }
    }

    if (options?.allowIfKnownCodexCwd) {
      const allowed = await options.allowIfKnownCodexCwd({ resolved, requested: trimmed })
      if (allowed) {
        return { resolved }
      }
    }

    return { error: 'not_allowed' }
  } catch {
    return { error: 'not_found' }
  }
}

function runGit(
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const proc = spawn('git', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let killedByTimeout = false

    const timer = setTimeout(() => {
      killedByTimeout = true
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, timeoutMs)
    timer.unref?.()

    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    proc.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    const finish = (exitCode: number | null) => {
      clearTimeout(timer)
      resolvePromise({ exitCode, stdout, stderr, timedOut: killedByTimeout })
    }

    proc.on('error', () => {
      finish(null)
    })

    proc.on('close', (code) => {
      finish(code)
    })
  })
}

function addPorcelainPaths(line: string, into: Set<string>): void {
  if (line.length < 3) return
  const rest = line.slice(3).trim()
  if (!rest) return

  const arrowIdx = rest.indexOf(' -> ')
  if (arrowIdx >= 0) {
    const from = rest.slice(0, arrowIdx).trim()
    const to = rest.slice(arrowIdx + 4).trim()
    if (from.length > 0) into.add(from)
    if (to.length > 0) into.add(to)
    return
  }

  into.add(rest)
}

export function parseGitStatusPorcelain(stdout: string): {
  detached: boolean
  branch: string | null
  ahead: number
  behind: number
  uniquePaths: number
  staged: number
  unstaged: number
  untracked: number
} {
  const lines = stdout.split('\n').filter((line) => line.length > 0)
  let detached = false
  let branch: string | null = null
  let ahead = 0
  let behind = 0

  let bodyStart = 0
  if (lines.length > 0 && lines[0].startsWith('## ')) {
    const header = lines[0].slice(3)
    if (header.startsWith('HEAD (no branch)')) {
      detached = true
      branch = null
    } else {
      const branchPart = header.split('...')[0]?.trim() ?? ''
      branch = branchPart.length > 0 ? branchPart : null
    }

    const combined = /\[ahead (\d+),\s*behind (\d+)\]/u.exec(header)
    if (combined) {
      ahead = Number.parseInt(combined[1] ?? '0', 10) || 0
      behind = Number.parseInt(combined[2] ?? '0', 10) || 0
    } else {
      const aheadMatch = /\[ahead (\d+)\]/u.exec(header)
      const behindMatch = /\[behind (\d+)\]/u.exec(header)
      if (aheadMatch) ahead = Number.parseInt(aheadMatch[1] ?? '0', 10) || 0
      if (behindMatch) behind = Number.parseInt(behindMatch[1] ?? '0', 10) || 0
    }

    bodyStart = 1
  }

  let staged = 0
  let unstaged = 0
  let untracked = 0
  const pathSet = new Set<string>()

  for (let i = bodyStart; i < lines.length; i += 1) {
    const line = lines[i]
    addPorcelainPaths(line, pathSet)

    if (line.startsWith('??')) {
      untracked += 1
      continue
    }

    const indexStatus = line[0] ?? ' '
    const workTreeStatus = line[1] ?? ' '

    if (indexStatus !== ' ' && indexStatus !== '?') {
      staged += 1
    }
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
      unstaged += 1
    }
  }

  return {
    detached,
    branch,
    ahead,
    behind,
    uniquePaths: pathSet.size,
    staged,
    unstaged,
    untracked,
  }
}

async function readHeadShortSha(repoCwd: string): Promise<string | null> {
  const result = await runGit(['-C', repoCwd, 'rev-parse', '--short', 'HEAD'], GIT_REV_PARSE_TIMEOUT_MS)
  if (result.timedOut || result.exitCode !== 0) return null
  const sha = result.stdout.trim()
  return sha.length > 0 ? sha : null
}

async function summarizeDiffAgainstHead(repoCwd: string): Promise<{ insertions: number; deletions: number }> {
  const headCheck = await runGit(['-C', repoCwd, 'rev-parse', '--verify', 'HEAD'], GIT_REV_PARSE_TIMEOUT_MS)
  if (headCheck.timedOut || headCheck.exitCode !== 0) {
    return { insertions: 0, deletions: 0 }
  }

  const result = await runGit(['-C', repoCwd, 'diff', 'HEAD', '--numstat'], GIT_STATUS_TIMEOUT_MS)
  if (result.timedOut || result.exitCode !== 0) {
    return { insertions: 0, deletions: 0 }
  }

  let insertions = 0
  let deletions = 0
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('\t')
    if (parts.length < 3) continue
    const addStr = parts[0]?.trim() ?? ''
    const delStr = parts[1]?.trim() ?? ''
    if (/^\d+$/u.test(addStr)) {
      insertions += Number.parseInt(addStr, 10)
    }
    if (/^\d+$/u.test(delStr)) {
      deletions += Number.parseInt(delStr, 10)
    }
  }

  return { insertions, deletions }
}

async function computeGitStatus(resolvedCwd: string): Promise<GitStatusResponse> {
  const lastUpdatedAt = nowMs()
  const statusResult = await runGit(
    ['-C', resolvedCwd, 'status', '--porcelain=v1', '--branch'],
    GIT_STATUS_TIMEOUT_MS,
  )

  if (statusResult.timedOut) {
    return {
      ok: false,
      cwd: resolvedCwd,
      code: 'timeout',
      message: 'git status timed out',
      lastUpdatedAt,
    }
  }

  if (statusResult.exitCode !== 0) {
    const errText = `${statusResult.stderr}\n${statusResult.stdout}`.toLowerCase()
    if (errText.includes('not a git repository')) {
      return {
        ok: true,
        cwd: resolvedCwd,
        isRepo: false,
        reason: 'not_git_repo',
        lastUpdatedAt,
      }
    }
    return {
      ok: false,
      cwd: resolvedCwd,
      code: 'spawn_failed',
      message: statusResult.stderr.trim() || `git status exited with code ${String(statusResult.exitCode)}`,
      lastUpdatedAt,
    }
  }

  let parsed: ReturnType<typeof parseGitStatusPorcelain>
  try {
    parsed = parseGitStatusPorcelain(statusResult.stdout)
  } catch {
    return {
      ok: false,
      cwd: resolvedCwd,
      code: 'parse_failed',
      message: 'Failed to parse git status output',
      lastUpdatedAt,
    }
  }

  let headShortSha: string | null = null
  if (parsed.detached) {
    headShortSha = await readHeadShortSha(resolvedCwd)
  }

  const lineStats = await summarizeDiffAgainstHead(resolvedCwd)

  const dirty =
    parsed.uniquePaths > 0 || lineStats.insertions > 0 || lineStats.deletions > 0

  return {
    ok: true,
    cwd: resolvedCwd,
    isRepo: true,
    branch: parsed.branch,
    headShortSha,
    detached: parsed.detached,
    dirty,
    uniquePaths: parsed.uniquePaths,
    lineInsertions: lineStats.insertions,
    lineDeletions: lineStats.deletions,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    ahead: parsed.ahead,
    behind: parsed.behind,
    lastUpdatedAt,
  }
}

export async function getGitStatusForCwd(cwd: string, options?: GitStatusOptions): Promise<GitStatusResponse> {
  const lastUpdatedAt = nowMs()
  const resolved = await resolveSafeCwd(cwd, options)
  if ('error' in resolved) {
    return {
      ok: true,
      cwd: cwd.trim(),
      isRepo: false,
      reason: resolved.error,
      lastUpdatedAt,
    }
  }

  const key = resolved.resolved
  const cached = cacheByCwd.get(key)
  if (cached && cached.expiresAt > nowMs()) {
    return await cached.value
  }

  const existingFlight = inFlightByCwd.get(key)
  if (existingFlight) {
    return existingFlight
  }

  const promise = computeGitStatus(key)
    .then((result) => {
      cacheByCwd.set(key, { expiresAt: nowMs() + CACHE_TTL_MS, value: Promise.resolve(result) })
      return result
    })
    .finally(() => {
      inFlightByCwd.delete(key)
    })

  inFlightByCwd.set(key, promise)
  return promise
}
