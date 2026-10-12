// The OpenAI-compatible servers the person added, kept beside the credentials in providers.json: each one's address
// and the models chosen of it. Their keys are credentials like any other, in auth.json under the endpoint's id.

import type { Endpoint } from '@ji.dev/llm'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { endpointProvider, models, registerProvider } from '@ji.dev/llm'

/** Each endpoint kept in `dir`, registered as a provider; what cannot be read is skipped, as if never added. */
export function registerEndpoints(dir: string): Endpoint[] {
  const endpoints = listEndpoints(dir)
  for (const endpoint of endpoints) {
    registerProvider(endpointProvider(endpoint))
  }
  return endpoints
}

export function listEndpoints(dir: string): Endpoint[] {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(fileOf(dir), 'utf8'))
  } catch {
    return []
  }
  return Array.isArray(value) ? value.filter(isEndpoint) : []
}

/** Keeps the endpoint, in place of the one of its id, and registers it. */
export async function saveEndpoint(dir: string, endpoint: Endpoint): Promise<void> {
  const others = listEndpoints(dir).filter(e => e.id !== endpoint.id)
  await write(dir, [...others, endpoint])
  registerProvider(endpointProvider(endpoint))
}

/** Forgets the endpoint and its key; its sessions fail until it is added again. */
export async function removeEndpoint(dir: string, id: string): Promise<void> {
  await write(
    dir,
    listEndpoints(dir).filter(e => e.id !== id),
  )
  await models.logout(id)
  models.deleteProvider(id)
}

function fileOf(dir: string): string {
  return join(dir, 'providers.json')
}

async function write(dir: string, endpoints: Endpoint[]): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = fileOf(dir)
  const next = `${file}.${process.pid}.tmp`
  await writeFile(next, `${JSON.stringify(endpoints, null, 2)}\n`, { mode: 0o600 })
  await rename(next, file)
}

function isEndpoint(value: unknown): value is Endpoint {
  const e = value as Partial<Endpoint> | null
  return (
    typeof e?.id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.baseUrl === 'string' &&
    Array.isArray(e.models) &&
    e.models.every(m => typeof m?.id === 'string')
  )
}
