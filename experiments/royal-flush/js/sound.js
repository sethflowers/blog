// Sounds, all made on the fly with WebAudio (no files to download): a flush, a ding, bubbles.
let ac = null, on = true;
export function setSound(v){ on = v; }
export function unlock(){
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch (e) {}
}
function noise(sec){
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * sec), ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ac.createBufferSource(); s.buffer = b; return s;
}

// whoosh down a falling filter, then a gurgle
export function flush(){
  if (!on || !ac) return;
  try {
    const t = ac.currentTime, n = noise(2.4), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(220, t + 2.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    n.connect(f).connect(g).connect(ac.destination); n.start(t); n.stop(t + 2.4);
    for (let i = 0; i < 7; i++){
      const o = ac.createOscillator(), og = ac.createGain(), s = t + 1.1 + i * 0.16 + Math.random() * 0.05;
      o.type = 'sine'; o.frequency.setValueAtTime(240 + Math.random() * 200, s); o.frequency.exponentialRampToValueAtTime(90, s + 0.12);
      og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.18, s + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, s + 0.14);
      o.connect(og).connect(ac.destination); o.start(s); o.stop(s + 0.16);
    }
  } catch (e) {}
}

export function ding(high){
  if (!on || !ac) return;
  try {
    const t = ac.currentTime;
    (high ? [784, 988, 1319] : [659, 880]).forEach((fr, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.11;
      o.type = 'triangle'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.25, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      o.connect(g).connect(ac.destination); o.start(s); o.stop(s + 0.55);
    });
  } catch (e) {}
}

export function bubble(){
  if (!on || !ac) return;
  try {
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(500 + Math.random() * 500, t); o.frequency.exponentialRampToValueAtTime(1400 + Math.random() * 600, t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.1);
  } catch (e) {}
}
