// A reply as it streams in: the run's events as lines in the two views, and as the status in the bar.

import type { Message, Run } from '@ji.dev/llm'
import type { Screen } from '../screen/screen.ts'
import type { Status } from '../screen/status.ts'
import type { Meter } from '../screen/usage.ts'
import { styleText } from 'node:util'
import { log } from '@clack/prompts'
import { dim } from '../paint/text.ts'
import { describeArguments, describeDone, describeResult, Output } from './calls.ts'
import { Gutter } from './gutter.ts'

/** Where a reply shows, and what it counts toward. */
export interface Stage {
  screen: Screen
  status: Status
  meter: Meter
  /** Resolves once no question is on screen, so nothing is drawn over one. */
  answered: () => Promise<void>
  /** The tools that read and change files. */
  fileTools: ReadonlySet<string>
}

/**
 * Maps run events to terminal lines, in two views (Ctrl+O switches). ASCII stand-ins for the real glyphs; every kind
 * differs in shape as well as color, so the output still reads without color.
 *
 *   brief, by default                          full
 *
 *   |                                          |                          <- Gutter opens a block with a bare rail
 *   o  Thought for 4s · 1.2k chars             o  Thinking                <- title
 *                                              :  The user wants 17*23    <- thinking: gray rail, dim italic text
 *   |                                          |
 *   |  Let me compute that.                    |  Let me compute that.    <- text: plain rail, normal text
 *   |  ```ts                                   |  ```ts                   <- a code block, in color a line at a time
 *   |                                          |                          <- blank line before a turn's first call
 *                                              >  calc                    <- tool_call: the tool has not started yet,
 *                                              |  expr: "17*23"              an argument a line
 *   v  calc(expr: "17*23")                     v  calc  391               <- tool_end: green, or red x with the error
 *   +  use vitest  · steer                     +  use vitest  · steer     <- a message, once it reaches the model
 *
 * Every line of a call or a result is cut to one row, so a long one never wraps under the rail. The status (Running
 * calc 1s) is in the bar, timed from tool_start, so it never counts time the model was writing; it also says what
 * keeps the conversation still: a table held back until it ends, or the output of a call still running. A file a
 * call changed goes in `changed`: the conversation can go back, the file cannot.
 */
export async function render(r: Run, stage: Stage, changed: Set<string>): Promise<void> {
  const { screen, status, meter } = stage
  const out = new Gutter(screen)
  // The calls running, by id: their names, and what they have written so far
  const running = new Map<string, { name: string; output: Output }>()
  // Each view's first tool line in a turn has a blank line before it
  let afterCall = false
  let afterDone = false

  const runningLabel = (): string => {
    const names = new Set([...running.values()].map(call => call.name))
    return `Running ${[...names].join(', ')}`
  }

  status.show('Waiting')
  try {
    for await (const e of r) {
      await stage.answered()
      switch (e.type) {
        case 'step_end':
          if (e.turn.kind === 'input') {
            out.end()
            // A message sent while the agent was busy steered it; one sent while idle simply started its turn
            const steer = e.turn.idle ? '' : dim('  · steer')
            for (const m of e.turn.messages) {
              log.message(`${styleText('bold', contentOf(m))}${steer}`, { symbol: styleText('cyan', '●') })
            }
            afterCall = false
            afterDone = false
          }
          break
        case 'model_start':
          // The level actually sent, after any plugin and after mapping to what the model supports
          status.show(e.thinking === 'off' ? 'Waiting' : 'Thinking')
          afterCall = false
          afterDone = false
          if (e.by === undefined) {
            meter.start()
          }
          break
        case 'thinking':
          meter.streaming()
          await out.write(e.delta, 'thinking')
          status.show('Thinking', out.describe())
          break
        case 'text':
          meter.streaming()
          await out.write(e.delta, 'text')
          status.show('Writing', out.describe())
          break
        case 'tool_call':
          out.end()
          // Calls from the same turn stay together without blank lines
          log.message(describeArguments(e.call), {
            symbol: styleText('cyan', '▸'),
            spacing: afterCall ? 0 : 1,
            output: screen.full,
          })
          afterCall = true
          break
        case 'tool_start':
          running.set(e.call.id, { name: e.call.name, output: new Output() })
          status.show(runningLabel())
          break
        case 'tool_update': {
          // The call that wrote last is the one shown
          const output = running.get(e.call.id)?.output
          output?.add(e.data)
          status.show(runningLabel(), output?.describe())
          break
        }
        case 'tool_end': {
          running.delete(e.call.id)
          if (!e.result.isError && e.call.name !== 'read' && stage.fileTools.has(e.call.name)) {
            changed.add(String(e.call.arguments.path))
          }

          const symbol = e.result.isError ? styleText('red', '✗') : styleText('green', '✓')
          log.message(await describeResult(e.call, e.result), { symbol, spacing: 0, output: screen.full })
          log.message(describeDone(e.call, e.result), { symbol, spacing: afterDone ? 0 : 1, output: screen.brief })
          afterDone = true

          status.show(running.size > 0 ? runningLabel() : 'Waiting')
          break
        }
        case 'model_end':
          meter.end(e.message.usage)
          break
        case 'model_error':
          meter.dropped(e.usage)
          break
        case 'step_cancelled':
          meter.dropped()
          running.clear()
          break
      }
    }
  } finally {
    status.hide()
    out.end()
  }
}

/** A message's text; images and other parts by their type. */
function contentOf(m: Message): string {
  if (typeof m.content === 'string') {
    return m.content
  }
  return m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('')
}
