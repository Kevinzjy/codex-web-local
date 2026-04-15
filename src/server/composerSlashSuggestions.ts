import type { ServerResponse } from 'node:http'
import { getSlashBuiltinRowsForComposerMenu } from './slashBuiltinCatalog.js'

export type ComposerSlashSuggestion = {
  id: string
  label: string
  insertText: string
  description?: string
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeFilter(q: string): string {
  return q.trim().toLowerCase().replace(/^\/+/u, '')
}

function matchesSlashFilter(label: string, filter: string): boolean {
  if (!filter) return true
  const lower = label.toLowerCase()
  const tail = label.startsWith('/') ? label.slice(1) : label
  return lower.includes(filter) || tail.toLowerCase().startsWith(filter)
}

type SkillRow = { name: string; description: string; path: string }

async function listSkillsForCwdRpc(
  cwd: string,
  rpc: (method: string, params: unknown) => Promise<unknown>,
): Promise<SkillRow[]> {
  const params: Record<string, unknown> = {}
  const trimmed = cwd.trim()
  if (trimmed) {
    params.cwds = [trimmed]
  }
  const payload = await rpc('skills/list', params)
  const record = asRecord(payload)
  const data = record && Array.isArray(record.data) ? record.data : []
  const byName = new Map<string, SkillRow>()
  for (const row of data) {
    const r = asRecord(row)
    const skills = r && Array.isArray(r.skills) ? r.skills : []
    for (const s of skills) {
      const sk = asRecord(s)
      const name = typeof sk?.name === 'string' ? sk.name.trim() : ''
      if (!name || byName.has(name)) continue
      const shortDesc = typeof sk?.shortDescription === 'string' ? sk.shortDescription.trim() : ''
      const longDesc = typeof sk?.description === 'string' ? sk.description.trim() : ''
      byName.set(name, {
        name,
        description: shortDesc || longDesc || 'Skill',
        path: typeof sk?.path === 'string' ? sk.path : '',
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * GET /codex-api/composer/slash-suggestions?cwd=&q=
 * Merges built-in slash commands with `skills/list` for the optional cwd.
 */
export async function handleComposerSlashSuggestionsGet(
  cwdRaw: string | null,
  queryRaw: string | null,
  rpc: (method: string, params: unknown) => Promise<unknown>,
  res: ServerResponse,
): Promise<void> {
  const filter = normalizeFilter(queryRaw ?? '')
  const out: ComposerSlashSuggestion[] = []
  const seenNames = new Set<string>()

  for (const row of getSlashBuiltinRowsForComposerMenu(process.platform)) {
    const label = `/${row.name}`
    if (!matchesSlashFilter(label, filter) && !matchesSlashFilter(row.name, filter)) {
      continue
    }
    out.push({
      id: `builtin:${row.name}`,
      label,
      insertText: `${label} `,
      description: row.description,
    })
    seenNames.add(row.name)
  }

  const cwd = cwdRaw?.trim() ?? ''
  try {
    const skills = await listSkillsForCwdRpc(cwd, rpc)
    for (const s of skills) {
      if (seenNames.has(s.name)) continue
      const label = `/${s.name}`
      if (!matchesSlashFilter(label, filter) && !matchesSlashFilter(s.name, filter)) {
        continue
      }
      out.push({
        id: `skill:${s.name}`,
        label,
        insertText: `${label} `,
        description: s.description,
      })
      seenNames.add(s.name)
    }
  } catch {
    // Built-ins still succeed when skills/list is unavailable.
  }

  setJson(res, 200, { entries: out.slice(0, 128) })
}
