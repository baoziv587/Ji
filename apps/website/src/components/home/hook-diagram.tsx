import type { HookId } from '~/content/home'
import { cn } from '~/lib/utils'

interface FrameProps {
  x: number
  y: number
  w: number
  h: number
  label: string
  caption?: string
  on?: boolean
  dim?: boolean
}

function Frame({ x, y, w, h, label, caption, on = false, dim = false }: FrameProps) {
  const cx = x + w / 2
  return (
    <g className={cn('transition-opacity duration-200', dim && 'opacity-35')}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        className={cn('fill-ink-1 transition-[stroke] duration-200', on ? 'stroke-qinglv' : 'stroke-ink-4')}
        strokeWidth={on ? 1.5 : 1}
      />
      <text
        x={cx}
        y={caption ? y + h / 2 - 3 : y + h / 2 + 5}
        textAnchor="middle"
        className={cn('font-mono text-[15px] transition-[fill] duration-200', on ? 'fill-qinglv' : 'fill-paper')}
      >
        {label}
      </text>
      {caption && (
        <text x={cx} y={y + h / 2 + 15} textAnchor="middle" className="fill-paper-faint font-sans text-[12px]">
          {caption}
        </text>
      )}
    </g>
  )
}

function Core({ x, y, w, h, dim }: { x: number; y: number; w: number; h: number; dim: boolean }) {
  return (
    <g className={cn('transition-opacity duration-200', dim && 'opacity-35')}>
      <rect x={x} y={y} width={w} height={h} rx={3} className="fill-ink-0 stroke-paper-faint" />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx={2} className="fill-none stroke-ink-4" />
      <text x={x + w / 2} y={y + h / 2 - 2} textAnchor="middle" className="fill-paper font-mono text-[15px]">
        model · tool
      </text>
      <text x={x + w / 2} y={y + h / 2 + 16} textAnchor="middle" className="fill-paper-faint font-mono text-[12px]">
        next(input)
      </text>
    </g>
  )
}

const line = (on: boolean) =>
  cn('fill-none transition-[stroke] duration-200', on ? 'stroke-qinglv' : 'stroke-paper-faint')
const width = (on: boolean) => (on ? 1.5 : 1)

/** Where each hook sits in a call. `intercept` answers without calling through. */
export function HookDiagram({ active }: { active: HookId }) {
  const before = active === 'before'
  const after = active === 'after'
  const intercept = active === 'intercept'
  const outward = after || intercept

  return (
    <>
      <svg viewBox="0 0 960 220" className="hidden w-full md:block" aria-hidden>
        <text x={8} y={159} className="fill-paper-dim font-mono text-[14px]">
          input
        </text>
        <path d="M58 154 H160" className={line(before)} strokeWidth={width(before)} />
        <path d="M330 154 H395" className={cn(line(false), intercept && 'opacity-35')} />
        <path d="M565 154 H630" className={cn(line(false), intercept && 'opacity-35')} />
        <path d="M800 154 H880" className={line(after)} strokeWidth={width(after)} />
        <path d="M872 148 L880 154 L872 160" className={line(outward)} strokeWidth={width(outward)} />
        <text x={890} y={159} className="fill-paper-dim font-mono text-[14px]">
          result
        </text>

        <path d="M110 154 V58 Q110 46 122 46 H160" className={line(intercept)} strokeWidth={width(intercept)} />
        <path
          d="M330 46 H838 Q850 46 850 58 V154"
          className={line(intercept)}
          strokeWidth={width(intercept)}
          strokeDasharray={intercept ? undefined : '3 5'}
        />

        <Frame x={160} y={16} w={170} h={60} label="intercept" caption="returns early" on={intercept} />
        <Frame x={160} y={124} w={170} h={60} label="before" caption="changes input" on={before} dim={intercept} />
        <Core x={395} y={116} w={170} h={76} dim={intercept} />
        <Frame x={630} y={124} w={170} h={60} label="after" caption="changes results" on={after} dim={intercept} />
      </svg>

      <svg viewBox="0 0 340 500" className="mx-auto w-full max-w-[22rem] md:hidden" aria-hidden>
        <text x={120} y={20} textAnchor="middle" className="fill-paper-dim font-mono text-[14px]">
          input
        </text>
        <path d="M120 30 V96" className={line(before)} strokeWidth={width(before)} />
        <path d="M120 156 V196" className={cn(line(false), intercept && 'opacity-35')} />
        <path d="M120 272 V312" className={cn(line(false), intercept && 'opacity-35')} />
        <path d="M120 372 V466" className={line(after)} strokeWidth={width(after)} />
        <path d="M114 458 L120 466 L126 458" className={line(outward)} strokeWidth={width(outward)} />
        <text x={120} y={488} textAnchor="middle" className="fill-paper-dim font-mono text-[14px]">
          result
        </text>

        <path d="M120 60 H268 Q280 60 280 72 V96" className={line(intercept)} strokeWidth={width(intercept)} />
        <path
          d="M280 156 V408 Q280 420 268 420 H120"
          className={line(intercept)}
          strokeWidth={width(intercept)}
          strokeDasharray={intercept ? undefined : '3 5'}
        />

        <Frame x={222} y={96} w={116} h={60} label="intercept" caption="returns early" on={intercept} />
        <Frame x={40} y={96} w={160} h={60} label="before" caption="changes input" on={before} dim={intercept} />
        <Core x={40} y={196} w={160} h={76} dim={intercept} />
        <Frame x={40} y={312} w={160} h={60} label="after" caption="changes results" on={after} dim={intercept} />
      </svg>
    </>
  )
}
