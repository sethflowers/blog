// Plays Royal Flush in headless Chromium, checks it, and saves screenshots. Quick (well under a minute).
//   NODE_PATH=$(npm root -g) node _tools/royal-flush/test.mjs [outDir]
// Checks: the loading screen (and its error + Try again), the title and version, practice mode
// (walking, arriving at a restroom, checking in, the celebration, washing hands, rating), ticking one off
// from the list and unticking it, the emergency button, badges and points, GPS mode with an emulated
// position (a GPS-verified check-in, moving a pin, being far from the park), saving and reloading, an
// old save, no console errors. Screenshots on a phone and an iPad.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, version } from './serve.mjs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const OUT = path.resolve(process.argv[2] || 'royal-flush-shots');
fs.mkdirSync(OUT, { recursive: true });
const VERSION = version('royal-flush');
const { server, origin } = await serve();
const URL = origin + '/experiments/royal-flush/';
let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; return ok; };
const browser = await chromium.launch();
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, name) });
const ev = (pg, f, a) => pg.evaluate(f, a);

// ---- loading screen ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  let pg = await ctx.newPage();
  let release; const gate = new Promise((r) => { release = r; });
  await pg.route('**/js/parks.js*', async (r) => { await gate; await r.continue(); });
  await pg.goto(URL, { waitUntil: 'commit' });
  await pg.waitForSelector('#loading');
  await pg.waitForTimeout(400);
  const txt = await pg.textContent('#ld-text');
  check(/^Loading/.test(txt), `a loading screen shows while the files arrive ("${txt}")`);
  await shot(pg, '00-loading.png');
  release();
  const gone = await pg.waitForFunction(() => getComputedStyle(document.getElementById('loading')).display === 'none', null, { timeout: 15000 }).then(() => true, () => false);
  check(gone, 'the loading screen goes away once the game is ready');
  await pg.close();
  pg = await ctx.newPage();
  await pg.route('**/js/util.js*', (r) => r.abort());
  await pg.goto(URL, { waitUntil: 'commit' });
  const said = await pg.waitForFunction(() => /went wrong/.test(document.getElementById('ld-text').textContent) && getComputedStyle(document.getElementById('ld-retry')).display !== 'none', null, { timeout: 15000 }).then(() => true, () => false);
  check(said, 'a missing file says "Something went wrong" with a Try again button');
  await ctx.close();
}

// ---- the game on a phone ----
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, permissions: ['geolocation'], serviceWorkers: 'block' });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await pg.goto(URL);
await pg.waitForFunction(() => window.__flush);
await pg.waitForTimeout(700);
check((await pg.textContent('#title .build-version')).includes('v' + VERSION), `the title screen shows the version (v${VERSION})`);
check(/21 restrooms/.test(await pg.textContent('#t-progress')), 'the title screen says how many restrooms there are');
check(await pg.isDisabled('[data-park="epcot"]'), 'the other parks are listed as coming soon');
await shot(pg, '01-title.png');

