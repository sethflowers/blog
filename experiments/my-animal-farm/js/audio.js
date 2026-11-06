// Synthesised sound, placed in 3D: hoofbeats on sand, grass, gravel or concrete, whinnies and nickers,
// brushing, the fork, water from the tap, the show bell and the crowd, birds and wind.
let ctx = null, master = null, noiseBuf = null, amb = null;

export function startAudio(){
  if (ctx){ if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ambience();
  } catch (e) { ctx = null; }
}
export function setListener(pos, fwd, up){
  if (!ctx || !Number.isFinite(pos.x + pos.y + pos.z + fwd.x + fwd.y + fwd.z)) return;
  const L = ctx.listener, t = ctx.currentTime;
  if (L.positionX){
    L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
    L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
    L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
  } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
}
function out(pos, vol = 1){
  const g = ctx.createGain(); g.gain.value = Number.isFinite(vol) ? vol : 0;
  if (pos && !Number.isFinite(pos.x + pos.y + pos.z)) pos = null;
  if (pos){
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.5; p.maxDistance = 80; p.rolloffFactor = 1;
    if (p.positionX){ p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p); p.connect(master);
  } else g.connect(master);
  return g;
}
function noise(dest, t0, dur, type, f0, f1, q = 1, vol = 1, attack = 0.005){
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
}
function tone(dest, t0, dur, type, f0, f1, vol = 1, attack = 0.005){
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
}
// a horse's voice: a buzzy tone with a wobbling pitch through a nasal filter
function voice(dest, t0, dur, f0, f1, vib, vol){
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t0); o.frequency.linearRampToValueAtTime(f1, t0 + dur);
  const lfo = ctx.createOscillator(); lfo.frequency.value = vib; const lg = ctx.createGain(); lg.gain.value = f0 * 0.08; lfo.connect(lg); lg.connect(o.frequency);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.05); g.gain.setValueAtTime(vol, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(f); f.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
}

