import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { randomFloat } from '@sim/utils/random'
import Redis, { type RedisOptions } from 'ioredis'
import { env } from '@/lib/core/config/env'
import { getConfiguredCacheProvider } from '@/lib/core/config/env-capabilities.server'

const logger = createLogger('Redis')

/**
 * When REDIS_URL targets a bare IP over `rediss://` (e.g. trigger.dev's
 * PrivateLink VPCE IP), default TLS hostname verification fails — the cert
 * is issued for the ElastiCache DNS name, not the IP. Override SNI with
 * REDIS_TLS_SERVERNAME (set to the DNS the cert was issued for).
 *
 * For DNS hosts: no override needed, default verification works.
 */
function resolveRedisTlsOptions(url: string | undefined): { servername: string } | undefined {
  if (!url) return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'rediss:') return undefined
  const hostIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)
  if (!hostIsIp) return undefined
  if (!env.REDIS_TLS_SERVERNAME) {
    throw new Error(
      'REDIS_TLS_SERVERNAME must be set when REDIS_URL targets an IP over rediss://. ' +
        'TLS cert hostname verification cannot match an IP — set REDIS_TLS_SERVERNAME ' +
        'to the DNS name the cert was issued for (the ElastiCache primary endpoint).'
    )
  }
  return { servername: env.REDIS_TLS_SERVERNAME }
}

/**
 * Shared connection defaults — keepAlive, connectTimeout, enableOfflineQueue,
 * and TLS SNI when REDIS_URL targets an IP. Every Redis client we open should
 * spread this; callers add their own retry / timeout policy on top.
 */
export function getRedisConnectionDefaults(
  url: string | undefined
): Pick<RedisOptions, 'keepAlive' | 'connectTimeout' | 'enableOfflineQueue' | 'tls'> {
  const tls = resolveRedisTlsOptions(url)
  return {
    keepAlive: 1000,
    connectTimeout: 10000,
    enableOfflineQueue: true,
    ...(tls ? { tls } : {}),
  }
}

interface RedisState {
  client: Redis | null
  pingFailures: number
  pingInterval: NodeJS.Timeout | null
  pingInFlight: boolean
  reconnectListeners: Array<() => void>
  clientCreatedAt: number | null
  lastReadyAt: number | null
  lastPingOkAt: number | null
  connects: number
  reconnects: number
  errors: number
  lastErrorMessage: string | null
}

const g = globalThis as typeof globalThis & { _redisState?: RedisState }
if (!g._redisState) {
  g._redisState = {
    client: null,
    pingFailures: 0,
    pingInterval: null,
    pingInFlight: false,
    reconnectListeners: [],
    clientCreatedAt: null,
    lastReadyAt: null,
    lastPingOkAt: null,
    connects: 0,
    reconnects: 0,
    errors: 0,
    lastErrorMessage: null,
  }
}
const state = g._redisState

/**
 * A command that never gets a reply fails identically whichever of three states
 * the client was in — still establishing its connection, reconnecting with the
 * command parked in the offline queue, or holding a socket that has silently
 * died. ioredis reports all three the same way: an `Error: Command timed out`
 * whose stack contains only its own timer frames, with no app frame naming the
 * call and no lifecycle event to say which happened.
 *
 * This snapshot is what separates them. `status` alone is usually decisive
 * (`connecting`/`reconnecting`/`ready`), and `queuedCommands` confirms it: a
 * command parked in the offline queue was waiting on connection setup, while a
 * command written to a `ready` socket that never answered means the socket is
 * dead in a way nothing reported.
 */
export interface RedisConnectionDiagnostics {
  status: string
  /** Age of the client object — distinguishes one created for this unit of work from an inherited one. */
  clientAgeMs: number | null
  /** Time since the connection last reached `ready`. */
  readyAgeMs: number | null
  /** Time since the last PING round-trip actually completed; the health check runs every 15s. */
  msSinceLastPingOk: number | null
  /** Depth of ioredis's offline queue — non-zero means commands are waiting on the connection. */
  queuedCommands: number | null
  connects: number
  reconnects: number
  errors: number
  lastErrorMessage: string | null
  /** Whether REDIS_URL targets an IP literal or a DNS name. Names DNS resolution in or out. */
  hostKind: 'ip' | 'dns' | 'unknown'
  tls: boolean
  /** Whether the TLS SNI override is in play (set when the host is a bare IP). */
  sniOverride: boolean
}

/** ioredis keeps no public accessor for its offline queue, but its depth is the tiebreaker above. */
interface OfflineQueueView {
  offlineQueue?: { length?: number }
}

function describeRedisUrl(
  url: string | null
): Pick<RedisConnectionDiagnostics, 'hostKind' | 'tls' | 'sniOverride'> {
  if (!url) return { hostKind: 'unknown', tls: false, sniOverride: false }
  try {
    const parsed = new URL(url)
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)
    const tls = parsed.protocol === 'rediss:'
    return { hostKind: isIp ? 'ip' : 'dns', tls, sniOverride: tls && isIp }
  } catch {
    return { hostKind: 'unknown', tls: false, sniOverride: false }
  }
}

