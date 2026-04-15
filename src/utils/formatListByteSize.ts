/**
 * Compact size label for list columns (similar to ls -lh, base 1024).
 */
export function formatListByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  const units = ['B', 'K', 'M', 'G', 'T', 'P', 'E'] as const
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  if (i === 0) {
    return `${Math.round(n)}${units[i]}`
  }
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/u, '')
  return `${text}${units[i]}`
}
