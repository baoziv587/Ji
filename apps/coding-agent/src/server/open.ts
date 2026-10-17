// What a session is opened with: the model it ran on last, the terminal's tools working in the session's folder, its
// own permissions, the terminal's commands, /login and the skills' too, talking to the client, and the jsonl plugin writing every run event
// to the session's log, which is what it is read back from next time.

import type { Api, Model, ThinkingLevel } from '@ji.dev/llm'
import type { Plugins, StartOptions } from '../agent/agent.ts'
import type { Feature } from '../features/feature.ts'
import type { Mode } from '../features/permissions.ts'
import type { CommandClient } from './service.ts'
import type { Opener } from './sessions.ts'
import type { SessionMeta, SessionStore } from './store.ts'
import { findModel, nearestThinking } from '@ji.dev/llm'
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

  /** Opens a session in a mode: what waits for a yes in it from the start. */
  open(meta: SessionMeta, mode: Mode): AgentService {
    const { id, root } = meta
    const { store } = this.options
    const workspace = localWorkspace(root, { allow: () => true })
    const plugins = createPlugins(workspace, createLocalExecutor({ cwd: root }))
    const permissions = new Permissions(workspace, plugins.files, plugins.shell, { mode })

    return new AgentService({
      id,
      root,
      permissions,
      features: client => this.featuresOf(id, plugins, permissions, client),
      start: (asking, features) => ({ root, features, asking, ...this.modelOf(meta) }),
      history: historyOf(store.records(id)),
      shared: {
        lock: () => store.lock(id),
        unlock: () => store.unlock(id),
        unread: () => store.unread(id),
        history: () => historyOf(store.records(id)).state,
      },
    })
  }

  /**
   * The model the session ran on last, at the default's thinking or the nearest it takes; the default when it has none,
   * or one the catalog no longer has.
   */
  private modelOf({ model: spec }: SessionMeta): Pick<StartOptions, 'model' | 'thinking'> {
    const { model, thinking } = this.options
    if (spec === undefined) {
      return { model, thinking }
    }

    try {
      const found = findModel(spec)
      return { model: found, thinking: nearestThinking(found, thinking) }
    } catch {
      return { model, thinking }
    }
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
