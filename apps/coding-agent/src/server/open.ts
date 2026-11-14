// What a session is opened with: the model it ran on last, the terminal's tools working in the session's folder, its
// own permissions, the terminal's commands, /login and the skills' too, talking to the client, and the jsonl plugin writing every run event
// to the session's log, which is what it is read back from next time.

import type { Api, Model, ModelInfo, ThinkingLevel } from '@ji.dev/llm'
import type { Plugins, StartOptions } from '../agent/agent.ts'
import type { Feature } from '../features/feature.ts'
import type { Mode } from '../features/permissions.ts'
import type { CommandClient } from './service.ts'
import type { Environment, ModelChoice, Opener } from './sessions.ts'
import type { SessionMeta, SessionStore } from './store.ts'
import process from 'node:process'
import { findModel, modelInfo, nearestThinking, UnsupportedThinkingError } from '@ji.dev/llm'
import { localWorkspace } from '@ji.dev/plugin-files'
import { jsonl } from '@ji.dev/plugin-jsonl'
import { createLocalExecutor } from '@ji.dev/plugin-shell'
import { errorMessage } from '@ji.dev/utils'
import { createPlugins } from '../agent/agent.ts'
import { createAuthFeature } from '../features/auth.ts'
import { Permissions } from '../features/permissions.ts'
import { createSkillsFeature } from '../features/skills.ts'
import { historyOf } from './history.ts'
import { AgentService } from './service.ts'

export interface SessionOpenerOptions {
  store: SessionStore
  /** 'provider/id' from pi-ai's catalog, or a pi-ai Model for a custom endpoint. */
  model: string | Model<Api>
  thinking: ThinkingLevel
  /** The folder of skills the model is told about, each a command; none without it. */
  skills?: string
  /** Where /login keeps what it is given, as the terminal does: ~/.ji. No /login without it. */
  auth?: string
}

export class SessionOpener implements Opener {
  private readonly options: SessionOpenerOptions

  constructor(options: SessionOpenerOptions) {
    this.options = options
  }

  /**
   * Opens a session in a mode: what waits for a yes in it from the start. Its commands run with `env` when given, and
   * the keys in it stand for the models' too where this process has none.
   */
  open(meta: SessionMeta, mode: Mode, env?: Environment): AgentService {
    const { id, root } = meta
    const { store } = this.options
    if (env !== undefined) {
      adoptCredentials(env)
    }
    const workspace = localWorkspace(root, { allow: () => true })
    const plugins = createPlugins(workspace, createLocalExecutor({ cwd: root, env }))
    const permissions = new Permissions(workspace, plugins.files, plugins.shell, { mode })

    return new AgentService({
      id,
      root,
      permissions,
      features: client => this.featuresOf(id, plugins, permissions, client),
      start: (asking, features) => ({ root, features, asking, ...this.modelOf(meta) }),
      history: historyOf(store.records(id)),
    })
  }

  /**
   * Throws UnknownModelError for a model the catalog does not have, and UnsupportedThinkingError for a level the model
   * does not take.
   */
  startsOn(spec?: string, level?: string): ModelChoice {
    const model = spec === undefined ? this.defaultModel() : findModel(spec)
    const thinking = level === undefined ? nearestThinking(model, this.options.thinking) : level
    const found = model.thinkingLevels.find(l => l === thinking)
    if (found === undefined) {
      throw new UnsupportedThinkingError(model, thinking)
    }
    return { model: `${model.provider}/${model.id}`, thinking: found, thinkingLevels: [...model.thinkingLevels] }
  }

  private defaultModel(): ModelInfo {
    const { model } = this.options
    return typeof model === 'string' ? findModel(model) : modelInfo(model)
  }

  /**
   * The model the session ran on last, at its thinking or the nearest the model takes; the default when it has none,
   * or one the catalog no longer has.
   */
  private modelOf({ model: spec, thinking: level }: SessionMeta): Pick<StartOptions, 'model' | 'thinking'> {
    const thinking = level ?? this.options.thinking
    if (spec !== undefined) {
      try {
        const found = findModel(spec)
        return { model: found, thinking: nearestThinking(found, thinking) }
      } catch {
        // Gone from the catalog: the default's
      }
    }
    return { model: this.options.model, thinking: nearestThinking(this.defaultModel(), thinking) }
  }

  /** As in the terminal, and the log written to the store. */
  private featuresOf(id: string, plugins: Plugins, permissions: Permissions, client: CommandClient): Feature[] {
    const { store, skills, auth } = this.options
    const { say, interaction, changed } = client
    const features: Feature[] = [
      { plugin: plugins.shell, approve: permissions.commandCalls },
      { plugin: plugins.search },
      { plugin: plugins.files, approve: permissions.fileCalls },
    ]

    if (skills !== undefined) {
      const feature = createSkillsFeature(skills, say)
      // The skills are commands once they are read
      feature.plugin.loading.then(changed, (error: unknown) => say.warn(`Skills: ${errorMessage(error)}`))
      features.push(feature)
    }
    if (auth !== undefined) {
      features.push(createAuthFeature(auth, interaction, say))
    }

    features.push({ plugin: jsonl(line => store.append(id, line)) })
    return features
  }
}

/** The variables a provider's key or token is read from, by their names. */
const CREDENTIAL = /_API_KEY$|_TOKEN$|^AWS_/

/**
 * The keys in a terminal's environment that this process has none of, taken as its own: a model reads its key from
 * this process's environment, and the terminal's is where a person exports one. A key this process has stays.
 */
function adoptCredentials(env: Environment): void {
  for (const [name, value] of Object.entries(env)) {
    if (CREDENTIAL.test(name) && value !== undefined && process.env[name] === undefined) {
      process.env[name] = value
    }
  }
}
