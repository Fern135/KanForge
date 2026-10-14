import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMoon, faSun } from '@fortawesome/free-solid-svg-icons';
import { useTheme } from '../theme';

// The round button in the bottom right corner of every page that switches
// between light and dark mode. The choice is remembered in this browser (see
// core/theme.js). It shows what you'd switch to: a moon in light mode, a sun in dark.
export default function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className="theme-toggle" onClick={toggle} title={label} aria-label={label}>
      <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} />
    </button>
  );
}