// practice mode
await pg.click('#b-practice');
await pg.waitForTimeout(600);
check(await ev(pg, () => document.body.classList.contains('playing') && __flush.G.mode === 'practice' && !!__flush.G.me), 'practice mode starts with a pretend you on the map');
await shot(pg, '02-practice-map.png');
// tap the map to walk: the pretend you moves
const before = await ev(pg, () => ({ ...__flush.G.me }));
const spot = await ev(pg, () => [__flush.map.sx(120), __flush.map.sy(-230)]);   // an empty bit of Tomorrowland
await pg.mouse.click(spot[0], spot[1]);
await pg.waitForTimeout(1600);
const after = await ev(pg, () => ({ ...__flush.G.me }));
check(Math.hypot(after.x - before.x, after.y - before.y) > 20, 'tapping the map walks you there');
// too far to check in
await ev(pg, () => __flush.setPractice(0, -300));
await ev(pg, () => __flush.closeSheet());
const far = await ev(pg, () => __flush.checkIn('tangled'));
check(far === false && !(await ev(pg, () => __flush.found('tangled'))), "can't check in from across the park in practice mode");
// arrive at the Tangled restrooms: the card opens by itself
const t = await ev(pg, () => __flush.byId('tangled'));
await ev(pg, ([x, y]) => __flush.setPractice(x + 5, y - 5), [t.x, t.y]);
await pg.waitForTimeout(500);
check(await ev(pg, () => __flush.G.sheetId === 'tangled' && document.getElementById('sheet').classList.contains('show')), 'arriving at a restroom opens its card');
await shot(pg, '03-arrived-card.png');
// Found it! → celebration → wash
await pg.click('#sheet [data-act="found"]');
await pg.waitForTimeout(700);
check(await ev(pg, () => document.getElementById('party').classList.contains('show')), 'checking in shows the celebration');
await shot(pg, '04-flushed.png');
await pg.waitForFunction(() => document.getElementById('wash').classList.contains('show'), null, { timeout: 8000 });
// scrub with the finger for a moment (bubbles), then finish the 20 seconds
for (let i = 0; i < 12; i++) await pg.mouse.move(150 + (i % 2) * 90, 500 + i * 6, { steps: 3 }), i === 0 && await pg.mouse.down();
await pg.mouse.up();
await shot(pg, '05-wash.png');
await ev(pg, () => __flush.washScrub(20));
await pg.waitForFunction(() => !document.getElementById('wash').classList.contains('show'), null, { timeout: 6000 });
await pg.waitForTimeout(300);
const f = await ev(pg, () => __flush.found('tangled'));
check(f && f.washed === 50, `a full hand wash earns the bonus (${f && f.washed})`);
check(await ev(pg, () => __flush.G.sheetId === 'tangled' && !!document.querySelector('#sheet [data-rate]')), 'after washing, the card asks for a rating');
await pg.click('#sheet [data-rate="4"]');
check((await ev(pg, () => __flush.found('tangled').rating)) === 4, 'rating it in rolls of toilet paper is saved');
await pg.click('#sheet [data-line="short"]');
check((await ev(pg, () => __flush.found('tangled').line)) === 'short', 'the line length is saved');
await shot(pg, '06-rated.png');
const badges = await ev(pg, () => Object.keys(__flush.slot().badges));
check(badges.includes('first') && badges.includes('tangled'), `badges: First Flush and Let Down Your Hair (${badges.join(', ')})`);
const sc = await ev(pg, () => __flush.score());
check(sc === 100 + 100 + 50 + 400, `points: find + themed + wash + 2 badges = ${sc}`);
check((await pg.textContent('#score')).startsWith(sc.toLocaleString('en-US')), 'the score shows at the top');

// the list: tick one off, untick it
await ev(pg, () => __flush.closeSheet());
await pg.click('#b-list');
await pg.waitForTimeout(300);
check(await pg.isVisible('[data-check="pinocchio"]'), 'the list has a checkbox for every restroom');
await pg.click('[data-check="pinocchio"]');
await pg.waitForTimeout(300);
check(!!(await ev(pg, () => __flush.found('pinocchio'))) && await pg.isVisible('[data-check="pinocchio"].on'), 'ticking one off in the list marks it found');
await shot(pg, '07-list.png');
await pg.click('[data-check="pinocchio"]');
await pg.waitForTimeout(200);
check(!(await ev(pg, () => __flush.found('pinocchio'))), 'tapping the tick again unticks it');
await pg.click('[data-check="pinocchio"]');
// tapping a row opens it on the map
await pg.click('[data-go="teacups"] .tx');
await pg.waitForTimeout(500);
check(await ev(pg, () => __flush.G.sheetId === 'teacups' && !document.getElementById('panel').classList.contains('show')), 'tapping a row shows that restroom on the map');
// untick from the card
await ev(pg, () => __flush.openSheet('pinocchio'));
await pg.click('#sheet [data-act="untick"]');
check(!(await ev(pg, () => __flush.found('pinocchio'))), 'a found restroom can be unticked from its card');
await ev(pg, () => __flush.closeSheet());

