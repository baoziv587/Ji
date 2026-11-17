import type { CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { CopyButton } from '~/components/home/copy-button'
import { HeroCode } from '~/components/home/hero-code'
import { links } from '~/content/home'
import { gutter } from '~/lib/layout'
import { cn } from '~/lib/utils'

const step = (i: number) => ({ '--i': i }) as CSSProperties

const install = 'npm i @ji.dev/llm@alpha'

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className={cn(gutter, 'pb-[clamp(3rem,6vw,4.5rem)] pt-[clamp(3rem,7vw,5.5rem)]')}
    >
      <div className="grid gap-12 xl:grid-cols-2 xl:gap-16">
        <div className="max-w-[40rem]">
          <h1
            id="hero-title"
            className="rise text-[clamp(2.25rem,3.6vw,3.5rem)] font-bold leading-[1.02] tracking-[-0.035em] text-balance"
            style={step(1)}
          >
            {/* One sentence per line: the promise, then what comes after it */}
            <span className="block">Write an agent in ten lines.</span>{' '}
            <span className="block">Grow it with plugins.</span>
          </h1>

          <p className="rise mt-6 max-w-[34rem] text-xl leading-relaxed text-pretty text-paper-dim" style={step(2)}>
            Any model from any provider, streaming by default. Hand work to a subagent and watch each step it takes. Add
            plugins when you need more; the core stays small.
          </p>

          <div className="rise mt-9 flex flex-wrap items-center gap-x-8 gap-y-5" style={step(3)}>
            <Link
              to="/docs"
              className="inline-flex h-12 items-center gap-2 rounded-sm bg-paper px-6 font-semibold text-ink-1 transition-colors hover:bg-paper/85"
            >
              Get started
              <ArrowRight aria-hidden className="size-4" />
            </Link>
            <a
              href={links.repo}
              className="inline-flex h-12 items-center gap-1.5 text-paper underline decoration-ink-4 underline-offset-[0.35em] transition-[text-decoration-color] hover:decoration-paper"
            >
              Source on GitHub
              <ArrowUpRight aria-hidden className="size-4 text-paper-faint" />
            </a>
          </div>

          <div
            className="rise mt-8 flex max-w-[26rem] items-center justify-between rounded-md bg-ink-0 py-1 pl-5 pr-1 ring-1 ring-ink-3/60"
            style={step(4)}
          >
            <code className="font-mono text-[0.875rem] text-paper">
              <span aria-hidden className="mr-3 select-none text-paper-faint">
                $
              </span>
              {install}
            </code>
            <CopyButton text={install} label="Copy the install command" />
          </div>

          <p className="rise mt-6 text-[0.8125rem] text-paper-faint" style={step(5)}>
            Alpha. APIs may change before 1.0.
          </p>
        </div>

        <HeroCode />
      </div>
    </section>
  )
}
