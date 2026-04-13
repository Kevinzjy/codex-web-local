PORT ?= 3001
HOST ?= 0.0.0.0
HTTP_PROXY_URL ?= http://127.0.0.1:1087
HTTPS_PROXY_URL ?= http://127.0.0.1:1087
ALL_PROXY_URL ?= socks5://127.0.0.1:1080

.PHONY: test install uninstall

test: node_modules/.bin/vite
	http_proxy=$(HTTP_PROXY_URL) https_proxy=$(HTTPS_PROXY_URL) all_proxy=$(ALL_PROXY_URL) npm run dev -- --host $(HOST) --port $(PORT)

install: node_modules/.bin/vite
	npm run build
	npm install -g .

uninstall:
	npm uninstall -g codex-web-local

node_modules/.bin/vite: package.json package-lock.json
	npm ci
