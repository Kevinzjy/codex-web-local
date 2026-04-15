import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { ChatStateStore, type ChatStatePatch } from './chatStateStore.js'
import { cwdIsKnownCodexWorkspace } from './codexThreadGitAllowance.js'
import { createGitWorktreeForCwd, getGitStatusForCwd } from './gitStatus.js'
import { handleComposerSlashSuggestionsGet } from './composerSlashSuggestions.js'
import { handleFsCompleteGet, handleFsDirectoriesGet, handleFsMkdirPost } from './fsDirectories.js'
import { mkdtemp, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type BangExecResult = {
  ok: true
  command: string
  cwd: string
  stdout: string
  stderr: string
  combined: string
  exitCode: number | null
  timedOut: boolean
}

const BANG_EXEC_TIMEOUT_MS = 20_000
const BANG_EXEC_MAX_OUTPUT_BYTES = 256 * 1024

type JsonRpcCall = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  id?: ServerRequestId
  result?: unknown
  error?: {
    code: number
    message: string
  }
  method?: string
  params?: unknown
}

type RpcProxyRequest = {
  method: string
  params?: unknown
}

type ServerRequestReply = {
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

type PendingServerRequest = {
  id: ServerRequestId
  method: string
  params: unknown
  receivedAtIso: string
}

type ServerRequestId = string | number

export type ProxyOptions = {
  httpProxy?: string
  httpsProxy?: string
  allProxy?: string
}

export type CodexBridgeOptions = {
  proxy?: ProxyOptions
}

function addProxyEnv(env: Record<string, string>, name: string, value: string | undefined): void {
  const trimmed = value?.trim()
  if (!trimmed) return

  env[name] = trimmed
  env[name.toUpperCase()] = trimmed
}

function createProxyEnv(proxy: ProxyOptions = {}): Record<string, string> {
  const env: Record<string, string> = {}

  addProxyEnv(env, 'http_proxy', proxy.httpProxy)
  addProxyEnv(env, 'https_proxy', proxy.httpsProxy)
  addProxyEnv(env, 'all_proxy', proxy.allProxy)

  return env
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload instanceof Error && payload.message.trim().length > 0) {
    return payload.message
  }

  const record = asRecord(payload)
  if (!record) return fallback

  const error = record.error
  if (typeof error === 'string' && error.length > 0) return error

  const nestedError = asRecord(error)
  if (nestedError && typeof nestedError.message === 'string' && nestedError.message.length > 0) {
    return nestedError.message
  }

  return fallback
}

function setJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  options?: { cacheControl?: string },
): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (options?.cacheControl) {
    res.setHeader('Cache-Control', options.cacheControl)
  }
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  if (chunks.length === 0) return null

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw.length === 0) return null

  return JSON.parse(raw) as unknown
}

async function executeBangCommand(command: string, cwd: string): Promise<BangExecResult> {
  const normalizedCommand = command.trim()
  const normalizedCwd = cwd.trim()
  if (!normalizedCommand) {
    throw new Error('Missing command')
  }
  if (!normalizedCwd) {
    throw new Error('Missing cwd')
  }

  return await new Promise<BangExecResult>((resolve, reject) => {
    const proc = spawn('/bin/bash', ['-lc', normalizedCommand], {
      cwd: normalizedCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false

    const appendChunk = (target: 'stdout' | 'stderr', chunk: string): void => {
      const bytes = Buffer.byteLength(chunk, 'utf8')
      if (target === 'stdout') {
        const remain = Math.max(0, BANG_EXEC_MAX_OUTPUT_BYTES - stdoutBytes)
        if (remain <= 0) return
        const piece = bytes <= remain ? chunk : Buffer.from(chunk, 'utf8').subarray(0, remain).toString('utf8')
        stdout += piece
        stdoutBytes += Buffer.byteLength(piece, 'utf8')
        return
      }
      const remain = Math.max(0, BANG_EXEC_MAX_OUTPUT_BYTES - stderrBytes)
      if (remain <= 0) return
      const piece = bytes <= remain ? chunk : Buffer.from(chunk, 'utf8').subarray(0, remain).toString('utf8')
      stderr += piece
      stderrBytes += Buffer.byteLength(piece, 'utf8')
    }

    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
      }, 1200)
    }, BANG_EXEC_TIMEOUT_MS)

    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => appendChunk('stdout', chunk))
    proc.stderr.on('data', (chunk: string) => appendChunk('stderr', chunk))
    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    proc.on('close', (code) => {
      clearTimeout(timeout)
      const combined = `${stdout}${stderr}`.trimEnd()
      resolve({
        ok: true,
        command: normalizedCommand,
        cwd: normalizedCwd,
        stdout,
        stderr,
        combined,
        exitCode: typeof code === 'number' ? code : null,
        timedOut,
      })
    })
  })
}

