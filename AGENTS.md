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
- `src/components/content/ThreadComposer.vue`: message input, **image-only** attachments (picker + paste), **`/status`** client command, **`New worktree`** entry (opens `GitWorktreeModal`), browser voice dictation (Web Speech API) when supported, IME-safe Enter behavior, multiline composer behavior.
- `src/components/content/GitWorktreeModal.vue`: create a git worktree from the thread cwd (`POST /codex-api/git/worktree`); optional follow-up: open new chat with worktree path or fork current thread into the new cwd.
- `src/utils/slashStatusFormat.ts`: formatted text for CLI-style **`/status`** panel (aligned columns).
- `src/server/composerSlashSuggestions.ts`: `GET /codex-api/composer/slash-suggestions` — merges parity built-ins + `skills/list` for `/` completion.
- `src/composables/useWebSpeechRecognition.ts`: Web Speech recognition lifecycle for the composer mic.
- `src/utils/platform.ts`: lightweight platform helpers (e.g. iOS detection for voice copy).
- `src/components/content/ComposerDropdown.vue`: shared dropdown used by Model/Thinking and New chat project selection.
- `src/components/sidebar/SidebarThreadTree.vue`: project/thread tree, project context menu, thread context menu, pin/unread/archive/rename actions.
- `src/components/content/DirectoryPickerOverlay.vue`: modal directory picker for New chat project folder (host-side paths).
- `src/server/slashBuiltinCatalog.ts`: Codex `SlashCommand` mirror + **`SLASH_BUILTIN_NAMES_IN_COMPOSER_MENU`** (only parity built-ins appear in `/` completion); merged with `skills/list` in `composerSlashSuggestions.ts`.
- `src/server/fsDirectories.ts`: `GET /codex-api/fs/directories`, `GET /codex-api/fs/complete` (composer **`@`** paths), `POST /codex-api/fs/mkdir` (allowed roots + logical paths).
- `src/api/fsDirectoriesClient.ts`: frontend client for fs endpoints.
- `src/utils/codexSessionCache.ts`: `localStorage` cache for last-known quota + model list (faster cold load).
- `src/server/codexAppServerBridge.ts`: Node middleware that starts and proxies `codex app-server`; routes for `/codex-api/git/*`, `/codex-api/fs/*`, `/codex-api/composer/slash-suggestions`, etc.
- `src/server/gitStatus.ts`: `GET /codex-api/git/status`, `POST /codex-api/git/worktree` (`createGitWorktreeForCwd`).
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
- **Light and dark theme:** The shell sets `data-theme="light"` | `"dark"` on the layout (`DesktopLayout.vue` / `App.vue`). **Every new UI** (conversation panels, modals, composer controls, server-driven cards) must remain legible in **both** themes. Prefer Tailwind colors that work on both backgrounds, or add **`[data-theme='dark']` overrides in `src/style.css`** next to the same feature’s light styles (pattern: scoped Vue classes for structure + global dark rules — e.g. `.message-code-block` / `.message-slasht-status` in `ThreadConversation.vue` with matching dark rules in `style.css`). Do not ship light-only surfaces without a dark counterpart.
- The dev server runs behind Vite. Remote host access is controlled through `server.allowedHosts` in `vite.config.ts`; avoid `allowedHosts: true` unless the user explicitly accepts the DNS rebinding risk.
- Production/global usage goes through the Express server in `src/server/httpServer.ts`, not Vite.

## Current UI Behavior Notes

- New chat project selection uses `ComposerDropdown` with search; **Add new project** opens a **server-side directory picker** (host paths). Optional **New folder** creates a directory under the current picker path (`POST /codex-api/fs/mkdir`). Manual path entry remains as a fallback.
- The chosen folder is a cwd string used when the first message creates a new Codex thread.
- **Project row:** The **⋯** menu and **right-click** on the project header open the same menu (`SidebarThreadTree.vue`). Right-click positions the panel with its top-left near the cursor (opens down-right); the dots trigger uses an anchored panel (`project-menu-panel--anchor` with `-translate-x-full`). **Remove project dir** calls `removeProject` in `useDesktopState.ts`: `archiveThread` for every thread in that project, `loadThreads()`, then `removeProjectFromLocalState` (order, `sourceGroups`, display names, cwd map, pins/unread pruning, selection).
- Message file references support backtick paths and Markdown links such as `[App.vue](/abs/path/App.vue)`.
- File links are displayed as paths relative to the active thread cwd when possible, matching the Codex CLI style more closely than basename-only rendering.
- **Message body rendering (`ThreadConversation.vue`):** `parseMessageBlocks` splits triple-backtick fenced code regions from the rest of the text; fenced blocks render as `<pre><code>` (`.message-code-block`); other paragraphs still go through `parseInlineSegments`. Dark theme overrides for code blocks and **`/status` panels** (`.message-slasht-status`) live in `style.css`.
- The composer uses a textarea. `Enter` submits, `Shift+Enter` inserts a newline, and IME composition Enter is not submitted.
- **Git worktree (from thread cwd):** Composer **New worktree** opens `GitWorktreeModal`; server runs `git worktree add` via `POST /codex-api/git/worktree`. After success, optional follow-up: **none** (path only), **new chat** with the worktree as project cwd, or **fork current thread** into the new cwd (see `App.vue` `onWorktreeCreated`).

