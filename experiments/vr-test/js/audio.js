// Synthesised sound, placed in 3D with HRTF panning so things sound like they come from where they are.
let ctx = null, master = null, noiseBuf = null;

export function startAudio(){
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ambience();
  } catch (e) { ctx = null; }
}

export function setListener(pos, fwd, up){
  if (!ctx || !Number.isFinite(pos.x + pos.y + pos.z + fwd.x + fwd.y + fwd.z + up.x + up.y + up.z)) return;
  const L = ctx.listener, t = ctx.currentTime;
  if (L.positionX){
    L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
    L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
    L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
  } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
}

// An output at a place in the world (or straight to the ears when pos is null).
function out(pos, vol = 1){
  const g = ctx.createGain(); g.gain.value = Number.isFinite(vol) ? vol : 0;
  if (pos && !Number.isFinite(pos.x + pos.y + pos.z)) pos = null;
  if (pos){
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.maxDistance = 60; p.rolloffFactor = 1.1;
    if (p.positionX){ p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p); p.connect(master);
  } else g.connect(master);
  return g;
}
function noise(dest, t0, dur, type, f0, f1, q = 1, vol = 1){
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
}
function tone(dest, t0, dur, type, f0, f1, vol = 1, attack = 0.005){
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
}

export const sfx = {
  shot(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 1);
    noise(o, t, 0.25, 'lowpass', 5000, 300, 0.7, 0.9); tone(o, t, 0.18, 'sine', 160, 40, 0.9); noise(o, t, 0.04, 'highpass', 3000, 2000, 1, 0.6); },
  swish(pos, speed){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, Math.min(0.6, speed * 0.06));
    noise(o, t, 0.22, 'bandpass', 600, 2400, 2.5, 1); },
  chop(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.9);
    noise(o, t, 0.12, 'bandpass', 1800, 500, 1.5, 1); tone(o, t, 0.1, 'triangle', 220, 90, 0.5); },
  thud(pos, v){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, Math.min(1, v * 0.18));
    tone(o, t, 0.12, 'sine', 140, 60, 0.8); noise(o, t, 0.05, 'lowpass', 900, 200, 1, 0.5); },
  clink(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.6);
    for (let i = 0; i < 4; i++) tone(o, t + i * 0.03 + Math.random() * 0.02, 0.18, 'sine', 2400 + Math.random() * 2400, 1800 + Math.random() * 1200, 0.3); },
  shatter(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.8);
    noise(o, t, 0.3, 'highpass', 3000, 6000, 1, 0.7);
    for (let i = 0; i < 7; i++) tone(o, t + Math.random() * 0.12, 0.15, 'sine', 2500 + Math.random() * 3500, 2000, 0.18); },
  grab(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.25); tone(o, t, 0.06, 'triangle', 500, 300, 0.6); },
  holster(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.35); tone(o, t, 0.05, 'square', 900, 600, 0.3); tone(o, t + 0.05, 0.08, 'square', 600, 400, 0.3); },
  bonk(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.7); tone(o, t, 0.15, 'square', 300, 120, 0.4); noise(o, t, 0.06, 'lowpass', 1500, 300, 1, 0.5); },
  step(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.12); noise(o, t, 0.07, 'lowpass', 700, 200, 1, 1); },
  jump(){ if (!ctx) return; },
  pop(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.35); tone(o, t, 0.12, 'sine', 300, 900, 0.5); },
  bleat(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.6);
    const os = ctx.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(380, t); os.frequency.linearRampToValueAtTime(330, t + 0.6);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 22; const lg = ctx.createGain(); lg.gain.value = 25; lfo.connect(lg); lg.connect(os.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    os.connect(f); f.connect(g); g.connect(o); os.start(t); lfo.start(t); os.stop(t + 0.7); lfo.stop(t + 0.7); },
  oink(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.6);
    for (let i = 0; i < 2; i++){ const t0 = t + i * 0.2; noise(o, t0, 0.14, 'bandpass', 500, 300, 4, 1); tone(o, t0, 0.14, 'sawtooth', 160, 110, 0.25); } },
  cluck(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.45);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) tone(o, t + i * 0.11, 0.07, 'square', 900 + Math.random() * 200, 600, 0.3); },
  squawk(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.7); tone(o, t, 0.3, 'sawtooth', 1200, 700, 0.35); noise(o, t, 0.25, 'bandpass', 2000, 1200, 3, 0.5); },
  talk(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.3);
    for (let i = 0; i < 5; i++) tone(o, t + i * 0.07, 0.06, 'triangle', 300 + Math.random() * 200, 280, 0.4); },
  ouch(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.6); tone(o, t, 0.25, 'triangle', 500, 250, 0.6); },
  place(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.45); tone(o, t, 0.07, 'square', 220, 140, 0.25); noise(o, t, 0.05, 'lowpass', 1200, 400, 1, 0.6); },
  crunch(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.7); noise(o, t, 0.16, 'bandpass', 900, 300, 1.2, 1); tone(o, t, 0.1, 'square', 160, 70, 0.25); },
  horn(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.6); tone(o, t, 0.45, 'sawtooth', 392, 390, 0.25, 0.02); tone(o, t, 0.45, 'sawtooth', 494, 492, 0.2, 0.02); },
  cannon(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 1); noise(o, t, 0.7, 'lowpass', 2500, 120, 0.7, 1); tone(o, t, 0.5, 'sine', 90, 30, 1); },
  boom(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 1); noise(o, t, 1.2, 'lowpass', 1800, 60, 0.7, 1); tone(o, t, 0.8, 'sine', 70, 25, 1); },
  whoosh(pos, amp = 1){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.9 * amp); noise(o, t, 0.6, 'lowpass', 500, 120, 1, 1); },
  roar(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.9);
    const os = ctx.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(110, t); os.frequency.linearRampToValueAtTime(150, t + 0.4); os.frequency.linearRampToValueAtTime(95, t + 1.2);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    os.connect(f); f.connect(g); g.connect(o); os.start(t); os.stop(t + 1.4); noise(o, t, 1.1, 'bandpass', 500, 300, 2, 0.4); },
  purr(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.8);
    const os = ctx.createOscillator(); os.type = 'sawtooth'; os.frequency.value = 55;
    const am = ctx.createOscillator(); am.frequency.value = 24; const ag = ctx.createGain(); ag.gain.value = 0.25;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.2); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    am.connect(ag); ag.connect(g.gain); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    os.connect(f); f.connect(g); g.connect(o); os.start(t); am.start(t); os.stop(t + 1.5); am.stop(t + 1.5); },
  huff(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.8); noise(o, t, 0.5, 'bandpass', 700, 250, 1, 1); },
  ui(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.25); tone(o, t, 0.08, 'sine', 880, 1100, 0.5); },
};

