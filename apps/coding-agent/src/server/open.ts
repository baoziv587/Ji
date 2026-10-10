// What a session is opened with: the terminal's tools working in the session's folder, its own permissions, the
// terminal's commands, /login and the skills' too, talking to the client, and the jsonl plugin writing every run event
// to the session's log, which is what it is read back from next time.

import type { Api, Model, ThinkingLevel } from '@ji.dev/llm'
import type { Feature } from '../features/feature.ts'
import type { AgentService } from './service.ts'
import type { SessionMeta, SessionStore } from './store.ts'
import { localWorkspace } from '@ji.dev/plugin-files'
import { jsonl } from '@ji.dev/plugin-jsonl'
import { createLocalExecutor } from '@ji.dev/plugin-shell'
import { createPlugins, startAgent } from '../agent/agent.ts'
import { createAuthFeature } from '../features/auth.ts'
import { Permissions } from '../features/permissions.ts'
import { createSkillsFeature } from '../features/skills.ts'
import { historyOf } from './history.ts'
import { createAgentService } from './service.ts'

export interface SessionOpenerOptions {
  store: SessionStore
  /** 'provider/id' from pi-ai's catalog, or a pi-ai Model for a custom endpoint. */
  model: string | Model<Api>
  thinking: ThinkingLevel
  /** The folder of skills the model is told about, each a command; none without it. */
  skills?: string
  /** Where /login keeps what it is given, as the terminal does: ~/.ji. No /login without it. */
  auth?: string
  /** Nothing waits for a yes, in any session. */
  yolo?: boolean
}

export function createSessionOpener(options: SessionOpenerOptions): (meta: SessionMeta) => AgentService {
  const { store, model, thinking, skills, auth, yolo = false } = options
  return ({ id, root }) => {
    const workspace = localWorkspace(root, { allow: () => true })
    const plugins = createPlugins(workspace, createLocalExecutor({ cwd: root }))
    const permissions = new Permissions(workspace, plugins.files, plugins.shell, { yolo })

    return createAgentService({
      id,
      root,
      permissions,
      // As in the terminal
      features: ({ say, interaction, changed }) => {
        const features: Feature[] = [
          { plugin: plugins.shell, approve: permissions.commandCalls },
          { plugin: plugins.search },
          { plugin: plugins.files, approve: permissions.fileCalls },
        ]

        if (skills !== undefined) {
          const feature = createSkillsFeature(skills, say)
          // The skills are commands once they are read
          feature.plugin.loading.then(changed, (error: unknown) => {
            say.warn(`Skills: ${error instanceof Error ? error.message : String(error)}`)
          })
          features.push(feature)
        }
        if (auth !== undefined) {
          features.push(createAuthFeature(auth, interaction, say))
        }

        features.push({ plugin: jsonl(line => store.append(id, line)) })
        return features
      },
      start: (asking, features) => startAgent({ root, model, thinking, features, asking }),
      history: historyOf(store.records(id)),
    })
  }
}