## Recently shipped (do not duplicate in backlog below)

These are already in the tree; the follow-up plan only lists **remaining** work.

- **App icon:** `favicon.svg` at the repo root, linked from `index.html` (`/favicon.svg`); included in Vite build output.
- **Git status in the header:** `GitStatusIndicator` + `GET /codex-api/git/status` (`src/server/gitStatus.ts`) — branch name, dirty/clean, detached HEAD, not-a-repo, and errors without blocking the UI.
- **Account quota / rate limits:** `SidebarRateLimitMeters` + `account/rateLimits/read` RPC, with live updates from `account/rateLimits/updated` notifications.
- **Per-thread context usage:** Composer shows context usage percent from `thread/tokenUsage/updated` (when available).
- **Persisted chat UI state:** `src/server/chatStateStore.ts` → `~/.config/codex-web-local/chat-state.json`; `GET`/`PATCH /codex-api/chat-state` for pins, collapsed projects, project order, display names, manual unread (with cache-busting so reload does not wipe state).
- **Sidebar layout / scrolling:** Pin section and **Threads** label stay fixed; only the project/thread list scrolls; shared `.codex-subtle-scroll` styling (conversation list uses the same pattern).
- **Composer attachments (images only — product decision):** `+` button and paste attach images (PNG/JPEG/WebP/GIF) with size/count limits. **Non-image files** are intentionally out of scope here; a future **remote terminal / file-browser** flow can own general upload/download (see P4).
- **Composer `/` and client `/status`:** `GET /codex-api/composer/slash-suggestions` merges Codex parity built-ins (`slashBuiltinCatalog.ts` → `SLASH_BUILTIN_NAMES_IN_COMPOSER_MENU`, currently **`status`**) with `skills/list`. Typing **`/status`** (bare command, no `turn/start`) inserts a local status card (`clientSlash.*` in `useDesktopState.ts`) using `account/read`, `account/rateLimits/read`, `config/read`.
- **Git worktree from current thread:** `GitWorktreeModal` + `POST /codex-api/git/worktree` (`gitStatus.ts`); see **Current UI Behavior Notes** for follow-up actions.
- **Voice input (phase 1):** Composer microphone uses the browser **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) for dictation into the draft. No server-side audio; optional LLM “polish” is a separate future step.
- **Mobile / notched layouts:** Viewport meta (`viewport-fit`, `interactive-widget`), `dvh` + safe-area padding on the desktop shell and content (`index.html`, `DesktopLayout.vue`, `App.vue`, `style.css`).
- **Linux systemd (user):** `make systemd` installs `~/.config/systemd/user/codex-web-local.service`, seeds `~/.config/codex-web-local/service.env` once from the commented template, and enables the service. CLI reads **`CODEX_WEB_LOCAL_PASSWORD`** and proxy env from `service.env` when run under systemd.
- **Remote project folder (fs API):** `GET /codex-api/fs/directories` lists child directories under `CODEX_WEB_PROJECT_ROOTS` (comma-separated) or defaults to `$HOME` + `process.cwd()`; navigation uses **logical paths** so symlinked home/project dirs behave predictably. **`POST /codex-api/fs/mkdir`** creates a single subfolder under an allowed parent (same security rules).
- **Cold-load resilience:** `localStorage` session cache for sidebar quota + model/thinking defaults; `initialize` RPC is single-flight in the bridge to avoid duplicate `initialize` on parallel first requests; frontend retries transient **502/503** on `/codex-api/rpc`. Reduces “quota unavailable / empty model list” and occasional 502 on first paint when `codex app-server` is still starting.
- **Install packaging:** `make install` uses `npm pack` + tarball (no fragile symlink to the repo tree).
- **Remove project dir:** Archives all threads in the project via Codex RPC, refreshes the thread list, then clears local sidebar state for that project (persistent removal, not a cosmetic hide).
- **Project menu UX:** Right-click on a project row opens the same menu as ⋯; cursor-anchored placement avoids the old `-translate-x-full` behavior that pulled the panel to the wrong side of the pointer.
- **Fenced code in chat:** Triple-backtick blocks in message text render as dedicated code blocks with horizontal scroll and light/dark styling.

