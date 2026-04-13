# AGENTS.md

## Project Overview

`codex-web-local` is a Vue/Vite web UI for Codex that talks to `codex app-server` through a local server bridge. It is intended to support remote browser access, including access through `0.0.0.0`, LAN hostnames, and Tailscale DNS names.

## Common Commands

- Local development: `make test`
- Local development with overrides: `make test PORT=3001 HOST=0.0.0.0`
- Install global package: `make install`
- systemd user unit + `~/.config/codex-web-local/service.env` template (Linux, after install): `make systemd`
- Uninstall global package + systemd unit: `make uninstall`
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

## Recently shipped (do not duplicate in backlog below)

These are already in the tree; the follow-up plan only lists **remaining** work.

- **App icon:** `favicon.svg` at the repo root, linked from `index.html` (`/favicon.svg`); included in Vite build output.
- **Git status in the header:** `GitStatusIndicator` + `GET /codex-api/git/status` (`src/server/gitStatus.ts`) — branch name, dirty/clean, detached HEAD, not-a-repo, and errors without blocking the UI.
- **Account quota / rate limits:** `SidebarRateLimitMeters` + `account/rateLimits/read` RPC, with live updates from `account/rateLimits/updated` notifications.
- **Per-thread context usage:** Composer shows context usage percent from `thread/tokenUsage/updated` (when available).
- **Persisted chat UI state:** `src/server/chatStateStore.ts` → `~/.config/codex-web-local/chat-state.json`; `GET`/`PATCH /codex-api/chat-state` for pins, collapsed projects, project order, display names, manual unread (with cache-busting so reload does not wipe state).
- **Sidebar layout / scrolling:** Pin section and **Threads** label stay fixed; only the project/thread list scrolls; shared `.codex-subtle-scroll` styling (conversation list uses the same pattern).
- **Composer attachments (images):** `+` button and paste attach images (PNG/JPEG/WebP/GIF) with size/count limits; not the same as attaching arbitrary non-image files or a server-side upload pipeline.
- **Voice input (phase 1):** Composer microphone uses the browser **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) for dictation into the draft. No server-side audio; optional LLM “polish” is a separate future step.

## Follow-Up Development Plan

Items are grouped by **priority** (rough order to tackle). Higher tiers deliver core workflow or unblock other work; lower tiers are larger or higher-risk efforts.

### Priority overview

| Tier | Focus |
|------|--------|
| **P1 — Next up** | New-chat project picker + read-only `fs` API (foundation for remote “choose folder”). |
| **P2 — Soon** | Extend composer beyond **image-only** attachments (if desired); small git/quota UX polish only where gaps appear. |
| **P3 — Later** | Message queueing; voice input. |
| **P4 — Deferred / high complexity** | Optional HTTPS + system notifications; remote terminal. |

---

### P1 — Server-side directory picker (next major feature)

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

**Rationale:** Matches the product goal (remote browser + correct host paths). Other features do not depend on it except indirectly (better onboarding).

---

### P2 — Composer and observability (remaining)

- **Composer — beyond images (optional product decision):** Today the composer supports **images** only (`ThreadComposer.vue`: file picker + paste). If needed, extend to non-image files (Codex attachments vs temp server path vs paste-as-text), without breaking existing image behavior.
- **Git / quota — polish only:** Core git header and sidebar quota meters are shipped (see **Recently shipped**). File follow-ups only if a concrete gap appears (e.g. richer diff stats, copy branch name).

**Rationale:** P2 is now mostly incremental; main greenfield item is optional non-image attachment behavior.

---

### P3 — Larger UX features

- Add message queueing and priority insertion.
  - Allow composing messages while a turn is in progress instead of forcing the user to wait.
  - Queue normal messages behind the current turn.
  - Provide an explicit "send next" or "interrupt and send" path for priority insertion.
  - Make queue state visible in the composer and keep cancellation/removal straightforward.
- Voice input — **phase 2 (LLM polish)** only:
  - Phase 2 prompt-polish (LLM rewrite) is **disabled by default**.
  - Enable phase 2 only when **both** a polish API URL and API key are configured; if either is missing, keep transcript as-is with no automatic rewrite.
  - Keep a text fallback and avoid sending audio to third-party services without an explicit user-visible opt-in.
  - Clarify whether voice should append to the current draft, replace the draft, or insert at the cursor.

**Rationale:** Queueing and voice are valuable but need careful UX.

---

### P4 — Deferred: HTTPS and system notifications (approval alerts)

**Goal:** Enable **Web Notifications** for pending approvals when the tab is in the background. Browsers require a **secure context** (`https://` or `http://localhost` / `127.0.0.1`); plain `http://` to a LAN or Tailscale IP is often **not** sufficient.

**Planned steps (implement after P1/P2 unless reprioritized):**

1. **TLS for the app server (Express + Vite dev)**
   - Configurable PEM paths (env or CLI), e.g. `CODEX_WEB_TLS_CERT` / `CODEX_WEB_TLS_KEY`.
   - Optional: auto-generated self-signed certs under `~/.config/codex-web-local/tls/` with SAN for chosen hosts/IPs; document **mkcert** for a trusted local CA (better UX than perpetual cert warnings).
   - Document Tailscale / LAN access: cert SAN must match how users open the URL.

2. **Notifications**
   - User preference + `Notification.requestPermission()` (clear opt-in).
   - When `pendingApprovalRequests` grows and the document is hidden or unfocused, fire a deduplicated `Notification` (e.g. `tag`); click focuses the window; approval still happens in-app.

**Rationale:** Cross-cuts CLI, server, docs, and browser policy; lower priority than the directory picker and composer improvements unless remote approval pain dominates.

---

### P4 — Remote terminal (high risk, separate track)

- Add a remote terminal window.
  - Treat this as a high-risk feature because it executes commands on the host running `codex-web-local`.
  - Reuse existing password auth and consider an explicit enable flag before exposing terminal access.
  - Prefer a PTY-backed implementation with clear session lifecycle, resize support, and command output streaming.

**Rationale:** Security and maintenance cost; keep isolated from P1–P3 unless explicitly prioritized.
