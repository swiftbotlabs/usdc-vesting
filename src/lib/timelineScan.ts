import {
  createPublicClient, http, decodeEventLog, keccak256, toBytes, numberToHex, hexToBigInt, hexToNumber, pad,
  type RpcLog,
} from 'viem'
import { VESTING_ABI } from './abi'
import type { NetworkConfig } from '../config/networks'

export const CHUNK = 9_000n
const CALL_GAP_MS = 120
const MAX_TRIES = 6
const BACKOFF_START_MS = 500
const BACKOFF_MAX_MS = 8_000
const CACHE_VERSION = 1

// topic0 -> event name, so we decode with the one matching ABI entry
const TOPIC0: Record<string, TimelineEvent['type'] | undefined> = {
  [keccak256(toBytes('ScheduleCreated(uint256,address,address,uint8,uint128,uint64,uint64,uint64,bool)'))]: 'ScheduleCreated',
  [keccak256(toBytes('Claimed(uint256,address,uint256,uint256,address)'))]: 'Claimed',
  [keccak256(toBytes('Cancelled(uint256,address,address,uint256,uint256)'))]: 'Cancelled',
  [keccak256(toBytes('TrancheAdded(uint256,uint256,uint64,uint128)'))]: 'TrancheAdded',
}

export interface TimelineEvent {
  type: 'ScheduleCreated' | 'Claimed' | 'Cancelled' | 'TrancheAdded'
  txHash: string
  logIndex: number
  blockNumber: bigint
  blockTime?: number // unix seconds
  args: Record<string, unknown>
}

export type ScanPhase = 'window' | 'tail' | 'full'

export interface ScanUpdate {
  /** Raw (not yet grouped) events, sorted by block then log index. */
  events: TimelineEvent[]
  phase: ScanPhase
  /** 0..100 progress of the current phase */
  progress: number
}

export type ScanResult = 'done' | 'error' | 'aborted'

// ─── Helpers ────────────────────────────────────────────────────────────────

class ScanAborted extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return }
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); resolve() }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// Deterministic JSON-RPC errors that will never succeed on retry
const NON_RETRYABLE_CODES = new Set([-32600, -32601, -32602, -32700])

function isRetryable(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'number' && NON_RETRYABLE_CODES.has(code)) return false
    cur = (cur as { cause?: unknown }).cause
  }
  return true // 429, -32005, timeouts, network errors, anything else transient
}

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, tries = MAX_TRIES): Promise<T> {
  let delay = BACKOFF_START_MS
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) throw new ScanAborted()
    try {
      return await fn()
    } catch (err) {
      if (signal.aborted) throw new ScanAborted()
      if (attempt >= tries || !isRetryable(err)) throw err
      await sleep(delay, signal)
      delay = Math.min(delay * 2, BACKOFF_MAX_MS)
    }
  }
}

function eventKey(e: { txHash: string; logIndex: number }): string {
  return `${e.txHash}-${e.logIndex}`
}

function sortEvents(list: TimelineEvent[]): TimelineEvent[] {
  return [...list].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
    return a.logIndex - b.logIndex
  })
}

/** Group consecutive TrancheAdded events into one synthetic entry (display only). */
export function collapseTranches(events: TimelineEvent[]): TimelineEvent[] {
  const collapsed: TimelineEvent[] = []
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === 'TrancheAdded') {
      let count = 1
      while (i + count < events.length && events[i + count].type === 'TrancheAdded') count++
      collapsed.push({
        type: 'TrancheAdded',
        txHash: events[i].txHash,
        logIndex: events[i].logIndex,
        blockNumber: events[i].blockNumber,
        blockTime: events[i].blockTime,
        args: { count },
      })
      i += count - 1
    } else {
      collapsed.push(events[i])
    }
  }
  return collapsed
}

// ─── Cache (memory + localStorage, both best-effort) ────────────────────────

