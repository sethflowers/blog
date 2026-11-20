// Checks a game's loading screen (see "Loading screen" in CLAUDE.md), in a fresh browser context
// (no service worker, so the requests can be held back):
//  - while three.js is held back, the loading screen is showing "Loading… n%" (screenshot saved);
//  - once everything arrives, the game starts and the loading screen goes away;
//  - when a game file fails to arrive, it says so and offers "Try again" instead of hanging.
// Use: await checkLoading({ browser, url: BASE, check, game: '__farm', main: pg, shot: path.join(OUT, '00-loading.png') });
// (main: the test's own page, which stops drawing meanwhile: two pages drawing at once in the software
// GPU made the new one take minutes to start)
export async function checkLoading({ browser: testBrowser, url, check, game, shot, main }){
  // its own browser, closed afterwards, so it can't slow down the rest of the test
  const browser = await testBrowser.browserType().launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const quiet = (on) => main && main.evaluate(([g, on]) => { const G = window[g]; if (!G) return; if (on){ window.__ldWasNoRender = G.noRender; G.noRender = true; } else G.noRender = window.__ldWasNoRender; }, [game, on]).catch(() => {});
  await quiet(true);
  try { await run(); } finally { await quiet(false); await browser.close(); }
  async function run(){
  const state = (pg) => pg.evaluate(() => {
    const l = document.getElementById('loading'), cs = l && getComputedStyle(l);
    return { visible: !!l && cs.display !== 'none' && +cs.opacity > 0.5, text: (document.getElementById('ld-text') || {}).textContent || '',
      retry: !!document.getElementById('ld-retry') && getComputedStyle(document.getElementById('ld-retry')).display !== 'none' };
  });
  // 1. slow download: the loading screen shows straight away
  // (service workers blocked: one registered at the top of the page can otherwise fetch three.js itself
  // before the hold-back below catches it, and serve it to the page)
  let ctx = await browser.newContext({ viewport: { width: 1024, height: 700 }, serviceWorkers: 'block' });
  let pg = await ctx.newPage();
  let release; const gate = new Promise((r) => { release = r; });
  await pg.route('**/lib/three.core.min.js*', async (r) => { await gate; await r.continue(); });
  await pg.goto(url, { waitUntil: 'commit' });
  await pg.waitForSelector('#loading', { timeout: 20000 });
  await pg.waitForTimeout(500);
  let s = await state(pg);
  check(s.visible && /^Loading/.test(s.text), `a loading screen shows while the game's files arrive ("${s.text}")`);
  if (shot) await pg.screenshot({ path: shot });
  release();
  const gone = await pg.waitForFunction(() => { const l = document.getElementById('loading'); return l && getComputedStyle(l).display === 'none'; }, null, { timeout: 120000 }).then(() => true, () => false);
  if (!gone) s = await state(pg);
  check(gone && await pg.evaluate(`!!window.${game}`), 'the loading screen goes away once the game is ready' + (gone ? '' : ` (still showing "${s.text}")`));
  await ctx.close();
  // 2. a file that never arrives: say so, offer Try again
  ctx = await browser.newContext({ viewport: { width: 1024, height: 700 }, serviceWorkers: 'block' });
  pg = await ctx.newPage();
  await pg.route('**/js/util.js*', (r) => r.abort());
  await pg.goto(url, { waitUntil: 'commit' });
  const said = await pg.waitForFunction(() => /went wrong/.test((document.getElementById('ld-text') || {}).textContent || ''), null, { timeout: 30000 }).then(() => true, () => false);
  s = await state(pg);
  check(said && s.visible && s.retry, 'a missing file shows "Something went wrong" and a Try again button');
  await ctx.close();
  }
}
