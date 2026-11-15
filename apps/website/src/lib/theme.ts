export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ji-theme'

/**
 * Runs in <head> before first paint, so the page never flashes the wrong ground.
 * A stored choice wins; otherwise the page follows the system and keeps following it.
 * Without JavaScript the page stays on the default ink (dark) theme.
 */
export const themeScript = `(() => {
  const root = document.documentElement
  const media = matchMedia('(prefers-color-scheme: light)')
  const stored = () => { try { return localStorage.getItem('${STORAGE_KEY}') } catch { return null } }
  const apply = () => {
    const choice = stored()
    root.dataset.theme = choice === 'light' || choice === 'dark' ? choice : media.matches ? 'light' : 'dark'
  }
  apply()
  media.addEventListener('change', apply)
})()`

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage can be blocked; the choice then lasts for this page view only.
  }
}

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
