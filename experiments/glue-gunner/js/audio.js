// Made-up sounds (Web Audio, nothing to download): the glue gun's wet thwump, the splat when it
// sticks, strings creaking under strain, flesh tearing, alien shrieks, hisses and clicks, your
// heartbeat when you're hurt, and the wind up here.
let ctx = null, master = null, noise = null, wind = null, heartT = null, clickT = null;
export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // the wind: filtered noise, slowly swelling
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.06;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.04; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    const lfo2 = ctx.createOscillator(), lg2 = ctx.createGain(); lfo2.frequency.value = 0.11; lg2.gain.value = 180; lfo2.connect(lg2); lg2.connect(f.frequency); lfo2.start();
    s.connect(f); f.connect(g); g.connect(master); s.start();
    wind = g;
    clicks();
  } catch (e) { ctx = null; }
}
function out(pan){
  if (pan == null || !ctx.createStereoPanner) return master;
  const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(master); return p;
}
function tone(type, f0, f1, dur, vol, when = 0, vib = 0, pan){
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (vib){ const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vib; lg.gain.value = f0 * 0.08; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur); }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out(pan)); o.start(t); o.stop(t + dur + 0.02);
}
function hiss(type, f0, f1, dur, vol, q = 1, when = 0, pan){
  if (!ctx) return;
  const t = ctx.currentTime + when, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; s.playbackRate.value = 0.8 + Math.random() * 0.4; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out(pan)); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
// a screech: a few detuned saws sliding, through a resonant filter (a throat), with a rasp of noise
function screech(base, dur, vol, pan){
  if (!ctx) return;
  const t = ctx.currentTime, f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.Q.value = 4; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(2400, t + dur * 0.3); f.frequency.linearRampToValueAtTime(1100, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05); g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g); g.connect(out(pan));
  for (const k of [1, 1.013, 0.987, 1.5]){
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * k, t); o.frequency.linearRampToValueAtTime(base * k * 1.7, t + dur * 0.25); o.frequency.linearRampToValueAtTime(base * k * 0.9, t + dur);
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 26 + Math.random() * 14; lg.gain.value = base * 0.12; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur);
    o.connect(f); o.start(t); o.stop(t + dur + 0.05);
  }
  hiss('bandpass', 3000, 1500, dur, vol * 0.9, 2, 0, pan);
}
function clicks(){
  // now and then, somewhere, clicking: the aliens talking to each other
  if (!ctx) return;
  if (sfx.aliensNear > 0){ const n = 3 + Math.floor(Math.random() * 6), p = Math.random() * 2 - 1; for (let i = 0; i < n; i++) hiss('bandpass', 2500 + Math.random() * 1500, 2000, 0.025, 0.08, 8, i * (0.05 + Math.random() * 0.04), p); }
  clickT = setTimeout(clicks, 2500 + Math.random() * 5000);
}
export const sfx = {
  aliensNear: 0,
  click(){ tone('square', 880, 880, 0.04, 0.05); },
  // the gun: a wet compressed thwump
  shoot(){ hiss('lowpass', 1800, 200, 0.18, 0.5, 1); tone('sine', 220, 70, 0.16, 0.35); tone('triangle', 900, 300, 0.06, 0.08); },
  splat(far){ const v = far ? 0.15 : 0.35; hiss('lowpass', 1200, 150, 0.22, v, 2); tone('sine', 160, 60, 0.12, v * 0.6); },
  miss(){ tone('sine', 400, 200, 0.2, 0.06); },
  tie(){ tone('sine', 300, 600, 0.12, 0.12); hiss('bandpass', 2000, 4000, 0.15, 0.12, 3); },
  // a string creaking as it takes the strain
  creak(k){ tone('sawtooth', 70 + k * 60, 60 + k * 50, 0.12, 0.05 + k * 0.05, 0, 30); },
  snap(){ hiss('highpass', 3000, 6000, 0.08, 0.2, 1); tone('square', 1200, 200, 0.05, 0.06); },
  // flesh giving way: a wet rip, a crack of bone, a gush
  tear(pan){ hiss('bandpass', 600, 2400, 0.25, 0.7, 1.5, 0, pan); hiss('lowpass', 400, 80, 0.4, 0.6, 1, 0.05, pan); tone('square', 180, 60, 0.07, 0.25, 0.02, 0, pan); hiss('highpass', 4000, 1200, 0.5, 0.25, 1, 0.12, pan); },
  shriek(pan, big){ screech(big ? 300 : 380 + Math.random() * 160, big ? 1.3 : 0.6 + Math.random() * 0.5, big ? 0.22 : 0.14, pan); },
  hiss(pan){ hiss('highpass', 2500, 5000, 0.7, 0.12, 1, 0, pan); hiss('bandpass', 1500, 900, 0.6, 0.1, 6, 0.05, pan); },
  swipe(pan){ hiss('bandpass', 1500, 5000, 0.18, 0.3, 2, 0, pan); },
  thud(v = 1){ tone('sine', 90, 40, 0.25, 0.25 * v); hiss('lowpass', 300, 60, 0.25, 0.25 * v); },
  hurt(){ tone('sawtooth', 160, 90, 0.3, 0.2, 0, 8); hiss('lowpass', 900, 200, 0.25, 0.4); },
  kill(){ tone('triangle', 520, 520, 0.08, 0.1); tone('triangle', 780, 780, 0.14, 0.1, 0.08); },
  wave(){ [196, 233, 262, 311].forEach((f, i) => tone('sawtooth', f, f, 0.5, 0.06, i * 0.18, 5)); tone('sine', 60, 40, 1.8, 0.3); },
  win(){ [392, 494, 587, 784].forEach((f, i) => tone('square', f, f, i === 3 ? 0.5 : 0.14, 0.08, i * 0.13)); },
  dead(){ tone('sawtooth', 200, 40, 1.6, 0.25, 0, 4); hiss('lowpass', 800, 60, 1.5, 0.4); },
};
// your heart, faster and louder the more hurt you are (h: 0 dead .. 1 healthy)
export function heartbeat(h){
  if (!ctx) return;
  if (h > 0.45 || h <= 0){ if (heartT){ clearTimeout(heartT); heartT = null; } return; }
  if (heartT) return;
  const beat = () => { tone('sine', 60, 40, 0.12, 0.35); tone('sine', 55, 38, 0.12, 0.25, 0.18); heartT = setTimeout(() => { heartT = null; if (sfx._h > 0 && sfx._h <= 0.45) heartbeat(sfx._h); }, 450 + sfx._h * 900); };
  beat();
}
export function setHealthForAudio(h){ sfx._h = h; heartbeat(h); }
