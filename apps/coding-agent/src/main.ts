import type { Element } from '@ji.dev/tui'
import type { ClientEvent } from './client/session.ts'
import type { ServiceState } from './server/events.ts'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { cancel, log, outro } from '@clack/prompts'
import { files, localWorkspace } from '@ji.dev/plugin-files'
import { abbreviateHomePath, dimText, formatKeyHint, Screen, Status } from '@ji.dev/tui'
import { errorMessage } from '@ji.dev/utils'
import { startService } from './client/launch.ts'
import { SessionClient } from './client/session.ts'
import { Answering } from './ui/answering.ts'
import { viewOf } from './ui/bars.ts'
import { showHelp } from './ui/commands.ts'
import { Input } from './ui/input.ts'
import { CommandMenu } from './ui/menu.ts'
import { describeUsage, summarizeUsage } from './ui/usage.ts'

// The terminal is a client of the coding agent's service (server.ts): the session runs there, with its tools, its
// approvals and its log, and the desktop app shows the same one as it happens. Closing the terminal leaves it there.

/** Where the command was run from: pnpm --filter starts the script in the package's own directory. */
const ROOT = process.env.INIT_CWD ?? process.cwd()

/** The root as the top bar shows it. */
const WORKSPACE = abbreviateHomePath(ROOT)

/**
 * `--model provider/id` picks any model of pi-ai's catalog; without it, DEEPSEEK_MODEL of DeepSeek's, and the level
 * DEEPSEEK_THINKING. `--yolo`: nothing waits for a yes, for the whole session, for a sandbox or a throwaway checkout.
 */
const { values: ARGS } = parseArgs({
  options: { model: { type: 'string' }, yolo: { type: 'boolean', default: false } },
})

if (!Screen.isSupported()) {
  cancel('The coding agent draws a bar at the bottom of a terminal: run it in one.')
  process.exit(1)
}

/**
 * The session, made in the root with the terminal's environment: its commands run with it, and a key exported in it
 * reaches the model. A typo in the model or the level stops the coding agent before the first prompt.
 */
const { session, started } = await openSessionOrQuit()

/** The tools that read and change files, as the session's files plugin has them: a reply that does not finish names
 * the files they changed. */
const FILE_TOOLS: ReadonlySet<string> = new Set(files(localWorkspace(ROOT)).tools?.map(t => t.name))

/** The session as its last 'state' event left it. */
let state: ServiceState = started

const { promise: quitting, resolve: quit } = Promise.withResolvers<void>()

/** The bars around the conversation, built by buildView; stdout is the conversation between them. */
const screen = new Screen(buildView)

const status = new Status(() => screen.draw())

const answering = new Answering({
  screen,
  status,
  state: () => state,
  answer: (id, reply) => session.answer(id, reply),
  switchMode: () => {
    session.setMode().catch((error: unknown) => log.error(errorMessage(error)))
  },
  // eslint-disable-next-line ts/no-use-before-define -- asked once a question comes, once the input below exists
  drawn: () => input.drawn(),
})

/** The input line and its keys; a reply shows on the stage, the conversation's part of the screen. */
const input = new Input({
  screen,
  session,
  state: () => state,
  answering,
  commands: new CommandMenu(() => state.commands),
  quit,
  stage: { screen, status, answered: () => answering.answered(), fileTools: FILE_TOOLS },
})

// The screen

function buildView(): Element {
  return viewOf(
    {
      model: state.model,
      thinking: state.thinking,
      fast: state.fast,
      root: WORKSPACE,
      editing: input.editing,
      menu: input.menu,
      replying: state.replying,
      asking: answering.open,
      queued: state.queued,
      usage: describeUsage(state.usage),
      status: status.describe(),
      view: screen.view,
      below: screen.below,
      mode: state.mode,
      auto: state.mode !== 'ask',
      allowed: state.allowed,
    },
    screen.content,
  )
}

// What the session does

/** Its events: a reply drawn as it streams, the questions asked, what its commands say, and its state. */
function take(e: ClientEvent): void {
  switch (e.type) {
    case 'run':
      input.take(e.event)
      return
    case 'reply_end':
      input.ended(e)
      return
    case 'ask':
      answering.ask(e)
      return
    case 'ask_closed':
      answering.closed(e.id)
      return
    case 'state': {
      const switched = e.state.mode !== state.mode
      state = e.state
      if (switched) {
        answering.modeChanged()
      }
      screen.draw()
      return
    }
    case 'notice':
      // After what the reply showed before it
      void input.drawn().then(() => log[e.level](e.text))
      return
    case 'help':
      void input.drawn().then(() => showHelp(e.sections))
  }
}

// Starting and quitting

async function openSessionOrQuit(): Promise<{ session: SessionClient; started: ServiceState }> {
  try {
    const session = await SessionClient.create(await startService(), {
      root: ROOT,
      model: ARGS.model ?? `deepseek/${process.env.DEEPSEEK_MODEL ?? 'deepseek-flash'}`,
      env: process.env,
    })
    // The service's mode is for every session, the desktop app's: the terminal's is its own
    let started = await session.setMode(ARGS.yolo ? 'yolo' : 'ask')
    const level = process.env.DEEPSEEK_THINKING
    if (level !== undefined && level !== '') {
      started = await session.think(level)
    }
    return { session, started }
  } catch (error) {
    cancel(errorMessage(error))
    process.exit(1)
  }
}

// Ctrl+C reaches the keypress listener as a key; the SIGINT comes from a question's prompt, which passes it on
process.on('SIGINT', () => {
  if (!state.replying) {
    process.exit(130)
  }
  session.stop().catch((error: unknown) => log.error(errorMessage(error)))
})

// Added before any question's listener, so the question redraws after a mode switch and shows the new mode
screen.keys.on('keypress', input.onKey)

screen.start()

const toolCount = state.tools.length === 1 ? '1 tool' : `${state.tools.length} tools`
const welcome = `${dimText(`${toolCount} ·`)} ${formatKeyHint('/help', 'lists keys, commands and tools')}`
log.message(welcome, { spacing: 0 })

const listening = new AbortController()
const listened = session.listen(take, listening.signal, {
  dropped: error => log.warn(`Lost the connection to the service (${errorMessage(error)}): connecting again…`),
  restored: () => log.success('Connected to the service again.'),
})

await quitting
if (state.replying) {
  await session.stop().catch(() => {})
}
listening.abort()
await listened
input.close()
await input.settled()

await screen.settled()
screen.stop()
log.message(`Session: ${session.id}\n${summarizeUsage(state.usage)}`)
outro('Bye')
