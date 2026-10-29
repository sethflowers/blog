// All the sound is made live with Web Audio: wind in the trees, birds, footsteps in the grass, and the
// voices of the animals. Nothing to download. Sounds placed in the world are panned and fade with distance.
let ctx = null, master = null, ambGain = null, drumGain = null, muted = false;
const listener = { x: 0, z: 0, yaw: 0 };

function noiseBuffer(sec, brown){
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++){
    const w = Math.random() * 2 - 1;
    if (brown){ last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
let white = null, brown = null;

export function initAudio(){
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
  white = noiseBuffer(2, false); brown = noiseBuffer(4, true);
  // wind: brown noise, low-passed, swelling and falling
  ambGain = ctx.createGain(); ambGain.gain.value = 0.0; ambGain.connect(master);
  const src = ctx.createBufferSource(); src.buffer = brown; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
  const g = ctx.createGain(); g.gain.value = 0.5;
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 0.3; lfo.connect(lfoG); lfoG.connect(g.gain);
  const lfo2 = ctx.createOscillator(), lfo2G = ctx.createGain(); lfo2.frequency.value = 0.05; lfo2G.gain.value = 250; lfo2.connect(lfo2G); lfo2G.connect(lp.frequency);
  src.connect(lp); lp.connect(g); g.connect(ambGain); src.start(); lfo.start(); lfo2.start();
  ambGain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 3);
  drumGain = ctx.createGain(); drumGain.gain.value = 0; drumGain.connect(master);
}
export function setMuted(m){ muted = m; if (master) master.gain.value = m ? 0 : 0.9; }
export function isMuted(){ return muted; }
export function setListener(x, z, yaw){ listener.x = x; listener.z = z; listener.yaw = yaw; }

// an output node for a sound at a world position (or right here when there is none)
function out(pos, vol = 1){
  const g = ctx.createGain();
  if (!pos){ g.gain.value = vol; g.connect(master); return g; }
  const dx = pos[0] - listener.x, dz = pos[1] - listener.z, d = Math.hypot(dx, dz);
  g.gain.value = vol / (1 + d * d * 0.004 + d * 0.05);
  if (ctx.createStereoPanner){
    const p = ctx.createStereoPanner();
    // the camera looks along -Z rotated by yaw; right is +X rotated
    const rx = Math.cos(listener.yaw) * dx - Math.sin(listener.yaw) * dz;
    p.pan.value = Math.max(-1, Math.min(1, rx / (Math.abs(rx) + 4)));
    g.connect(p); p.connect(master);
  } else g.connect(master);
  return g;
}
function noise(dest, t, dur, type, f0, f1, q, v0, attack = 0.005){
  const s = ctx.createBufferSource(); s.buffer = white; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v0, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(dest, t, dur, wave, f0, f1, v0, attack = 0.01, filt){
  const o = ctx.createOscillator(); o.type = wave;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v0, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (filt){ const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filt; f.Q.value = 2; o.connect(f); node = f; }
  node.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  return o;
}
// a rough animal voice: a buzzy source through two vowel-like resonances, with a wobble
function voice(dest, t, dur, f0, f1, formants, v, rough = 0.5){
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
  const wob = ctx.createOscillator(), wg = ctx.createGain(); wob.frequency.value = 23 + Math.random() * 12; wg.gain.value = f0 * 0.12 * rough;
  wob.connect(wg); wg.connect(o.frequency);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.12, dur * 0.2));
  g.gain.setValueAtTime(v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const [f, q, a] of formants){
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const ga = ctx.createGain(); ga.gain.value = a; o.connect(bp); bp.connect(ga); ga.connect(g);
  }
  g.connect(dest); o.start(t); wob.start(t); o.stop(t + dur + 0.05); wob.stop(t + dur + 0.05);
  noise(dest, t, dur, 'bandpass', formants[0][0] * 2, formants[0][0] * 1.5, 1.5, v * rough * 0.5, 0.05);
}

