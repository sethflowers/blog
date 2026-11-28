// Made-up sounds (Web Audio, nothing to download): boings, pops, glops, the bell and the till, a
// BOOM, zaps, whistles going up (floating away) and down (shrinking), oinks and ribbits, customers
// babbling in gibberish at their own pitch, a wah-wah for a wrong order, a fanfare for a discovery,
// and the lab bubbling and crackling in the background.
let ctx = null, master = null, noise = null;
export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ambience();
  } catch (e) { ctx = null; }
}
function out(pan){
  if (pan == null || !ctx.createStereoPanner) return master;
  const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(master); return p;
}
function tone(type, f0, f1, dur, vol, when = 0, { vib = 0, pan, curve = 'exp' } = {}){
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); else o.frequency.linearRampToValueAtTime(f1, t + dur);
  if (vib){ const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vib; lg.gain.value = f0 * 0.06; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur); }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out(pan)); o.start(t); o.stop(t + dur + 0.02);
}
function hiss(type, f0, f1, dur, vol, q = 1, when = 0, pan){
  if (!ctx) return;
  const t = ctx.currentTime + when, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out(pan)); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}
// the lab in the background: bubbling now and then, the Tesla coil buzzing
function ambience(){
  const bub = () => { if (!ctx) return; if (ctx.state === 'running'){ const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone('sine', 300 + Math.random() * 500, 700 + Math.random() * 600, 0.06, 0.025, i * 0.07); } setTimeout(bub, 500 + Math.random() * 1400); };
  bub();
  const buzz = () => { if (!ctx) return; if (ctx.state === 'running' && Math.random() < 0.6){ hiss('bandpass', 2500, 1800, 0.12 + Math.random() * 0.2, 0.03, 3, 0, -0.6); tone('sawtooth', 120, 118, 0.25, 0.012, 0, { pan: -0.6 }); } setTimeout(buzz, 900 + Math.random() * 2500); };
  buzz();
}
export const sfx = {
  click(){ tone('square', 900, 700, 0.05, 0.05); },
  pop(){ tone('sine', 500, 1200, 0.08, 0.15); },
  scoop(){ hiss('lowpass', 900, 300, 0.18, 0.2, 1); tone('sine', 220, 140, 0.15, 0.12); },
  glop(){ tone('sine', 700, 180, 0.16, 0.2); tone('sine', 400, 120, 0.12, 0.12, 0.08); },
  bin(){ hiss('lowpass', 1500, 200, 0.3, 0.2, 1); tone('square', 160, 80, 0.2, 0.06); },
  ding(){ for (const [f, w] of [[1320, 0], [1980, 0], [2640, 0]]) tone('sine', f, f * 0.995, 1.2, 0.09 - f / 50000, w); },
  till(){ tone('square', 1800, 1800, 0.06, 0.05); tone('sine', 1568, 1568, 0.5, 0.12, 0.08); tone('sine', 2093, 2093, 0.6, 0.1, 0.16); },
  coin(){ tone('square', 988, 988, 0.07, 0.06); tone('square', 1319, 1319, 0.25, 0.06, 0.07); },
  lick(){ hiss('bandpass', 2500, 1200, 0.12, 0.12, 2); },
  crunch(){ hiss('bandpass', 1800, 600, 0.09, 0.2, 1.5); hiss('bandpass', 1500, 500, 0.08, 0.18, 1.5, 0.11); },
  gulp(){ tone('sine', 300, 90, 0.18, 0.25); },
  boing(){ tone('sine', 160, 600, 0.35, 0.2, 0, { vib: 18, curve: 'lin' }); },
  inflate(){ hiss('bandpass', 600, 2400, 0.9, 0.12, 2); tone('sine', 200, 700, 0.9, 0.06, 0, { curve: 'lin' }); },
  wheee(v = 1){ tone('triangle', 500 * v, 1500 * v, 1.1, 0.12, 0, { vib: 7 }); },
  shrink(){ tone('square', 1400, 300, 0.5, 0.07); tone('sine', 2000, 600, 0.5, 0.08); },
  stretch(){ tone('sawtooth', 120, 500, 0.7, 0.07, 0, { vib: 25, curve: 'lin' }); },
  grow(){ for (let i = 0; i < 6; i++) tone('triangle', 300 + i * 80, 340 + i * 80, 0.1, 0.06, i * 0.07); },
  plop(){ tone('sine', 220, 110, 0.12, 0.15); },
  poof(){ hiss('lowpass', 3000, 300, 0.6, 0.3, 0.7); tone('sine', 900, 200, 0.3, 0.08); },
  fuse(){ hiss('highpass', 4000, 6000, 1.0, 0.08, 1); },
  boom(){ hiss('lowpass', 1200, 40, 1.8, 0.9, 0.5); tone('sine', 120, 30, 1.2, 0.6); tone('sawtooth', 80, 25, 0.6, 0.2); },
  zap(){ for (let i = 0; i < 5; i++){ hiss('bandpass', 3000 + Math.random() * 2000, 800, 0.08, 0.3, 4, i * 0.06); tone('sawtooth', 60 + Math.random() * 30, 50, 0.08, 0.12, i * 0.06); } },
  fire(){ hiss('lowpass', 900, 300, 2.5, 0.25, 0.6); tone('sawtooth', 90, 60, 1.0, 0.08); },
  vanish(){ for (let i = 0; i < 8; i++) tone('sine', 1800 - i * 150, 1700 - i * 150, 0.12, 0.05, i * 0.05); },
  hairfall(){ tone('triangle', 900, 200, 0.6, 0.08); },
  yum(){ tone('sine', 300, 500, 0.25, 0.1, 0, { vib: 6 }); tone('sine', 500, 400, 0.4, 0.08, 0.25, { vib: 6 }); },
  oink(){ for (const w of [0, 0.25]) { tone('sawtooth', 260, 160, 0.16, 0.12, w, { vib: 40 }); hiss('bandpass', 700, 400, 0.15, 0.1, 3, w); } },
  ribbit(){ for (const w of [0, 0.18]) tone('square', 180, 120, 0.12, 0.1, w, { vib: 60 }); },
  bok(){ for (const [w, f] of [[0, 700], [0.15, 700], [0.3, 950]]) tone('square', f, f * 0.7, 0.1, 0.07, w); tone('square', 1200, 600, 0.35, 0.07, 0.45); },
  moo(){ tone('sawtooth', 160, 120, 1.0, 0.12, 0, { vib: 4, curve: 'lin' }); hiss('lowpass', 500, 300, 0.9, 0.05, 1); },
  bug(){ for (let i = 0; i < 6; i++) tone('square', 2400, 2200, 0.025, 0.05, i * 0.06); },
  wah(){ [392, 370, 349, 294].forEach((f, i) => tone('sawtooth', f, i === 3 ? f * 0.9 : f, i === 3 ? 0.8 : 0.3, 0.06, i * 0.3, { vib: i === 3 ? 6 : 0 })); },
  fanfare(){ [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, i === 3 ? 0.5 : 0.13, 0.07, i * 0.11)); tone('triangle', 1047, 1047, 0.6, 0.08, 0.33); },
  doorbell(){ tone('sine', 1568, 1568, 0.6, 0.08); tone('sine', 1318, 1318, 0.8, 0.08, 0.18); },
  huff(){ hiss('lowpass', 1200, 300, 0.4, 0.2, 1); tone('sawtooth', 200, 120, 0.3, 0.05); },
  gasp(v = 1){ hiss('bandpass', 2200 * v, 1400 * v, 0.3, 0.12, 2); },
  disco(){ [0, 0.25, 0.5, 0.75].forEach((w, i) => { tone('square', [262, 330, 392, 330][i], [262, 330, 392, 330][i], 0.18, 0.05, w); hiss('highpass', 7000, 8000, 0.05, 0.08, 1, w); }); tone('sine', 60, 40, 0.2, 0.3, 0); tone('sine', 60, 40, 0.2, 0.3, 0.5); },
  // gibberish: a few blips at the customer's own pitch, one per syllable
  talk(text, pitch = 1){
    if (!ctx) return;
    const n = Math.min(10, Math.max(3, Math.round(String(text).length / 4)));
    for (let i = 0; i < n; i++){ const f = (220 + Math.random() * 160) * pitch; tone(Math.random() < 0.5 ? 'triangle' : 'square', f, f * (0.85 + Math.random() * 0.3), 0.07, 0.045, i * 0.085); }
  },
};
