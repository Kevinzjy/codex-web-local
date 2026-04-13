import { createServer } from 'node:http'
import { Command } from 'commander'
import { createServer as createApp } from '../server/httpServer.js'
import { generatePassword } from '../server/password.js'

const program = new Command()
  .name('codex-web-local')
  .description('Web interface for Codex app-server')
  .option('-p, --port <port>', 'port to listen on', '3000')
  .option('--host <host>', 'host to listen on', '0.0.0.0')
  .option('--password <pass>', 'set a specific password')
  .option('--no-password', 'disable password protection')
  .option('--http-proxy <url>', 'HTTP proxy passed to codex app-server')
  .option('--https-proxy <url>', 'HTTPS proxy passed to codex app-server')
  .option('--all-proxy <url>', 'SOCKS/ALL proxy passed to codex app-server')
  .parse()

const opts = program.opts<{
  port: string
  host: string
  password: string | boolean
  httpProxy?: string
  httpsProxy?: string
  allProxy?: string
}>()
const port = parseInt(opts.port, 10)

let password: string | undefined
if (opts.password === false) {
  password = undefined
} else if (typeof opts.password === 'string') {
  password = opts.password
} else {
  password = generatePassword()
}

const { app, dispose } = createApp({
  password,
  proxy: {
    httpProxy: opts.httpProxy,
    httpsProxy: opts.httpsProxy,
    allProxy: opts.allProxy,
  },
})
const server = createServer(app)

server.listen(port, opts.host, () => {
  const lines = [
    '',
    'Codex Web Local is running!',
    '',
    `  Local:    http://${opts.host}:${String(port)}`,
  ]

  if (password) {
    lines.push(`  Password: ${password}`)
  }

  if (opts.httpProxy || opts.httpsProxy || opts.allProxy) {
    lines.push('  Proxy:   enabled for codex app-server')
  }

  lines.push('')
  console.log(lines.join('\n'))
})

function shutdown() {
  console.log('\nShutting down...')
  server.close(() => {
    dispose()
    process.exit(0)
  })
  // Force exit after timeout
  setTimeout(() => {
    dispose()
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
