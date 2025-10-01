import { createSignal } from 'solid-js'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'pagesonic:theme'

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  return 'dark'
}

const [theme, setThemeSignal] = createSignal<Theme>(readInitialTheme())

const applyThemeClass = (t: Theme) => {
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-light')
  root.classList.add(t === 'dark' ? 'theme-dark' : 'theme-light')
}

// Apply immediately on module load
try { applyThemeClass(theme()) } catch {}

export const useTheme = () => {
  const setTheme = (t: Theme) => {
    setThemeSignal(t)
    try { localStorage.setItem(THEME_KEY, t) } catch {}
    try { applyThemeClass(t) } catch {}
  }
  const toggleTheme = () => setTheme(theme() === 'dark' ? 'light' : 'dark')
  return {
    theme,
    setTheme,
    toggleTheme
  }
}
