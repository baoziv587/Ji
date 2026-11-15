import type { CSSProperties } from 'react'
import { colorways } from '~/lib/catalog'
import { cn } from '~/lib/utils'

/**
 * Each mark gets its own jump, so the row reads as six characters, not one copy-pasted
 * motion: `air` is the jump height (in logo heights), `tilt` the lean direction, and the
 * one with `turn` shows off with a full flip.
 */
const moves = [
  { air: 0.5, tilt: 1, turn: 0 },
  { air: 0.7, tilt: -1, turn: 0 },
  { air: 0.45, tilt: 1, turn: 0 },
  { air: 0.95, tilt: -1, turn: 1 },
  { air: 0.6, tilt: 1, turn: 0 },
  { air: 0.75, tilt: -1, turn: 0 },
] as const

/**
 * Paper white is drawn for ink and vanishes on paper; charcoal is the reverse. On the
 * site the two share the last place and the theme shows one (see .dark-only/.light-only).
 * The brand page is always paper, so it shows charcoal only.
 */
const inked = colorways.filter(colorway => colorway.id !== 'paper')
const paperMark = colorways.find(colorway => colorway.id === 'paper')!
const swapAt = inked.findIndex(colorway => colorway.id === 'charcoal')

function marksFor(ground: 'paper' | 'theme') {
  const row = inked.map((colorway, i) => ({ colorway, i, className: '' }))
  if (ground === 'paper') return row
  row[swapAt]!.className = 'light-only'
  return [...row, { colorway: paperMark, i: swapAt, className: 'dark-only' }]
}

/**
 * The JI marks hop in turn, left to right, then rest before the next round.
 * Squash and stretch, anticipation and a second small bounce are all CSS
 * keyframes (see .logo-hop in styles.css); under reduced motion the row stands still.
 */
export function LogoHop({
  ground = 'theme',
  lazy = false,
  className,
}: {
  /** `paper` for the warm-paper brand page; `theme` follows the site's ink or paper theme. */
  ground?: 'paper' | 'theme'
  lazy?: boolean
  className?: string
}) {
  return (
    <div
      className={cn('logo-hop', ground === 'theme' && 'logo-hop--theme', className)}
      role="img"
      aria-label="JI 标志的六种配色依次跳起、落地"
    >
      {marksFor(ground).map(({ colorway, i, className: shown }) => {
        const move = moves[i % moves.length]!
        const style = { '--i': i, '--air': move.air, '--tilt': move.tilt, '--turn': move.turn } as CSSProperties
        return (
          <div key={colorway.id} className={cn('logo-hop-cell', shown)} style={style}>
            <span className="logo-hop-shadow" aria-hidden />
            <span className="logo-hop-ring" aria-hidden />
            <div className="logo-hop-body">
              <img
                className="logo-hop-squash"
                src={colorway.thumbnail}
                width={234}
                height={288}
                alt=""
                loading={lazy ? 'lazy' : undefined}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
