import { Moon, Sun } from 'lucide-react'
import { currentTheme, setTheme } from '~/lib/theme'
import { cn } from '~/lib/utils'

/**
 * Both icons render and CSS shows the one for the other theme, so the server
 * markup never depends on the viewer's theme and hydration always matches.
 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => setTheme(currentTheme() === 'light' ? 'dark' : 'light')}
      aria-label="Switch between light and dark theme"
      className={cn(
        'grid size-10 place-items-center rounded-sm text-paper-dim transition-colors hover:bg-ink-2 hover:text-paper',
        className,
      )}
    >
      <Sun aria-hidden className="dark-only size-4" />
      <Moon aria-hidden className="light-only size-4" />
    </button>
  )
}