export const sfx = {
  step(pos, size, run){
    if (!ctx) return; const t = ctx.currentTime;
    noise(out(pos, 0.12 * size * (run ? 1.4 : 1)), t, 0.09 + size * 0.05, 'bandpass', 2400 / Math.sqrt(size), 1200 / Math.sqrt(size), 0.9, 0.5);
    if (size > 2) tone(out(pos, 0.25 * size), t, 0.18, 'sine', 70, 40, 0.6);
  },
  swipe(){ if (!ctx) return; const t = ctx.currentTime; noise(out(null, 0.5), t, 0.18, 'bandpass', 900, 3500, 1.2, 0.5, 0.03); },
  hiss(){ if (!ctx) return; const t = ctx.currentTime; noise(out(null, 0.35), t, 0.6, 'highpass', 3500, 5000, 0.7, 0.5, 0.04); },
  yowl(){ if (!ctx) return; const t = ctx.currentTime; voice(out(null, 0.25), t, 0.7, 420, 300, [[900, 6, 1], [2400, 8, 0.5]], 0.6, 0.3); },
  meow(){ if (!ctx) return; const t = ctx.currentTime; voice(out(null, 0.18), t, 0.45, 520, 640, [[1100, 6, 1], [2600, 8, 0.4]], 0.6, 0.1); },
  pounce(){ if (!ctx) return; const t = ctx.currentTime; noise(out(null, 0.4), t, 0.3, 'bandpass', 600, 2000, 1, 0.4, 0.05); },
  land(){ if (!ctx) return; const t = ctx.currentTime; noise(out(null, 0.3), t, 0.15, 'lowpass', 800, 200, 0.7, 0.6); },
  hit(pos, big){
    if (!ctx) return; const t = ctx.currentTime, o = out(pos, big ? 0.9 : 0.6);
    tone(o, t, 0.2, 'sine', big ? 120 : 180, 50, 0.9); noise(o, t, 0.12, 'lowpass', 2500, 400, 0.7, 0.7);
    noise(o, t + 0.01, 0.08, 'bandpass', 5000, 3000, 2, 0.25);
  },
  hurt(){ if (!ctx) return; const t = ctx.currentTime; voice(out(null, 0.3), t, 0.35, 700, 500, [[1300, 5, 1], [3000, 8, 0.6]], 0.7, 0.5); },
  roar(pos, big = 1){
    if (!ctx) return; const t = ctx.currentTime, o = out(pos, 1.0);
    voice(o, t, 1.4 * big, 95, 70, [[350, 3, 1], [800, 4, 0.6], [1600, 5, 0.25]], 0.9, 0.9);
    noise(o, t, 1.3 * big, 'lowpass', 600, 200, 0.7, 0.5, 0.1);
  },
  growl(pos, f = 90){ if (!ctx) return; const t = ctx.currentTime; voice(out(pos, 0.7), t, 0.9, f, f * 0.9, [[f * 4, 3, 1], [f * 9, 4, 0.4]], 0.6, 1.0); },
  snarl(pos){ if (!ctx) return; const t = ctx.currentTime; voice(out(pos, 0.7), t, 0.6, 180, 150, [[700, 4, 1], [1800, 5, 0.5]], 0.7, 1.0); },
  howl(pos){ if (!ctx) return; const t = ctx.currentTime; const o = tone(out(pos, 0.6), t, 3.2, 'triangle', 380, 520, 0.4, 0.6, 700);
    o.frequency.setValueAtTime(380, t); o.frequency.linearRampToValueAtTime(560, t + 0.9); o.frequency.linearRampToValueAtTime(500, t + 2.6); o.frequency.linearRampToValueAtTime(330, t + 3.2); },
  grunt(pos){ if (!ctx) return; const t = ctx.currentTime; voice(out(pos, 0.7), t, 0.25, 140, 110, [[500, 3, 1], [1200, 4, 0.5]], 0.8, 1.0); },
  squeal(pos){ if (!ctx) return; const t = ctx.currentTime; voice(out(pos, 0.6), t, 0.8, 900, 1300, [[2000, 3, 1], [3500, 4, 0.5]], 0.6, 0.6); },
  squeak(pos){ if (!ctx) return; const t = ctx.currentTime; tone(out(pos, 0.4), t, 0.15, 'sine', 2600, 3400, 0.4); },
  eat(){ if (!ctx) return; const t = ctx.currentTime; for (let i = 0; i < 4; i++) noise(out(null, 0.3), t + i * 0.18, 0.1, 'bandpass', 1500, 900, 1, 0.5); },
  bird(pos){
    if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.25);
    const n = 2 + Math.floor(Math.random() * 5), f = 2600 + Math.random() * 1800;
    for (let i = 0; i < n; i++) tone(o, t + i * (0.09 + Math.random() * 0.05), 0.07 + Math.random() * 0.05, 'sine', f * (1 + Math.random() * 0.2), f * (0.8 + Math.random() * 0.5), 0.3);
  },
  win(){ if (!ctx) return; const t = ctx.currentTime; [0, 0.12, 0.24].forEach((d, i) => tone(out(null, 0.2), t + d, 0.6, 'triangle', [392, 494, 587][i], [392, 494, 587][i], 0.4)); },
  // the fight: deep drums that build while it lasts
  fight(on){
    if (!ctx) return;
    drumGain.gain.cancelScheduledValues(ctx.currentTime);
    drumGain.gain.linearRampToValueAtTime(on ? 0.5 : 0, ctx.currentTime + (on ? 0.4 : 2));
  },
  drum(beat){ if (!ctx || drumGain.gain.value < 0.01) return; const t = ctx.currentTime;
    tone(drumGain, t, 0.35, 'sine', beat % 4 === 0 ? 75 : 95, 40, beat % 2 ? 0.5 : 0.9); if (beat % 4 === 2) noise(drumGain, t, 0.12, 'bandpass', 300, 150, 1, 0.3); },
};