class AppServerProcess {
  private process: ChildProcessWithoutNullStreams | null = null
  private initialized = false
  /** Serializes `initialize` so concurrent RPCs cannot send duplicate initialize calls. */
  private initPromise: Promise<void> | null = null
  private readBuffer = ''
  private nextId = 1
  private stopping = false
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>()
  private readonly notificationListeners = new Set<(value: { method: string; params: unknown }) => void>()
  private readonly pendingServerRequests = new Map<ServerRequestId, PendingServerRequest>()

  constructor(private readonly proxyEnv: Record<string, string>) {}

  private start(): void {
    if (this.process) return

    this.stopping = false
    const proc = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.proxyEnv,
      },
    })
    this.process = proc

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      this.readBuffer += chunk

      let lineEnd = this.readBuffer.indexOf('\n')
      while (lineEnd !== -1) {
        const line = this.readBuffer.slice(0, lineEnd).trim()
        this.readBuffer = this.readBuffer.slice(lineEnd + 1)

        if (line.length > 0) {
          this.handleLine(line)
        }

        lineEnd = this.readBuffer.indexOf('\n')
      }
    })

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', () => {
      // Keep stderr silent in dev middleware; JSON-RPC errors are forwarded via responses.
    })

    proc.on('exit', () => {
      const failure = new Error(this.stopping ? 'codex app-server stopped' : 'codex app-server exited unexpectedly')
      for (const request of this.pending.values()) {
        request.reject(failure)
      }

      this.pending.clear()
      this.pendingServerRequests.clear()
      this.process = null
      this.initialized = false
      this.initPromise = null
      this.readBuffer = ''
    })
  }

  private sendLine(payload: Record<string, unknown>): void {
    if (!this.process) {
      throw new Error('codex app-server is not running')
    }

    this.process.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse
    try {
      message = JSON.parse(line) as JsonRpcResponse
    } catch {
      return
    }

    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const pendingRequest = this.pending.get(message.id)
      this.pending.delete(message.id)

      if (!pendingRequest) return

      if (message.error) {
        pendingRequest.reject(new Error(message.error.message))
      } else {
        pendingRequest.resolve(message.result)
      }
      return
    }

    if (typeof message.method === 'string' && typeof message.id !== 'number') {
      this.emitNotification({
        method: message.method,
        params: message.params ?? null,
      })
      return
    }

    // Handle server-initiated JSON-RPC requests (approvals, dynamic tool calls, etc.).
    if ((typeof message.id === 'number' || typeof message.id === 'string') && typeof message.method === 'string') {
      this.handleServerRequest(message.id, message.method, message.params ?? null)
    }
  }

  private emitNotification(notification: { method: string; params: unknown }): void {
    for (const listener of this.notificationListeners) {
      listener(notification)
    }
  }

  private sendServerRequestReply(requestId: ServerRequestId, reply: ServerRequestReply): void {
    if (reply.error) {
      this.sendLine({
        jsonrpc: '2.0',
        id: requestId,
        error: reply.error,
      })
      return
    }

    this.sendLine({
      jsonrpc: '2.0',
      id: requestId,
      result: reply.result ?? {},
    })
  }

  private resolvePendingServerRequest(requestId: ServerRequestId, reply: ServerRequestReply): void {
    const pendingRequest = this.pendingServerRequests.get(requestId)
    if (!pendingRequest) {
      throw new Error(`No pending server request found for id ${String(requestId)}`)
    }
    this.pendingServerRequests.delete(requestId)

    this.sendServerRequestReply(requestId, reply)
    const requestParams = asRecord(pendingRequest.params)
    const threadId =
      typeof requestParams?.threadId === 'string' && requestParams.threadId.length > 0
        ? requestParams.threadId
        : ''
    this.emitNotification({
      method: 'server/request/resolved',
      params: {
        id: requestId,
        method: pendingRequest.method,
        threadId,
        mode: 'manual',
        resolvedAtIso: new Date().toISOString(),
      },
    })
  }

  private handleServerRequest(requestId: ServerRequestId, method: string, params: unknown): void {
    const pendingRequest: PendingServerRequest = {
      id: requestId,
      method,
      params,
      receivedAtIso: new Date().toISOString(),
    }
    this.pendingServerRequests.set(requestId, pendingRequest)

    this.emitNotification({
      method: 'server/request',
      params: pendingRequest,
    })
  }

  private async call(method: string, params: unknown): Promise<unknown> {
    this.start()
    const id = this.nextId++

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })

      this.sendLine({
        jsonrpc: '2.0',
        id,
        method,
        params,
      } satisfies JsonRpcCall)
    })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    if (!this.initPromise) {
      this.initPromise = this.initializeOnce()
    }

    await this.initPromise
  }

  private async initializeOnce(): Promise<void> {
    try {
      await this.call('initialize', {
        clientInfo: {
          name: 'codex-web-local',
          version: '0.1.0',
        },
      })
      this.initialized = true
    } catch (error) {
      this.initPromise = null
      throw error
    }
  }

  async rpc(method: string, params: unknown): Promise<unknown> {
    await this.ensureInitialized()
    return this.call(method, params)
  }

  onNotification(listener: (value: { method: string; params: unknown }) => void): () => void {
    this.notificationListeners.add(listener)
    return () => {
      this.notificationListeners.delete(listener)
    }
  }

  async respondToServerRequest(payload: unknown): Promise<void> {
    await this.ensureInitialized()

    const body = asRecord(payload)
    if (!body) {
      throw new Error('Invalid response payload: expected object')
    }

    const id = body.id
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new Error('Invalid response payload: "id" must be a string or number')
    }

    const rawError = asRecord(body.error)
    if (rawError) {
      const message = typeof rawError.message === 'string' && rawError.message.trim().length > 0
        ? rawError.message.trim()
        : 'Server request rejected by client'
      const code = typeof rawError.code === 'number' && Number.isFinite(rawError.code)
        ? Math.trunc(rawError.code)
        : -32000
      this.resolvePendingServerRequest(id, { error: { code, message } })
      return
    }

    if (!('result' in body)) {
      throw new Error('Invalid response payload: expected "result" or "error"')
    }

    this.resolvePendingServerRequest(id, { result: body.result })
  }

  listPendingServerRequests(): PendingServerRequest[] {
    return Array.from(this.pendingServerRequests.values())
  }

  dispose(): void {
    if (!this.process) return

    const proc = this.process
    this.stopping = true
    this.process = null
    this.initialized = false
    this.initPromise = null
    this.readBuffer = ''

    const failure = new Error('codex app-server stopped')
    for (const request of this.pending.values()) {
      request.reject(failure)
    }
    this.pending.clear()
    this.pendingServerRequests.clear()

    try {
      proc.stdin.end()
    } catch {
      // ignore close errors on shutdown
    }

    try {
      proc.kill('SIGTERM')
    } catch {
      // ignore kill errors on shutdown
    }

    const forceKillTimer = setTimeout(() => {
      if (!proc.killed) {
        try {
          proc.kill('SIGKILL')
        } catch {
          // ignore kill errors on shutdown
        }
      }
    }, 1500)
    forceKillTimer.unref()
  }
}

