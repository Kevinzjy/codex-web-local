PORT ?= 3001
HOST ?= 0.0.0.0
HTTP_PROXY_URL ?= http://127.0.0.1:1087
HTTPS_PROXY_URL ?= http://127.0.0.1:1087
ALL_PROXY_URL ?= socks5://127.0.0.1:1080

SYSTEMD_USER_UNITDIR ?= $(HOME)/.config/systemd/user
SYSTEMD_SERVICE_TEMPLATE ?= systemd/codex-web-local.service.in
CODEX_CONFIG_DIR ?= $(HOME)/.config/codex-web-local
SERVICE_ENV_TEMPLATE ?= systemd/service.env.example
# Set to 0 to only write the unit file without `systemctl --user enable --now`.
SYSTEMD_USER_ENABLE ?= 1

.PHONY: test install systemd uninstall

# Matches the filename `npm pack` writes for this package (avoids `npm install -g .` symlinking the repo).
TARBALL := $(shell node -p "require('./package.json').name + '-' + require('./package.json').version + '.tgz'")

test: node_modules/.bin/vite
	npm run build
	http_proxy=$(HTTP_PROXY_URL) https_proxy=$(HTTPS_PROXY_URL) all_proxy=$(ALL_PROXY_URL) npm run dev -- --host $(HOST) --port $(PORT)

install: node_modules/.bin/vite
	npm run build
	rm -f $(TARBALL)
	npm pack
	test -f $(TARBALL)
	npm install -g ./$(TARBALL)
	rm -f $(TARBALL)

# Linux only: user systemd unit for the globally installed CLI (run after `make install`).
systemd:
	@if [ "$$(uname -s)" != "Linux" ]; then \
		echo "Skipping systemd user unit (only generated on Linux)."; \
		exit 0; \
	fi
	@test -n "$(HOME)" || (echo "HOME is unset"; exit 1)
	@set -e; \
	bin="$$(npm prefix -g)/bin/codex-web-local"; \
	if [ ! -x "$$bin" ]; then \
		bin="$$(command -v codex-web-local 2>/dev/null || true)"; \
	fi; \
	if [ -z "$$bin" ] || [ ! -x "$$bin" ]; then \
		echo "Could not find codex-web-local in PATH. Run \`make install\` first."; exit 1; \
	fi; \
	mkdir -p "$(CODEX_CONFIG_DIR)"; \
	if [ -f "$(CODEX_CONFIG_DIR)/service.env" ]; then \
		echo "Keeping existing $(CODEX_CONFIG_DIR)/service.env"; \
	else \
		cp "$(SERVICE_ENV_TEMPLATE)" "$(CODEX_CONFIG_DIR)/service.env"; \
		chmod 600 "$(CODEX_CONFIG_DIR)/service.env"; \
		echo "Created $(CODEX_CONFIG_DIR)/service.env — edit (uncomment), then: systemctl --user restart codex-web-local.service"; \
	fi; \
	mkdir -p "$(SYSTEMD_USER_UNITDIR)"; \
	sed "s#@@CODEX_WEB_LOCAL_BIN@@#$$bin#g" "$(SYSTEMD_SERVICE_TEMPLATE)" > "$(SYSTEMD_USER_UNITDIR)/codex-web-local.service"; \
	echo "Installed systemd user unit: $(SYSTEMD_USER_UNITDIR)/codex-web-local.service"; \
	echo "  ExecStart=$$bin"; \
	if command -v systemctl >/dev/null 2>&1; then \
		systemctl --user daemon-reload 2>/dev/null || true; \
		if [ "$(SYSTEMD_USER_ENABLE)" != "0" ]; then \
			if systemctl --user enable --now codex-web-local.service 2>/dev/null; then \
				echo "systemd (user): enabled and started codex-web-local.service"; \
			else \
				echo "systemd (user): could not enable/start (no user bus?). Try: systemctl --user enable --now codex-web-local.service"; \
			fi; \
		else \
			echo "systemd (user): unit installed only (SYSTEMD_USER_ENABLE=0). Start with: systemctl --user enable --now codex-web-local.service"; \
		fi; \
	else \
		echo "systemctl not found; unit file installed. Install systemd or start manually."; \
	fi; \
	echo "Logs: journalctl --user -u codex-web-local.service -f"

uninstall:
	@if [ "$$(uname -s)" = "Linux" ] && [ -n "$(HOME)" ]; then \
		if command -v systemctl >/dev/null 2>&1; then \
			systemctl --user stop codex-web-local.service 2>/dev/null || true; \
			echo "systemd (user): stopped codex-web-local.service (if it was running)"; \
		fi; \
	fi
	npm uninstall -g codex-web-local
	@if [ "$$(uname -s)" = "Linux" ] && [ -n "$(HOME)" ]; then \
		if command -v systemctl >/dev/null 2>&1; then \
			systemctl --user disable codex-web-local.service 2>/dev/null || true; \
		fi; \
		rm -f "$(SYSTEMD_USER_UNITDIR)/codex-web-local.service"; \
		if command -v systemctl >/dev/null 2>&1; then \
			systemctl --user daemon-reload 2>/dev/null || true; \
		fi; \
		echo "systemd (user): disabled/removed codex-web-local.service (if it was present)"; \
	fi

node_modules/.bin/vite: package.json package-lock.json
	npm ci