// a whole land: tick off all of Liberty Square
await ev(pg, () => { __flush.tick('tavern'); __flush.tick('columbia'); });
const lp = await ev(pg, () => __flush.landProgress().lib);
check(lp.have === lp.all, 'ticking off every restroom in a land completes it');
check((await ev(pg, () => Object.keys(__flush.slot().badges))).includes('land'), 'and earns Land Lord');

// emergency
await ev(pg, ([x, y]) => __flush.setPractice(x + 40, y), [ (await ev(pg, () => __flush.byId('space'))).x, (await ev(pg, () => __flush.byId('space'))).y ]);
await pg.waitForTimeout(300);
await ev(pg, () => __flush.closeSheet());
await pg.click('#b-need');
await pg.waitForTimeout(800);
check(await ev(pg, () => __flush.G.routeId === 'space' && __flush.G.sheetId === 'space' && !!__flush.map.route), '"I need to go!" picks the nearest restroom and shows the way');
await shot(pg, '08-emergency.png');
await ev(pg, () => __flush.closeSheet());

// badges panel
await pg.click('#b-badges');
await pg.waitForTimeout(300);
check(/Badges/.test(await pg.textContent('#panel')), 'the badges panel opens');
await shot(pg, '09-badges.png');
await pg.click('#panel [data-close]');
// menu
await pg.click('#b-menu');
check(/v\d/.test(await pg.textContent('#panel')), 'the menu shows the version');
await pg.click('#panel [data-close]');

// a landmark tap names it
await ev(pg, () => __flush.map.centerOn(0, -60, 2, false));
await pg.waitForTimeout(200);
const sm = await ev(pg, () => { const l = __flush.G.park.landmarks.find((x) => x.name === 'Swiss Family Treehouse'); return [__flush.map.sx(l.x), __flush.map.sy(l.y)]; });
await pg.mouse.click(sm[0], sm[1]);
await pg.waitForTimeout(300);
check(/Swiss Family/.test(await pg.textContent('#msgs')), 'tapping a landmark says what it is');
await pg.waitForTimeout(400);
await shot(pg, '10-zoomed.png');

// save survives a reload
await pg.reload();
await pg.waitForFunction(() => window.__flush);
const kept = await ev(pg, () => { __flush.play('practice'); return !!__flush.found('tangled') && __flush.found('tangled').rating === 4; });
check(kept, 'progress is saved and comes back after a reload');
check(await ev(pg, () => !__flush.S.parks['magic-kingdom'] || !__flush.S.parks['magic-kingdom'].found.tangled), 'practice progress is kept apart from the real quest');

