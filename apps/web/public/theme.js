// Runs before first paint so the page never flashes the wrong theme. Kept as a file because the
// CSP forbids inline scripts. Mirrors applyTheme() in src/utils/theme.ts.
(function () {
  var pref = 'system';
  try {
    pref = JSON.parse(localStorage.getItem('poketracker-settings') || '{}').state.theme || 'system';
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#12110f' : '#f4f1ea');
})();
