// What the host runtime offers, read without assuming Node: in a browser there is no `process`.

/** True only when NODE_ENV is development or test; any other value, or none at all, is false. */
export function isDevEnv(): boolean {
  const env = nodeProcess()?.env?.NODE_ENV
  return env === 'development' || env === 'test'
}

/** process.emitWarning in Node; console.error where there is no process (browsers). */
export function warn(message: string, type: string): void {
  const node = nodeProcess()
  if (typeof node?.emitWarning === 'function') {
    node.emitWarning(message, type)
  } else {
    console.error(`${type}: ${message}`)
  }
}

interface NodeProcess {
  env?: Record<string, string | undefined>
  emitWarning?: (message: string, type: string) => void
}

function nodeProcess(): NodeProcess | undefined {
  return Reflect.get(globalThis, 'process') as NodeProcess | undefined
}
