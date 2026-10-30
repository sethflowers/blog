// The Undercroft's sound. Everything is synthesised with Web Audio: no files to download.
// A stone-room reverb sits under everything; positional sounds use HRTF panners so they come from a direction.

export const audio = { ctx: null, master: null, verb: null, noise: null, muted: false, listener: null };

export function initAudio(){
  if (audio.ctx) return audio;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return audio;
  const ctx = new AC(); audio.ctx = ctx;
  const master = ctx.createGain(); master.gain.value = audio.muted ? 0 : 0.9; master.connect(ctx.destination); audio.master = master;
  // a long, dark stone reverb
  const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++){ const d = ir.getChannelData(ch);
    for (let k = 0; k < len; k++){ const t = k / len; d[k] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (k < 400 ? k / 400 : 1); } }
  const verb = ctx.createConvolver(); verb.buffer = ir;
  const verbLP = ctx.createBiquadFilter(); verbLP.type = 'lowpass'; verbLP.frequency.value = 2400;
  const verbGain = ctx.createGain(); verbGain.gain.value = 0.55;
  verb.connect(verbLP); verbLP.connect(verbGain); verbGain.connect(master);
  audio.verb = verb;
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
  for (let k = 0; k < nd.length; k++) nd[k] = Math.random() * 2 - 1;
  audio.noise = nb;
  const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), bd = brown.getChannelData(0);
  let last = 0; for (let k = 0; k < bd.length; k++){ last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[k] = last * 3.5; }
  // room tone: brown noise, slowly breathing
  const room = ctx.createBufferSource(); room.buffer = brown; room.loop = true;
  const roomLP = ctx.createBiquadFilter(); roomLP.type = 'lowpass'; roomLP.frequency.value = 320;
  const roomG = ctx.createGain(); roomG.gain.value = 0.22;
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 0.1;
  lfo.connect(lfoG); lfoG.connect(roomG.gain); lfo.start();
  room.connect(roomLP); roomLP.connect(roomG); roomG.connect(master); room.start();
  // drone: low tones a hair apart, beating against each other
  for (const [f, v] of [[41.2, 0.05], [41.9, 0.05], [61.7, 0.018], [82.0, 0.008]]){
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.3;
    const g = ctx.createGain(); g.gain.value = v;
    o.connect(lp); lp.connect(g); g.connect(master); g.connect(verb); o.start();
  }
  // the torch in your hand: a steady roar
  const roar = ctx.createBufferSource(); roar.buffer = nb; roar.loop = true;
  const roarLP = ctx.createBiquadFilter(); roarLP.type = 'lowpass'; roarLP.frequency.value = 500;
  const roarG = ctx.createGain(); roarG.gain.value = 0.05;
  roar.connect(roarLP); roarLP.connect(roarG); roarG.connect(master); roar.start();
  // the shield's hum, silent until it is up
  const hum = ctx.createOscillator(), hum2 = ctx.createOscillator(); hum.frequency.value = 220; hum2.frequency.value = 331;
  const humG = ctx.createGain(); humG.gain.value = 0; hum.connect(humG); hum2.connect(humG); humG.connect(master); hum.start(); hum2.start();
  audio.humGain = humG;
  audio.next = { drip: 1.5, crackle: 0.2, event: 25 + Math.random() * 20 };
  return audio;
}
export function resumeAudio(){ if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume(); }
export function setMuted(m){ audio.muted = m; if (audio.master) audio.master.gain.value = m ? 0 : 0.9; }
const ok = () => audio.ctx && audio.ctx.state === 'running';

