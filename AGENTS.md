# AGENTS.md

## Project Overview

`codex-web-local` is a Vue/Vite web UI for Codex that talks to `codex app-server` through a local server bridge. It is intended to support remote browser access, including access through `0.0.0.0`, LAN hostnames, and Tailscale DNS names.

**Upstream / repo:** Active development is on [github.com/Kevinzjy/codex-web-local](https://github.com/Kevinzjy/codex-web-local). Install from a **git checkout** with `make install` (see README); this fork is not oriented around publishing to the npm registry.

## Common Commands

- Local development: `make test`
- Local development with overrides: `make test PORT=3001 HOST=0.0.0.0`
- Install global CLI from the working tree: `make install` (runs `npm run build` and `npm install -g .`)
- Linux — user systemd unit + first-run `service.env` template: `make systemd` (after `make install`). Set `SYSTEMD_USER_ENABLE=0` to install the unit file without `enable --now`.
- Linux — remove user unit, reload systemd, then global CLI: `make uninstall`
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

### CLI environment (headless / systemd)

- **`CODEX_WEB_LOCAL_PASSWORD`** — If neither `--password` nor `--no-password` is set, a non-empty value is used as the web UI password. Startup logs show `(from CODEX_WEB_LOCAL_PASSWORD)` instead of the secret. **`--password` on the CLI wins** over the variable.
- Under **systemd**, the user unit loads **`~/.config/codex-web-local/service.env`** (`EnvironmentFile` in `systemd/codex-web-local.service.in`). **`make systemd`** creates that file on first run by copying `systemd/service.env.example` (commented template for password + `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`); an existing `service.env` is never overwritten. After editing, `systemctl --user restart codex-web-local.service`.
- **`make uninstall`** removes the systemd unit and runs `npm uninstall -g`; it does **not** delete `service.env` (may contain secrets / local tuning).

### systemd assets in the repo

- `systemd/codex-web-local.service.in` — `ExecStart` placeholder `@@CODEX_WEB_LOCAL_BIN@@` replaced by `make systemd`.
- `systemd/service.env.example` — shipped as the template for `service.env`; listed in `package.json` `files` for pack layout consistency.

## Code Map

- `src/App.vue`: top-level layout wiring, route sync, New chat page, sidebar events, composer events.
- `src/composables/useDesktopState.ts`: application state, thread/project lists, message loading, read/unread state, local persistence, Codex RPC actions.
- `src/api/codexGateway.ts`: frontend RPC calls into the local `/codex-api` bridge.
- `src/api/normalizers/v2.ts`: conversion from Codex app-server payloads to UI models.
- `src/components/content/ThreadConversation.vue`: message rendering, file reference rendering, scroll state persistence/restoration, server request cards.
- `src/components/content/ThreadComposer.vue`: message input, image paste attachments, browser voice dictation (Web Speech API) when supported, IME-safe Enter behavior, multiline composer behavior.
- `src/composables/useWebSpeechRecognition.ts`: Web Speech recognition lifecycle for the composer mic.
- `src/utils/platform.ts`: lightweight platform helpers (e.g. iOS detection for voice copy).
- `src/components/content/ComposerDropdown.vue`: shared dropdown used by Model/Thinking and New chat project selection.
- `src/components/sidebar/SidebarThreadTree.vue`: project/thread tree, project context menu, thread context menu, pin/unread/archive/rename actions.
- `src/components/content/DirectoryPickerOverlay.vue`: modal directory picker for New chat project folder (host-side paths).
- `src/server/fsDirectories.ts`: `GET /codex-api/fs/directories`, `POST /codex-api/fs/mkdir` (allowed roots + logical paths).
- `src/api/fsDirectoriesClient.ts`: frontend client for fs endpoints.
- `src/utils/codexSessionCache.ts`: `localStorage` cache for last-known quota + model list (faster cold load).
- `src/server/codexAppServerBridge.ts`: Node middleware that starts and proxies `codex app-server`.
- `src/server/httpServer.ts`: production Express server, auth, static frontend, and bridge middleware.
- `src/cli/index.ts`: `codex-web-local` CLI entrypoint (default port **3000**, `CODEX_WEB_LOCAL_PASSWORD`, proxy flags).
- `systemd/`: user unit template and `service.env.example` for Linux installs via `make systemd`.
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

- New chat project selection uses `ComposerDropdown` with search; **Add new project** opens a **server-side directory picker** (host paths). Optional **New folder** creates a directory under the current picker path (`POST /codex-api/fs/mkdir`). Manual path entry remains as a fallback.
- The chosen folder is a cwd string used when the first message creates a new Codex thread.
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
- **Mobile / notched layouts:** Viewport meta (`viewport-fit`, `interactive-widget`), `dvh` + safe-area padding on the desktop shell and content (`index.html`, `DesktopLayout.vue`, `App.vue`, `style.css`).
- **Linux systemd (user):** `make systemd` installs `~/.config/systemd/user/codex-web-local.service`, seeds `~/.config/codex-web-local/service.env` once from the commented template, and enables the service. CLI reads **`CODEX_WEB_LOCAL_PASSWORD`** and proxy env from `service.env` when run under systemd.
- **Remote project folder (fs API):** `GET /codex-api/fs/directories` lists child directories under `CODEX_WEB_PROJECT_ROOTS` (comma-separated) or defaults to `$HOME` + `process.cwd()`; navigation uses **logical paths** so symlinked home/project dirs behave predictably. **`POST /codex-api/fs/mkdir`** creates a single subfolder under an allowed parent (same security rules).
- **Cold-load resilience:** `localStorage` session cache for sidebar quota + model/thinking defaults; `initialize` RPC is single-flight in the bridge to avoid duplicate `initialize` on parallel first requests; frontend retries transient **502/503** on `/codex-api/rpc`. Reduces “quota unavailable / empty model list” and occasional 502 on first paint when `codex app-server` is still starting.
- **Install packaging:** `make install` uses `npm pack` + tarball (no fragile symlink to the repo tree).

## Follow-Up Development Plan

Items are grouped by **priority** (rough order to tackle). Higher tiers deliver core workflow or unblock other work; lower tiers are larger or higher-risk efforts.

### Priority overview

| Tier | Focus |
|------|--------|
| **P1 — Next up** | Composer beyond **image-only** attachments (optional); **composer `/` `@` `!` triggers** (CLI parity); git/quota UX polish only where gaps appear. |
| **P2 — Soon** | **Git worktree** from current thread; incremental directory-picker / fs polish if needed (e.g. UX edge cases, docs). |
| **P3 — Later** | Message queueing; voice phase 2 (LLM polish) only. |
| **P4 — Deferred / high complexity** | Optional HTTPS + system notifications; remote terminal. |

---

### P1 — Composer and observability (next focus)

- **Composer — beyond images (optional product decision):** Today the composer supports **images** only (`ThreadComposer.vue`: file picker + paste). If needed, extend to non-image files (Codex attachments vs temp server path vs paste-as-text), without breaking existing image behavior.
- **Composer — CLI-style triggers (not yet in web UI):** The Codex CLI supports **`/`** for built-in commands, **`@`** for file references, and **`!`** for invoking system shell commands. The web composer currently does not surface these. Follow-up: investigate app-server RPC / payload support, then implement input handling (detection, completion UI, safe `!` execution policy) in `ThreadComposer.vue` aligned with CLI behavior.
- **Git / quota — polish only:** Core git header and sidebar quota meters are shipped (see **Recently shipped**). Follow-ups only if a concrete gap appears (e.g. richer diff stats, copy branch name).

**Rationale:** Directory picker + fs API are shipped; remaining high-value product work here is optional non-image attachments, composer parity with CLI affordances, and small polish.

---

### P2 — Git worktree + directory picker / fs (incremental)

- **New worktree from current thread:** Support creating a **Git worktree** (e.g. `git worktree add`) rooted from the active thread’s `cwd` so the user can do isolated development without leaving the conversation. Open design questions: whether this spawns a **new Codex thread**, updates **cwd** for the current thread only for follow-up turns, or only exposes a **host path** for manual use; must align with Codex app-server thread/cwd semantics and safety (password-protected remote UI).
- Only if users report gaps on the directory picker: e.g. clearer errors, keyboard shortcuts, remember last browsed path across sessions, or documentation tweaks for `CODEX_WEB_PROJECT_ROOTS`.
- Avoid expanding server fs scope (file reads, writes beyond `mkdir`) unless product explicitly requires it.

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

**Planned steps (implement after composer/fs polish unless reprioritized):**

1. **TLS for the app server (Express + Vite dev)**
   - Configurable PEM paths (env or CLI), e.g. `CODEX_WEB_TLS_CERT` / `CODEX_WEB_TLS_KEY`.
   - Optional: auto-generated self-signed certs under `~/.config/codex-web-local/tls/` with SAN for chosen hosts/IPs; document **mkcert** for a trusted local CA (better UX than perpetual cert warnings).
   - Document Tailscale / LAN access: cert SAN must match how users open the URL.

2. **Notifications**
   - User preference + `Notification.requestPermission()` (clear opt-in).
   - When `pendingApprovalRequests` grows and the document is hidden or unfocused, fire a deduplicated `Notification` (e.g. `tag`); click focuses the window; approval still happens in-app.

**Rationale:** Cross-cuts CLI, server, docs, and browser policy; lower priority than composer attachment work and core UX unless remote approval pain dominates.

---

### P4 — Remote terminal (high risk, separate track)

- Add a remote terminal window.
  - Treat this as a high-risk feature because it executes commands on the host running `codex-web-local`.
  - Reuse existing password auth and consider an explicit enable flag before exposing terminal access.
  - Prefer a PTY-backed implementation with clear session lifecycle, resize support, and command output streaming.

**Rationale:** Security and maintenance cost; keep isolated from P1–P3 unless explicitly prioritized.
