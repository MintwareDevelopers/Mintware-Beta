// =============================================================================
// lib/logger.ts — Structured logger
//
// Emits newline-delimited JSON to stdout/stderr. Each line is a valid JSON
// object with level, tag, msg, ts, and optional requestId + context fields.
//
// Usage:
//   import { log } from '@/lib/logger'
//   log.info('sweep', 'Starting treasury sweep', { campaignId })
//   log.error('epoch-end', 'Failed to process epoch', { epochId, err: e.message })
//
// Per-request usage (inside createHandler — prefer this):
//   ctx.log.info('sweep', 'Starting', { campaignId })
//   // Every line automatically carries the requestId for correlation
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogContext = Record<string, unknown>

interface LogEntry {
  level: LogLevel
  tag: string
  msg: string
  ts: number
  requestId?: string
  [key: string]: unknown
}

function emit(
  level: LogLevel,
  tag: string,
  msg: string,
  ctx?: LogContext,
  requestId?: string
): void {
  const entry: LogEntry = {
    level,
    tag,
    msg,
    ts: Date.now(),
    ...(requestId ? { requestId } : {}),
    ...ctx,
  }
  const line = JSON.stringify(entry)
  if (level === 'error' || level === 'warn') {
    console.error(line)
  } else {
    console.log(line)
  }
}

// ---------------------------------------------------------------------------
// Root logger — no requestId binding
// Use for module-level or startup logging. Prefer ctx.log inside handlers.
// ---------------------------------------------------------------------------

export const log = {
  debug: (tag: string, msg: string, ctx?: LogContext) => emit('debug', tag, msg, ctx),
  info:  (tag: string, msg: string, ctx?: LogContext) => emit('info',  tag, msg, ctx),
  warn:  (tag: string, msg: string, ctx?: LogContext) => emit('warn',  tag, msg, ctx),
  error: (tag: string, msg: string, ctx?: LogContext) => emit('error', tag, msg, ctx),
}

// ---------------------------------------------------------------------------
// Bound logger — pre-tagged with a requestId
// Created once per request inside createHandler and passed via RouteContext.
// All log lines from the same request share the same requestId, making it
// trivial to correlate across cron steps, downstream calls, and errors.
// ---------------------------------------------------------------------------

export function bindLogger(requestId: string) {
  return {
    debug: (tag: string, msg: string, ctx?: LogContext) => emit('debug', tag, msg, ctx, requestId),
    info:  (tag: string, msg: string, ctx?: LogContext) => emit('info',  tag, msg, ctx, requestId),
    warn:  (tag: string, msg: string, ctx?: LogContext) => emit('warn',  tag, msg, ctx, requestId),
    error: (tag: string, msg: string, ctx?: LogContext) => emit('error', tag, msg, ctx, requestId),
  }
}

export type BoundLogger = ReturnType<typeof bindLogger>
