// Made-up sounds (Web Audio, nothing to download): clicks, the camera's shutter, a picture being hung,
// the till when something sells, a visitor's "ooh" when they make an offer, and a little fanfare.
let ctx = null, master = null, noise = null;

export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}
function tone(type, f0, f1, dur, vol, when = 0){
  if (!ctx) return;
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
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
export const sfx = {
  click(){ tone('square', 880, 880, 0.035, 0.05); },
  shutter(){ hiss('highpass', 3000, 2000, 0.05, 0.5, 1); hiss('bandpass', 1800, 900, 0.09, 0.4, 2, 0.07); tone('square', 220, 160, 0.03, 0.08, 0.06); },
  hang(){ tone('triangle', 330, 330, 0.08, 0.15); tone('triangle', 440, 440, 0.12, 0.12, 0.09); },
  cash(){ tone('square', 1320, 1320, 0.06, 0.08); tone('square', 1760, 1760, 0.18, 0.08, 0.07); hiss('highpass', 6000, 8000, 0.25, 0.08, 1, 0.05); },
  offer(){ tone('sine', 520, 780, 0.18, 0.12); tone('sine', 780, 1040, 0.22, 0.1, 0.16); },
  win(){ [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, i === 3 ? 0.4 : 0.12, 0.12, i * 0.1)); },
  bad(){ tone('square', 220, 160, 0.3, 0.1); },
};