/**
 * Connection state at a point in time, safe to attach to any log line.
 *
 * Derives only non-sensitive facts from REDIS_URL — never the URL itself, which
 * carries the AUTH token.
 */
export function describeRedisConnection(): RedisConnectionDiagnostics {
  const now = Date.now()
  let url: string | null = null
  try {
    url = getConfiguredRedisUrl()
  } catch {
    url = null
  }

  const client = state.client
  // double-cast-allowed: ioredis omits offlineQueue from its public type, and its depth is what separates a command waiting on connection setup from one written to a live socket
  const queued = (client as unknown as OfflineQueueView | null)?.offlineQueue?.length

  return {
    status: client?.status ?? 'no-client',
    clientAgeMs: state.clientCreatedAt === null ? null : now - state.clientCreatedAt,
    readyAgeMs: state.lastReadyAt === null ? null : now - state.lastReadyAt,
    msSinceLastPingOk: state.lastPingOkAt === null ? null : now - state.lastPingOkAt,
    queuedCommands: typeof queued === 'number' ? queued : null,
    connects: state.connects,
    reconnects: state.reconnects,
    errors: state.errors,
    lastErrorMessage: state.lastErrorMessage,
    ...describeRedisUrl(url),
  }
}

const PING_INTERVAL_MS = 15_000
const MAX_PING_FAILURES = 2

export function getConfiguredRedisUrl(): string | null {
  if (getConfiguredCacheProvider() === 'database') return null

  const redisUrl = env.REDIS_URL
  if (!redisUrl) {
    throw new Error('Cache capability selected Redis but REDIS_URL is missing')
  }
  return redisUrl
}

/**
 * Register a callback that fires when the PING health check forces a reconnect.
 * Useful for resetting cached adapters that hold a stale Redis reference.
 */
export function onRedisReconnect(cb: () => void): void {
  state.reconnectListeners.push(cb)
}

function startPingHealthCheck(redis: Redis): void {
  if (state.pingInterval) return

  state.pingInterval = setInterval(async () => {
    if (state.pingInFlight) return
    state.pingInFlight = true
    try {
      await redis.ping()
      state.pingFailures = 0
      state.lastPingOkAt = Date.now()
    } catch (error) {
      state.pingFailures++
      logger.warn('Redis PING failed', {
        consecutiveFailures: state.pingFailures,
        error: toError(error).message,
      })

      if (state.pingFailures >= MAX_PING_FAILURES) {
        logger.error('Redis PING failed consecutive times — forcing reconnect', {
          consecutiveFailures: state.pingFailures,
        })
        state.pingFailures = 0
        // Clear before notifying listeners — they may call getRedisClient() and must see the reset state.
        state.client = null
        if (state.pingInterval) {
          clearInterval(state.pingInterval)
          state.pingInterval = null
        }
        for (const cb of state.reconnectListeners) {
          try {
            cb()
          } catch (cbError) {
            logger.error('Redis reconnect listener error', { error: cbError })
          }
        }
        try {
          redis.disconnect(true)
        } catch (disconnectError) {
          logger.error('Error during forced Redis disconnect', { error: disconnectError })
        }
      }
    } finally {
      state.pingInFlight = false
    }
  }, PING_INTERVAL_MS)
}

/**
 * Get a Redis client instance.
 * Uses connection pooling to reuse connections across requests.
 *
 * ioredis handles command queuing internally via `enableOfflineQueue` (default: true),
 * so commands are queued and executed once connected. No manual connection checks needed.
 */
export function getRedisClient(): Redis | null {
  if (typeof window !== 'undefined') return null
  const redisUrl = getConfiguredRedisUrl()
  if (!redisUrl) return null
  if (state.client) return state.client

  // Outside the try/catch so config errors aren't silently swallowed.
  const defaults = getRedisConnectionDefaults(redisUrl)

  try {
    logger.info('Initializing Redis client')

    state.client = new Redis(redisUrl, {
      ...defaults,
      commandTimeout: 5000,
      maxRetriesPerRequest: 5,

      retryStrategy: (times) => {
        if (times > 10) {
          logger.error(`Redis reconnection attempt ${times}`, { nextRetryMs: 30000 })
          return 30000
        }
        const base = Math.min(1000 * 2 ** (times - 1), 10000)
        const jitter = randomFloat() * base * 0.3
        const delay = Math.round(base + jitter)
        state.reconnects++
        logger.warn('Redis reconnecting', { attempt: times, nextRetryMs: delay })
        return delay
      },

      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']
        return targetErrors.some((e) => err.message.includes(e))
      },
    })

    state.clientCreatedAt = Date.now()
    state.lastReadyAt = null
    state.lastPingOkAt = null

    state.client.on('connect', () => {
      state.connects++
      // Elapsed since construction, because the wait before a connection becomes
      // usable is the number this path has never been able to produce: it is
      // spent inside a command's deadline, where it surfaces as a command
      // timeout rather than as connection latency.
      logger.info('Redis connected', {
        elapsedMs: state.clientCreatedAt === null ? null : Date.now() - state.clientCreatedAt,
        attempt: state.connects,
      })
    })
    state.client.on('ready', () => {
      state.lastReadyAt = Date.now()
      logger.info('Redis ready', {
        elapsedMs: state.clientCreatedAt === null ? null : Date.now() - state.clientCreatedAt,
      })
    })
    state.client.on('error', (err: Error) => {
      state.errors++
      state.lastErrorMessage = err.message
      logger.error('Redis error', { error: err.message, code: (err as any).code })
    })
    state.client.on('close', () => logger.warn('Redis connection closed'))
    state.client.on('end', () => logger.error('Redis connection ended'))

    startPingHealthCheck(state.client)

    return state.client
  } catch (error) {
    logger.error('Failed to initialize Redis client', { error })
    return null
  }
}

