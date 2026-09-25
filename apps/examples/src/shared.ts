// Shared by the examples: picking a model and displaying a run.
import type { Run, RunSummary, Turn } from '@gaoxiang.ai/llm'
import type { Api, FauxResponseStep, KnownProvider, Model } from '@mariozechner/pi-ai'
import process from 'node:process'
import { getModels, registerFauxProvider } from '@mariozechner/pi-ai'

/**
 * MODEL=anthropic/claude-sonnet-5 -> a real model (API key read from env).
 * Without MODEL -> pi-ai's faux provider replays `script` step by step, so the example runs offline.
 */
export function pickModel(script: FauxResponseStep[], tokensPerSecond = 200): Model<Api> {
  const spec = process.env.MODEL
  if (spec) {
    const i = spec.indexOf('/')
    const [provider, id] = [spec.slice(0, i), spec.slice(i + 1)]
    const model = getModels(provider as KnownProvider).find(m => m.id === id)
    if (!model) {
      throw new Error(`unknown model: ${spec}`)
    }
    return model as Model<Api>
  }

  const faux = registerFauxProvider({ tokensPerSecond })
  faux.setResponses(script)
  return faux.getModel()
}

/** Reads two streams at once: text as it streams, plus one line per finished step. Prints the totals at the end. */
export async function show(r: Run): Promise<RunSummary> {
  const text = (async () => {
    for await (const chunk of r.text) {
      process.stdout.write(chunk)
    }
  })()

  for await (const { t, turn } of r.turns) {
    const line = describe(turn)
    if (line !== undefined) {
      console.log(`\n  [t=${t}] ${line}`)
    }
  }
  await text

  const summary = await r.summary
  console.log(
    `\n  summary: ${summary.turns} model turns, ${summary.usage.input} in / ${summary.usage.output} out tokens, $${summary.usage.cost.toFixed(4)}`,
  )
  return summary
}

function describe(turn: Turn): string | undefined {
  if (turn.kind === 'input') {
    const label = turn.interrupted ? 'interrupt' : turn.idle ? 'user' : 'steer'
    return `${label} → ${turn.messages.map(m => JSON.stringify(m.content)).join(', ')}`
  }
  if (turn.kind === 'rewrite') {
    return `history rewritten → ${turn.messages.length} messages`
  }
  if (turn.results.length === 0) {
    return undefined
  }

  return turn.results
    .map(r => {
      const text = r.content.map(c => (c.type === 'text' ? c.text : '')).join('')
      const preview = text.length > 60 ? `${text.slice(0, 60)}… (${text.length} chars)` : text
      return `${r.toolName}${r.isError ? ' ✗' : ''} → ${JSON.stringify(preview)}`
    })
    .join('\n  ')
}
