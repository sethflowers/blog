// Made-up sounds (Web Audio, nothing to download): the zap, the scanner's beeps, an alien found, an
// alien popping and falling, a person saying "Ow!", little voices when people talk, a fanfare, and
// birds singing round the town.
let ctx = null, master = null, noise = null, birdT = null;

export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    birds();
  } catch (e) { ctx = null; }
}
function tone(type, f0, f1, dur, vol, when = 0, vib = 0){
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (vib){ const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vib; lg.gain.value = f0 * 0.06; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur); }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function hiss(type, f0, f1, dur, vol, q = 1, when = 0){
  if (!ctx) return;
  const t = ctx.currentTime + when, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
}
function birds(){
  if (!ctx) return;
  const n = 2 + Math.floor(Math.random() * 3), f = 2200 + Math.random() * 1800;
  for (let i = 0; i < n; i++) tone('sine', f, f * (1.2 + Math.random() * 0.4), 0.07, 0.025, i * 0.11);
  birdT = setTimeout(birds, 2500 + Math.random() * 5000);
}
export const sfx = {
  click(){ tone('square', 880, 880, 0.04, 0.06); },
  zap(){ hiss('bandpass', 4000, 500, 0.28, 0.5, 2); tone('sawtooth', 1600, 120, 0.25, 0.18); tone('square', 2400, 300, 0.12, 0.08); },
  hit(){ hiss('highpass', 3000, 6000, 0.5, 0.25, 1); for (let i = 0; i < 6; i++) tone('square', 300 + Math.random() * 900, 200, 0.05, 0.08, i * 0.07); },
  beep(p){ tone('sine', 900 + p * 900, 900 + p * 900, 0.05, 0.05); },
  alien(){ tone('square', 740, 740, 0.12, 0.12); tone('square', 990, 990, 0.12, 0.12, 0.15); tone('sine', 300, 1200, 0.5, 0.12, 0.3, 7); },
  human(){ tone('sine', 660, 660, 0.1, 0.1); tone('sine', 990, 990, 0.18, 0.1, 0.1); },
  die(){ hiss('lowpass', 1500, 100, 0.35, 0.5); tone('sine', 1200, 80, 0.9, 0.2, 0.05, 9); tone('triangle', 200, 60, 0.4, 0.2, 0.75); },
  ow(){ tone('triangle', 520, 300, 0.35, 0.22, 0, 12); tone('triangle', 620, 380, 0.3, 0.15, 0.32, 10); },
  speak(alien){ const n = 4 + Math.floor(Math.random() * 4), b = alien ? 520 : 260; for (let i = 0; i < n; i++){ const f = b * (0.85 + Math.random() * 0.5); tone(alien ? 'sine' : 'triangle', f, f * (alien ? 1.4 : 0.9), 0.07, 0.05, i * 0.085, alien ? 18 : 0); } },
  win(){ [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, f, i === 5 ? 0.5 : 0.13, 0.09, i * 0.13)); },
  bad(){ tone('square', 220, 160, 0.3, 0.1); },
};
export function stopAudio(){ if (birdT) clearTimeout(birdT); }