interface CacheEntry {
  sig: string
  lastBlock: bigint
  events: TimelineEvent[]
}

const memoryCache = new Map<string, CacheEntry>()
const blockTimeCache = new Map<string, number>()

function cacheKey(network: string, address: string, id: bigint): string {
  return `usdcvesting_tl_v${CACHE_VERSION}:${network}:${address.toLowerCase()}:${id.toString()}`
}

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? { __bigint: v.toString() } : v)
const reviver = (_k: string, v: unknown) => {
  if (v && typeof v === 'object' && '__bigint' in v && typeof (v).__bigint === 'string') {
    return BigInt((v as { __bigint: string }).__bigint)
  }
  return v
}

function isValidEvent(e: unknown): e is TimelineEvent {
  if (!e || typeof e !== 'object') return false
  const o = e as Record<string, unknown>
  return (
    typeof o.type === 'string' && Object.values(TOPIC0).includes(o.type as TimelineEvent['type']) &&
    typeof o.txHash === 'string' && typeof o.logIndex === 'number' &&
    typeof o.blockNumber === 'bigint' && !!o.args && typeof o.args === 'object' &&
    (o.blockTime === undefined || typeof o.blockTime === 'number')
  )
}

function loadCache(key: string, sig: string): CacheEntry | null {
  const mem = memoryCache.get(key)
  if (mem && mem.sig === sig) return mem
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw, reviver) as { sig?: unknown; lastBlock?: unknown; events?: unknown }
    if (parsed.sig !== sig || typeof parsed.lastBlock !== 'bigint' || !Array.isArray(parsed.events)) return null
    if (!parsed.events.every(isValidEvent)) return null
    const entry: CacheEntry = { sig, lastBlock: parsed.lastBlock, events: parsed.events }
    memoryCache.set(key, entry)
    return entry
  } catch {
    return null
  }
}

function saveCache(key: string, entry: CacheEntry): void {
  memoryCache.set(key, entry)
  try {
    localStorage.setItem(key, JSON.stringify(entry, replacer))
  } catch {
    // storage full / blocked: ignore
  }
}

// ─── Scanner ────────────────────────────────────────────────────────────────

interface Segment { from: bigint; to: bigint; phase: ScanPhase }

