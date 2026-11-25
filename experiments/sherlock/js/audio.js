// Sounds, made in the browser (nothing to download): the train rumbling and clacking over the rail
// joints, rain, thunder, the crash and scream in the dark, and little chimes for clues.
let ctx = null, master = null, amb = null;
export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  ambience();
}
function noiseBuffer(sec = 2, brown = false){
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++){ const w = Math.random() * 2 - 1; if (brown){ last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  return b;
}
function loop(buf, gain, filter){
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const g = ctx.createGain(); g.gain.value = gain;
  if (filter){ const f = ctx.createBiquadFilter(); Object.assign(f, { type: filter.type }); f.frequency.value = filter.f; s.connect(f); f.connect(g); } else s.connect(g);
  g.connect(master); s.start(); return g;
}
function ambience(){
  amb = {
    rumble: loop(noiseBuffer(3, true), 0.55, { type: 'lowpass', f: 180 }),
    rain: loop(noiseBuffer(2), 0.05, { type: 'highpass', f: 2500 }),
  };
  // clack-clack ... clack-clack over the rail joints
  let t = ctx.currentTime + 0.5;
  const clack = (when, v) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = 70; g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(v, when + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; o.connect(f); f.connect(g); g.connect(master); o.start(when); o.stop(when + 0.1); };
  const tick = () => { if (!ctx) return; while (t < ctx.currentTime + 1){ clack(t, 0.12); clack(t + 0.11, 0.1); t += 1.25; } };
  setInterval(tick, 400);
}
// the outside is louder on the open platform
export function outdoors(v){ if (amb) amb.rain.gain.setTargetAtTime(0.05 + v * 0.25, ctx.currentTime, 0.3); }
function burst(dur, gain, f0, f1, type = 'lowpass', delay = 0){
  if (!ctx) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur + 0.1);
  const f = ctx.createBiquadFilter(); f.type = type; const t = ctx.currentTime + delay;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.1);
}
function tone(freq, dur, gain = 0.15, type = 'sine', delay = 0, slide = 0){
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
export const sfx = {
  click(){ tone(900, 0.05, 0.06, 'square'); },
  thunder(delay = 0){ burst(2.8, 0.9, 900, 40, 'lowpass', delay); burst(1.2, 0.5, 200, 30, 'lowpass', delay + 0.2); },
  flicker(){ tone(120, 0.15, 0.08, 'sawtooth'); },
  powerDown(){ tone(220, 0.8, 0.15, 'sawtooth', 0, 0.2); },
  powerUp(){ tone(60, 0.6, 0.1, 'sawtooth', 0, 3); },
  crash(){ burst(0.5, 0.8, 3000, 200, 'bandpass'); burst(0.25, 0.6, 400, 80); },
  // a scream down the corridor (a short, distant cry)
  scream(){
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), t = ctx.currentTime;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(700, t); o.frequency.linearRampToValueAtTime(1050, t + 0.15); o.frequency.linearRampToValueAtTime(820, t + 0.9);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 7; lg.gain.value = 30; lfo.connect(lg); lg.connect(o.frequency);
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.06); g.gain.setValueAtTime(0.18, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(f); f.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t + 1.05); lfo.stop(t + 1.05);
  },
  footsteps(){ for (let k = 0; k < 6; k++) burst(0.06, 0.25, 600, 200, 'lowpass', 0.4 + k * 0.28); },
  clue(){ tone(660, 0.18, 0.12, 'triangle'); tone(990, 0.3, 0.1, 'triangle', 0.12); },
  dust(){ burst(0.5, 0.15, 6000, 3000, 'highpass'); },
  note(){ tone(520, 0.12, 0.06, 'triangle'); },
  gasp(){ burst(0.35, 0.2, 1800, 900, 'bandpass'); },
  win(){ [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, 0.14, 'triangle', i * 0.14)); },
  lose(){ [392, 330, 262, 196].forEach((f, i) => tone(f, 0.6, 0.14, 'sawtooth', i * 0.22)); },
  warn(){ tone(300, 0.25, 0.12, 'square'); tone(240, 0.35, 0.12, 'square', 0.2); },
};