export const sfx = {
  // ground: 'sand' | 'grass' | 'gravel' | 'hard'
  hoof(pos, ground, gait){ if (!ctx) return; const t = ctx.currentTime, v = { walk: 0.35, trot: 0.5, canter: 0.65, gallop: 0.8 }[gait] || 0.35, o = out(pos, v);
    if (ground === 'hard'){ tone(o, t, 0.05, 'triangle', 900, 300, 0.6); noise(o, t, 0.05, 'bandpass', 2500, 1200, 2, 0.6); }
    else if (ground === 'gravel'){ noise(o, t, 0.09, 'bandpass', 1800, 900, 1, 0.8); tone(o, t, 0.06, 'sine', 160, 80, 0.4); }
    else if (ground === 'sand'){ noise(o, t, 0.11, 'lowpass', 700, 200, 0.7, 0.9); tone(o, t, 0.07, 'sine', 120, 60, 0.5); }
    else { tone(o, t, 0.08, 'sine', 140, 60, 0.7); noise(o, t, 0.07, 'lowpass', 500, 150, 0.7, 0.5); } },
  step(pos, ground){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.18);
    noise(o, t, 0.08, ground === 'gravel' ? 'bandpass' : 'lowpass', ground === 'gravel' ? 2000 : 900, 300, 1, 0.8); },
  whinny(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.5);
    voice(o, t, 0.25, 700, 1100, 18, 0.5); voice(o, t + 0.22, 0.9, 1050, 520, 24, 0.55); noise(o, t + 1.0, 0.35, 'bandpass', 900, 400, 1, 0.3); },
  nicker(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.45);
    for (let i = 0; i < 4; i++) voice(o, t + i * 0.09, 0.12, 120, 110, 30, 0.6); },
  snort(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.5); noise(o, t, 0.35, 'bandpass', 600, 250, 1.5, 0.9, 0.02); },
  chew(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.15); noise(o, t, 0.06, 'bandpass', 1500, 800, 3, 0.7); },
  crunch(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.5); for (let i = 0; i < 5; i++) noise(o, t + i * 0.13, 0.07, 'highpass', 3000, 2000, 1, 0.7); },
  brush(pos, kind){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.22); noise(o, t, 0.16, kind === 'curry' ? 'bandpass' : 'highpass', kind === 'curry' ? 1200 : 4000, kind === 'curry' ? 900 : 3000, 1, 0.8, 0.03); },
  scrape(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.35); noise(o, t, 0.15, 'bandpass', 2400, 1400, 4, 0.8, 0.02); },
  tack(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.4); noise(o, t, 0.12, 'lowpass', 1200, 300, 1, 0.7); tone(o, t + 0.05, 0.08, 'triangle', 2400, 2200, 0.25); },
  buckle(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.35); tone(o, t, 0.05, 'triangle', 3000, 2600, 0.4); tone(o, t + 0.08, 0.05, 'triangle', 3200, 2800, 0.3); },
  hay(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.4); noise(o, t, 0.4, 'highpass', 2000, 1200, 0.7, 0.6, 0.04); },
  grain(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.4); for (let i = 0; i < 10; i++) noise(o, t + i * 0.03, 0.05, 'highpass', 4000, 3000, 1, 0.5); },
  water(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.4); noise(o, t, 0.6, 'bandpass', 800, 1400, 0.8, 0.6, 0.05); },
  pour(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.45); noise(o, t, 0.8, 'bandpass', 600, 300, 0.8, 0.7, 0.05); },
  fork(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.45); noise(o, t, 0.2, 'bandpass', 1600, 700, 1, 0.7, 0.01); tone(o, t, 0.06, 'triangle', 1800, 1600, 0.2); },
  thud(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.5); tone(o, t, 0.12, 'sine', 120, 60, 0.7); noise(o, t, 0.1, 'lowpass', 600, 200, 1, 0.5); },
  dump(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.6); noise(o, t, 0.6, 'lowpass', 800, 150, 0.7, 0.9, 0.05); },
  shavings(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.45); noise(o, t, 0.7, 'highpass', 2500, 1500, 0.7, 0.6, 0.1); },
  shears(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.4); for (let i = 0; i < 6; i++) noise(o, t + i * 0.12, 0.05, 'highpass', 5000, 4000, 2, 0.6); },
  pole(pos){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.8); tone(o, t, 0.15, 'triangle', 420, 300, 0.6); tone(o, t + 0.25, 0.12, 'triangle', 380, 280, 0.5); noise(o, t + 0.25, 0.1, 'lowpass', 800, 200, 1, 0.5); },
  bell(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.35); for (const f of [880, 1320, 2200]) tone(o, t, 1.6, 'sine', f, f * 0.995, 0.3, 0.002); },
  buzzer(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.25); tone(o, t, 0.5, 'square', 220, 210, 0.3); },
  cheer(pos, big = 1){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.5 * big); noise(o, t, 2.5, 'bandpass', 1400, 900, 0.5, 0.8, 0.3);
    for (let i = 0; i < 25 * big; i++) noise(o, t + Math.random() * 2, 0.04, 'bandpass', 2000 + Math.random() * 1500, 1500, 3, 0.4); },
  coin(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.3); tone(o, t, 0.1, 'square', 1300, 1300, 0.2); tone(o, t + 0.08, 0.3, 'square', 1960, 1960, 0.2); },
  ui(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.2); tone(o, t, 0.05, 'triangle', 900, 1200, 0.4); },
  pickup(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.15); tone(o, t, 0.06, 'sine', 500, 800, 0.5); },
  bad(){ if (!ctx) return; const t = ctx.currentTime, o = out(null, 0.2); tone(o, t, 0.25, 'triangle', 300, 180, 0.4); },
  bleat(pos, kind){ if (!ctx) return; const t = ctx.currentTime, o = out(pos, 0.35);
    if (kind === 'pig'){ for (let i = 0; i < 3; i++) noise(o, t + i * 0.12, 0.1, 'bandpass', 400, 250, 4, 0.8); }
    else if (kind === 'chicken'){ for (let i = 0; i < 4; i++) voice(o, t + i * 0.1, 0.07, 900, 700, 40, 0.3); voice(o, t + 0.45, 0.3, 1000, 1300, 30, 0.3); }
    else voice(o, t, 0.6, kind === 'sheep' ? 420 : 520, kind === 'sheep' ? 380 : 450, kind === 'sheep' ? 9 : 14, 0.4); },
};

// birds and a light breeze in the background, quieter at night
let night = 0;
export function setNight(n){ night = n; if (amb) amb.gain.setTargetAtTime(0.11 * (1 - n * 0.6), ctx.currentTime, 1); }
function ambience(){
  amb = ctx.createGain(); amb.gain.value = 0.11; amb.connect(master);
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
  const g = ctx.createGain(); g.gain.value = 0.35;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.2; lfo.connect(lg); lg.connect(g.gain); lfo.start();
  s.connect(f); f.connect(g); g.connect(amb); s.start();
  const chirp = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (night < 0.5){
      const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800;
      for (let i = 0; i < n; i++) tone(amb, t + i * 0.11, 0.08, 'sine', base, base * (0.75 + Math.random() * 0.5), 0.35, 0.01);
    } else {
      // crickets
      for (let i = 0; i < 6; i++) tone(amb, t + i * 0.05, 0.03, 'sine', 4400, 4400, 0.12, 0.004);
    }
    setTimeout(chirp, 1500 + Math.random() * 4000);
  };
  setTimeout(chirp, 1200);
}