## Follow-Up Development Plan

Items are grouped by **priority** (rough order to tackle). Higher tiers deliver core workflow or unblock other work; lower tiers are larger or higher-risk efforts.

### Priority overview

| Tier | Focus |
|------|--------|
| **P1 — Next up** | **Codex `/` command parity** (incremental; full inventory in `AGENTS.md`; **completion menu only for aligned built-ins**); **`@`** / **`!`** follow-ups (`@` completion shipped; **`!`** not). |
| **P2 — Soon** | Incremental polish only: **directory picker / fs** (already shipped — UX edge cases, docs, `CODEX_WEB_PROJECT_ROOTS` tuning if reported); **worktree** (already shipped — edge cases, docs). |
| **P3 — Later** | Message queueing; voice phase 2 (LLM polish) only. |
| **P4 — Deferred / high complexity** | Optional HTTPS + system notifications; **remote terminal**; **general file attach / file browser** (non-image uploads and downloads pair naturally with terminal). |

---

### P1 — Composer slash parity and `@` / `!`

- **Composer attachments:** **Images only** by design (`ThreadComposer.vue`). Do **not** treat non-image attachments as P1; defer to **P4** (terminal / file-browser–centric workflow).
- **Slash commands (`/`) — policy (Codex parity):**
  - **Source of truth** for *what exists in Codex* is the TUI enum `SlashCommand` in upstream [`codex/codex-rs/tui/src/slash_command.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/slash_command.rs) (dispatch: `chatwidget/slash_dispatch.rs`). The app-server does **not** expose a single “run any slash command” RPC; the CLI implements commands client-side and calls different RPCs or UI flows per command.
  - **Development backlog:** Treat **every** Codex built-in name (and behavior) as eventual work for this project, tracked in the inventory below and in `src/server/slashBuiltinCatalog.ts` (`CODEX_SLASH_BUILTIN_ALL`).
  - **Composer `/` menu:** Only show built-ins that are **functionally aligned** with the CLI (same user-visible outcome, using web-appropriate UI). Until then, the command stays **off** the completion menu but remains on the backlog. Implement by extending handlers (e.g. `useDesktopState` slash dispatch) and adding the name to `SLASH_BUILTIN_NAMES_IN_COMPOSER_MENU` in `slashBuiltinCatalog.ts`.
  - **Skills:** Entries from `skills/list` remain in the `/` menu as **`/skillName`** when present; sending them still follows Codex user-input rules (extend parity separately if needed).
  - **`@` / `!`:** `@` path completion is shipped; **`!`** shell execution is not — follow app-server safety and remote-UI constraints when prioritized.
- **Git / quota — what “polish” means:** Header git indicator and sidebar quota / rate-limit meters are **already shipped** (see **Recently shipped**). There is **no fixed backlog** here — only **optional** UX if a concrete gap appears, for example: **copy branch name** from the header; **richer git tooltip** (ahead/behind, short SHA); **click-through** to a host diff view (not in scope unless product asks); **quota**: copy remaining tokens, clearer error when RPC is cold. Skip unless users or maintainers identify a real pain point.

#### Codex built-in slash commands — backlog vs composer menu

| Command | In Codex TUI | Web handler / parity | In `/` menu |
|--------|----------------|-------------------------|------------|
| `model` | Yes | Backlog | No |
| `fast` | Yes | Backlog | No |
| `approvals` | Yes | Backlog | No |
| `permissions` | Yes | Backlog | No |
| `setup-default-sandbox` | Yes | Backlog (Windows TUI paths) | No |
| `sandbox-add-read-dir` | Yes (Windows) | Backlog | No |
| `experimental` | Yes | Backlog | No |
| `skills` | Yes | Backlog (menu lists skills separately via `skills/list`) | No |
| `review` | Yes | Backlog (`review/start` etc.) | No |
| `rename` | Yes | Backlog | No |
| `new` | Yes | Backlog | No |
| `resume` | Yes | Backlog | No |
| `fork` | Yes | Backlog (`thread/fork`) | No |
| `init` | Yes | Backlog | No |
| `compact` | Yes | Backlog (`thread/compact/start` or equivalent) | No |
| `plan` | Yes | Backlog | No |
| `collab` | Yes | Backlog | No |
| `agent` / `subagents` | Yes | Backlog | No |
| `copy` | Yes | Backlog | No |
| `diff` | Yes | Backlog | No |
| `mention` | Yes | Backlog (`@` already exists) | No |
| **`status`** | **Yes** | **Shipped:** local session status card + RPCs (`account/read`, `account/rateLimits/read`, `config/read`) | **Yes** |
| `debug-config` | Yes | Backlog | No |
| `title` | Yes | Backlog (TUI-only semantics) | No |
| `statusline` | Yes | Backlog | No |
| `theme` | Yes | Backlog | No |
| `mcp` | Yes | Backlog | No |
| `apps` | Yes | Backlog | No |
| `plugins` | Yes | Backlog | No |
| `logout` | Yes | Backlog | No |
| `quit` / `exit` | Yes | Backlog (web does not exit host) | No |
| `feedback` | Yes | Backlog | No |
| `ps` / `stop` / `clean` | Yes | Backlog | No |
| `clear` | Yes | Backlog | No |
| `personality` | Yes | Backlog | No |
| `realtime` / `settings` | Yes | Backlog | No |
| `debug-m-*` / `test-approval` / `rollout` | Debug / internal | Omit from product menu | No |

**Rationale:** Composer images-only policy is stable; main remaining P1 work is **incremental slash parity** with Codex CLI and **`@` / `!`** behavior, not attachment types.

---

### P2 — Directory picker, fs, and worktree (incremental polish)

These features are **already implemented** (see **Recently shipped** and **Current UI Behavior Notes**). P2 here means **small follow-ups only**:

- **Directory picker + fs API:** `DirectoryPickerOverlay`, `GET /codex-api/fs/directories`, `POST /codex-api/fs/mkdir`, `CODEX_WEB_PROJECT_ROOTS`. Remaining work is **reactive** (clearer errors, keyboard shortcuts, remember last path across sessions, doc tweaks) — not greenfield.
- **Git worktree:** `GitWorktreeModal`, `POST /codex-api/git/worktree`, composer entry, optional **new chat** or **fork thread** follow-up. Remaining work: edge cases (detached HEAD, non-git cwd, permission errors), documentation, or alignment tweaks with Codex thread/cwd semantics if reported.
- **Security note:** Avoid expanding server fs scope (arbitrary file read/write beyond listing + `mkdir`) unless product explicitly requires it; pair general upload/download with **P4** terminal/file-browser planning.

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

**Planned steps (implement after P1 slash/`@`/`!` priorities unless reprioritized):**

1. **TLS for the app server (Express + Vite dev)**
   - Configurable PEM paths (env or CLI), e.g. `CODEX_WEB_TLS_CERT` / `CODEX_WEB_TLS_KEY`.
   - Optional: auto-generated self-signed certs under `~/.config/codex-web-local/tls/` with SAN for chosen hosts/IPs; document **mkcert** for a trusted local CA (better UX than perpetual cert warnings).
   - Document Tailscale / LAN access: cert SAN must match how users open the URL.

2. **Notifications**
   - User preference + `Notification.requestPermission()` (clear opt-in).
   - When `pendingApprovalRequests` grows and the document is hidden or unfocused, fire a deduplicated `Notification` (e.g. `tag`); click focuses the window; approval still happens in-app.

**Rationale:** Cross-cuts CLI, server, docs, and browser policy; lower priority than slash/`@`/`!` parity unless remote approval pain dominates.

---

### P4 — Remote terminal and general file handling (high risk, separate track)

- **Remote terminal:** PTY-backed session in the browser; executes on the host running `codex-web-local`. Reuse password auth; prefer an explicit enable flag. Clear lifecycle, resize, streaming output.
- **File browser / non-image attach:** Pairs naturally with terminal for **upload/download** and paths outside the image-only composer. Not started; scope separately from **New chat directory picker** (folders only).

**Rationale:** Security and maintenance cost; keep isolated from P1–P3 unless explicitly prioritized.
