import { createAgent } from '@ji.dev/llm'
import { blockShell, lowTemperature, model, trimOutput } from './context.ts'
// @snippet
const toolPlugins = [trimOutput, blockShell]
const plugins = [lowTemperature, toolPlugins]

const agent = createAgent({ model, plugins })
