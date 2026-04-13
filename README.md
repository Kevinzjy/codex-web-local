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

## systemd (Linux)

After **`make install`**, run **`make systemd`**. It installs the user unit, creates **`~/.config/codex-web-local/service.env`** from a commented template on first run (existing file is left untouched), enables and starts the service. Edit **`service.env`** (uncomment `CODEX_WEB_LOCAL_PASSWORD`, proxy lines, etc.), then **`systemctl --user restart codex-web-local.service`**.

Skip auto-start: `make systemd SYSTEMD_USER_ENABLE=0`. One-step removal: **`make uninstall`**. Logs: `journalctl --user -u codex-web-local.service -f`. Headless/SSH: you may need `loginctl enable-linger "$USER"` once.

## Contributing

Issues and pull requests are welcome! If you have ideas, suggestions, or found a bug, please open an issue on the [GitHub repository](https://github.com/Kevinzjy/codex-web-local/issues).

## License

[MIT](./LICENSE)
