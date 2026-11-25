// The game itself: setting up a case (people on the train, the crime scene), the story (the lights go
// out...), examining things, questioning people, the notebook, accusing someone, and the ending.
// Every panel is a description (ui.js) drawn on screen or on the VR notebook.
import * as THREE from 'three';
import { V } from './util.js';
import { makeMystery, PROF, AVATARS, CAR_NAME, PATTERNS, SOLES, HEIGHTS, DIFFICULTY, placeCar } from './mystery.js';
import { Case, first, placeName } from './case.js';
import { Person, loadKinds } from './people.js';
import { fingerprint, shoePrint } from './evidence.js';
import { prepareHead, makeHead, listCast, castInfo } from './cast.js';
import { sfx } from './audio.js';

export const SAVE_KEY = 'sherlock-save-1';
const NEAR = 3.2;               // how close you must be to examine something or ask a question

export class Game {
  constructor(app){
    this.app = app;
    this.m = null; this.kase = null; this.people = []; this.conductor = null;
    this.items = [];             // the crime scene's things (body, weapon, footprints...)
    this.portraits = [];
    this.stage = 'none';         // none | intro | dark | arrive | investigate | gather | result
    this.timeline = [];
    this.lightning = 6;
    this.rt = new THREE.WebGLRenderTarget(192, 192); this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.pcam = new THREE.PerspectiveCamera(26, 1, 0.05, 4); this.pcam.layers.set(5);
    const pl = new THREE.DirectionalLight(0xfff0e0, 2.4); pl.layers.set(5); const pa = new THREE.AmbientLight(0xffffff, 0.9); pa.layers.set(5);
    this.pcam.add(pl, pa); pl.position.set(0.3, 0.4, 0.2); pl.target.position.set(0, 0, -1); this.pcam.add(pl.target);
    app.scene.add(this.pcam);
    this.notebookTab = 'todo';
  }

