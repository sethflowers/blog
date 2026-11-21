// Sound, made in code (no files to fetch, so it works offline): a soft breeze and birdsong by day,
// crickets at night, and a click for the interface. Starts after the first touch (browsers require it).
export class Audio {
  constructor(){ this.ctx = null; this.on = false; }
  unlock(){
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
    // breeze: filtered noise, slowly swelling
    const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++){ last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last * 3; }
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    this.wind = c.createGain(); this.wind.gain.value = 0.0;
    src.connect(lp); lp.connect(this.wind); this.wind.connect(this.master); src.start();
    this.timer = setInterval(() => this.tick(), 700);
  }
  start(){ this.on = true; }
  set night(v){ this._night = v; }
  tick(){
    if (!this.ctx || !this.on || document.hidden) { if (this.wind) this.wind.gain.value = 0; return; }
    const c = this.ctx, t = c.currentTime, night = this._night || 0;
    this.wind.gain.setTargetAtTime(0.05 + 0.04 * Math.sin(t * 0.2) + 0.14 * (this._rain || 0), t, 1.5);
    if (night < 0.5 && Math.random() < 0.28 * (1 - (this._rain || 0))) this.bird(t);
    if (night > 0.5 && Math.random() < 0.6) this.cricket(t);
  }
  bird(t){
    const c = this.ctx, n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800, pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan){ pan.pan.value = Math.random() * 2 - 1; pan.connect(this.master); }
    for (let k = 0; k < n; k++){
      const o = c.createOscillator(), g = c.createGain(), t0 = t + k * (0.09 + Math.random() * 0.05);
      o.type = 'sine'; o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.7), t0 + 0.07);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.025, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.08);
      o.connect(g); g.connect(pan || this.master); o.start(t0); o.stop(t0 + 0.1);
    }
  }
  cricket(t){
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 4400 + Math.random() * 300;
    for (let k = 0; k < 3; k++){ const t0 = t + k * 0.06; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.008, t0 + 0.01); g.gain.linearRampToValueAtTime(0, t0 + 0.04); }
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.25);
  }
  // fireworks: a rising whoosh, and a bang (softer far away)
  whoosh(){ if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(1400, t + 1.4); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.012, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0005, t + 1.5); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.6); }
  bang(dist = 100){
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + Math.min(1.5, dist / 340), len = c.sampleRate * 0.8, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = buf; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = Math.min(0.5, 30 / Math.max(20, dist));
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }
  set rain(v){ if (this.wind) this._rain = v; }
  click(){
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.05);
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.08);
  }
}