/**
 * Lua script for safe lock release.
 * Only deletes the key if the value matches (ownership verification).
 * Returns 1 if deleted, 0 if not (value mismatch or key doesn't exist).
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * Lua script for safe lock TTL extension.
 * Only refreshes the expiry if the value matches (ownership verification),
 * so a stale heartbeat from a prior owner cannot extend a lock currently
 * held by someone else after a TTL eviction.
 * Returns 1 if the TTL was extended, 0 if not (value mismatch or key gone).
 */
const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
else
  return 0
end
`

/**
 * Acquire a distributed lock using Redis SET NX.
 * Returns true if lock acquired, false if already held.
 *
 * When Redis is not available, returns true (lock "acquired") to allow
 * single-replica deployments to function without Redis. In multi-replica
 * deployments without Redis, the idempotency layer prevents duplicate processing.
 */
export interface AcquireLockOptions {
  /**
   * Release the lock this call may have taken when the SET itself rejects.
   *
   * A rejected SET does not mean the server declined it: `commandTimeout` gives
   * up client-side while the command can still reach Redis and take the lock,
   * leaving it held by a caller that never learned it won and so never releases
   * it. Every contender then skips until the TTL expires.
   *
   * Only opt in when BOTH hold, because the reclaim is unsafe otherwise:
   *
   * 1. `value` is unique to this holder. A value two holders can share — the
   *    copilot chat lock keys on a client-supplied `userMessageId` — makes the
   *    compare-and-delete match a lock another holder is actively using.
   * 2. A throw means the caller does no work. One that falls open and runs
   *    anyway (`withLeaderLock`, the MCP OAuth refresh mutex) would keep running
   *    while this frees its lock, admitting a second concurrent runner.
   */
  reclaimOnFailure?: boolean
}

export async function acquireLock(
  lockKey: string,
  value: string,
  expirySeconds: number,
  options?: AcquireLockOptions
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return true // No-op when Redis unavailable; idempotency layer handles duplicates
  }

  try {
    const result = await redis.set(lockKey, value, 'EX', expirySeconds, 'NX')
    return result === 'OK'
  } catch (error) {
    // Best effort, and the same compare-and-delete `releaseLock` runs on the
    // success path: it deletes only while `value` still owns the key. If Redis
    // is still unreachable the TTL stays the backstop, which is the behavior
    // without this cleanup.
    if (options?.reclaimOnFailure) {
      await releaseLock(lockKey, value).catch(() => {})
    }
    throw error
  }
}

/**
 * Release a distributed lock safely.
 * Only releases if the caller owns the lock (value matches).
 * Returns true if lock was released, false if not owned or already expired.
 *
 * When Redis is not available, returns true (no-op) since no lock was held.
 */
export async function releaseLock(lockKey: string, value: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return true // No-op when Redis unavailable; no lock was actually held
  }

  const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, value)
  return result === 1
}

/**
 * Extend the TTL of a distributed lock if still owned by the caller.
 * Returns true if the caller still owns the lock and the TTL was refreshed,
 * false if the lock has been taken over by another owner or has expired.
 *
 * When Redis is not available, returns true (no-op) to match the behavior
 * of `acquireLock` / `releaseLock`: single-replica deployments without
 * Redis never held a real lock, so heartbeat success is implicit.
 */
export async function extendLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return true
  }

  const result = await redis.eval(EXTEND_LOCK_SCRIPT, 1, lockKey, value, expirySeconds)
  return result === 1
}

/**
 * Close the Redis connection.
 * Use for graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (state.pingInterval) {
    clearInterval(state.pingInterval)
    state.pingInterval = null
  }

  if (state.client) {
    try {
      await state.client.quit()
    } catch (error) {
      logger.error('Error closing Redis connection', { error })
    } finally {
      state.client = null
    }
  }
}

/**
 * Reset all module-level state. Only intended for use in tests.
 */
export function resetForTesting(): void {
  if (state.pingInterval) {
    clearInterval(state.pingInterval)
    state.pingInterval = null
  }
  state.client = null
  state.pingFailures = 0
  state.pingInFlight = false
  state.reconnectListeners.length = 0
  state.clientCreatedAt = null
  state.lastReadyAt = null
  state.lastPingOkAt = null
  state.connects = 0
  state.reconnects = 0
  state.errors = 0
  state.lastErrorMessage = null
}
