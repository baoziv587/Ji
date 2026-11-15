import { Link } from '@tanstack/react-router'
import { LogoHop } from '~/components/logo-hop'
import { Seal } from '~/components/seal'

export function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-[40rem] content-center gap-6 px-6">
      <Seal size={56} alt="" />
      <h1 className="text-4xl font-extrabold tracking-[-0.03em]">Nothing was carved here.</h1>
      <p className="text-paper-dim">The page you followed does not exist.</p>
      <Link to="/" className="text-paper underline decoration-ink-4 underline-offset-[0.3em] hover:decoration-paper">
        Back to ji.dev
      </Link>
      <LogoHop className="mt-4 justify-start [--logo-h:clamp(3rem,8vw,4.5rem)]" />
    </main>
  )
}
