// Development checks and warnings (RFC-0006 §8). They report misuse; none of them changes what a correct run does.
import { warn as emitWarning } from '@ji.dev/utils'

export type WarningType = 'ObserveWarning' | 'DeterminismWarning'

/** Only the warning types the agent documents. */
export function warn(message: string, type: WarningType): void {
  emitWarning(message, type)
}
