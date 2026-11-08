// Synthesised sound: the train rumbling round the track (placed in 3D), wind when you ride, riders
// screaming on the drops, the station bell, coins, and clicks for building.
let ctx = null, master = null, noiseBuf = null;
let rumble = null, wind = null;

export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++){ const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 3; }
    // the train's rumble: filtered noise through a panner that follows the train
    rumble = loop('lowpass', 300, true);
    // wind in your ears when you ride
    wind = loop('bandpass', 800, false);
    birds();
  } catch (e) { ctx = null; }
}
function loop(type, freq, spatial){
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = type === 'bandpass' ? 0.6 : 0.8;
  const g = ctx.createGain(); g.gain.value = 0;
  s.connect(f); f.connect(g);
  let p = null;
  if (spatial){ p = panner(); g.connect(p); p.connect(master); } else g.connect(master);
  s.start();
  return { f, g, p };
}
function panner(){
  const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 200; p.rolloffFactor = 1.1;
  return p;
}
function setPos(p, pos){ if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return; if (p.positionX){ p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z); }
export function setListener(pos, fwd, up){
  if (!ctx || !Number.isFinite(pos.x + pos.y + pos.z + fwd.x + fwd.y + fwd.z)) return;
  const L = ctx.listener, t = ctx.currentTime;
  if (L.positionX){
    L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
    L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
    L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
  } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
}
// every frame: where the train is, how fast, and whether you're on it
export function trainSound(pos, speed, riding){
  if (!ctx) return;
  const t = ctx.currentTime;
  setPos(rumble.p, pos);
  rumble.g.gain.setTargetAtTime(Math.min(1.2, speed / 10) * (riding ? 0.45 : 1), t, 0.1);
  rumble.f.frequency.setTargetAtTime(150 + speed * 25, t, 0.1);
  wind.g.gain.setTargetAtTime(riding ? Math.min(0.9, (speed / 18) ** 2) : 0, t, 0.15);
  wind.f.frequency.setTargetAtTime(400 + speed * 60, t, 0.2);
}
function out(pos, vol){
  const g = ctx.createGain(); g.gain.value = vol;
  if (pos){ const p = panner(); setPos(p, pos); g.connect(p); p.connect(master); } else g.connect(master);
  return g;
}
function tone(dest, t0, dur, type, f0, f1, vol, attack = 0.01){
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  return o;
}
function noise(dest, t0, dur, type, f0, f1, vol, q = 1){
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
}
// a happy scream: a few voices sliding up then down, with wobble
function voice(dest, t0, dur, f0, vol){
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t0); o.frequency.linearRampToValueAtTime(f0 * 1.35, t0 + dur * 0.3); o.frequency.linearRampToValueAtTime(f0 * 0.9, t0 + dur);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 6 + Math.random() * 3; const lg = ctx.createGain(); lg.gain.value = f0 * 0.05; lfo.connect(lg); lg.connect(o.frequency);
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1100 + Math.random() * 400; f1.Q.value = 3;
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2600; f2.Q.value = 4;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.08); g.gain.setValueAtTime(vol, t0 + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.05); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
}
function birds(){
  if (!ctx) return;
  const t = ctx.currentTime + 0.1, o = out(null, 0.05);
  const n = 2 + Math.floor(Math.random() * 4), f = 2600 + Math.random() * 1800;
  for (let i = 0; i < n; i++) tone(o, t + i * 0.12, 0.08, 'sine', f, f * (0.75 + Math.random() * 0.5), 0.6);
  setTimeout(birds, 3000 + Math.random() * 7000);
}

export const sfx = {
  click(){ if (!ctx) return; tone(out(null, 0.25), ctx.currentTime, 0.06, 'square', 900, 600, 0.4); },
  place(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.5); tone(o, t, 0.12, 'triangle', 220, 110, 0.8); noise(o, t, 0.08, 'bandpass', 2000, 800, 0.5, 2); tone(o, t + 0.05, 0.1, 'sine', 660, 880, 0.3); },
  undo(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.4); tone(o, t, 0.15, 'triangle', 500, 200, 0.6); },
  bad(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.35); tone(o, t, 0.25, 'sawtooth', 160, 120, 0.5); tone(o, t, 0.25, 'square', 165, 118, 0.3); },
  coin(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.22); tone(o, t, 0.08, 'square', 988, 988, 0.4); tone(o, t + 0.08, 0.3, 'square', 1319, 1319, 0.4); },
  buy(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.3); [523, 659, 784, 1047].forEach((f, i) => tone(o, t + i * 0.09, 0.25, 'triangle', f, f, 0.6)); },
  done(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.35); [392, 523, 659, 784, 659, 784].forEach((f, i) => tone(o, t + i * 0.11, 0.3, 'triangle', f, f, 0.6)); },
  bell(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.5); for (let i = 0; i < 2; i++){ tone(o, t + i * 0.35, 0.6, 'sine', 1480, 1470, 0.6); tone(o, t + i * 0.35, 0.5, 'sine', 2960, 2950, 0.2); } },
  hiss(pos){ if (!ctx) return; noise(out(pos, 0.4), ctx.currentTime, 0.7, 'highpass', 3000, 5000, 0.6); },
  scream(pos, n = 3){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.12); for (let i = 0; i < n; i++) voice(o, t + Math.random() * 0.3, 1.2 + Math.random() * 0.8, 380 + Math.random() * 380, 0.5); },
  whoosh(){ if (!ctx) return; noise(out(null, 0.5), ctx.currentTime, 0.8, 'bandpass', 300, 2000, 0.8, 1.5); },
  cheer(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.25); for (let i = 0; i < 6; i++) noise(o, t + i * 0.08, 0.6, 'bandpass', 900 + Math.random() * 900, 1400, 0.4, 3); },
};
