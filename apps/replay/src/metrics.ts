// What a stretch of work cost the process: CPU, memory peaks, GC and event-loop delay.
//
//   const meter = startMeter()   ...work, meter.sample() now and then...   const cost = await meter.stop()
//
// Heap and RSS peaks are sampled on a timer and at every sample(), so a spike between two samples can slip through;
// maxRss is the kernel's own high-water mark for the whole process. CPU is process-wide: while cases run
// concurrently, a case's share of it cannot be told apart, and per-case CPU is only exact with concurrency 1.
//
// Timers, GC entries and the event-loop delay monitor all need macrotask turns. Work that runs only in microtasks
// (the faux provider streams that way when unthrottled) starves them: sample() covers memory, and the caller yields
// between units of work so the rest can catch up. Event-loop delay then measures the longest stretch without a yield.
//
// stop() collects garbage first and reports what is still retained: growth there across repeats of the same cases is
// a leak, not load.

import type { Histogram } from 'node:perf_hooks'
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks'
import process from 'node:process'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

export interface ResourceCost {
  wallMs: number
  cpuUserMs: number
  cpuSystemMs: number
  /** (user + system) / wall: above 100 means more than one core was busy. */
  cpuPercent: number
  heapStartBytes: number
  heapEndBytes: number
  heapPeakBytes: number
  /** Heap in use after a full GC at the end. */
  heapRetainedBytes: number
  rssStartBytes: number
  rssPeakBytes: number
  /** Process lifetime high-water mark, from getrusage. */
  maxRssBytes: number
  gcCount: number
  gcMs: number
  /** Share of wall time the event loop was busy. */
  eventLoopUtilization: number
  eventLoopDelayMs: { p50: number; p99: number; max: number }
}

export interface Meter {
  /** Records the current heap and RSS toward the peaks. */
  sample: () => void
  stop: () => Promise<ResourceCost>
}

export function startMeter({ intervalMs = 25 }: { intervalMs?: number } = {}): Meter {
  const start = performance.now()
  const cpu = process.cpuUsage()
  const elu = performance.eventLoopUtilization()
  const heapStart = process.memoryUsage().heapUsed
  const rssStart = process.memoryUsage.rss()
  let heapPeak = heapStart
  let rssPeak = rssStart

  const sample = (): void => {
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed)
    rssPeak = Math.max(rssPeak, process.memoryUsage.rss())
  }
  const sampler = setInterval(sample, intervalMs)
  sampler.unref()

  const delay = monitorEventLoopDelay({ resolution: 10 })
  delay.enable()

  let gcCount = 0
  let gcMs = 0
  const gc = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      gcCount++
      gcMs += entry.duration
    }
  })
  gc.observe({ entryTypes: ['gc'] })

  return {
    sample,
    stop: async () => {
      const wallMs = performance.now() - start
      const used = process.cpuUsage(cpu)
      const utilization = performance.eventLoopUtilization(elu).utilization
      sample()
      const heapEnd = process.memoryUsage().heapUsed

      clearInterval(sampler)
      delay.disable()
      // GC entries are delivered on a later turn
      await new Promise(resolve => setImmediate(resolve))
      gc.disconnect()

      collectGarbage()

      return {
        wallMs,
        cpuUserMs: used.user / 1000,
        cpuSystemMs: used.system / 1000,
        cpuPercent: wallMs === 0 ? 0 : ((used.user + used.system) / 1000 / wallMs) * 100,
        heapStartBytes: heapStart,
        heapEndBytes: heapEnd,
        heapPeakBytes: heapPeak,
        heapRetainedBytes: process.memoryUsage().heapUsed,
        rssStartBytes: rssStart,
        rssPeakBytes: rssPeak,
        maxRssBytes: process.resourceUsage().maxRSS * 1024,
        gcCount,
        gcMs,
        eventLoopUtilization: utilization,
        eventLoopDelayMs: delayOf(delay),
      }
    },
  }
}

/** A full GC, with or without node --expose-gc: the flag can be set at runtime, and gc read from a fresh context. */
function collectGarbage(): void {
  setFlagsFromString('--expose-gc')
  const gc = runInNewContext('gc') as () => void
  gc()
}

function delayOf(h: Histogram): ResourceCost['eventLoopDelayMs'] {
  // In nanoseconds; an empty histogram has a meaningless min and max
  if (h.count === 0) {
    return { p50: 0, p99: 0, max: 0 }
  }
  return { p50: h.percentile(50) / 1e6, p99: h.percentile(99) / 1e6, max: h.max / 1e6 }
}

/** Nearest-rank percentile of an unsorted list; 0 for an empty one. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}
