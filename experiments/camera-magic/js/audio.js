// Little sounds made on the spot (no sound files to download). The first tap unlocks audio on iOS.
let ac = null, master = null;
export const sound = { on: true };

export function unlockAudio(){
  try {
    if (!ac){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC(); master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
  } catch (e) {}
}

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}){
  if (!ac || !sound.on) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  pop(pitch = 1){ tone(520 * pitch, 0.12, { type: 'triangle', slide: 2.2, vol: 0.35 }); },
  gold(){ [880, 1175, 1568].forEach((f, i) => tone(f, 0.18, { type: 'triangle', delay: i * 0.06, vol: 0.25 })); },
  found(){ [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', delay: i * 0.09, vol: 0.28 })); },
  click(){ tone(700, 0.05, { type: 'square', vol: 0.08 }); },
  giggle(){ [900, 1100, 950, 1200].forEach((f, i) => tone(f, 0.08, { type: 'sine', delay: i * 0.07, vol: 0.2, slide: 1.3 })); },
  boing(){ tone(220, 0.3, { type: 'sine', slide: 2.5, vol: 0.3 }); },
  sparkle(){ tone(1600 + Math.random() * 800, 0.08, { type: 'sine', vol: 0.08 }); },
  shutter(){ tone(2000, 0.04, { type: 'square', vol: 0.12 }); tone(1200, 0.06, { type: 'square', vol: 0.1, delay: 0.05 }); },
  miss(){ tone(300, 0.2, { type: 'sawtooth', slide: 0.5, vol: 0.12 }); },
};
