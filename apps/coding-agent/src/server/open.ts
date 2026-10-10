// What a session is opened with: the terminal's tools working in the session's folder, its own permissions, and the
// jsonl plugin writing every run event to the session's log, which is what it is read back from next time.

import type { Api, Model, ThinkingLevel } from '@ji.dev/llm'
import type { Feature } from '../features/feature.ts'
import type { AgentService } from './service.ts'
import type { SessionMeta, SessionStore } from './store.ts'
import { localWorkspace } from '@ji.dev/plugin-files'
import { jsonl } from '@ji.dev/plugin-jsonl'
import { createLocalExecutor } from '@ji.dev/plugin-shell'
import { createSkillsPlugin } from '@ji.dev/plugin-skills'
import { createPlugins, startAgent } from '../agent/agent.ts'
import { Permissions } from '../features/permissions.ts'
import { historyOf } from './history.ts'
import { createAgentService } from './service.ts'

export interface SessionOpenerOptions {
  store: SessionStore
  /** 'provider/id' from pi-ai's catalog, or a pi-ai Model for a custom endpoint. */
  model: string | Model<Api>
  thinking: ThinkingLevel
  /** The folder of skills the model is told about; none without it. */
  skills?: string
  /** Nothing waits for a yes, in any session. */
  yolo?: boolean
}

export function createSessionOpener(options: SessionOpenerOptions): (meta: SessionMeta) => AgentService {
  const { store, model, thinking, skills, yolo = false } = options
  return ({ id, root }) => {
    const workspace = localWorkspace(root, { allow: () => true })
    const plugins = createPlugins(workspace, createLocalExecutor({ cwd: root }))
    const permissions = new Permissions(workspace, plugins.files, plugins.shell, { yolo })

    // As in the terminal, less what only a terminal shows: /login, and the skills' slash commands
    const features: Feature[] = [
      { plugin: plugins.shell, approve: permissions.commandCalls },
      { plugin: plugins.search },
      { plugin: plugins.files, approve: permissions.fileCalls },
    ]
    if (skills !== undefined) {
      features.push({ plugin: createSkillsPlugin(skills) })
    }
    features.push({ plugin: jsonl(line => store.append(id, line)) })

    return createAgentService({
      id,
      root,
      permissions,
      features,
      start: asking => startAgent({ root, model, thinking, features, asking }),
      history: historyOf(store.records(id)),
    })
  }
}
