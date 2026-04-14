# codex-web-local

A lightweight web interface for [Codex](https://github.com/openai/codex) that replicates the desktop UI and runs on top of the Codex `app-server`. It exposes Codex through a web application, allowing you to access your local Codex instance remotely from any browser.

## Prerequisites

- Node.js 18+
- [Codex CLI](https://github.com/openai/codex) installed and available in your `PATH`

## Installation

From a git checkout:

```bash
git clone https://github.com/Kevinzjy/codex-web-local.git
cd codex-web-local
make install
```

This builds the app and installs the `codex-web-local` command on your machine (see the `Makefile` for details). For development without a global install, use `make test` after `npm ci`.

## Usage

```
Usage: codex-web-local [options]

Web interface for Codex app-server

Options:
  -p, --port <port>    port to listen on (default: "3000")
  --host <host>        host to listen on (default: "0.0.0.0")
  --password <pass>    set a specific password
  --no-password        disable password protection
  --http-proxy <url>   HTTP proxy passed to codex app-server
  --https-proxy <url>  HTTPS proxy passed to codex app-server
  --all-proxy <url>    SOCKS/ALL proxy passed to codex app-server
  -h, --help           display help for command

Environment (optional):
  CODEX_WEB_LOCAL_PASSWORD   same as --password when not passed on the CLI
```

## Examples

```bash
# Start with auto-generated password on default port 3000
codex-web-local

# Start on a custom port
codex-web-local --port 8080

# Start with a specific password
codex-web-local --password my-secret

# Start without password protection (use only on trusted networks)
codex-web-local --no-password

# Start with proxy settings for codex app-server
codex-web-local \
  --http-proxy http://127.0.0.1:1087 \
  --https-proxy http://127.0.0.1:1087 \
  --all-proxy socks5://127.0.0.1:1080
```

When started with password protection (default), the server prints the password to the console. Open the URL in your browser, enter the password, and you're in.

## systemd user service (Linux)

Run `codex-web-local` in the background with a **per-user** systemd unit (no root required for the app itself).

### Prerequisites

- You have already run `make install` so the `codex-web-local` binary is on your `PATH` (the unit file points at the installed CLI).

### Install the unit

```bash
make systemd
```

This will:

- Install `codex-web-local.service` under `~/.config/systemd/user/`.
- On **first** run only, copy `systemd/service.env.example` to `~/.config/codex-web-local/service.env` (an existing `service.env` is never overwritten).
- Enable and start the user service (default).

### Install without enabling or starting

To only install the unit file and env template **without** `systemctl --user enable --now`:

```bash
make systemd SYSTEMD_USER_ENABLE=0
```

### Configure

1. Edit `~/.config/codex-web-local/service.env`. Uncomment and set variables as needed, for example:
   - `CODEX_WEB_LOCAL_PASSWORD` — web UI password when you do not pass `--password` on the CLI.
   - `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` if your Codex traffic should use proxies.
2. Apply changes:

   ```bash
   systemctl --user restart codex-web-local.service
   ```

### Logs

Follow logs:

```bash
journalctl --user -u codex-web-local.service -f
```

### Uninstall

From the same git checkout:

```bash
make uninstall
```

This removes the user unit and runs `npm uninstall -g`; it does **not** delete `~/.config/codex-web-local/service.env` (may contain secrets).

### Headless or SSH-only use

User services may not stay running after logout unless lingering is enabled for your user (typical on servers or SSH sessions):

```bash
loginctl enable-linger "$USER"
```

## Contributing

Issues and pull requests are welcome! If you have ideas, suggestions, or found a bug, please open an issue on the [GitHub repository](https://github.com/Kevinzjy/codex-web-local/issues).

## License

[MIT](./LICENSE)
