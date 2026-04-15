/**
 * Browser-safe POSIX path helpers for @ mention insertion (matches Node path.posix behavior for common cases).
 */

function trimTrailingSlashes(p: string): string {
  if (p.length <= 1) {
    return p
  }
  return p.replace(/\/+$/gu, '')
}

/** Normalize an absolute POSIX path (slashes, `.`, `..`). */
export function posixNormalizeAbs(p: string): string {
  const s = p.replace(/\\/gu, '/')
  const isAbs = s.startsWith('/')
  const segments = s.split('/')
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') {
      continue
    }
    if (seg === '..') {
      if (stack.length) {
        stack.pop()
      } else if (!isAbs) {
        stack.push('..')
      }
    } else {
      stack.push(seg)
    }
  }
  if (isAbs) {
    return stack.length ? `/${stack.join('/')}` : '/'
  }
  return stack.join('/') || '.'
}

/** `path.posix.relative` for two absolute paths. */
export function posixRelative(fromAbs: string, toAbs: string): string {
  let a = posixNormalizeAbs(fromAbs)
  let b = posixNormalizeAbs(toAbs)
  if (a === b) {
    return ''
  }
  a = trimTrailingSlashes(a)
  b = trimTrailingSlashes(b)
  if (a === b) {
    return ''
  }

  const aParts = a === '/' ? [] : a.slice(1).split('/')
  const bParts = b === '/' ? [] : b.slice(1).split('/')

  let i = 0
  const min = Math.min(aParts.length, bParts.length)
  while (i < min && aParts[i] === bParts[i]) {
    i += 1
  }

  const up = aParts.length - i
  const out = [...Array(up).fill('..'), ...bParts.slice(i)]
  return out.join('/') || '.'
}
