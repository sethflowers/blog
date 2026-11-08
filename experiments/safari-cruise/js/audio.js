// Synthesised sound: the savanna (insects, birds, wind), engines (the nearest truck, and your jeep),
// animal calls placed in 3D (lions roar, elephants trumpet, zebras bark, hippos grunt), and the game's
// own noises (coins, alerts, a horn, spanners, splashes).
let ctx = null, master = null, noiseBuf = null;
let engine = null, myEngine = null, insects = null;

export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++){ const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 3; }
    engine = motor(true); myEngine = motor(false);
    // cicadas: a high buzzing band of noise that swells and fades
    insects = loop('bandpass', 5200, false); insects.f.Q.value = 6;
    birds(); swell();
  } catch (e) { ctx = null; }
}
function loop(type, freq, spatial){
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 0;
  s.connect(f); f.connect(g);
  let p = null;
  if (spatial){ p = panner(); g.connect(p); p.connect(master); } else g.connect(master);
  s.start();
  return { f, g, p };
}
// an engine: a low growl (sawtooth through a filter) plus rumbling noise
function motor(spatial){
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 40;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 2;
  const g = ctx.createGain(); g.gain.value = 0;
  o.connect(f); f.connect(g);
  const n = loop('lowpass', 180, false); n.g.disconnect(); n.g.connect(g); n.g.gain.value = 0.6;
  let p = null; if (spatial){ p = panner(); g.connect(p); p.connect(master); } else g.connect(master);
  o.start();
  return { o, f, g, p };
}
function panner(){
  const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 5; p.maxDistance = 300; p.rolloffFactor = 1.2;
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
// every frame: the nearest truck (placed in 3D), and the engine of whatever you're in
export function engines(truckPos, truckSpeed, mineSpeed, mineOn, mineBig){
  if (!ctx) return;
  const t = ctx.currentTime;
  if (truckPos) setPos(engine.p, truckPos);
  engine.g.gain.setTargetAtTime(truckPos ? 0.25 + Math.min(0.4, truckSpeed / 15) : 0, t, 0.2);
  engine.o.frequency.setTargetAtTime(32 + truckSpeed * 4, t, 0.2);
  myEngine.g.gain.setTargetAtTime(mineOn ? 0.12 + Math.min(0.25, Math.abs(mineSpeed) / 30) : 0, t, 0.15);
  myEngine.o.frequency.setTargetAtTime((mineBig ? 30 : 45) + Math.abs(mineSpeed) * (mineBig ? 4 : 7), t, 0.1);
  myEngine.f.frequency.setTargetAtTime(200 + Math.abs(mineSpeed) * 30, t, 0.1);
}
function swell(){
  if (!ctx) return;
  const t = ctx.currentTime;
  insects.g.gain.setTargetAtTime(0.02 + Math.random() * 0.035, t, 2);
  setTimeout(swell, 3000 + Math.random() * 5000);
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
function noise(dest, t0, dur, type, f0, f1, vol, q = 1, attack = 0.01){
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
}
function birds(){
  if (!ctx) return;
  const t = ctx.currentTime + 0.1, o = out(null, 0.04);
  const kind = Math.random();
  if (kind < 0.5){ const n = 2 + Math.floor(Math.random() * 4), f = 2200 + Math.random() * 1800; for (let i = 0; i < n; i++) tone(o, t + i * 0.13, 0.09, 'sine', f, f * (0.7 + Math.random() * 0.6), 0.6); }
  else if (kind < 0.8){ for (let i = 0; i < 3; i++) tone(o, t + i * 0.4, 0.3, 'sine', 900, 700, 0.5, 0.05); }   // a dove
  else { for (let i = 0; i < 6; i++) tone(o, t + i * 0.08, 0.06, 'square', 3000 + i * 100, 2600, 0.2); }
  setTimeout(birds, 2500 + Math.random() * 6000);
}

// animal calls, at the animal
const CALLS = {
  lion(o, t){ noise(o, t, 1.6, 'lowpass', 260, 120, 1.0, 3, 0.25); tone(o, t, 1.5, 'sawtooth', 110, 70, 0.5, 0.3); for (let i = 1; i < 4; i++) tone(o, t + 1.7 + i * 0.6, 0.4, 'sawtooth', 95, 70, 0.35 / i, 0.05); },
  tiger(o, t){ noise(o, t, 1.0, 'lowpass', 400, 150, 0.9, 3, 0.1); tone(o, t, 0.9, 'sawtooth', 140, 80, 0.5, 0.1); },
  elephant(o, t){ const v = tone(o, t, 1.3, 'sawtooth', 420, 520, 0.6, 0.08); void v; tone(o, t, 1.3, 'square', 425, 530, 0.25, 0.08); noise(o, t, 1.2, 'bandpass', 1200, 1500, 0.4, 2, 0.1); },
  zebra(o, t){ for (let i = 0; i < 4; i++) tone(o, t + i * 0.22, 0.18, 'sawtooth', 600 - i * 40, 300, 0.5, 0.02); },
  hippo(o, t){ for (let i = 0; i < 5; i++){ tone(o, t + i * 0.28, 0.24, 'sawtooth', 90, 60, 0.6, 0.02); noise(o, t + i * 0.28, 0.2, 'lowpass', 300, 150, 0.4, 2); } },
  rhino(o, t){ noise(o, t, 0.5, 'lowpass', 500, 200, 0.7, 2, 0.05); },
  bear(o, t){ noise(o, t, 1.2, 'lowpass', 300, 160, 0.9, 4, 0.2); tone(o, t, 1.1, 'sawtooth', 85, 65, 0.4, 0.2); },
  wildebeest(o, t){ tone(o, t, 0.4, 'sawtooth', 160, 120, 0.4, 0.03); tone(o, t + 0.5, 0.4, 'sawtooth', 150, 110, 0.4, 0.03); },
  giraffe(o, t){ noise(o, t, 0.6, 'lowpass', 200, 120, 0.3, 2, 0.1); },
  ostrich(o, t){ tone(o, t, 0.8, 'sine', 120, 90, 0.6, 0.2); },
  cheetah(o, t){ for (let i = 0; i < 3; i++) tone(o, t + i * 0.3, 0.15, 'sine', 1800, 1500, 0.4, 0.01); },   // cheetahs chirp
  warthog(o, t){ for (let i = 0; i < 3; i++) noise(o, t + i * 0.15, 0.12, 'bandpass', 600, 400, 0.6, 3); },
  impala(o, t){ noise(o, t, 0.25, 'bandpass', 900, 500, 0.6, 2); },
  crocodile(o, t){ noise(o, t, 0.9, 'lowpass', 150, 80, 1.0, 5, 0.1); },
};
export function call(kind, pos){ if (!ctx || !CALLS[kind]) return; CALLS[kind](out(pos, 0.5), ctx.currentTime + 0.02); }

export const sfx = {
  click(){ if (!ctx) return; tone(out(null, 0.25), ctx.currentTime, 0.06, 'square', 900, 600, 0.4); },
  coin(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.2); tone(o, t, 0.08, 'square', 988, 988, 0.4); tone(o, t + 0.08, 0.3, 'square', 1319, 1319, 0.4); },
  buy(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.3); [523, 659, 784, 1047].forEach((f, i) => tone(o, t + i * 0.09, 0.25, 'triangle', f, f, 0.6)); },
  good(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.3); [659, 784, 1047].forEach((f, i) => tone(o, t + i * 0.1, 0.3, 'triangle', f, f, 0.6)); },
  bad(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.3); tone(o, t, 0.18, 'square', 520, 500, 0.4); tone(o, t + 0.2, 0.3, 'square', 390, 380, 0.4); },
  horn(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.5); tone(o, t, 0.5, 'sawtooth', 330, 330, 0.5, 0.02); tone(o, t, 0.5, 'sawtooth', 415, 415, 0.4, 0.02); },
  spanner(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.4); for (let i = 0; i < 3; i++) tone(o, t + i * 0.12, 0.1, 'square', 2400 + Math.random() * 800, 2000, 0.3); },
  splash(pos){ if (!ctx) return; noise(out(pos, 0.5), ctx.currentTime, 0.6, 'highpass', 1500, 3000, 0.6); },
  day(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.3); [392, 523, 659, 784, 659, 784].forEach((f, i) => tone(o, t + i * 0.12, 0.35, 'triangle', f, f, 0.6)); },
  whoosh(){ if (!ctx) return; noise(out(null, 0.5), ctx.currentTime, 0.8, 'bandpass', 300, 2000, 0.8, 1.5); },
};
