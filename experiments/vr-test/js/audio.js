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
  if (!ctx) return;
  const L = ctx.listener, t = ctx.currentTime;
  if (L.positionX){
    L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
    L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
    L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
  } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
}

// An output at a place in the world (or straight to the ears when pos is null).
function out(pos, vol = 1){
  const g = ctx.createGain(); g.gain.value = vol;
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