// ---- GPS mode, at the park ----
const pin = await ev(pg, () => __flush.byId('cosmic'));
const ll = await ev(pg, async ([x, y]) => { const m = await import('/experiments/royal-flush/js/parks.js'); return m.toLatLon(m.parkById('magic-kingdom'), x, y); }, [pin.x + 12, pin.y + 8]);
await ctx.setGeolocation({ latitude: ll.lat, longitude: ll.lon, accuracy: 8 });
await ev(pg, () => { __flush.showTitle(); });
await pg.click('#b-go');
await pg.waitForFunction(() => __flush.G.me && !__flush.G.me.practice, null, { timeout: 8000 }).catch(() => {});
const me = await ev(pg, () => __flush.G.me);
check(me && Math.hypot(me.x - pin.x - 12, me.y - pin.y - 8) < 2, 'GPS puts you on the map where you are');
check(/GPS ±8 m/.test(await pg.textContent('#gps')), 'the GPS accuracy shows');
await pg.waitForTimeout(400);
check(await ev(pg, () => __flush.G.sheetId === 'cosmic'), "arriving at a restroom with GPS opens its card");
await shot(pg, '11-gps-arrived.png');
await pg.click('#sheet [data-act="found"]');
await pg.waitForFunction(() => document.getElementById('wash').classList.contains('show'), null, { timeout: 8000 });
await pg.click('#wash-skip');
await pg.waitForTimeout(300);
const fc = await ev(pg, () => __flush.found('cosmic'));
check(fc && fc.verified, 'a check-in at the restroom with GPS earns the GPS bonus');
check(await pg.isVisible('#sheet [data-act="fix"]'), 'a found restroom near you offers "move the pin here"');
await pg.click('#sheet [data-act="fix"]');
const moved = await ev(pg, () => __flush.byId('cosmic'));
check(Math.abs(moved.x - pin.x - 12) < 1 && moved.fixed, 'moving a pin puts it where you are standing (saved on the device)');
// a far-away pin asks before counting it
await ev(pg, () => __flush.openSheet('gate'));
await pg.click('#sheet [data-act="found"]');
check(await pg.isVisible('#sheet [data-act="force"]'), 'checking in far from a pin asks "count it anyway?"');
await shot(pg, '12-far-confirm.png');
await ev(pg, () => __flush.closeSheet());
// at home, a long way from the park
await ctx.setGeolocation({ latitude: 40.7, longitude: -74.0, accuracy: 20 });
await pg.waitForFunction(() => /from Magic Kingdom/.test(document.getElementById('gps').textContent), null, { timeout: 8000 }).catch(() => {});
check(/from Magic Kingdom/.test(await pg.textContent('#gps')), 'far from the park, it says so and offers practice mode');

// ---- an old save loads (never break an old save) ----
await ev(pg, () => localStorage.setItem('royal-flush-save-1', JSON.stringify({ v: 1, parks: { 'magic-kingdom': { found: { townsq: { t: 1 } } } } })));
await pg.reload();
await pg.waitForFunction(() => window.__flush);
check(await ev(pg, () => !!__flush.S.parks['magic-kingdom'].found.townsq && Array.isArray(__flush.S.parks['magic-kingdom'].custom) && __flush.S.settings.sound === true), 'an old save is upgraded, keeping what it had');

check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await ctx.close();

// ---- an iPad, sideways ----
{
  const c = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, serviceWorkers: 'block' });
  const p = await c.newPage();
  await p.goto(URL); await p.waitForFunction(() => window.__flush);
  await shot(p, '13-ipad-title.png');
  await p.click('#b-practice'); await p.waitForTimeout(500);
  await p.evaluate(() => __flush.map.centerOn(0, -40, __flush.map.startZoom(), false)); await p.waitForTimeout(300);
  await shot(p, '14-ipad-map.png');
  await c.close();
}

