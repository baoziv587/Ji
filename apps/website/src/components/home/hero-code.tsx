import type { CSSProperties, KeyboardEvent } from 'react'
import { ArrowDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { CodePrint } from '~/components/home/code-print'
import { useTabHopper } from '~/components/home/use-tab-hopper'
import { headerMarkOf } from '~/lib/marks'
import { cn } from '~/lib/utils'
import chatHtml from '~/snippets/hero-chat.ts?highlight'
import guardrailHtml from '~/snippets/hero-guardrail.ts?highlight'
import subagentHtml from '~/snippets/hero-subagent.ts?highlight'

type SceneId = 'chat' | 'subagent' | 'guardrail'

const scenes: readonly { id: SceneId; label: string; file: string; html: string; caption: string }[] = [
  { id: 'chat', label: 'Chat', file: 'chat.ts', html: chatHtml, caption: 'An agent that streams its reply' },
  {
    id: 'subagent',
    label: 'Subagent',
    file: 'research.ts',
    html: subagentHtml,
    caption: 'A subagent run as a tool, reporting each step',
  },
  {
    id: 'guardrail',
    label: 'Guardrail',
    file: 'block-shell.ts',
    html: guardrailHtml,
    caption: 'A plugin that blocks shell tool calls',
  },
]

// Without JavaScript the tabs cannot switch: unstack the panels so every one shows, and hide the rail.
const noScriptCss =
  '[data-scene-panel]{visibility:visible!important;grid-area:auto!important}[data-scene-tabs]{display:none}'

/**
 * The hero's code: three things people write first, one well. The panels share one grid cell, so the well keeps the
 * height of the longest and the page never jumps on a switch. A small JI stands on the selected tab's word and, every
 * few seconds, hops to the next one; the tab switches as it lands (./use-tab-hopper.ts, ./hop.ts).
 */
export function HeroCode({ className }: { className?: string }) {
  const [active, setActive] = useState<SceneId>('chat')
  const tabsRef = useRef(new Map<SceneId, HTMLButtonElement>())
  const rootRef = useRef<HTMLDivElement>(null)
  const wordsRef = useRef<Array<HTMLSpanElement | null>>([])
  const { stage, rig, pick } = useTabHopper({
    root: rootRef,
    words: wordsRef,
    onLand: index => setActive(scenes[index]!.id),
  })

  /** A person chose: switch now, and the JI follows. */
  function choose(index: number) {
    setActive(scenes[index]!.id)
    pick(index)
  }

  function select(index: number) {
    const at = index % scenes.length
    choose(at)
    tabsRef.current.get(scenes[at]!.id)?.focus()
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1 + scenes.length,
      Home: 0,
      End: scenes.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(next)
  }

  return (
    <div ref={rootRef} className={cn('min-w-0', className)}>
      {/* The tabs rise with the text; the JI drops in after them */}
      <div ref={stage} className="rise relative" style={{ '--i': 2 } as CSSProperties}>
        <div role="tablist" aria-label="Examples" data-scene-tabs className="flex gap-x-6 border-b border-ink-3">
          {scenes.map((scene, index) => {
            const selected = scene.id === active
            return (
              <button
                key={scene.id}
                ref={node => {
                  if (node) tabsRef.current.set(scene.id, node)
                }}
                type="button"
                role="tab"
                id={`scene-tab-${scene.id}`}
                aria-selected={selected}
                aria-controls={`scene-panel-${scene.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(index)}
                onKeyDown={event => onKeyDown(event, index)}
                // A tab, not a hook: the selected state is paper, like the Docs tab, never qinglv
                className={cn(
                  '-mb-px h-11 border-b-2 text-[0.9375rem] transition-colors duration-200 focus-visible:-outline-offset-2',
                  selected
                    ? 'border-paper font-semibold text-paper'
                    : 'border-transparent text-paper-dim hover:border-ink-4 hover:text-paper',
                )}
              >
                {/* The word the JI stands on: inline-block so it can be squashed from its baseline */}
                <span
                  ref={node => {
                    wordsRef.current[index] = node
                  }}
                  className="inline-block origin-bottom leading-none"
                >
                  {scene.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Hidden until it drops in; without JavaScript the rail is hidden and so is it */}
        <span ref={rig.x} aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0">
          <span ref={rig.y} className="block origin-bottom">
            <span ref={rig.face} className="block">
              <span ref={rig.body} className="block h-7 w-[22.75px] origin-bottom">
                <img className="dark-only size-full" src={headerMarkOf('paper')} width={65} height={80} alt="" />
                <img className="light-only size-full" src={headerMarkOf('charcoal')} width={65} height={80} alt="" />
              </span>
            </span>
          </span>
        </span>
      </div>

      {/* Only the code soaks in: a mask clips everything outside its box, and the JI stands above the tabs */}
      <div className="soak mt-6 grid">
        {scenes.map(scene => {
          const selected = scene.id === active
          return (
            <div
              key={scene.id}
              role="tabpanel"
              id={`scene-panel-${scene.id}`}
              aria-labelledby={`scene-tab-${scene.id}`}
              data-scene-panel
              // Hidden panels keep their size so the cell fits the longest; visibility also takes them out of focus
              // order and the accessibility tree
              className={cn(
                'col-start-1 row-start-1 min-w-0',
                selected ? 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150' : 'invisible',
              )}
            >
              <CodePrint
                html={scene.html}
                label={scene.caption}
                toolbar={<span className="py-2 font-mono text-[0.8125rem] text-paper-faint">{scene.file}</span>}
                className="max-sm:[&_pre]:text-[0.8125rem]!"
              />
              {scene.id === 'guardrail' && (
                <a
                  href="#hooks"
                  className="mt-5 inline-flex items-center gap-1.5 text-[0.9375rem] text-paper underline decoration-ink-4 underline-offset-[0.3em] transition-[text-decoration-color] hover:decoration-paper"
                >
                  How hooks work
                  <ArrowDown aria-hidden className="size-3.5 text-paper-faint" />
                </a>
              )}
            </div>
          )
        })}
      </div>

      <noscript>
        <style>{noScriptCss}</style>
      </noscript>
    </div>
  )
}
