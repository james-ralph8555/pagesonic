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
  
  // Apply CSS custom properties for the theme
  if (t === 'light') {
    root.style.setProperty('--bg-primary', '#ffffff')
    root.style.setProperty('--bg-secondary', '#f8fafc')
    root.style.setProperty('--bg-tertiary', '#f1f5f9')
    root.style.setProperty('--text-primary', '#111111')
    root.style.setProperty('--text-secondary', '#374151')
    root.style.setProperty('--text-tertiary', '#6b7280')
    root.style.setProperty('--text-inverse', '#ffffff')
    root.style.setProperty('--glass-bg', 'rgba(0, 0, 0, 0.06)')
    root.style.setProperty('--glass-bg-strong', 'rgba(0, 0, 0, 0.08)')
    root.style.setProperty('--glass-bg-hover', 'rgba(0, 0, 0, 0.12)')
    root.style.setProperty('--glass-border', 'rgba(0, 0, 0, 0.12)')
    root.style.setProperty('--glass-border-strong', 'rgba(0, 0, 0, 0.2)')
    root.style.setProperty('--ambient-gradient-1', 'radial-gradient(1200px 600px at 50% -200px, rgba(0,0,0,0.05), rgba(0,0,0,0) 60%)')
    root.style.setProperty('--ambient-gradient-2', 'radial-gradient(800px 400px at 10% 10%, rgba(99,102,241,0.08), rgba(0,0,0,0) 60%)')
    root.style.setProperty('--ambient-gradient-3', 'radial-gradient(900px 450px at 90% 15%, rgba(236,72,153,0.06), rgba(0,0,0,0) 60%)')
    root.style.setProperty('--ambient-base', 'linear-gradient(180deg, #ffffff, #ffffff)')
  } else {
    root.style.setProperty('--bg-primary', '#0a0a0e')
    root.style.setProperty('--bg-secondary', '#17171c')
    root.style.setProperty('--bg-tertiary', '#1f1f25')
    root.style.setProperty('--text-primary', '#ffffff')
    root.style.setProperty('--text-secondary', '#e5e7eb')
    root.style.setProperty('--text-tertiary', '#9ca3af')
    root.style.setProperty('--text-inverse', '#111111')
    root.style.setProperty('--glass-bg', 'rgba(255, 255, 255, 0.08)')
    root.style.setProperty('--glass-bg-strong', 'rgba(255, 255, 255, 0.12)')
    root.style.setProperty('--glass-bg-hover', 'rgba(255, 255, 255, 0.16)')
    root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.18)')
    root.style.setProperty('--glass-border-strong', 'rgba(255, 255, 255, 0.25)')
    root.style.setProperty('--ambient-gradient-1', 'radial-gradient(1200px 600px at 50% -200px, rgba(255,255,255,0.12), rgba(0,0,0,0) 60%)')
    root.style.setProperty('--ambient-gradient-2', 'radial-gradient(800px 400px at 10% 10%, rgba(99,102,241,0.15), rgba(0,0,0,0) 60%)')
    root.style.setProperty('--ambient-gradient-3', 'radial-gradient(900px 450px at 90% 15%, rgba(236,72,153,0.12), rgba(0,0,0,0) 60%)')
    root.style.setProperty('--ambient-base', 'linear-gradient(180deg, rgba(10,10,14,0.9), rgba(10,10,14,0.9))')
  }
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
