function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export type CodexErrorCode =
  | 'http_error'
  | 'rpc_error'
  | 'network_error'
  | 'invalid_response'
  | 'unknown_error'

export class CodexApiError extends Error {
  code: CodexErrorCode
  method?: string
  status?: number

  constructor(message: string, options: { code: CodexErrorCode; method?: string; status?: number }) {
    super(message)
    this.name = 'CodexApiError'
    this.code = options.code
    this.method = options.method
    this.status = options.status
  }
}

/**
 * True when thread/read fails because the session is not ready yet
 * (common immediately after thread/start before the first user turn is persisted).
 */
export function isThreadReadNotMaterializedError(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('not materialized') && m.includes('includeturns')
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload)
  if (!record) return fallback

  const error = record.error
  let message: string
  if (typeof error === 'string' && error.length > 0) {
    message = error
  } else {
    const nested = asRecord(error)
    if (nested && typeof nested.message === 'string' && nested.message.length > 0) {
      message = nested.message
    } else {
      return fallback
    }
  }

  const method = record.method
  if (typeof method === 'string' && method.length > 0) {
    return `${message} (${method})`
  }
  return message
}

export function normalizeCodexApiError(error: unknown, fallback: string, method?: string): CodexApiError {
  if (error instanceof CodexApiError) {
    return error
  }

  if (error instanceof Error) {
    return new CodexApiError(error.message || fallback, {
      code: 'unknown_error',
      method,
    })
  }

  return new CodexApiError(fallback, {
    code: 'unknown_error',
    method,
  })
}