class MethodCatalog {
  private methodCache: string[] | null = null
  private notificationCache: string[] | null = null

  constructor(private readonly proxyEnv: Record<string, string>) {}

  private async runGenerateSchemaCommand(outDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('codex', ['app-server', 'generate-json-schema', '--out', outDir], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          ...this.proxyEnv,
        },
      })

      let stderr = ''

      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      proc.on('error', reject)
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve()
          return
        }

        reject(new Error(stderr.trim() || `generate-json-schema exited with code ${String(code)}`))
      })
    })
  }

  private extractMethodsFromClientRequest(payload: unknown): string[] {
    const root = asRecord(payload)
    const oneOf = Array.isArray(root?.oneOf) ? root.oneOf : []
    const methods = new Set<string>()

    for (const entry of oneOf) {
      const row = asRecord(entry)
      const properties = asRecord(row?.properties)
      const methodDef = asRecord(properties?.method)
      const methodEnum = Array.isArray(methodDef?.enum) ? methodDef.enum : []

      for (const item of methodEnum) {
        if (typeof item === 'string' && item.length > 0) {
          methods.add(item)
        }
      }
    }

    return Array.from(methods).sort((a, b) => a.localeCompare(b))
  }

  private extractMethodsFromServerNotification(payload: unknown): string[] {
    const root = asRecord(payload)
    const oneOf = Array.isArray(root?.oneOf) ? root.oneOf : []
    const methods = new Set<string>()

    for (const entry of oneOf) {
      const row = asRecord(entry)
      const properties = asRecord(row?.properties)
      const methodDef = asRecord(properties?.method)
      const methodEnum = Array.isArray(methodDef?.enum) ? methodDef.enum : []

      for (const item of methodEnum) {
        if (typeof item === 'string' && item.length > 0) {
          methods.add(item)
        }
      }
    }

    return Array.from(methods).sort((a, b) => a.localeCompare(b))
  }

  async listMethods(): Promise<string[]> {
    if (this.methodCache) {
      return this.methodCache
    }

    const outDir = await mkdtemp(join(tmpdir(), 'codex-web-local-schema-'))
    await this.runGenerateSchemaCommand(outDir)

    const clientRequestPath = join(outDir, 'ClientRequest.json')
    const raw = await readFile(clientRequestPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const methods = this.extractMethodsFromClientRequest(parsed)

    this.methodCache = methods
    return methods
  }

  async listNotificationMethods(): Promise<string[]> {
    if (this.notificationCache) {
      return this.notificationCache
    }

    const outDir = await mkdtemp(join(tmpdir(), 'codex-web-local-schema-'))
    await this.runGenerateSchemaCommand(outDir)

    const serverNotificationPath = join(outDir, 'ServerNotification.json')
    const raw = await readFile(serverNotificationPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const methods = this.extractMethodsFromServerNotification(parsed)

    this.notificationCache = methods
    return methods
  }
}

type CodexBridgeMiddleware = ((req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>) & {
  dispose: () => void
}

type SharedBridgeState = {
  appServer: AppServerProcess
  methodCatalog: MethodCatalog
  chatStateStore: ChatStateStore
}

const SHARED_BRIDGE_KEY = '__codexRemoteSharedBridge__'

function getSharedBridgeState(options: CodexBridgeOptions = {}): SharedBridgeState {
  const globalScope = globalThis as typeof globalThis & {
    [SHARED_BRIDGE_KEY]?: SharedBridgeState
  }

  const existing = globalScope[SHARED_BRIDGE_KEY]
  if (existing) return existing

  const proxyEnv = createProxyEnv(options.proxy)
  const created: SharedBridgeState = {
    appServer: new AppServerProcess(proxyEnv),
    methodCatalog: new MethodCatalog(proxyEnv),
    chatStateStore: new ChatStateStore(),
  }
  globalScope[SHARED_BRIDGE_KEY] = created
  return created
}

export function createCodexBridgeMiddleware(options: CodexBridgeOptions = {}): CodexBridgeMiddleware {
  const { appServer, methodCatalog, chatStateStore } = getSharedBridgeState(options)

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    try {
      if (!req.url) {
        next()
        return
      }

      const url = new URL(req.url, 'http://localhost')

      if (req.method === 'POST' && url.pathname === '/codex-api/rpc') {
        const payload = await readJsonBody(req)
        const body = asRecord(payload) as RpcProxyRequest | null

        if (!body || typeof body.method !== 'string' || body.method.length === 0) {
          setJson(res, 400, { error: 'Invalid body: expected { method, params? }' })
          return
        }

        try {
          const result = await appServer.rpc(body.method, body.params ?? null)
          setJson(res, 200, { result })
        } catch (error) {
          const message = getErrorMessage(error, 'RPC failed')
          setJson(res, 500, { error: message, method: body.method })
        }
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/server-requests/respond') {
        const payload = await readJsonBody(req)
        await appServer.respondToServerRequest(payload)
        setJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/server-requests/pending') {
        setJson(res, 200, { data: appServer.listPendingServerRequests() })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/meta/methods') {
        const methods = await methodCatalog.listMethods()
        setJson(res, 200, { data: methods })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/meta/notifications') {
        const methods = await methodCatalog.listNotificationMethods()
        setJson(res, 200, { data: methods })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/fs/directories') {
        const rawPath = url.searchParams.get('path')
        await handleFsDirectoriesGet(rawPath, res)
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/fs/complete') {
        const cwd = url.searchParams.get('cwd')
        const q = url.searchParams.get('q')
        await handleFsCompleteGet(cwd, q, res)
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/composer/slash-suggestions') {
        const cwd = url.searchParams.get('cwd')
        const q = url.searchParams.get('q')
        await handleComposerSlashSuggestionsGet(cwd, q, (method, params) => appServer.rpc(method, params), res)
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/fs/mkdir') {
        const payload = await readJsonBody(req)
        await handleFsMkdirPost(payload, res)
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/exec/bash') {
        const payload = await readJsonBody(req)
        const body = asRecord(payload)
        const command = typeof body?.command === 'string' ? body.command : ''
        const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
        if (!command.trim() || !cwd.trim()) {
          setJson(res, 400, { error: 'Missing command or cwd in JSON body' })
          return
        }
        try {
          const result = await executeBangCommand(command, cwd)
          setJson(res, 200, result)
        } catch (error) {
          setJson(res, 500, { error: getErrorMessage(error, 'Failed to execute bash command') })
        }
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/git/status') {
        const cwd = url.searchParams.get('cwd') ?? ''
        if (!cwd.trim()) {
          setJson(res, 400, { error: 'Missing cwd query parameter' })
          return
        }

        const payload = await getGitStatusForCwd(cwd, {
          allowIfKnownCodexCwd: async ({ resolved, requested }) =>
            cwdIsKnownCodexWorkspace((method, params) => appServer.rpc(method, params), resolved, requested),
        })
        setJson(res, 200, payload)
        return
      }

      if (req.method === 'POST' && url.pathname === '/codex-api/git/worktree') {
        const payload = await readJsonBody(req)
        const body = payload as { cwd?: unknown; path?: unknown; branch?: unknown }
        const rawCwd = typeof body?.cwd === 'string' ? body.cwd : ''
        const pathSpec = typeof body?.path === 'string' ? body.path : ''
        const branchName = typeof body?.branch === 'string' ? body.branch : ''
        if (!rawCwd.trim() || !pathSpec.trim() || !branchName.trim()) {
          setJson(res, 400, { error: 'Missing cwd, path, or branch in JSON body' })
          return
        }

        const result = await createGitWorktreeForCwd(rawCwd, pathSpec, branchName, {
          allowIfKnownCodexCwd: async ({ resolved, requested }) =>
            cwdIsKnownCodexWorkspace((method, params) => appServer.rpc(method, params), resolved, requested),
        })

        if (result.ok) {
          setJson(res, 200, result)
          return
        }

        const status =
          result.code === 'not_allowed'
            ? 403
            : result.code === 'git_failed'
              ? 500
              : 400
        setJson(res, status, { error: result.error, code: result.code })
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/chat-state') {
        const payload = await chatStateStore.read()
        setJson(res, 200, payload, {
          cacheControl: 'no-store, no-cache, must-revalidate',
        })
        return
      }

      if (req.method === 'PATCH' && url.pathname === '/codex-api/chat-state') {
        const payload = await readJsonBody(req)
        const body = asRecord(payload)
        if (!body) {
          setJson(res, 400, { error: 'Invalid body: expected object' })
          return
        }

        const patch: ChatStatePatch = {}
        if ('pinnedThreadIds' in body) {
          patch.pinnedThreadIds = body.pinnedThreadIds as ChatStatePatch['pinnedThreadIds']
        }
        if ('collapsedProjects' in body) {
          patch.collapsedProjects = body.collapsedProjects as ChatStatePatch['collapsedProjects']
        }
        if ('projectOrder' in body) {
          patch.projectOrder = body.projectOrder as ChatStatePatch['projectOrder']
        }
        if ('projectDisplayNames' in body) {
          patch.projectDisplayNames = body.projectDisplayNames as ChatStatePatch['projectDisplayNames']
        }
        if ('projectCwdByProjectName' in body) {
          patch.projectCwdByProjectName = body.projectCwdByProjectName as ChatStatePatch['projectCwdByProjectName']
        }
        if ('manualUnreadByThreadId' in body) {
          patch.manualUnreadByThreadId = body.manualUnreadByThreadId as ChatStatePatch['manualUnreadByThreadId']
        }
        if ('readStateByThreadId' in body) {
          patch.readStateByThreadId = body.readStateByThreadId as ChatStatePatch['readStateByThreadId']
        }
        if ('manualUnreadSyncByThreadId' in body) {
          patch.manualUnreadSyncByThreadId =
            body.manualUnreadSyncByThreadId as ChatStatePatch['manualUnreadSyncByThreadId']
        }
        if ('eventUnreadSyncByThreadId' in body) {
          patch.eventUnreadSyncByThreadId =
            body.eventUnreadSyncByThreadId as ChatStatePatch['eventUnreadSyncByThreadId']
        }
        if ('threadRunStateByThreadId' in body) {
          patch.threadRunStateByThreadId =
            body.threadRunStateByThreadId as ChatStatePatch['threadRunStateByThreadId']
        }
        if ('threadPermissionModeByThreadId' in body) {
          patch.threadPermissionModeByThreadId = body.threadPermissionModeByThreadId as ChatStatePatch['threadPermissionModeByThreadId']
        }
        if ('threadFullAccessAcknowledgedByThreadId' in body) {
          patch.threadFullAccessAcknowledgedByThreadId =
            body.threadFullAccessAcknowledgedByThreadId as ChatStatePatch['threadFullAccessAcknowledgedByThreadId']
        }

        const saved = await chatStateStore.patch(patch)
        setJson(res, 200, saved)
        return
      }

      if (req.method === 'GET' && url.pathname === '/codex-api/events') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')

        const unsubscribe = appServer.onNotification((notification) => {
          if (res.writableEnded || res.destroyed) return
          const payload = {
            ...notification,
            atIso: new Date().toISOString(),
          }
          res.write(`data: ${JSON.stringify(payload)}\n\n`)
        })

        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`)
        const keepAlive = setInterval(() => {
          res.write(': ping\n\n')
        }, 15000)

        const close = () => {
          clearInterval(keepAlive)
          unsubscribe()
          if (!res.writableEnded) {
            res.end()
          }
        }

        req.on('close', close)
        req.on('aborted', close)
        return
      }

      next()
    } catch (error) {
      const message = getErrorMessage(error, 'Unknown bridge error')
      setJson(res, 500, { error: message })
    }
  }

  middleware.dispose = () => {
    appServer.dispose()
  }

  return middleware
}
