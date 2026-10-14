import { useCallback, useEffect, useState } from 'react';

// Light or dark mode for the whole app. The choice is kept in this browser and
// set as data-bs-theme on <html>, which switches Bootstrap's dark theme and the
// app's own colour variables (styles/theme.scss).
//
// public/theme.js applies the saved choice before the page first draws, so a
// dark page never flashes light. Until someone picks, it follows the system.

// Shared with public/theme.js: keep the two in sync.
export const THEME_KEY = 'kanforge.theme';

const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

// What was picked in this browser, or null if nothing was (or storage is unavailable).
function savedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

const applyTheme = (theme) => document.documentElement.setAttribute('data-bs-theme', theme);

// [theme, toggle]: the theme in use, and a function that switches it and saves the choice.
export function useTheme() {
  const [theme, setTheme] = useState(() => savedTheme() ?? systemTheme());

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    // Follows the system's setting while nothing has been picked here.
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystem = () => !savedTheme() && setTheme(systemTheme());
    // A choice made in another tab applies here too.
    const onStorage = (e) => e.key === THEME_KEY && setTheme(savedTheme() ?? systemTheme());
    media?.addEventListener('change', onSystem);
    window.addEventListener('storage', onStorage);
    return () => {
      media?.removeEventListener('change', onSystem);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch { /* storage may be unavailable (private windows): it still switches for now */ }
      return next;
    });
  }, []);

  return [theme, toggle];
}
