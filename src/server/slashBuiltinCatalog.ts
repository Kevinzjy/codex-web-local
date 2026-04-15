/**
 * Built-in `/` commands for composer completion, aligned with Codex TUI:
 * - Enum order and command names: `codex/codex-rs/tui/src/slash_command.rs` (`SlashCommand`, `#[strum(serialize_all = "kebab-case")]` + per-variant overrides)
 * - Descriptions: `SlashCommand::description()` in the same file
 * - Visibility: `SlashCommand::is_visible()` (platform / debug-only); feature-gating in
 *   `codex/codex-rs/tui/src/bottom_pane/slash_commands.rs` (`BuiltinCommandFlags`) is not applied here
 *   because those flags come from live CLI config — the web UI shows the full non-hidden set.
 *
 * When updating Codex, refresh this table from the Rust sources above.
 *
 * **Composer `/` menu policy:** Only built-ins that have **functional parity** with the Codex CLI
 * appear in the web composer completion menu (`getSlashBuiltinRowsForComposerMenu`). The full
 * list below remains the **tracking backlog**; see `AGENTS.md` (slash commands / CLI parity).
 */
export type SlashBuiltinRow = {
  name: string
  description: string
}

/**
 * Built-in command names allowed in the `/` **completion menu** once behavior matches CLI.
 * Keep in sync with `useDesktopState` / composer handlers (e.g. bare `/status`).
 */
export const SLASH_BUILTIN_NAMES_IN_COMPOSER_MENU = new Set<string>(['status'])

/**
 * Full catalog in **`SlashCommand` declaration order** (matches popup order in TUI when no gating).
 * Entries filtered at runtime — see `getSlashBuiltinRowsForHost`.
 */
const CODEX_SLASH_BUILTIN_ALL: SlashBuiltinRow[] = [
  { name: 'model', description: 'choose what model and reasoning effort to use' },
  { name: 'fast', description: 'toggle Fast mode to enable fastest inference at 2X plan usage' },
  { name: 'approvals', description: 'choose what Codex is allowed to do' },
  { name: 'permissions', description: 'choose what Codex is allowed to do' },
  { name: 'setup-default-sandbox', description: 'set up elevated agent sandbox' },
  {
    name: 'sandbox-add-read-dir',
    description: 'let sandbox read a directory: /sandbox-add-read-dir <absolute_path>',
  },
  { name: 'experimental', description: 'toggle experimental features' },
  { name: 'skills', description: 'use skills to improve how Codex performs specific tasks' },
  { name: 'review', description: 'review my current changes and find issues' },
  { name: 'rename', description: 'rename the current thread' },
  { name: 'new', description: 'start a new chat during a conversation' },
  { name: 'resume', description: 'resume a saved chat' },
  { name: 'fork', description: 'fork the current chat' },
  { name: 'init', description: 'create an AGENTS.md file with instructions for Codex' },
  { name: 'compact', description: 'summarize conversation to prevent hitting the context limit' },
  { name: 'plan', description: 'switch to Plan mode' },
  { name: 'collab', description: 'change collaboration mode (experimental)' },
  { name: 'agent', description: 'switch the active agent thread' },
  { name: 'copy', description: 'copy last response as markdown' },
  { name: 'diff', description: 'show git diff (including untracked files)' },
  { name: 'mention', description: 'mention a file' },
  { name: 'status', description: 'show current session configuration and token usage' },
  { name: 'debug-config', description: 'show config layers and requirement sources for debugging' },
  { name: 'title', description: 'configure which items appear in the terminal title' },
  { name: 'statusline', description: 'configure which items appear in the status line' },
  { name: 'theme', description: 'choose a syntax highlighting theme' },
  { name: 'mcp', description: 'list configured MCP tools' },
  { name: 'apps', description: 'manage apps' },
  { name: 'plugins', description: 'browse plugins' },
  { name: 'logout', description: 'log out of Codex' },
  { name: 'quit', description: 'exit Codex' },
  { name: 'exit', description: 'exit Codex' },
  { name: 'feedback', description: 'send logs to maintainers' },
  { name: 'rollout', description: 'print the rollout file path' },
  { name: 'ps', description: 'list background terminals' },
  { name: 'stop', description: 'stop all background terminals' },
  /** Parses as `SlashCommand::Stop` in Codex (`from_str("clean")`). */
  { name: 'clean', description: 'stop all background terminals' },
  { name: 'clear', description: 'clear the terminal and start a new chat' },
  { name: 'personality', description: 'choose a communication style for Codex' },
  { name: 'realtime', description: 'toggle realtime voice mode (experimental)' },
  { name: 'settings', description: 'configure realtime microphone/speaker' },
  { name: 'test-approval', description: 'test approval request' },
  { name: 'subagents', description: 'switch the active agent thread' },
  { name: 'debug-m-drop', description: 'DO NOT USE' },
  { name: 'debug-m-update', description: 'DO NOT USE' },
]

function isBuiltinHiddenForHost(row: SlashBuiltinRow, platform: NodeJS.Platform): boolean {
  // `SlashCommand::is_visible` in slash_command.rs
  if (row.name === 'sandbox-add-read-dir' && platform !== 'win32') {
    return true
  }
  // TUI hides Copy on Android; browser clients are not the TUI, but keep parity if we ever reuse this for UA-based filtering.
  if (row.name === 'copy' && platform === 'android') {
    return true
  }
  if (row.name === 'rollout' || row.name === 'test-approval') {
    // Only in `cfg(debug_assertions)` builds in Codex — omit in the web catalog.
    return true
  }
  if (row.name === 'debug-m-drop' || row.name === 'debug-m-update') {
    return true
  }
  return false
}

/**
 * Built-in rows to show for the Node host running `codex-web-local` (mirrors TUI `is_visible`, minus debug-only pairs).
 */
export function getSlashBuiltinRowsForHost(platform: NodeJS.Platform = process.platform): SlashBuiltinRow[] {
  return CODEX_SLASH_BUILTIN_ALL.filter((row) => !isBuiltinHiddenForHost(row, platform))
}

/**
 * Built-ins offered in the composer `/` popup: **parity subset only** (plus `skills/list` entries
 * merged separately in `composerSlashSuggestions.ts`).
 */
export function getSlashBuiltinRowsForComposerMenu(platform: NodeJS.Platform = process.platform): SlashBuiltinRow[] {
  return getSlashBuiltinRowsForHost(platform).filter((row) => SLASH_BUILTIN_NAMES_IN_COMPOSER_MENU.has(row.name))
}
