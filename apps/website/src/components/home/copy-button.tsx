import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { cn } from '~/lib/utils'

type Status = 'idle' | 'copied' | 'failed'

const messages: Record<Status, string> = {
  idle: '',
  copied: 'Copied',
  failed: 'Copy blocked. Select the commands instead.',
}

interface CopyButtonProps {
  text: string
  /** What the button copies, as a screen reader announces it. */
  label?: string
  className?: string
}

export function CopyButton({ text, label = 'Copy commands', className }: CopyButtonProps) {
  const [status, setStatus] = useState<Status>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
    setTimeout(setStatus, 2400, 'idle')
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span role="status" className="text-[0.8125rem] text-paper-dim">
        {messages[status]}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="grid size-10 place-items-center rounded-sm text-paper-dim transition-colors hover:bg-ink-2 hover:text-paper"
      >
        {status === 'copied' ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      </button>
    </div>
  )
}