// A soft wind bed and the odd bird, so the world isn't silent.
function ambience(){
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  const g = ctx.createGain(); g.gain.value = 0.035;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lg = ctx.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain);
  s.connect(f); f.connect(g); g.connect(master); s.start(); lfo.start();
  const bird = () => {
    if (ctx.state === 'running'){
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 15;
      const o = out({ x: Math.cos(a) * r, y: 5 + Math.random() * 4, z: Math.sin(a) * r }, 0.5);
      const t = ctx.currentTime, n = 2 + Math.floor(Math.random() * 4), base = 2400 + Math.random() * 1600;
      for (let i = 0; i < n; i++) tone(o, t + i * 0.13, 0.1, 'sine', base, base * (Math.random() < 0.5 ? 1.4 : 0.7), 0.25);
    }
    setTimeout(bird, 2500 + Math.random() * 6000);
  };
  setTimeout(bird, 3000);
}

// A running engine for a vehicle: set(level 0..1) changes its note; stop() fades it out.
export function engine(kind){
  if (!ctx) return { set(){}, stop(){} };
  const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(master);
  const t = ctx.currentTime;
  g.gain.exponentialRampToValueAtTime(kind === 'heli' ? 0.32 : 0.22, t + 0.6);
  const nodes = [];
  if (kind === 'heli'){
    // rotor thump: noise chopped by a low oscillator
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(chop.gain); s.connect(f); f.connect(chop); chop.connect(g);
    const whine = ctx.createOscillator(); whine.type = 'triangle'; whine.frequency.value = 420; const wg = ctx.createGain(); wg.gain.value = 0.06; whine.connect(wg); wg.connect(g);
    s.start(); lfo.start(); whine.start(); nodes.push(s, lfo, whine);
    return { set(v){ lfo.frequency.setTargetAtTime(6 + v * 6, ctx.currentTime, 0.2); whine.frequency.setTargetAtTime(380 + v * 120, ctx.currentTime, 0.2); }, stop(){ g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); nodes.forEach((n) => n.stop(ctx.currentTime + 2)); } };
  }
  const base = kind === 'tank' ? 38 : 55;
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = base;
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = base * 1.01;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'tank' ? 260 : 420;
  const og = ctx.createGain(); og.gain.value = 0.5;
  o1.connect(f); o2.connect(f); f.connect(og); og.connect(g);
  if (kind === 'tank'){ const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 180; const ng = ctx.createGain(); ng.gain.value = 0.3; s.connect(nf); nf.connect(ng); ng.connect(g); s.start(); nodes.push(s); }
  o1.start(); o2.start(); nodes.push(o1, o2);
  return {
    set(v){ const fr = base * (1 + Math.min(1.5, v) * 1.6); o1.frequency.setTargetAtTime(fr, ctx.currentTime, 0.15); o2.frequency.setTargetAtTime(fr * 1.01, ctx.currentTime, 0.15); },
    stop(){ g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3); nodes.forEach((n) => n.stop(ctx.currentTime + 1.5)); },
  };
}
