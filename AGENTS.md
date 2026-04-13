# AGENTS.md

## Project Overview

`codex-web-local` is a Vue/Vite web UI for Codex that talks to `codex app-server` through a local server bridge. It is intended to support remote browser access, including access through `0.0.0.0`, LAN hostnames, and Tailscale DNS names.

## Common Commands

- Local development: `make test`
- Local development with overrides: `make test PORT=3001 HOST=0.0.0.0`
- Install global package: `make install`
- Uninstall global package: `make uninstall`
- Build check: `npm run build`
- Whitespace check before commit: `git diff --check`

The Makefile applies the default proxy environment for local development:

- `http_proxy=http://127.0.0.1:1087`
- `https_proxy=http://127.0.0.1:1087`
- `all_proxy=socks5://127.0.0.1:1080`

The installed CLI also accepts proxy flags that are passed to `codex app-server`:

- `--http-proxy`
- `--https-proxy`
- `--all-proxy`

## Code Map

- `src/App.vue`: top-level layout wiring, route sync, New chat page, sidebar events, composer events.
- `src/composables/useDesktopState.ts`: application state, thread/project lists, message loading, read/unread state, local persistence, Codex RPC actions.
- `src/api/codexGateway.ts`: frontend RPC calls into the local `/codex-api` bridge.
- `src/api/normalizers/v2.ts`: conversion from Codex app-server payloads to UI models.
- `src/components/content/ThreadConversation.vue`: message rendering, file reference rendering, scroll state persistence/restoration, server request cards.
- `src/components/content/ThreadComposer.vue`: message input, image paste attachments, IME-safe Enter behavior, multiline composer behavior.
- `src/components/content/ComposerDropdown.vue`: shared dropdown used by Model/Thinking and New chat project selection.
- `src/components/sidebar/SidebarThreadTree.vue`: project/thread tree, project context menu, thread context menu, pin/unread/archive/rename actions.
- `src/server/codexAppServerBridge.ts`: Node middleware that starts and proxies `codex app-server`.
- `src/server/httpServer.ts`: production Express server, auth, static frontend, and bridge middleware.
- `src/cli/index.ts`: `codex-web-local` CLI entrypoint.
- `vite.config.ts`: dev server configuration and Codex bridge middleware for Vite.

## Development Notes

### Git and commits

- **Do not create git commits without explicit user instruction.** Completing an implementation does not imply permission to commit. If the user asks to commit a specific change set first and then work on a follow-up (e.g. style or UX fixes), commit only what they asked for; leave subsequent work uncommitted until they confirm or ask to commit it.
- When in doubt, leave changes unstaged or uncommitted and summarize the diff instead.

- Keep edits scoped. There may be uncommitted user changes in the tree; do not revert unrelated changes.
- Use existing Vue composition patterns and local helper functions before introducing new abstractions.
- `npm run build` runs both frontend type checking/build and CLI bundling; use it before reporting a completed code change.
- Use `git diff --check` before commits.
- The UI is mostly English. Keep new user-facing UI strings in English unless the user explicitly asks otherwise.
- The project uses Tailwind through `@apply` in Vue scoped styles. Preserve the existing low-radius, simple desktop UI style.
- The dev server runs behind Vite. Remote host access is controlled through `server.allowedHosts` in `vite.config.ts`; avoid `allowedHosts: true` unless the user explicitly accepts the DNS rebinding risk.
- Production/global usage goes through the Express server in `src/server/httpServer.ts`, not Vite.

## Current UI Behavior Notes

- New chat project selection currently uses `ComposerDropdown` with search and an "Add new project" text field.
- The added project is a cwd string used when the first message creates a new Codex thread.
- Message file references support backtick paths and Markdown links such as `[App.vue](/abs/path/App.vue)`.
- File links are displayed as paths relative to the active thread cwd when possible, matching the Codex CLI style more closely than basename-only rendering.
- The composer uses a textarea. `Enter` submits, `Shift+Enter` inserts a newline, and IME composition Enter is not submitted.

## Follow-Up Development Plan

- Replace the manual New chat "Add new project" text entry with a remote server-side directory picker.
- The directory picker should browse directories on the machine running `codex-web-local`, not the browser client machine.
- Implement a shared read-only filesystem middleware that can be mounted in both:
  - Vite dev server via `vite.config.ts`
  - Express production server via `src/server/httpServer.ts`
- Suggested API shape:
  - `GET /codex-api/fs/directories?path=<absolute-path>`
  - Return current path, parent path, and child directories.
  - Return clear errors for missing paths, non-directories, and permission-denied directories.
- Security constraints:
  - List directories only; do not expose file contents.
  - Reuse existing auth in production.
  - Prefer an allowlist such as `CODEX_WEB_PROJECT_ROOTS=/data/zhangjy/workspace,/home/zhangjy`.
  - If no allowlist is set, consider a conservative default such as `$HOME` and `process.cwd()`.
- Frontend picker behavior:
  - Add a modal or popover from "Add new project".
  - Show root choices, current path, parent navigation, and child directories.
  - Include search/filter within the current directory.
  - Include a manual path field for paste/edit fallback.
  - "Choose this folder" should set `newThreadCwd` and add the selected cwd to the New chat project options for the current session.
- Add an upload file button to the composer.
  - Decide whether uploaded files should become Codex attachments, be written to a temporary server-side upload directory, or be pasted into the prompt as text/image content.
  - Keep image paste behavior in `ThreadComposer.vue` working while adding file upload UI.
- Add voice input to the composer.
  - Start with browser speech recognition only if the target browsers support it well enough.
  - Keep a text fallback and avoid sending audio to third-party services without an explicit user-visible opt-in.
  - Clarify whether voice should append to the current draft, replace the draft, or insert at the cursor.
- Add message queueing and priority insertion.
  - Allow composing messages while a turn is in progress instead of forcing the user to wait.
  - Queue normal messages behind the current turn.
  - Provide an explicit "send next" or "interrupt and send" path for priority insertion.
  - Make queue state visible in the composer and keep cancellation/removal straightforward.
- Add a remote terminal window.
  - Treat this as a high-risk feature because it executes commands on the host running `codex-web-local`.
  - Reuse existing password auth and consider an explicit enable flag before exposing terminal access.
  - Prefer a PTY-backed implementation with clear session lifecycle, resize support, and command output streaming.
- Add git branch and git status indicators.
  - Show the branch/status for the active thread cwd when available.
  - Handle missing git repos, detached HEAD, and slow git commands without blocking the UI.
  - Consider reusing a server-side endpoint rather than running git in the browser.
- Add Codex quota/usage display.
  - First identify whether `codex app-server` exposes quota information over JSON-RPC.
  - If unavailable, document the limitation rather than scraping unstable CLI output.
- Update the favicon.
  - Replace the default app icon assets and verify both dev and built output use the new icon.
