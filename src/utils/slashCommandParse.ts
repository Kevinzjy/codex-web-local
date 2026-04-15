/**
 * Returns the slash command name (without leading `/`) when the entire draft is a single
 * bare command, e.g. `/status` or `/help`. Returns null if there is other text or images.
 */
export function tryParseBareSlashCommand(text: string): string | null {
  const t = text.trim()
  const m = /^\/([a-zA-Z0-9][a-zA-Z0-9-]*)\s*$/u.exec(t)
  return m ? m[1].toLowerCase() : null
}
