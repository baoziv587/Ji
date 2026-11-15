// Names the snippets use without defining them on the page, typed from the real packages so every snippet compiles.
// Nothing here runs: the page shows each snippet from its `// @snippet` line on.
import type { AnyPlugin, Api, Message, Model, PluginList, Session } from '@ji.dev/llm'

export declare const model: Model<Api>
export declare const session: Session

// Plugins defined in other snippets (hook-before, hook-after, hook-intercept, compose)
export declare const lowTemperature: AnyPlugin
export declare const trimOutput: AnyPlugin
export declare const blockShell: AnyPlugin
export declare const toolPlugins: PluginList

/** Illustrative: renders messages as plain text for the summarizer. Not exported by any package. */
export declare function transcript(messages: Message[]): string