export async function scanTimeline(opts: {
  network: string
  cfg: NetworkConfig
  scheduleId: bigint
  signal: AbortSignal
  onUpdate: (u: ScanUpdate) => void
}): Promise<ScanResult> {
  const { network, cfg, scheduleId, signal, onUpdate } = opts
  const snapshot = cfg.historySnapshotBlock
  const win = snapshot !== null ? cfg.scheduleWindows[Number(scheduleId)] : undefined
  const tailPhase: ScanPhase = snapshot !== null ? 'tail' : 'full'

  const sig = `${cfg.deploymentBlock}|${snapshot ?? 'x'}|${win ? `${win[0]}-${win[1]}` : 'x'}`
  const key = cacheKey(network, cfg.address, scheduleId)
  const cached = loadCache(key, sig)

  const events = new Map<string, TimelineEvent>()
  for (const e of cached?.events ?? []) events.set(eventKey(e), e)
  let lastBlock = cached?.lastBlock ?? -1n

  const snapshotList = () => sortEvents([...events.values()])
  const emit = (phase: ScanPhase, progress: number) => {
    if (!signal.aborted) onUpdate({ events: snapshotList(), phase, progress })
  }
  const persist = () => {
    if (signal.aborted) return
    saveCache(key, { sig, lastBlock, events: snapshotList() })
  }

  const clip = (from: bigint, to: bigint): [bigint, bigint] => [from > lastBlock + 1n ? from : lastBlock + 1n, to]
  const windowPending = !!win && clip(win[0], win[1])[0] <= win[1]

  // Show whatever the cache already has straight away
  if (events.size > 0) emit(windowPending ? 'window' : tailPhase, 0)

  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.chain.rpcUrls.default.http[0], { retryCount: 0, timeout: 20_000 }),
  })
  const idTopic = pad(numberToHex(scheduleId), { size: 32 })
  let firstCall = true
  const gap = async () => {
    if (!firstCall) await sleep(CALL_GAP_MS, signal)
    firstCall = false
    if (signal.aborted) throw new ScanAborted()
  }

  const decodeLog = (log: RpcLog) => {
    const topic0 = log.topics[0]
    const eventName = topic0 ? TOPIC0[topic0] : undefined
    if (!eventName) return
    try {
      const dec = decodeEventLog({
        abi: VESTING_ABI,
        data: log.data,
        topics: log.topics,
        eventName,
      })
      if (!dec?.args) return
      const args = dec.args as unknown as Record<string, unknown>
      if (args['id'] !== scheduleId) return
      const ev: TimelineEvent = {
        type: eventName,
        txHash: log.transactionHash ?? '',
        logIndex: log.logIndex ? hexToNumber(log.logIndex) : 0,
        blockNumber: log.blockNumber ? hexToBigInt(log.blockNumber) : 0n,
        args,
      }
      const k = eventKey(ev)
      if (!events.has(k)) events.set(k, ev)
    } catch {
      // malformed log: skip
    }
  }

  // Sequential, best-effort timestamps; each block fetched once
  const fillTimes = async () => {
    for (const [k, ev] of events) {
      if (ev.blockTime !== undefined) continue
      const bk = `${cfg.chain.id}:${ev.blockNumber.toString()}`
      let t = blockTimeCache.get(bk)
      if (t === undefined) {
        try {
          await gap()
          const blk = await withRetry(() => client.getBlock({ blockNumber: ev.blockNumber }), signal, 4)
          t = Number(blk.timestamp)
          blockTimeCache.set(bk, t)
        } catch (err) {
          if (err instanceof ScanAborted) throw err
          return // timestamps are best-effort; stop on a failing RPC
        }
      }
      events.set(k, { ...ev, blockTime: t })
    }
  }

  const scanSegment = async (seg: Segment) => {
    const total = seg.to - seg.from + 1n
    for (let from = seg.from; from <= seg.to; from += CHUNK) {
      const to = from + CHUNK - 1n > seg.to ? seg.to : from + CHUNK - 1n
      await gap()
      const logs = await withRetry(
        () => client.request({
          method: 'eth_getLogs',
          params: [{ address: cfg.address, fromBlock: numberToHex(from), toBlock: numberToHex(to), topics: [null, idTopic] }],
        }),
        signal,
      )
      for (const log of logs) decodeLog(log)
      lastBlock = to
      persist()
      emit(seg.phase, Number(((to - seg.from + 1n) * 100n) / total))
    }
  }

  try {
    // 1) Known window for this schedule (snapshot mode only)
    if (win && windowPending) {
      const [from, to] = clip(win[0], win[1])
      emit('window', 0)
      await scanSegment({ from, to, phase: 'window' })
    }
    if (win) {
      // Show window events immediately, then fill in timestamps
      emit('tail', 0)
      await fillTimes()
      persist()
      emit('tail', 0)
    }

    // 2) Tail: new blocks after the snapshot (or the whole range when there is no snapshot)
    const head = await withRetry(() => client.getBlockNumber(), signal)
    const tailStart = snapshot !== null ? snapshot + 1n : cfg.deploymentBlock
    const [tFrom, tTo] = clip(tailStart, head)
    if (tFrom <= tTo) {
      emit(tailPhase, 0)
      await scanSegment({ from: tFrom, to: tTo, phase: tailPhase })
    }
    await fillTimes()
    persist()
    emit(tailPhase, 100)
    return 'done'
  } catch (err) {
    if (err instanceof ScanAborted || signal.aborted) return 'aborted'
    // events found so far were already emitted; the caller shows them as incomplete
    return 'error'
  }
}
