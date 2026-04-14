import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import express, { type Express } from 'express'
import { createCodexBridgeMiddleware, type ProxyOptions } from './codexAppServerBridge.js'
import { createAuthMiddleware } from './authMiddleware.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(join(__dirname, '..', 'dist'))
const indexHtmlPath = resolve(join(distDir, 'index.html'))

export type ServerOptions = {
  password?: string
  proxy?: ProxyOptions
}

export type ServerInstance = {
  app: Express
  dispose: () => void
}

export function createServer(options: ServerOptions = {}): ServerInstance {
  const app = express()
  const bridge = createCodexBridgeMiddleware({ proxy: options.proxy })

  if (!existsSync(indexHtmlPath)) {
    console.warn(
      `[codex-web-local] Frontend bundle not found at ${indexHtmlPath}\n` +
        '  Run `npm run build` in the package directory, then reinstall (e.g. `npm install -g .`) if you use a global install.',
    )
  }

  // 1. Auth middleware (if password is set)
  if (options.password) {
    app.use(createAuthMiddleware(options.password))
  }

  // 2. Bridge middleware for /codex-api/*
  app.use(bridge)

  // 3. Static files from Vue build
  if (existsSync(distDir)) {
    app.use(express.static(distDir))
  }

  // 4. SPA fallback
  app.use((_req, res) => {
    if (!existsSync(indexHtmlPath)) {
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send(
          `Frontend bundle not found.\n\n` +
            `Expected file: ${indexHtmlPath}\n\n` +
            'Build the UI from the package root:\n' +
            '  npm run build\n\n' +
            'Then reinstall the CLI if needed:\n' +
            '  npm install -g .\n',
        )
      return
    }
    res.sendFile(indexHtmlPath)
  })

  return {
    app,
    dispose: () => bridge.dispose(),
  }
}
