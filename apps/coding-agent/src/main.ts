import type { Agent } from '@ji.dev/llm'
import type { Element } from '@ji.dev/tui'
import type { Feature } from './features/feature.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { cancel, log, outro } from '@clack/prompts'
import { UnknownModelError, UnsupportedThinkingError } from '@ji.dev/llm'
import { choices } from '@ji.dev/plugin-choices'
import { localWorkspace } from '@ji.dev/plugin-files'
import { createLocalExecutor } from '@ji.dev/plugin-shell'
import { abbreviateHomePath, dimText, formatKeyHint, Screen, Status } from '@ji.dev/tui'
import { contextLimitOf, createPlugins, startAgent, toolNamesOf } from './agent/agent.ts'
import { Conversation } from './agent/conversation.ts'
import { Permissions } from './features/permissions.ts'
import { createSkillsFeature } from './features/skills.ts'
import { Answering } from './ui/answering.ts'
import { viewOf } from './ui/bars.ts'
import { createCommandMenu } from './ui/commands.ts'
import { Input, MISSING_KEY } from './ui/input.ts'
import { Meter } from './ui/usage.ts'

// The parts

/** Where the command was run from: pnpm --filter starts the script in the package's own directory. */
const ROOT = process.env.INIT_CWD ?? process.cwd()

/** The root as the top bar shows it. */
const WORKSPACE = abbreviateHomePath(ROOT)

/** Where skills are kept, the same place Claude Code reads them from. */
const SKILLS = join(homedir(), '.agents', 'skills')

const { promise: quitting, resolve: quit } = Promise.withResolvers<void>()

/** The local machine: files anywhere on it, the permissions say which are asked about, and commands run in the root. */
const workspace = localWorkspace(ROOT, { allow: () => true })
const executor = createLocalExecutor({ cwd: ROOT })

const plugins = createPlugins(workspace, executor)

/** What waits for a yes; Shift+Tab switches its mode, at the prompt or at a question. */
const permissions = new Permissions(workspace, plugins.files, plugins.shell)

/** Read in the background: the screen comes up first, and the menu has them a moment later. */
const skills = createSkillsFeature(SKILLS)

/**
 * What the agent runs with: each plugin, and what the terminal asks before its calls. The shell's before the files
 * plugin: a command runs after the edits the model wrote before it. grep is read-only, so never asked about. The
 * skills are commands, one per folder, and a hook that hands the model their instructions.
 */
const features: Feature[] = [
  { plugin: plugins.shell, approve: permissions.commandCalls },
  { plugin: plugins.search },
  { plugin: plugins.files, approve: permissions.fileCalls },
  skills,
]

/** The bars around the conversation, built by buildView; stdout is the conversation between them. */
const screen = new Screen(buildView)

/** What the session has spent, on the line above the status. */
const meter = new Meter()

const status = new Status(() => screen.draw())

const answering = new Answering(screen, status, permissions)

/**
 * The model asks with ask_user; permissions say which calls wait for a yes (RFC-0007 §5). None of them knows about the
 * terminal: `answer` puts every question to the person.
 */
const asking = choices({ answer: answering.answer, approve: features.flatMap(f => f.approve ?? []) })

const conversation = new Conversation(startAgentOrQuit())

const TOOLS = toolNamesOf(features, asking)

const commands = createCommandMenu({
  conversation,
  tools: TOOLS,
  quit,
  extra: () => features.flatMap(f => f.commands ?? []),
})

/** The input line and its keys; a reply shows on the stage, the conversation's part of the screen. */
const input = new Input({
  screen,
  conversation,
  answering,
  commands,
  quit,
  stage: {
    screen,
    status,
    meter,
    answered: () => answering.answered(),
    fileTools: new Set(plugins.files.tools?.map(t => t.name)),
  },
})

// The screen

function buildView(): Element {
  const { model, thinking } = conversation.agent
  return viewOf(
    {
      model: `${model.provider}/${model.id}`,
      thinking,
      root: WORKSPACE,
      editing: input.editing,
      menu: input.menu,
      replying: conversation.replying,
      asking: answering.open,
      queued: conversation.queued,
      usage: meter.parts(contextLimitOf(model)),
      status: status.describe(),
      view: screen.view,
      below: screen.below,
      mode: permissions.describeMode(),
      auto: permissions.mode === 'auto',
      allowed: permissions.describeAllowed(),
    },
    screen.content,
  )
}

// Starting and quitting

/** A typo in the model or the level stops the coding agent before the first prompt, with the choices listed. */
function startAgentOrQuit(): Agent {
  try {
    return startAgent(ROOT, features, asking)
  } catch (error) {
    if (error instanceof UnknownModelError || error instanceof UnsupportedThinkingError) {
      cancel(error.message)
      process.exit(1)
    }
    throw error
  }
}

if (!Screen.isSupported()) {
  cancel('The coding agent draws a bar at the bottom of a terminal: run it in one.')
  process.exit(1)
}

// Ctrl+C reaches the keypress listener as a key; the SIGINT comes from a question's prompt, which passes it on
process.on('SIGINT', () => {
  if (!conversation.replying) {
    process.exit(130)
  }
  conversation.stop()
})

// Added before any question's listener, so the question redraws after a mode switch and shows the new mode
screen.keys.on('keypress', input.onKey)

screen.start()

// The menu reads the commands as it draws: once the skills are in, a draw shows them
skills.loading.then(
  () => screen.draw(),
  (error: unknown) => log.warn(`Skills: ${error instanceof Error ? error.message : String(error)}`),
)

const toolCount = TOOLS.length === 1 ? '1 tool' : `${TOOLS.length} tools`
const welcome = `${dimText(`${toolCount} ·`)} ${formatKeyHint('/help', 'lists keys, commands and tools')}`
log.message(welcome, { spacing: 0 })

// The key is only needed to send, so its absence is pointed out without blocking anything else
if (!conversation.agent.model.hasEnvKey) {
  log.warn(MISSING_KEY)
}

await quitting
conversation.stop()
await input.settled()

await screen.settled()
screen.stop()
log.message(`Session: ${conversation.id}\n${meter.summary()}`)
outro('Bye')