  // ---------- setting up a case ----------
  async newCase({ difficulty = 'medium', useCast = false, seed } = {}){
    const cast = useCast ? (await listCast()).filter((p) => p.photos && p.photos.front) : [];
    const info = cast.map(castInfo);
    seed = seed ?? (Math.floor(Math.random() * 1e9) + 1);
    const m = makeMystery({ seed, difficulty, cast: info });
    await this.setup(m, null, { seed, difficulty, cast: info });
    this.startIntro();
    this.save();
  }
  async loadSaved(){
    let S; try { S = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { S = null; }
    if (!S || !S.seed) return false;
    S = upgrade(S);
    const m = makeMystery({ seed: S.seed, difficulty: S.difficulty, cast: S.cast || [] });
    await this.setup(m, S.case, S);
    if (S.player) this.app.standAt(S.player.x, S.player.z, S.player.yaw);
    if (this.kase.stage === 'intro') this.startIntro();
    else if (!this.kase.has('body')){ this.stage = 'arrive'; this.app.setPower(1); }
    else this.stage = 'investigate';
    this.app.say(`Welcome back, Detective. Your case on the Midnight Express is still open (${DIFFICULTY[m.difficulty].name}).`);
    return true;
  }
  hasSave(){ try { return !!JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return false; } }
  save(){
    if (!this.m || this.stage === 'result') return;
    const me = this.app.myPos();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, seed: this.meta.seed, difficulty: this.meta.difficulty, cast: this.meta.cast, case: this.kase.save(), player: { x: me.x, z: me.z, yaw: this.app.myYaw() - Math.PI } })); } catch (e) { /* storage full: carry on */ }
  }
  async setup(m, savedCase, meta){
    const app = this.app;
    this.teardown();
    this.m = m; this.meta = { seed: meta.seed, difficulty: meta.difficulty, cast: meta.cast || [] };
    this.kase = new Case(m, savedCase);
    app.loadingMsg('Getting the passengers on board…', 0);
    await loadKinds([...m.people.map((p) => p.avatar), m.conductorAvatar], (d, t) => app.loadingMsg('Getting the passengers on board…', t ? d / t : 1));
    // photo heads for your own people
    const cast = await listCast();
    const heads = {};
    for (const p of m.people) if (p.cast){ const c = cast.find((x) => x.id === p.cast); if (c){ try { const b = await prepareHead(c); if (b) heads[p.i] = makeHead(b); } catch (e) { console.warn('photo head', e); } } }
    this.people = m.people.map((p) => {
      const P = new Person({ avatar: p.avatar, heightBand: p.heightBand, hat: PROF[p.prof].hat, photoHead: heads[p.i] || null });
      P.info = p; app.train.group.add(P.holder);
      P.proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.7, 8).translate(0, 0.85, 0), new THREE.MeshBasicMaterial());
      P.proxy.visible = false; P.proxy.userData.item = 'person:' + p.i; P.holder.add(P.proxy);
      return P;
    });
    this.conductor = new Person({ avatar: m.conductorAvatar, heightBand: 'medium', hat: 'conductor' });
    app.train.group.add(this.conductor.holder);
    this.conductor.proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.7, 8).translate(0, 0.85, 0), new THREE.MeshBasicMaterial()); this.conductor.proxy.visible = false; this.conductor.proxy.userData.item = 'conductor'; this.conductor.holder.add(this.conductor.proxy);
    // everyone where they were when the lights went out (and stay there)
    const used = {};
    const spotFor = (p) => {
      const S = app.train.spots[p.place]; const k = used[p.place] = (used[p.place] ?? -1) + 1;
      if (p.place.startsWith('cabin')) return S[0];
      return p.with != null ? S[Math.min(k, 1)] : S[2];
    };
    for (const P of this.people){ if (P.info.i === m.victim) continue; const s = spotFor(P.info); P.place(s.x, s.z, s.yaw); P.spot = s; }
    const cs = app.train.spots.conductor[0]; this.conductor.place(cs.x, cs.z, cs.yaw);
    // the crime scene, and the victim standing there before it happens
    const where = app.crime.build(m);
    this.where = where;
    const V0 = this.people[m.victim]; V0.place(where.body.x, where.body.z + 0.6, where.body.yaw + Math.PI);
    this.portraits = this.people.map((P) => this.portrait(P));
    this.conductor.portraitC = this.portrait(this.conductor);
    if (this.kase.has('body') || (savedCase && savedCase.stage !== 'intro')) this.killVictim();
    this.makeItems();
    this.refreshSparkles();
    for (const id of this.kase.order){ const it = this.items.find((x) => x.markFor && x.markFor.includes(id)); if (it) app.crime.marker(it.id, it.pos); }
    app.loadingMsg(null);
  }
  teardown(){
    for (const P of [...this.people, this.conductor]){ if (!P) continue; P.proxy.geometry.dispose(); P.dispose(); }
    this.people = []; this.conductor = null; this.items = [];
    this.app.crime.clear();
    this.timeline = [];
    this.stage = 'none';
  }
  killVictim(){
    const w = this.where, V0 = this.people[this.m.victim];
    V0.lie(w.body.x, w.body.z, w.body.yaw);
    if (!V0.lyingProxy){ V0.proxy.geometry.dispose(); V0.proxy.geometry = new THREE.BoxGeometry(0.7, 0.5, 1.8).translate(0, 0.25, 0); V0.lyingProxy = true; }
    V0.proxy.userData.item = 'body';
  }
  // the things at the scene you can examine
  makeItems(){
    const w = this.where, m = this.m;
    const body = this.people[m.victim];
    const bodyPos = V(w.body.x - Math.sin(w.body.yaw) * 0.85, 0.25, w.body.z - Math.cos(w.body.yaw) * 0.85);
    const add = (id, name, pos, r, markFor) => { const proxy = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial()); proxy.visible = false; proxy.position.copy(pos); proxy.userData.item = id; this.app.crime.group.add(proxy); this.items.push({ id, name, pos: pos.clone(), proxy, markFor }); };
    add('body', body.info.name, bodyPos, 0.55, ['body-look', 'note']);
    add('weapon', this.kase.weapon.name.replace(/^an? /, 'The '), w.weapon, 0.22, ['weapon-print']);
    add('foot', 'The footprints', w.prints[1] || w.puddle, 0.4, ['foot']);
    add('puddle', 'The spill', w.puddle, 0.4, ['foot']);
    add('fibre', 'The door frame', w.fibre, 0.2, ['fibre']);
    add('door', 'The door handle', w.door, 0.15, ['door']);
    add('glass', 'A glass', w.glass, 0.12, ['glass']);
    body.proxy.userData.item = 'body';
  }
  item(id){ return this.items.find((x) => x.id === id) || this.app.train.items.find((x) => x.id === id); }
  // sparkles over the clues you haven't found (Easy: all of them; Medium: when you're close; Hard: none)
  refreshSparkles(){
    const C = this.app.crime, k = this.kase;
    for (const s of [...C.sparkles]) C.unsparkle(s.userData.id);
    if (this.m.difficulty === 'hard' || !k.has('body')) return;
    const todo = { body: !k.has('body-look') || !k.has('note'), weapon: !k.has('weapon-print'), foot: !k.has('foot'), fibre: k.hasFibre && !k.has('fibre') };
    for (const it of this.items) if (todo[it.id]) C.sparkle(it.id, it.pos);
  }
  sparkleVisible(p){ if (this.m.difficulty === 'easy') return true; return this.app.myPos().distanceTo(V(p.x, 0, p.z)) < 3; }

  // a picture of someone's face, for the notebook
  portrait(P){
    const R = this.app.renderer, c = document.createElement('canvas'); c.width = c.height = 192;
    P.update(0); P.holder.updateMatrixWorld(true);
    const h = P.headPos(V()), fwd = V(Math.sin(P.yaw), 0, Math.cos(P.yaw));
    this.pcam.position.copy(h).addScaledVector(fwd, 0.85).add(V(0, 0.02, 0)); this.pcam.lookAt(h.x, h.y - 0.04, h.z); this.pcam.updateMatrixWorld(true);
    P.holder.traverse((o) => o.layers.enable(5));
    const xr = R.xr.enabled; R.xr.enabled = false;
    const prevRT = R.getRenderTarget(), cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
    R.setClearColor(0x4a3a2a, 1); R.setRenderTarget(this.rt); R.clear(); R.render(this.app.scene, this.pcam);
    const px = new Uint8Array(192 * 192 * 4); R.readRenderTargetPixels(this.rt, 0, 0, 192, 192, px);
    R.setRenderTarget(prevRT); R.setClearColor(cc, ca); R.xr.enabled = xr;
    P.holder.traverse((o) => o.layers.disable(5));
    const g = c.getContext('2d'), img = g.createImageData(192, 192);
    for (let y = 0; y < 192; y++) img.data.set(px.subarray((191 - y) * 192 * 4, (192 - y) * 192 * 4), y * 192 * 4);
    g.putImageData(img, 0, 0);
    // a frame
    g.strokeStyle = '#c8a050'; g.lineWidth = 8; g.strokeRect(4, 4, 184, 184);
    return c;
  }

  // ---------- the story ----------
  startIntro(){
    const app = this.app, m = this.m;
    this.stage = 'intro'; this.kase.stage = 'intro';
    app.setPower(1); app.refreshHUD();
    const st = app.train.playerStart; app.standAt(st.x, st.z, st.yaw);
    this.people[m.victim].proxy.userData.item = 'person:' + m.victim;
    app.showPanel({ title: '🚂 The Midnight Express', modal: true, sections: [
      { text: `A wild, stormy night in the mountains. You are a famous detective, on your way home on the Midnight Express.\n\nDinner is over, and the other passengers have gone off around the train. You're in the dining car with the conductor, and an ice-cold Coke.` },
      { text: `Six other passengers are on board tonight, and one more: ${m.people[m.victim].name}, the ${PROF[m.people[m.victim].prof].name.toLowerCase()}, who talked about money all through dinner.` },
      { buttons: [{ label: 'Continue ▶', kind: 'primary', go: () => { app.closePanels(); this.blackout(); } }, { label: 'Skip the story', go: () => { app.closePanels(); this.blackout(true); } }] },
    ] });
  }
  // the lights flicker, go out... a crash, a scream... and come back on
  blackout(quick = false){
    const app = this.app, sc = CAR_NAME[this.m.scene];
    this.stage = 'dark';
    const T = quick ? 0.25 : 1;
    const at = (t, f) => this.timeline.push({ t: t * T, f });
    this.clock = 0;
    at(1.0, () => { app.setPower(0.3); sfx.flicker(); });
    at(1.2, () => app.setPower(1));
    at(1.8, () => { app.setPower(0.2); sfx.flicker(); });
    at(2.0, () => app.setPower(1));
    at(2.6, () => { app.setPower(0); sfx.powerDown(); app.train.flash = 1; sfx.thunder(0.1); app.say('The lights have gone out! It\'s pitch dark...', 'bad'); });
    at(4.2, () => { sfx.crash(); });
    at(4.7, () => { sfx.scream(); });
    at(5.8, () => { sfx.footsteps(); this.killVictim(); });
    at(7.5, () => { app.train.flash = 0.8; sfx.thunder(0.3); });
    at(9.0, () => { app.setPower(0.4); sfx.powerUp(); });
    at(9.3, () => { app.setPower(1); this.stage = 'arrive'; this.kase.stage = 'arrive';
      app.clearMsgs(); app.pointAt(this.items.find((x) => x.id === 'body').pos, 1e9);
      app.say(`Conductor: "That scream came from the ${sc}! Quick, Detective, follow me... no, you go first!"`, 'good');
      this.conductor.gesture('agree');
      this.save(); app.refreshHUD(); });
  }
  // you walk into the crime scene
  arrive(){
    const app = this.app, V0 = this.m.people[this.m.victim];
    this.kase.learn('body'); this.stage = 'investigate'; this.kase.stage = 'investigate';
    sfx.gasp();
    this.refreshSparkles();
    app.showPanel({ title: `Oh no! ${V0.name}!`, portrait: this.portraits[this.m.victim], sections: [
      { text: this.kase.bodyText() },
      { text: `The conductor arrives, out of breath: "Nobody can get off until we reach Kingsbridge in the morning. I've asked everyone to stay exactly where they were when the lights went out. Please, Detective, find out who did this!"`, quote: true },
      { heading: 'How to investigate', text: app.isVR() ? 'Point at things and people and pull the trigger to examine them. Your notebook (left hand) has a list of things to do. When you know who did it, accuse them!' : 'Tap things and people to examine them (or use the button at the bottom right). Your notebook has a list of things to do. When you know who did it, accuse them!' },
      { buttons: [{ label: '🔍 Start investigating', kind: 'primary', go: () => this.examine('body') }] },
    ] });
    this.save(); app.refreshHUD();
  }
  update(dt){
    const app = this.app;
    if (this.stage === 'dark' || this.stage === 'gather'){
      this.clock += dt;
      while (this.timeline.length && this.timeline[0].t <= this.clock) this.timeline.shift().f();
    }
    if (this.stage === 'arrive' && this.where){
      const me = app.myPos(), b = this.where.body;
      if (Math.hypot(me.x - b.x, me.z - b.z) < 3.2 && Math.abs(placeCarZ(app, me.z) - placeCarZ(app, b.z)) < 1) this.arrive();
    }
    if (this.stage === 'investigate' || this.stage === 'arrive') this.kase.time += dt;
    // people turn to look at you when you're near
    const me = app.myPos();
    for (const P of [...this.people, this.conductor]){ if (!P) continue; const d = P.holder.position.distanceTo(V(me.x, 0, me.z)); P.lookAt(d < 2.6 && this.stage !== 'result' ? me : null); P.update(dt); }
    // lightning now and then
    this.lightning -= dt;
    if (this.lightning < 0){ this.lightning = 9 + Math.random() * 16; app.train.flash = 0.6 + Math.random() * 0.4; sfx.thunder(0.6 + Math.random() * 1.5); }
  }

  // ---------- examining things ----------
  near(pos){ const me = this.app.myPos(); return Math.hypot(me.x - pos.x, me.z - pos.z) < NEAR; }
  // tap / point at something
  use(id){
    if (this.stage === 'intro' || this.stage === 'dark' || this.stage === 'gather' || this.stage === 'result') return;
    if (id.startsWith('person:')) return this.personPanel(this.people[+id.slice(7)]);
    if (id === 'conductor') return this.conductorPanel();
    if (id === 'body' && this.stage === 'arrive') return this.arrive();
    this.examine(id);
  }
  examine(id){
    const app = this.app, k = this.kase, m = this.m;
    const it = this.item(id); if (!it) return;
    if (this.stage === 'arrive' && this.items.includes(it)) return this.arrive();
    const close = () => this.near(it.pos);
    const act = (label, fact, after) => ({ label, kind: 'primary', disabled: !close(), go: () => { const fresh = k.learn(fact); if (fresh){ sfx.clue(); app.crime.marker(it.id, it.pos); app.say('📓 Added to your notebook.', 'good'); this.refreshSparkles(); this.save(); } if (after) after(); this.examine(id); app.refreshHUD(); } });
    const far = close() ? [] : [{ text: `Walk closer to ${it.name.toLowerCase()} to examine it.` }];
    const done = (fact) => k.has(fact);
    let spec;
    if (id === 'body'){
      const s = [{ text: k.bodyText() }];
      if (done('body-look')) s.push({ heading: '🔍 Looking closely', text: k.lookBody() });
      if (done('note')) s.push({ heading: '📝 In the pocket', text: k.noteText() });
      const b = [];
      if (!done('body-look')) b.push(act('🔍 Look closely', 'body-look', () => sfx.note()));
      if (!done('note')) b.push(act('👛 Check the pockets', 'note'));
      spec = { title: it.name, portrait: this.portraits[m.victim], sections: [...s, ...far, { buttons: [...b, { label: '📓 Notebook', go: () => this.notebook() }] }] };
    } else if (id === 'weapon'){
      const s = [{ text: k.weaponText() }];
      if (done('weapon-print')){ const p = k.weaponPrint(); s.push({ heading: '🖐 Fingerprint', text: k.printText(), images: [{ canvas: fingerprint(p.pattern, p.seed, p.part), label: 'On the weapon' }] }); }
      const b = done('weapon-print') ? [{ label: '📓 Compare prints', kind: 'primary', go: () => this.comparePrints('weapon') }] : [act('🖌 Dust for fingerprints', 'weapon-print', () => sfx.dust())];
      spec = { title: it.name, sections: [...s, ...far, { buttons: b }] };
    } else if (id === 'foot' || id === 'puddle'){
      const c = m.clues.foot;
      const s = [{ text: `${m.medium[0].toUpperCase() + m.medium.slice(1)} on the floor, and footprints leading away from it towards the ${k.dirOfPrints()} of the train.` }];
      if (done('foot')) s.push({ heading: '📏 Measured', text: k.footText(), images: [{ canvas: shoePrint(c.show === 'size' ? 'smooth' : c.sole, c.show === 'sole' ? 0 : c.size, { ink: c.show === 'size' ? '#9a8a7a' : '#3a2a1a' }), label: c.show === 'size' ? 'too smudged' : SOLES[c.sole] }] });
      const b = done('foot') ? [{ label: '📓 Compare shoes', kind: 'primary', go: () => this.compareShoes() }] : [act('📏 Measure the footprints', 'foot')];
      spec = { title: 'The footprints', sections: [...s, ...far, { buttons: b }] };
    } else if (id === 'fibre'){
      const s = [{ text: 'The frame of the door at the end of the car. Something is caught on a splinter...' }];
      if (done('fibre')) s.push({ heading: '🔍 A thread', text: k.fibreText() });
      spec = { title: 'The door frame', sections: [...s, ...far, { buttons: done('fibre') ? [] : [act('🔍 Look closely', 'fibre')] }] };
    } else if (id === 'door'){
      const s = [{ text: 'The handle of the door at the end of the car.' }];
      const pp = k.doorPrinter();
      if (done('door')) s.push({ heading: '🖐 Fingerprints', text: k.doorText(), images: pp ? [{ canvas: fingerprint(pp.pattern, k.printOf(pp).seed, 'full'), label: 'On the handle' }] : undefined });
      spec = { title: 'The door handle', sections: [...s, ...far, { buttons: done('door') ? (pp ? [{ label: '📓 Compare prints', go: () => this.comparePrints('door') }] : []) : [act('🖌 Dust the handle', 'door', () => sfx.dust())] }] };
    } else if (id === 'glass'){
      const pp = k.glassPrinter();
      const s = [{ text: 'An empty glass. Someone had a drink in here.' }];
      if (done('glass')) s.push({ heading: '🖐 Fingerprints', text: k.glassText(), images: pp ? [{ canvas: fingerprint(pp.pattern, k.printOf(pp).seed, 'full'), label: 'On the glass' }] : undefined });
      spec = { title: 'A glass', sections: [...s, ...far, { buttons: done('glass') ? (pp ? [{ label: '📓 Compare prints', go: () => this.comparePrints('glass') }] : []) : [act('🖌 Dust the glass', 'glass', () => sfx.dust())] }] };
    } else if (id === 'coke'){
      const s = [{ text: it.text }];
      if (done('coke')) s.push({ heading: '🖐 Fingerprints', text: k.cokeText(), images: m.cokePrints.slice(0, 4).map((i) => ({ canvas: fingerprint(m.people[i].pattern, k.printOf(m.people[i]).seed, 'smudged', 120) })) });
      const b = []; if (!done('coke')) b.push(act('🖌 Dust the bottle', 'coke', () => sfx.dust()));
      b.push({ label: '🥤 Have a sip', disabled: !close(), go: () => { sfx.note(); app.say('Mmm, ice cold! Very refreshing. It doesn\'t solve the mystery, though.', 'good'); } });
      spec = { title: '🥤 A bottle of Coke', sections: [...s, ...far, { buttons: b }] };
    } else {
      // the train's own things: tell you something if they're where the weapon came from
      const homeHit = it.home && it.home.split(' ').includes(m.weapon);
      const text = homeHit ? it.text : it.plain || it.text;
      spec = { title: it.name, sections: [{ text }, { buttons: [] }] };
    }
    app.showPanel(spec);
  }

  // ---------- people ----------
  personPanel(P){
    const app = this.app, k = this.kase, p = P.info, m = this.m;
    if (p.i === m.victim && this.stage !== 'intro') return this.examine('body');
    const close = this.near(P.holder.position) || this.stage === 'gather';
    const s = [];
    s.push({ text: `${PROF[p.prof].icon} ${PROF[p.prof].name}${p.cast ? ' · one of your people' : ''}. Travelling in cabin ${p.cabin}.` });
    const said = [];
    if (k.has(`p${p.i}-where`)) said.push({ heading: '💬 When the lights went out', text: `"${p.says.where}"`, quote: true });
    if (k.has(`p${p.i}-heard`)) said.push({ heading: '💬 What they heard', text: `"${p.says.heard}"`, quote: true });
    if (k.has(`p${p.i}-victim`)) said.push({ heading: `💬 About ${first(m.people[m.victim])}`, text: `"${p.says.victim}"`, quote: true });
    s.push(...said);
    const imgs = [];
    if (k.has(`p${p.i}-prints`)){ const pr = k.printOf(p); imgs.push({ canvas: fingerprint(pr.pattern, pr.seed, 'full'), label: `${cap(PATTERNS[p.pattern]).replace(/^An? /, '')}` }); }
    if (k.has(`p${p.i}-shoes`)) imgs.push({ canvas: shoePrint(p.sole, p.shoe), label: SOLES[p.sole] });
    if (imgs.length) s.push({ heading: '🖐 👟 Fingerprints and shoes', images: imgs });
    if (k.has(`p${p.i}-look`)) s.push({ heading: '👀 Looking carefully', text: k.lookText(p) });
    if (!close) s.push({ text: `${first(p)} is in ${placeName(p.place)}. Walk over to them to ask questions.` });
    const ask = (label, fact, gesture) => ({ label, disabled: !close, kind: k.has(fact) ? '' : 'primary', go: () => { if (k.learn(fact)){ sfx.note(); this.save(); } P.gesture(typeof gesture === 'function' ? gesture() : gesture); this.personPanel(P); app.refreshHUD(); } });
    const b = [
      ask('💬 Where were you when the lights went out?', `p${p.i}-where`, 'agree'),
      ask('💬 Did you hear or see anything?', `p${p.i}-heard`, () => (p.i === m.murderer ? 'headShake' : 'agree')),
      ask(`💬 What did you think of ${first(m.people[m.victim])}?`, `p${p.i}-victim`, () => (p.motive ? 'headShake' : 'agree')),
      ask('🖐 Take their fingerprints', `p${p.i}-prints`, null),
      ask('👟 Look at their shoes', `p${p.i}-shoes`, null),
      ask('👀 Look at them carefully', `p${p.i}-look`, null),
      { label: k.crossed.has(p.i) ? '↩ Put back on the suspect list' : '✗ Cross off the suspect list', go: () => { k.crossed.has(p.i) ? k.crossed.delete(p.i) : k.crossed.add(p.i); sfx.click(); this.save(); this.personPanel(P); } },
    ];
    app.showPanel({ title: p.name, portrait: this.portraits[p.i], sections: [...s, { buttons: b }] });
  }
  conductorPanel(){
    const app = this.app, k = this.kase;
    const close = this.near(this.conductor.holder.position);
    const s = [{ text: 'The conductor: in charge of the train and its passengers.' }];
    if (k.has('conductor')) s.push({ heading: '💬 During the blackout', text: `"${this.m.conductorSays}"`, quote: true });
    const next = k.jobs()[0];
    s.push({ heading: '💡 A hint', text: `"${hint(next)}"`, quote: true });
    app.showPanel({ title: '🎩 The conductor', portrait: this.conductor.portraitC, sections: [...s, { buttons: [
      { label: '💬 What happened during the blackout?', kind: k.has('conductor') ? '' : 'primary', disabled: !close, go: () => { if (k.learn('conductor')){ sfx.note(); this.save(); } this.conductor.gesture('agree'); this.conductorPanel(); app.refreshHUD(); } },
      { label: '👉 I know who did it!', go: () => this.accusePanel() },
    ] }] });
  }

  // ---------- the notebook ----------
  notebook(tab = this.notebookTab){
    const app = this.app, k = this.kase, m = this.m;
    if (!m) return;
    this.notebookTab = tab;
    const tabs = [['todo', '✅ To do'], ['clues', '🔍 Clues'], ['people', '👥 People'], ['suspects', '🕵 Suspects']].map(([id, label]) => ({ label, on: tab === id, go: () => this.notebook(id) }));
    const sections = [];
    if (tab === 'todo'){
      sections.push({ text: `${DIFFICULTY[m.difficulty].name} case · ${fmtTime(k.time)} · ${k.order.length} things found` });
      sections.push({ rows: k.jobs().map((j) => ({ title: j.text, sub: hint(j), go: () => this.followJob(j) })) });
      sections.push({ buttons: [{ label: '👉 Accuse someone', kind: 'danger', go: () => this.accusePanel() }] });
    } else if (tab === 'clues'){
      const L = k.clueList();
      if (!L.length) sections.push({ text: 'Nothing yet. Go and look at the crime scene!' });
      for (const c of L){
        const sec = { heading: c.title, text: c.text };
        if (c.print) sec.images = [{ canvas: fingerprint(c.print.pattern, c.print.seed, c.print.part || 'full'), label: c.print.part === 'partial' ? 'part of a print' : 'fingerprint' }];
        if (c.shoe) sec.images = [{ canvas: shoePrint(c.shoe.show === 'size' ? 'smooth' : c.shoe.sole, c.shoe.show === 'sole' ? 0 : c.shoe.size, { ink: c.shoe.show === 'size' ? '#9a8a7a' : '#3a2a1a' }), label: 'the footprints' }];
        sections.push(sec);
        if (c.id === 'weapon-print' || c.target) sections.push({ buttons: [{ label: '📓 Compare with everyone\'s prints', go: () => this.comparePrints(c.target || 'weapon') }] });
        if (c.id === 'foot') sections.push({ buttons: [{ label: '📓 Compare with everyone\'s shoes', go: () => this.compareShoes() }] });
      }
    } else if (tab === 'people'){
      sections.push({ text: 'Tap someone to see everything you know about them.' });
      sections.push({ rows: this.people.filter((P) => P.info.i !== m.victim).map((P) => {
        const p = P.info, bits = [];
        bits.push(`${PROF[p.prof].name}`);
        bits.push(k.has(`p${p.i}-where`) ? `was in ${placeName(p.place)}${p.with != null ? ' with ' + first(m.people[p.with]) : ''}` : 'not asked yet');
        if (k.has(`p${p.i}-prints`)) bits.push(`prints: ${PATTERNS[p.pattern].replace(/^an? /, '')}`);
        if (k.has(`p${p.i}-shoes`)) bits.push(`${SOLES[p.sole]}, size ${p.shoe}`);
        if (k.has(`p${p.i}-look`)) bits.push(`${p.hair} hair, ${p.coat} clothes, ${HEIGHTS[p.heightBand]}`);
        return { icon: this.portraits[p.i], title: p.name + (k.crossed.has(p.i) ? ' ✗' : ''), sub: bits.join(' · '), struck: k.crossed.has(p.i), go: () => this.personPanel(P) };
      }) });
      sections.push({ rows: [{ icon: this.conductor.portraitC, title: 'The conductor', sub: k.has('conductor') ? 'told you about the blackout' : 'not asked yet', go: () => this.conductorPanel() }] });
    } else {
      sections.push({ text: m.difficulty === 'hard' ? 'Cross off the people who can\'t have done it. Tap a face to cross it off (or put it back).' : 'Cross off the people who can\'t have done it. Tap a face to cross it off (or put it back). What you know about each person is underneath.' });
      sections.push({ grid: this.people.filter((P) => P.info.i !== m.victim).map((P) => {
        const p = P.info, r = k.reasons(p);
        const sub = m.difficulty === 'easy' ? (r.out.length ? '✗ ' + r.out[0] : r.fits.length ? '✓ fits ' + r.fits.length : '') : m.difficulty === 'medium' ? (r.out.find((t) => t.startsWith('was with') || t.startsWith('the conductor')) ? '✗ has an alibi' : '') : '';
        return { label: first(p), sub, icon: this.portraits[p.i], struck: k.crossed.has(p.i), on: false, go: () => { k.crossed.has(p.i) ? k.crossed.delete(p.i) : k.crossed.add(p.i); sfx.click(); this.save(); this.notebook('suspects'); } };
      }), cols: 3, cellH: 220 });
      sections.push({ buttons: [{ label: '👉 Accuse someone', kind: 'danger', go: () => this.accusePanel() }] });
    }
    app.showPanel({ title: '📓 Notebook', tabs, sections, wide: true });
  }
  followJob(j){
    const app = this.app;
    if (j.target === 'accuse') return this.accusePanel();
    if (j.target === 'conductor'){ app.closePanels(); app.say('The conductor is in the dining car, by the bar.'); app.pointAt(this.conductor.holder.position); return; }
    if (j.target === 'person'){ this.notebook('people'); return; }
    const it = this.item(j.target === 'foot' ? 'foot' : j.target); if (!it) return;
    app.closePanels(); app.say(`${it.name} is in the ${CAR_NAME[this.m.scene]}.`); app.pointAt(it.pos);
  }
  comparePrints(target){
    const k = this.kase, list = k.printCompare(target), known = list.length, total = k.suspects.length;
    const pr = target === 'weapon' ? k.weaponPrint() : { ...k.printOf(target === 'door' ? k.doorPrinter() : k.glassPrinter()), part: 'full' };
    const sections = [{ text: target === 'weapon' && pr.part === 'partial' ? 'Only part of the print shows, so you can only tell its pattern. Who has the same pattern?' : 'Is it the same as anyone\'s?', images: [{ canvas: fingerprint(pr.pattern, pr.seed, pr.part), label: target === 'weapon' ? 'On the weapon' : target === 'door' ? 'On the handle' : 'On the glass' }] }];
    if (!known) sections.push({ text: 'You haven\'t taken anyone\'s fingerprints yet! Ask people for them.' });
    else sections.push({ images: list.map((r) => ({ canvas: fingerprint(r.p.pattern, k.printOf(r.p).seed, 'full', 140), label: `${first(r.p)}: ${r.match ? '✓ ' : ''}${r.why}`, good: r.match })) });
    if (known < total) sections.push({ text: `You have ${known} of ${total} people's fingerprints.` });
    sections.push({ buttons: [{ label: '◀ Back to the notebook', go: () => this.notebook('clues') }] });
    this.app.showPanel({ title: '🖐 Comparing fingerprints', sections, wide: true });
  }
  compareShoes(){
    const k = this.kase, c = this.m.clues.foot, list = k.shoeCompare(), total = k.suspects.length;
    const sections = [{ text: k.footText(), images: [{ canvas: shoePrint(c.show === 'size' ? 'smooth' : c.sole, c.show === 'sole' ? 0 : c.size, { ink: c.show === 'size' ? '#9a8a7a' : '#3a2a1a' }), label: 'The footprints' }] }];
    if (!list.length) sections.push({ text: 'You haven\'t looked at anyone\'s shoes yet!' });
    else sections.push({ images: list.map((r) => ({ canvas: shoePrint(r.p.sole, r.p.shoe), label: `${first(r.p)} ${r.match ? '✓' : '✗'}`, good: r.match })) }, { rows: list.map((r) => ({ title: `${first(r.p)}: ${r.match ? 'matches!' : 'different'}`, sub: r.why })) });
    if (list.length < total) sections.push({ text: `You've seen ${list.length} of ${total} people's shoes.` });
    sections.push({ buttons: [{ label: '◀ Back to the notebook', go: () => this.notebook('clues') }] });
    this.app.showPanel({ title: '👟 Comparing shoes', sections, wide: true });
  }

  // ---------- accusing ----------
  accusePanel(){
    if (!this.kase.has('body')){ this.app.say('First find out what happened!'); return; }
    const k = this.kase, m = this.m;
    this.app.showPanel({ title: '👉 Who did it?', sections: [
      { text: k.warnings > 0 ? 'Choose the murderer. (On Easy, if you get it wrong you get one warning.)' : 'Choose the murderer. Be careful: if you\'re wrong, they get away!' },
      { grid: this.people.filter((P) => P.info.i !== m.victim).map((P) => ({ label: first(P.info), sub: PROF[P.info.prof].name, icon: this.portraits[P.info.i], struck: k.crossed.has(P.info.i), go: () => this.confirmAccuse(P) })), cols: 3, cellH: 220 },
      { buttons: [{ label: '◀ Not yet', go: () => this.app.closePanels() }] },
    ] });
  }
  confirmAccuse(P){
    const p = P.info;
    this.app.showPanel({ title: `Accuse ${p.name}?`, portrait: this.portraits[p.i], sections: [
      { text: `Everyone will gather in the lounge car, and you'll tell them: "It was ${first(p)}!"${this.kase.warnings > 0 ? '' : ' If you\'re wrong, the real murderer gets away and the case is lost.'}` },
      { buttons: [{ label: `👉 It was ${first(p)}!`, kind: 'danger', go: () => this.accuse(P) }, { label: '◀ Not yet', go: () => this.accusePanel() }] },
    ] });
  }
  accuse(P){
    const app = this.app, k = this.kase, r = k.accuse(P.info.i);
    if (r.warning){
      sfx.warn(); this.save();
      app.showPanel({ title: 'Hmm, wait a moment...', portrait: this.portraits[P.info.i], sections: [
        { text: `"Me? It can't have been me!" says ${first(P.info)}. And they're right:` },
        { text: r.why, quote: true },
        { text: 'This was your one warning. Look at the clues again, and think about who can\'t prove where they were.' },
        { buttons: [{ label: '📓 Open the notebook', kind: 'primary', go: () => this.notebook('suspects') }] },
      ] });
      return;
    }
    this.gather(P, r.right);
  }
  // everyone gathers in the lounge car to hear the answer
  gather(P, right){
    const app = this.app, m = this.m, L = app.train.cars.lounge;
    this.stage = 'gather'; app.closePanels();
    app.fade(1, () => {
      // you stand at the piano end of the rug; the accused in front of you, everyone else gathered behind
      const z0 = L.z0;
      app.standAt(0, z0 + 4.4, 0);
      const others = this.people.filter((Q) => Q.info.i !== m.victim && Q !== P);
      P.place(0, z0 + 5.6, Math.PI);
      const spots = [[-0.3, 6.5], [0.1, 7.15], [-0.3, 7.7], [0.2, 8.2], [-0.15, 8.75], [0.15, 9.3]];
      others.forEach((Q, n) => { const [x, z] = spots[n]; Q.place(x, z0 + z, Math.PI + x * 0.3); });
      this.conductor.place(0.95, z0 + 4.7, -Math.PI / 2 - 0.3);
      app.fade(0);
      this.clock = 0; this.timeline = [{ t: 0.6, f: () => P.gesture('headShake') }, { t: 1.8, f: () => this.result(P, right) }];
    });
  }
  result(P, right){
    const app = this.app, k = this.kase, m = this.m, M = k.murderer;
    this.stage = 'result';
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    const sol = k.solution();
    if (right){ sfx.win(); for (const Q of this.people) if (Q !== P) Q.gesture('agree'); }
    else { sfx.lose(); }
    const rank = k.rank(right);
    const sections = right ? [
      { text: `"It was you, ${first(M)}!"\n\n${first(M)} goes pale. "How... how did you know?" The conductor takes ${first(M)} to the baggage car to wait for the police at Kingsbridge.`, quote: true },
      { heading: '🏆 Case solved!', text: `Rank: ${rank} · ${DIFFICULTY[m.difficulty].name} · ${fmtTime(k.time)}` },
    ] : [
      { text: `"It was you, ${first(P.info)}!"\n\n"Me?" says ${first(P.info)}. "But I didn't do anything!" And while everyone is looking at ${first(P.info)}, ${M.name} quietly slips off the back of the train as it slows for a bend...`, quote: true },
      { heading: '❌ The murderer got away!', text: `It was ${M.name}, the ${PROF[M.prof].name.toLowerCase()}. ${k.whyNot(P.info)}` },
    ];
    sections.push({ heading: '🔎 What really happened', text: sol.lines.join('\n\n') });
    if (sol.clear.length) sections.push({ heading: 'Who it couldn\'t have been', text: sol.clear.join(' ') });
    sections.push({ buttons: [{ label: '🚂 A new mystery', kind: 'primary', go: () => app.newCasePanel() }, { label: '🏠 Title screen', go: () => app.toTitle() }] });
    app.showPanel({ title: right ? `Solved! It was ${M.name}` : 'Case lost...', portrait: this.portraits[M.i], modal: true, sections });
    app.refreshHUD();
  }
}
function placeCarZ(app, z){ const c = app.train.carAt(z); return c ? (c.i ?? 99) : -1; }
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function fmtTime(s){ s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function hint(j){
  if (!j) return '';
  return {
    go: 'Walk through the train to find out what happened. Follow the signs over the doors.',
    'body-look': 'Look for traces of the murderer on the victim\'s clothes.',
    note: 'Was the victim carrying anything that shows who had a reason to do it?',
    weapon: 'Whoever held the weapon may have left fingerprints on it.',
    foot: 'Someone stepped in the spill. Measure their footprints.',
    fibre: 'Look around the door they ran out through.',
    talk: 'Ask everyone where they were when the lights went out, and what they heard. People who were together can vouch for each other.',
    prints: 'Take everyone\'s fingerprints, then compare them with the one on the weapon.',
    shoes: 'Look at everyone\'s shoes and compare them with the footprints.',
    look: 'Look at everyone carefully: their hair, their clothes, how tall they are.',
    conductor: 'The conductor is in the dining car. They might know something.',
    accuse: 'Cross off everyone who can\'t have done it. Who is left?',
  }[j.id] || '';
}
void AVATARS; void placeCar;
// fill in whatever an older save lacks (none yet: this is the first version of the save)
function upgrade(S){
  if (!S.v) S.v = 1;
  if (!S.cast) S.cast = [];
  return S;
}
