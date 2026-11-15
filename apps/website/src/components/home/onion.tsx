import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '~/lib/utils'

function Layer({ name, preset = false, children }: { name: string; preset?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-sm border p-3 pt-2 sm:p-4 sm:pt-2.5',
        preset ? 'border-dashed border-ink-4' : 'border-paper-faint/50',
      )}
    >
      <p className={cn('mb-2 font-mono text-[0.8125rem]', preset ? 'text-paper-faint' : 'text-paper-dim')}>
        {name}
        {preset && <span className="font-sans"> · preset</span>}
      </p>
      {children}
    </div>
  )
}

const inward = ['lowTemperature', 'trimOutput', 'blockShell', 'model']

function Order({ label, steps }: { label: string; steps: readonly string[] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.8125rem] text-paper-dim">
      <span className="w-9 font-sans text-paper-faint">{label}</span>
      {steps.map((step, index) => (
        <span key={step} className="flex items-center gap-2">
          {index > 0 && <ArrowRight aria-hidden className="size-3.5 text-paper-faint" />}
          {step}
        </span>
      ))}
    </p>
  )
}

/** How `[lowTemperature, [trimOutput, blockShell]]` wraps a call on one hook. */
export function Onion() {
  return (
    <figure>
      <Layer name="lowTemperature">
        <Layer name="toolPlugins" preset>
          <Layer name="trimOutput">
            <Layer name="blockShell">
              <div className="grid place-items-center rounded-sm bg-paper px-4 py-5 font-mono text-[0.875rem] text-ink-1">
                model · tool
              </div>
            </Layer>
          </Layer>
        </Layer>
      </Layer>
      <figcaption className="mt-5 grid gap-2">
        <Order label="in" steps={inward} />
        <Order label="out" steps={inward.toReversed()} />
      </figcaption>
    </figure>
  )
}
