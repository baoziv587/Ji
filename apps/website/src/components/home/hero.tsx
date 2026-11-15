import type { CSSProperties } from 'react'
import { ArrowDown, ArrowUpRight } from 'lucide-react'
import { CodePrint } from '~/components/home/code-print'
import { Seal } from '~/components/seal'
import { ThemeToggle } from '~/components/theme-toggle'
import { links } from '~/content/home'
import { gutter } from '~/lib/layout'
import { cn } from '~/lib/utils'
import heroHtml from '~/snippets/hero.ts?highlight'

const step = (i: number) => ({ '--i': i }) as CSSProperties

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className={cn(gutter, 'pb-[clamp(1rem,2vw,2rem)] pt-[clamp(2rem,5vw,3.5rem)]')}
    >
      <div className="rise flex items-center justify-between" style={step(0)}>
        <Seal size={40} alt="JI" />
        <ThemeToggle className="-mr-2" />
      </div>

      <div className="mt-[clamp(3rem,7vw,5.5rem)] grid gap-12 xl:grid-cols-2 xl:gap-16">
        <div className="max-w-[40rem]">
          <h1
            id="hero-title"
            className="rise text-[clamp(2.25rem,3.6vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-balance"
            style={step(1)}
          >
            A small, extensible TypeScript runtime for LLM agents.
          </h1>

          <p className="rise mt-6 max-w-[34rem] text-lg text-pretty text-paper-dim" style={step(2)}>
            <span lang="zh-CN" className="text-paper">
              极
            </span>
            {' (jí) means the utmost, as in '}
            <span lang="zh-CN">极简</span>: minimal to the extreme. The core stays as small as it can be; plugins take
            it as far as you need.
          </p>

          <div className="rise mt-9 flex flex-wrap items-center gap-x-8 gap-y-5" style={step(3)}>
            <a
              href="#hooks"
              className="inline-flex h-12 items-center gap-2 rounded-sm bg-paper px-6 font-semibold text-ink-1 transition-colors hover:bg-paper/85"
            >
              Read the hook model
              <ArrowDown aria-hidden className="size-4" />
            </a>
            <a
              href={links.repo}
              className="inline-flex h-12 items-center gap-1.5 text-paper underline decoration-ink-4 underline-offset-[0.35em] transition-[text-decoration-color] hover:decoration-paper"
            >
              Source on GitHub
              <ArrowUpRight aria-hidden className="size-4 text-paper-faint" />
            </a>
          </div>

          <p className="rise mt-10 text-sm text-paper-faint" style={step(4)}>
            In development. APIs may change; packages are not on npm yet.
          </p>
        </div>

        <CodePrint
          html={heroHtml}
          label="A plugin that blocks shell tool calls"
          toolbar={<span className="py-2 font-mono text-[0.8125rem] text-paper-faint">block-shell.ts</span>}
          className="soak min-w-0 max-sm:[&_pre]:text-[0.8125rem]!"
        />
      </div>
    </section>
  )
}