// ---- iPhones: portrait, sideways (with the notch), a small one ----
{
  const c = await browser.newContext({ ...devices['iPhone 13'], permissions: ['geolocation'], serviceWorkers: 'block' });
  const p = await c.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL); await p.waitForFunction(() => window.__flush);
  const pin = await p.evaluate(() => __flush.byId('teacups'));
  const ll = await p.evaluate(async ([x, y]) => { const m = await import('/experiments/royal-flush/js/parks.js'); return m.toLatLon(m.parkById('magic-kingdom'), x, y); }, [pin.x + 30, pin.y - 50]);
  await c.setGeolocation({ latitude: ll.lat, longitude: ll.lon, accuracy: 6 });
  await p.tap('#b-go');
  await p.waitForFunction(() => __flush.G.me, null, { timeout: 8000 }).catch(() => {});
  // facing north-east: the heading cone
  await p.evaluate(() => { __flush.map.heading = 45; __flush.map.dirty(); });
  await p.waitForTimeout(700);
  await shot(p, '15-iphone-gps.png');
  check(await p.evaluate(() => __flush.map.dpr === 3), 'iPhone: the map is drawn at the full 3x resolution');
  // dragging never shows unfinished map: after a moment's rest, the tiles around the screen are ready,
  // and every frame of a drag is made from finished tiles (none missing, none drawn mid-drag)
  await p.waitForTimeout(1200);
  const cost = await p.evaluate(async () => {
    const m = __flush.map, cv = document.getElementById('map');
    const fire = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true }));
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const made0 = m.tilesMade;
    fire('pointerdown', 200, 400); await frame();
    let missing = 0, worst = 0;
    for (let i = 1; i <= 24; i++){
      fire('pointermove', 200 - i * 9, 400 - i * 7);
      const t0 = performance.now(); m.bgKey = null; m.draw(performance.now()); worst = Math.max(worst, performance.now() - t0);
      missing += m.lastMissing; await frame();
    }
    fire('pointerup', 0, 230); await frame();
    return { missing, worst, drawnDuringDrag: m.tilesMade - made0, tiles: m.tiles.size };
  });
  check(cost.missing === 0, `iPhone: dragging shows only finished map (${cost.missing} missing tiles over 24 frames; slowest frame ${cost.worst.toFixed(1)} ms; ${cost.drawnDuringDrag} tiles drawn ahead meanwhile; ${cost.tiles} kept)`);
  await p.evaluate(() => { __flush.closeSheet(); __flush.map.centerOn(-300, -150, 2.2, false); __flush.openSheet('teacups'); });
  await p.waitForTimeout(900);
  await shot(p, '16-iphone-card.png');
  const where = await p.evaluate(() => { const r = __flush.byId('teacups'), m = __flush.map; return { x: m.sx(r.x), y: m.sy(r.y), top: document.querySelector('#sheet .sh').getBoundingClientRect().top }; });
  check(where.x > 20 && where.x < 370 && where.y > 120 && where.y < where.top - 10 && where.y > where.top - 120, `iPhone: opening a card brings its pin into view above the card (pin at ${Math.round(where.x)}, ${Math.round(where.y)}; card from ${Math.round(where.top)})`);
  const sheetH = await p.evaluate(() => document.querySelector('#sheet .sh').getBoundingClientRect().height);
  check(sheetH < 844 * 0.75, `iPhone: the card leaves the map visible (${Math.round(sheetH)} px)`);
  // sideways
  await p.setViewportSize({ width: 844, height: 390 });
  await p.evaluate(() => __flush.closeSheet());
  await p.waitForTimeout(500);
  await shot(p, '17-iphone-landscape.png');
  const fits = await p.evaluate(() => { const b = document.getElementById('bottom').getBoundingClientRect(), t = document.getElementById('top').getBoundingClientRect(); return b.top - t.bottom; });
  check(fits > 150, `iPhone sideways: room for the map between the bars (${Math.round(fits)} px)`);
  await p.evaluate(() => __flush.openSheet('teacups'));
  await p.waitForTimeout(400);
  const scrollable = await p.evaluate(() => { const s = document.querySelector('#sheet .sh'); return s.getBoundingClientRect().height <= innerHeight * 0.73 && s.scrollHeight >= s.clientHeight; });
  check(scrollable, 'iPhone sideways: the card fits and scrolls');
  await shot(p, '18-iphone-landscape-card.png');
  check(errs.length === 0, 'iPhone: no errors' + (errs.length ? ': ' + errs[0] : ''));
  await c.close();
  const c2 = await browser.newContext({ ...devices['iPhone SE'], serviceWorkers: 'block' });
  const p2 = await c2.newPage();
  await p2.goto(URL); await p2.waitForFunction(() => window.__flush);
  await p2.waitForTimeout(400);
  const btn = await p2.evaluate(() => { const r = document.getElementById('b-go').getBoundingClientRect(); return r.bottom <= innerHeight && r.width > 250; });
  check(btn, 'small iPhone: "Start the quest" is on screen without scrolling');
  await shot(p2, '19-iphone-se-title.png');
  await c2.close();
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall good');
process.exit(failures ? 1 : 0);
