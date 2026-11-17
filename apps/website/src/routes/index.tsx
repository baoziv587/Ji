import { createFileRoute } from '@tanstack/react-router'
import { CodePrint } from '~/components/home/code-print'
import { CopyButton } from '~/components/home/copy-button'
import { Hero } from '~/components/home/hero'
import { HookModel } from '~/components/home/hook-model'
import { Onion } from '~/components/home/onion'
import { C, DocLink, ExternalLink, Heading, Section } from '~/components/home/primitives'
import { SiteFooter } from '~/components/home/site-footer'
import { SiteHeader } from '~/components/site-header'
import { capabilities, compactionNotes, links, subagentNotes } from '~/content/home'
import compactionHtml from '~/snippets/compaction.ts?highlight'
import composeHtml from '~/snippets/compose.ts?highlight'
import quickstartHtml from '~/snippets/quickstart.sh?highlight'
import quickstart from '~/snippets/quickstart.sh?raw'
import subagentHtml from '~/snippets/subagent.ts?highlight'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />

        <div id="hooks" className="scroll-mt-4 border-y border-ink-3 bg-ink-2">
          <Section aria-labelledby="hooks-title">
            <Heading id="hooks-title" title="One hook model, three ways to intervene.">
              <p className="text-xl leading-snug text-paper">The hook chooses where; the helper chooses how.</p>
            </Heading>
            <HookModel />
            <p className="mt-12 max-w-[44rem] text-pretty text-paper-dim">
              All three work with <C>decide</C>, <C>request</C>, <C>toolCalls</C> and <C>toolCall</C>. For retries,
              sequential execution or custom events, write <C>(input, next, ctx)</C> and delegate with{' '}
              <C>yield* next(input)</C>.
            </p>
          </Section>
        </div>

        <Section aria-labelledby="subagents">
          <Heading id="subagents" title="Subagents report as they work.">
            <p>
              A subagent is a tool that runs another agent. Whatever the tool yields arrives in the lead’s run as a{' '}
              <C>tool_update</C>, so your UI shows each step while the subagent works; what it returns is the result. No
              callback, no separate event channel.
            </p>
          </Heading>
          <CodePrint html={subagentHtml} label="A subagent that reports its steps" notes={subagentNotes} />
          <p className="mt-8 max-w-[44rem] text-paper-dim">
            Any tool reports the same way: <C>yield</C> progress, <C>return</C> the result. Compose result trimming,
            call interception and <ExternalLink href={links.throttle}>progress throttling</ExternalLink> around it.
          </p>
        </Section>

        <Section aria-labelledby="compose">
          <Heading id="compose" title="Write plugins on their own. Compose them as lists.">
            <p>
              Each plugin does one job. Group plugins into presets and nest the presets. On the same hook the list wraps
              outside in: inputs flow forward, results return in reverse.
            </p>
            <p className="mt-4">
              <DocLink slug="plugins" hash="ordering">
                Composition order
              </DocLink>
            </p>
          </Heading>
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
            <CodePrint html={composeHtml} label="Composing plugins" />
            <Onion />
          </div>
        </Section>

        <Section aria-labelledby="middleware" className="pt-0">
          <Heading id="middleware" title="Complex behavior, same model.">
            <p>
              Compaction is a <C>decide</C> middleware: summarize with <C>complete</C>, then swap the history with{' '}
              <C>rewriteHistory</C>.
            </p>
          </Heading>
          <CodePrint html={compactionHtml} label="Compaction middleware" notes={compactionNotes} />
          <p className="mt-8">
            <ExternalLink href={links.compaction}>
              Full implementation, with token estimation and transcript helpers
            </ExternalLink>
          </p>
        </Section>

        <Section aria-labelledby="capabilities" className="pt-0">
          <Heading id="capabilities" title="More, ready to compose." />
          <dl className="border-t border-ink-3">
            {capabilities.map(row => (
              <div key={row.area} className="grid gap-2 border-b border-ink-3 py-5 md:grid-cols-2 md:gap-16">
                <dt className="font-semibold">{row.area}</dt>
                <dd className="flex flex-wrap gap-x-6 gap-y-2">
                  {row.items.map(item => (
                    <ExternalLink key={item.href} href={item.href}>
                      {item.label}
                    </ExternalLink>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <div className="border-t border-ink-3 bg-ink-2">
          <Section aria-labelledby="try" className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-x-10">
            <div className="max-w-[42rem]">
              <Heading id="try" title="Run it offline.">
                <p>
                  Needs Node 24 or later and pnpm. The demo talks to a scripted calculator, so no API key is needed.
                </p>
              </Heading>
              <CodePrint
                html={quickstartHtml}
                label="Quick start commands"
                toolbar={
                  <>
                    <span className="py-2 font-mono text-[0.8125rem] text-paper-faint">Terminal</span>
                    <CopyButton text={quickstart} />
                  </>
                }
              />
              <p className="mt-6 text-paper-dim">
                For a real model, set your provider’s API key and run <C>MODEL=provider/model pnpm demo</C>.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold">A coding agent in 2,000 lines.</h2>
              <p className="mt-4 text-pretty text-paper-dim">
                A tiny terminal coding agent built on JI. Small enough to read in an evening, useful enough to keep.
              </p>
              <p className="mt-6">
                <ExternalLink href={links.codingAgent}>Read the coding agent</ExternalLink>
              </p>
            </div>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
