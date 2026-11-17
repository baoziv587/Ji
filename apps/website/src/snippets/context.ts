// Names the snippets use without defining them on the page, typed from the real packages so every snippet compiles.
// Nothing here runs: the page shows each snippet from its `// @snippet` line on.
import type { Agent, AgentTool, AnyPlugin, Api, Message, Model } from '@ji.dev/llm'

export declare const model: Model<Api>
export declare const task: string

// Plugins defined in other snippets (hook-before, hook-after, hook-intercept, compose)
export declare const lowTemperature: AnyPlugin
export declare const trimOutput: AnyPlugin
export declare const blockShell: AnyPlugin

// The subagent snippets: the researcher's tools, and the agent the hero hands questions to
export declare const search: AgentTool
export declare const fetchPage: AgentTool
export declare const researcher: Agent

/** Illustrative: the app's own progress display. Not exported by any package. */
export declare const ui: { progress: (callId: string, data: unknown) => void }

/** Illustrative: renders messages as plain text for the summarizer. Not exported by any package. */
export declare function transcript(messages: Message[]): string