function panner(at){
  const p = audio.ctx.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 1.1;
  p.positionX.value = at[0]; p.positionY.value = at[1]; p.positionZ.value = at[2];
  return p;
}
// route a source through a gain (returned, for envelopes), optionally from a position, optionally into the reverb
function voice(node, at, wet){
  const ctx = audio.ctx, g = ctx.createGain(); g.gain.value = 0;
  node.connect(g);
  if (at){ const p = panner(at); g.connect(p); p.connect(audio.master); if (wet){ const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(audio.verb); } }
  else { g.connect(audio.master); if (wet){ const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(audio.verb); } }
  return g;
}
function env(g, t, peak, attack, dur){
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
}
function noise(t, dur, type, freq, q, gain, at, wet, freqTo){
  const ctx = audio.ctx, s = ctx.createBufferSource(); s.buffer = audio.noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
  s.connect(f);
  env(voice(f, at, wet), t, gain, 0.005, dur);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
function tone(t, dur, type, f0, f1, gain, at, wet, attack){
  const ctx = audio.ctx, o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(voice(o, at, wet), t, gain, attack || 0.005, dur);
  o.start(t); o.stop(t + dur + 0.05);
}

export function setListener(pos, fwd){
  if (!ok()) return;
  const L = audio.ctx.listener;
  if (L.positionX){ L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
    L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
}

// ambience: drips, the torch crackling, and now and then something far away
export function ambience(dt, px, pz){
  if (!ok()) return;
  const n = audio.next, t = audio.ctx.currentTime;
  if ((n.drip -= dt) < 0){
    n.drip = 0.8 + Math.random() * 4;
    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 10, f = 900 + Math.random() * 1400;
    tone(t, 0.18, 'sine', f * 0.6, f * 1.6, 0.25, [px + Math.cos(a) * r, 2.5, pz + Math.sin(a) * r], 0.8, 0.004);
  }
  if ((n.crackle -= dt) < 0){
    n.crackle = 0.1 + Math.random() * 0.6;
    for (let k = 0; k < 1 + Math.random() * 3; k++) noise(t + Math.random() * 0.08, 0.02 + Math.random() * 0.03, 'highpass', 1500 + Math.random() * 3000, 0.7, 0.05 + Math.random() * 0.08, null, 0.05);
  }
  if ((n.event -= dt) < 0){
    n.event = 30 + Math.random() * 50;
    const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 10, at = [px + Math.cos(a) * r, 1.5, pz + Math.sin(a) * r];
    if (Math.random() < 0.5) groan(at, 0.5); else for (let k = 0; k < 14; k++) noise(t + k * 0.09 + Math.random() * 0.05, 0.06, 'bandpass', 2500 + Math.random() * 2500, 6, 0.22, at, 0.8);
  }
}

export const sfx = {
  step(hurry, wet){ if (!ok()) return; const t = audio.ctx.currentTime;
    noise(t, 0.12, 'bandpass', 700 + Math.random() * 300, 0.9, hurry ? 0.5 : 0.32, null, 0.5);
    noise(t, 0.08, 'lowpass', 180, 0.7, hurry ? 0.6 : 0.4, null, 0.3);
    if (wet) noise(t + 0.02, 0.15, 'bandpass', 1800, 2, 0.15, null, 0.3); },
  swing(heavy){ if (!ok()) return; const t = audio.ctx.currentTime;
    noise(t, heavy ? 0.4 : 0.25, 'bandpass', heavy ? 500 : 1200, 1.2, heavy ? 0.5 : 0.4, null, 0.2, heavy ? 200 : 3000); },
  thrust(){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.18, 'bandpass', 900, 1.5, 0.45, null, 0.2, 2400); },
  hitFlesh(at){ if (!ok()) return; const t = audio.ctx.currentTime;
    noise(t, 0.12, 'lowpass', 600, 1, 0.9, at, 0.3); tone(t, 0.1, 'sine', 120, 60, 0.6, at, 0.2); noise(t + 0.02, 0.2, 'bandpass', 2200, 3, 0.25, at, 0.3); },
  clang(at){ if (!ok()) return; const t = audio.ctx.currentTime;
    for (const f of [1750, 2630, 3920]) tone(t, 0.6, 'sine', f, f * 0.98, 0.12, at, 0.6); noise(t, 0.05, 'highpass', 3000, 0.5, 0.4, at, 0.3); },
  crossbow(){ if (!ok()) return; const t = audio.ctx.currentTime;
    noise(t, 0.08, 'highpass', 1500, 0.7, 0.6, null, 0.3); tone(t, 0.25, 'triangle', 180, 90, 0.4, null, 0.3); },
  thud(at){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.2, 'lowpass', 300, 1, 0.7, at, 0.5); },
  hurt(){ if (!ok()) return; const t = audio.ctx.currentTime;
    tone(t, 0.25, 'sawtooth', 190, 120, 0.25, null, 0.2, 0.02); noise(t, 0.15, 'lowpass', 500, 1, 0.6, null, 0.2); },
  zombieGroan(at){ groan(at, 0.35, 1.6); },
  zombieAttack(at){ if (!ok()) return; const t = audio.ctx.currentTime; groan(at, 0.5, 2.2, 0.6); noise(t + 0.25, 0.15, 'bandpass', 900, 1, 0.5, at, 0.3); },
  zombieDie(at){ groan(at, 0.6, 1.2, 1.4); },
  roar(at){ if (!ok()) return; const t = audio.ctx.currentTime; groan(at, 1.2, 0.55, 2.2);
    noise(t, 2.0, 'bandpass', 300, 1.5, 0.9, at, 0.8, 120); },
  barf(at){ if (!ok()) return; const t = audio.ctx.currentTime; groan(at, 0.8, 0.9, 1.2);
    noise(t + 0.3, 1.2, 'lowpass', 900, 2, 1.0, at, 0.6, 300); for (let k = 0; k < 8; k++) noise(t + 0.5 + k * 0.12, 0.08, 'lowpass', 400, 4, 0.6, at, 0.4); },
  boing(at){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 0.5, 'sine', 90, 360, 0.6, at, 0.4, 0.01); tone(t, 0.5, 'triangle', 180, 720, 0.2, at, 0.4); },
  stomp(at){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 0.6, 'sine', 70, 30, 1.0, at, 0.8); noise(t, 0.5, 'lowpass', 250, 1, 1.0, at, 0.8); },
  explosion(at){ if (!ok()) return; const t = audio.ctx.currentTime;
    tone(t, 1.2, 'sine', 90, 25, 1.4, at, 1.0); noise(t, 1.6, 'lowpass', 2000, 0.7, 1.5, at, 1.0, 150); noise(t + 0.05, 0.6, 'highpass', 2500, 0.5, 0.4, at, 0.6); },
  bombThrow(){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.2, 'bandpass', 700, 1, 0.3, null, 0.2, 1800); },
  beep(at){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 0.08, 'square', 1800, 1800, 0.12, at, 0.2); },
  freeze(){ if (!ok()) return; const t = audio.ctx.currentTime;
    noise(t, 1.2, 'highpass', 4000, 0.7, 0.4, null, 0.8, 9000); for (let k = 0; k < 10; k++) tone(t + k * 0.07, 0.3, 'sine', 2500 + Math.random() * 2500, 0, 0.06, null, 0.8); },
  crack(at){ if (!ok()) return; const t = audio.ctx.currentTime; for (let k = 0; k < 5; k++) noise(t + k * 0.07 + Math.random() * 0.05, 0.05, 'highpass', 2000, 1, 0.4, at, 0.6); },
  splash(){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 1.0, 'lowpass', 1800, 0.8, 1.2, null, 0.8, 300); tone(t, 0.5, 'sine', 200, 60, 0.5, null, 0.5); },
  magnet(on){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 0.3, 'sawtooth', on ? 60 : 90, on ? 90 : 60, 0.15, null, 0.3, 0.05); },
  shield(on){ if (!audio.humGain) return; audio.humGain.gain.setTargetAtTime(on ? 0.03 : 0, audio.ctx.currentTime, 0.3);
    if (on && ok()){ const t = audio.ctx.currentTime; for (const f of [523, 659, 784, 1047]) tone(t + f / 4000, 1.2, 'sine', f, f, 0.12, null, 0.8, 0.05); } },
  // flight: a rush of air on take-off, soft gusts while you're up, a thump when you land
  flight(on){ if (!ok()) return; const t = audio.ctx.currentTime;
    if (on){ noise(t, 1.4, 'bandpass', 300, 0.8, 0.5, null, 0.4, 1800); for (const f of [587, 784, 1175]) tone(t + 0.2 + f / 5000, 1.1, 'sine', f, f * 1.5, 0.08, null, 0.8, 0.1); }
    else { noise(t, 0.5, 'bandpass', 900, 0.8, 0.3, null, 0.3, 200); tone(t + 0.35, 0.2, 'sine', 90, 50, 0.3, null, 0.2); } },
  gust(at, gain){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 1.6, 'bandpass', 250 + Math.random() * 200, 0.7, gain || 0.18, at, 0.5, 700 + Math.random() * 500); },
  power(){ if (!ok()) return; const t = audio.ctx.currentTime;
    [392, 494, 587, 784, 988].forEach((f, k) => tone(t + k * 0.12, 1.4, 'sine', f, f, 0.18, null, 0.9, 0.02)); },
  pickup(){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 0.15, 'sine', 660, 990, 0.2, null, 0.4); tone(t + 0.09, 0.2, 'sine', 990, 1320, 0.15, null, 0.4); },
  weapon(){ if (!ok()) return; const t = audio.ctx.currentTime; [523, 659, 784, 1047, 1319].forEach((f, k) => tone(t + k * 0.09, 0.9, 'triangle', f, f, 0.15, null, 0.7)); sfx.clang(null); },
  eat(){ if (!ok()) return; const t = audio.ctx.currentTime; for (let k = 0; k < 4; k++) noise(t + k * 0.18, 0.09, 'bandpass', 1200 + Math.random() * 800, 1.5, 0.4, null, 0.1);
    tone(t + 0.8, 0.5, 'sine', 523, 784, 0.12, null, 0.4); },
  chest(){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 0.8, 'sawtooth', 110, 180, 0.08, null, 0.4, 0.2); noise(t, 0.6, 'bandpass', 500, 4, 0.3, null, 0.4); },
  lock(at){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.06, 'highpass', 2500, 1, 0.4, at, 0.3); tone(t, 0.1, 'square', 900, 700, 0.06, at, 0.3); },
  door(at){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 1.2, 'sawtooth', 160, 120, 0.1, at, 0.6, 0.3); sfx.clang(at); },
  cheer(at){ if (!ok()) return; const t = audio.ctx.currentTime;
    for (let k = 0; k < 3; k++) tone(t + k * 0.22, 0.25, 'triangle', 330 + k * 60, 520 + k * 80, 0.12, at, 0.4, 0.03); },
  gate(at){ if (!ok()) return; const t = audio.ctx.currentTime;
    for (let k = 0; k < 20; k++) noise(t + k * 0.1, 0.08, 'bandpass', 1500 + Math.random() * 1000, 5, 0.25, at, 0.6); tone(t, 2, 'sawtooth', 60, 50, 0.15, at, 0.7, 0.2); },
  die(){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 2.5, 'sawtooth', 220, 55, 0.25, null, 0.9, 0.05); },
  win(){ if (!ok()) return; const t = audio.ctx.currentTime; [262, 330, 392, 523, 659, 784].forEach((f, k) => tone(t + k * 0.15, 2.0, 'sine', f, f, 0.15, null, 0.9, 0.02)); },
  scrape(at){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.45, 'bandpass', 220, 2, 0.6, at, 0.6, 160); noise(t, 0.45, 'bandpass', 1200, 4, 0.12, at, 0.4); },
  ignite(at){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.6, 'lowpass', 400, 0.7, 0.8, at, 0.5, 2400); tone(t, 0.3, 'sine', 90, 50, 0.3, at, 0.3); },
  douse(at){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.7, 'highpass', 2000, 0.6, 0.35, at, 0.5, 600); },
  chime(){ if (!ok()) return; const t = audio.ctx.currentTime; [784, 988, 1175, 1568].forEach((f, k) => tone(t + k * 0.75, 0.9, 'sine', f, f, 0.12, null, 0.9, 0.01)); },
  lever(at){ if (!ok()) return; const t = audio.ctx.currentTime; noise(t, 0.08, 'bandpass', 900, 3, 0.5, at, 0.4); tone(t + 0.05, 0.25, 'square', 140, 90, 0.08, at, 0.4); sfx.clang(at); },
  shrine(){ if (!ok()) return; const t = audio.ctx.currentTime; [196, 294, 392, 587].forEach((f, k) => tone(t + k * 0.05, 2.4, 'sine', f, f, 0.1, null, 1.0, 0.3)); },
  deny(){ if (!ok()) return; const t = audio.ctx.currentTime; tone(t, 0.15, 'square', 180, 150, 0.08, null, 0.2); },
};

// a throaty, wavering voice: zombies, distant things, the monster
function groan(at, gain, pitch, dur){
  if (!ok()) return;
  const ctx = audio.ctx, t = ctx.currentTime; pitch = pitch || 1; dur = dur || 3;
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(); o.type = o2.type = 'sawtooth';
  const base = (55 + Math.random() * 25) * pitch;
  o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
  o2.frequency.setValueAtTime(base * 1.51, t); o2.frequency.linearRampToValueAtTime(base * 1.02, t + dur);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420 * pitch; lp.Q.value = 4;
  const wob = ctx.createOscillator(), wg = ctx.createGain(); wob.frequency.value = 5.5; wg.gain.value = 140 * pitch; wob.connect(wg); wg.connect(lp.frequency);
  o.connect(lp); o2.connect(lp);
  const g = voice(lp, at, 0.8);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.25); g.gain.linearRampToValueAtTime(gain * 0.6, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
  o.start(t); o2.start(t); wob.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1); wob.stop(t + dur + 0.1);
}
