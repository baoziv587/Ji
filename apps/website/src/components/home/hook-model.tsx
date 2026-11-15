import type { KeyboardEvent } from 'react'
import type { HookId } from '~/content/home'
import { useRef, useState } from 'react'
import { CodePrint } from '~/components/home/code-print'
import { HookDiagram } from '~/components/home/hook-diagram'
import { hooks } from '~/content/home'
import { cn } from '~/lib/utils'
import afterHtml from '~/snippets/hook-after.ts?highlight'
import beforeHtml from '~/snippets/hook-before.ts?highlight'
import interceptHtml from '~/snippets/hook-intercept.ts?highlight'

const snippets: Record<HookId, string> = { before: beforeHtml, after: afterHtml, intercept: interceptHtml }

// Without JavaScript the tabs cannot switch, so show every panel instead.
const noScriptCss = '[data-hook-panel][hidden]{display:block}[data-hook-tabs]{display:none}'

export function HookModel() {
  const [active, setActive] = useState<HookId>('before')
  const tabsRef = useRef(new Map<HookId, HTMLButtonElement>())

  function select(index: number) {
    const hook = hooks.at(index % hooks.length)!
    setActive(hook.id)
    tabsRef.current.get(hook.id)?.focus()
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1 + hooks.length,
      Home: 0,
      End: hooks.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(next)
  }

  return (
    <div>
      <HookDiagram active={active} />

      <div
        role="tablist"
        aria-label="Hook helpers"
        data-hook-tabs
        className="mt-10 grid grid-cols-3 border-b border-ink-3 md:mt-12"
      >
        {hooks.map((hook, index) => {
          const selected = hook.id === active
          return (
            <button
              key={hook.id}
              ref={node => {
                if (node) tabsRef.current.set(hook.id, node)
              }}
              type="button"
              role="tab"
              id={`hook-tab-${hook.id}`}
              aria-selected={selected}
              aria-controls={`hook-panel-${hook.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(hook.id)}
              onKeyDown={event => onKeyDown(event, index)}
              className={cn(
                '-mb-px flex min-h-14 flex-col items-start justify-center border-b-2 pb-3 pt-2 text-left transition-colors duration-200 focus-visible:-outline-offset-2',
                selected ? 'border-qinglv' : 'border-transparent hover:border-ink-4',
              )}
            >
              <span className={cn('font-mono text-base', selected ? 'text-qinglv' : 'text-paper')}>{hook.id}</span>
              <span className="text-sm text-paper-faint">{hook.effect}</span>
            </button>
          )
        })}
      </div>

      {hooks.map(hook => (
        <div
          key={hook.id}
          role="tabpanel"
          id={`hook-panel-${hook.id}`}
          aria-labelledby={`hook-tab-${hook.id}`}
          hidden={hook.id !== active}
          data-hook-panel
          className="pt-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
        >
          <p className="mb-6 max-w-[40rem] text-paper-dim">{hook.detail}</p>
          <CodePrint html={snippets[hook.id]} label={`${hook.id} example`} />
        </div>
      ))}

      <noscript>
        <style>{noScriptCss}</style>
      </noscript>
    </div>
  )
}
