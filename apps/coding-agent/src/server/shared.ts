// The machine's one service, the terminal's and the desktop app's alike (server.ts --shared): where every client looks
// for it, and what a service there says of itself and agrees to (server/http.ts's /api/service).

/** Where the shared service listens: server.ts's default address. */
export const SHARED_HOST = '127.0.0.1'
export const SHARED_PORT = 4317

/** What GET /api/service answers: which service this is, and of which code. */
export interface ServiceInfo {
  pid: number
  version?: string
}

/** What the service at `url` says of itself; undefined when nothing answers, or not with JSON. */
export async function serviceAt(url: string): Promise<ServiceInfo | undefined> {
  try {
    const response = await fetch(`${url}/api/service`)
    return response.ok ? ((await response.json()) as ServiceInfo) : undefined
  } catch {
    return undefined
  }
}

/** Whether the service at `url` agreed to end: it does not while it is in use. */
export async function stopServiceAt(url: string): Promise<boolean> {
  const response = await fetch(`${url}/api/service/stop`, { method: 'POST' }).catch(() => undefined)
  return response?.ok === true
}
