// Applies the light or dark mode chosen in this browser before the page first
// draws, so a dark page never flashes light while the app loads. Until someone
// picks, it follows the system. The app takes over from here (src/core/theme.js,
// which uses the same storage key). A plain file rather than inline script,
// since the Content-Security-Policy only allows scripts from this site.
(function () {
  var theme;
  try {
    theme = localStorage.getItem('kanforge.theme');
  } catch (e) { /* storage unavailable: fall back to the system setting */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-bs-theme', theme);
}());
