// Camera Magic: a demo of what a web page can do with an iPad's camera. The camera picture fills the
// screen; Google's MediaPipe models (run on the device) find things, hands, faces, bodies and people
// in it; and six modes play with what they find. A headset that can do AR (a Quest 3) gets its own
// passthrough mode.
import { $, h, say, save, store, drawBits, bits, banner } from '/experiments/camera-magic/js/util.js';
import { cam, startCamera, stopCamera, flipCamera, useImage, fit, cameraSupported, drawCovering, isBrave } from '/experiments/camera-magic/js/camera.js';
import * as vision from '/experiments/camera-magic/js/vision.js';
import { unlockAudio, sound, sfx } from '/experiments/camera-magic/js/audio.js';
import { getRenderer, resizeRenderer } from '/experiments/camera-magic/js/three-layer.js';
import { arSupported, startAR, stopAR, AR, arInfo } from '/experiments/camera-magic/js/xr.js';
import spot from '/experiments/camera-magic/js/m-spot.js';
import hunt from '/experiments/camera-magic/js/m-hunt.js';
import bubbles from '/experiments/camera-magic/js/m-bubbles.js';
import pip from '/experiments/camera-magic/js/m-pip.js';
import dress from '/experiments/camera-magic/js/m-dress.js';
import look, { askGyro } from '/experiments/camera-magic/js/m-look.js';

await window.__loading();

const MODES = [spot, hunt, bubbles, pip, dress, look];
const G = window.__cm = {
  cam, R: vision.R, vision, modes: Object.fromEntries(MODES.map((m) => [m.id, m])), mode: null,
  playing: false, noRender: false, timeScale: 1, fps: 0, frames: 0, errors: [],
  useImage, startCamera, setMode, AR, arInfo, startAR: () => enterAR(), stopAR, save,
};
const overlay = $('overlay'), octx = overlay.getContext('2d');
const threeCanvas = $('three');

// ---- title screen ----
const status = $('status');
const isStandalone = () => navigator.standalone || (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches));
if (!cameraSupported()){
  status.textContent = window.isSecureContext ? 'This browser doesn\'t let web pages use the camera.' + (isBrave() ? ' In Brave, allow the camera in Shields or the page settings, or open the page in Safari.' : ' Try Safari.') : 'The camera needs a secure (https) page.';
} else status.textContent = 'Nothing leaves this device: all the seeing happens right here.';

async function begin(facing){
  unlockAudio();
  status.textContent = 'Starting the camera…';
  $('b-start').disabled = $('b-selfie').disabled = true;
  // no answer after a while (no camera prompt showed, or it is waiting behind something): say so,
  // and let Start be tapped again, instead of "Starting the camera…" for ever
  const slow = setTimeout(() => {
    status.textContent = 'Still waiting for the camera. If no "use the camera?" question appeared, this browser may have the camera switched off for this page.' + (isBrave() ? ' In Brave, tap the lion (Shields) or the page settings and allow the camera, or open the page in Safari.' : ' Try Safari.');
    $('b-start').disabled = $('b-selfie').disabled = false;
    $('b-start').textContent = '▶ Try again';
  }, 8000);
  try {
    await startCamera(facing);
    play();
  } catch (e) {
    status.textContent = cam.error || 'The camera did not start.';
    $('b-start').textContent = '▶ Try again';
  } finally { clearTimeout(slow); $('b-start').disabled = $('b-selfie').disabled = false; }
}
$('b-start').onclick = () => begin('environment');
$('b-selfie').onclick = () => begin('user');

function play(){
  G.playing = true;
  document.body.classList.add('playing');
  $('title').classList.add('hidden');
  setMode(save.mode && G.modes[save.mode] ? save.mode : 'spot');
}
function stop(){
  G.playing = false;
  if (G.mode) G.mode.exit();
  G.mode = null;
  stopCamera();
  document.body.classList.remove('playing');
  $('title').classList.remove('hidden');
  status.textContent = 'Camera off. Tap Start to switch it on again.';
  banner('');
}

// ---- the headset's AR mode ----
const arBtn = $('b-ar');
arSupported().then((ok) => {
  arBtn.disabled = !ok;
  arBtn.textContent = ok ? '🥽 Play in AR (headset)' : '🥽 AR needs a headset (Quest 3)';
});
async function enterAR(){
  unlockAudio();
  try {
    $('ar-note').style.display = 'flex';
    await startAR(() => { $('ar-note').style.display = 'none'; status.textContent = 'Back from AR.'; });
  } catch (e) {
    $('ar-note').style.display = 'none';
    status.textContent = 'AR did not start: ' + (e && e.message || e);
  }
}
arBtn.onclick = enterAR;

// ---- the HUD ----
const tabs = $('tabs');
for (const m of MODES){
  tabs.append(h('button', { class: 'tab', 'data-mode': m.id, onclick: () => { sfx.click(); setMode(m.id); } }, h('span', { class: 'ti' }, m.icon), h('span', { class: 'tl' }, m.name)));
}
$('b-flip').onclick = async () => {
  sfx.click();
  try { await flipCamera(); say(cam.facing === 'user' ? 'Selfie camera' : 'Back camera'); }
  catch (e) { say(cam.error || 'Could not switch cameras', 'bad'); }
};
$('b-photo').onclick = () => { G.wantPhoto = true; };
$('b-sound').onclick = () => { sound.on = !sound.on; $('b-sound').textContent = sound.on ? '🔊' : '🔇'; save.sound = sound.on; store(); };
if (save.sound === false){ sound.on = false; $('b-sound').textContent = '🔇'; }
$('b-stop').onclick = () => { sfx.click(); stop(); };
$('ph-close').onclick = () => { $('photo').classList.remove('show'); };

function setMode(id){
  const m = G.modes[id];
  if (!m) return;
  if (G.mode && G.mode !== m) G.mode.exit();
  G.mode = m;
  save.mode = id; store();
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.mode === id);
  const bar = $('bar'); bar.replaceChildren(...(m.bar ? m.bar() : []));
  $('hint').textContent = m.hint || '';
  $('hint').classList.add('show'); clearTimeout(G.hintT); G.hintT = setTimeout(() => $('hint').classList.remove('show'), 6000);
  threeCanvas.style.display = m.three ? 'block' : 'none';
  if (m.three) getRenderer();
  for (const name of m.needs()) loadModel(name);
  // some modes want a particular camera (dress up: the selfie one)
  if (m.camera && cam.live && cam.facing !== m.camera){
    startCamera(m.camera).then(() => say(m.camera === 'user' ? 'Switched to the selfie camera' : 'Switched to the back camera')).catch(() => {});
  }
  if (id === 'look') askGyro();
  m.enter();
}

// models load the first time a mode needs them, with a note on screen while they do
const modelNote = $('model-note');
function loadModel(name){ if (!vision.status[name] || vision.status[name] === 'failed') vision.load(name); }
let noteText = '';
function updateModelNote(want){
  let t = '';
  for (const n of want){
    if (vision.status[n] === 'loading'){ t = 'Loading ' + vision.MODELS[n].name + '…'; break; }
    if (vision.status[n] === 'failed'){ t = 'Couldn\'t load ' + vision.MODELS[n].name + '. Tap to try again.'; break; }
  }
  if (t !== noteText){ noteText = t; modelNote.textContent = t; modelNote.classList.toggle('show', !!t); modelNote.classList.toggle('bad', /Couldn/.test(t)); }
}
modelNote.onclick = () => { if (G.mode) for (const n of G.mode.needs()) loadModel(n); };

// ---- touch / mouse: tap to use, drag to look (Look around) ----
const touch = $('touch');
const ptrs = new Map();
touch.addEventListener('pointerdown', (e) => {
  unlockAudio();
  try { touch.setPointerCapture(e.pointerId); } catch (x) {}
  ptrs.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
});
touch.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(p.x - p.x0, p.y - p.y0) > 12) p.moved = true;
  if (p.moved && G.mode && G.mode.drag) G.mode.drag(dx, dy);
});
function up(e){
  const p = ptrs.get(e.pointerId); if (!p) return;
  ptrs.delete(e.pointerId);
  if (e.type === 'pointerup' && !p.moved && performance.now() - p.t < 600 && G.mode && G.mode.tap) G.mode.tap(e.clientX, e.clientY);
}
touch.addEventListener('pointerup', up);
touch.addEventListener('pointercancel', up);
touch.addEventListener('lostpointercapture', up);
addEventListener('pointerup', up);
const forget = () => ptrs.clear();
addEventListener('blur', forget);
document.addEventListener('visibilitychange', () => {
  forget();
  // back from another app: iOS may have stopped the camera
  if (!document.hidden && G.playing && cam.live && cam.stream && cam.stream.getVideoTracks().every((t) => t.readyState === 'ended')) startCamera(cam.facing).catch(() => say(cam.error || 'The camera stopped', 'bad', 5000));
});

// ---- size ----
let dpr = 1;
function resize(){
  dpr = Math.min(devicePixelRatio || 1, 2);
  overlay.width = Math.round(innerWidth * dpr); overlay.height = Math.round(innerHeight * dpr);
  resizeRenderer();
  fit();
}
addEventListener('resize', resize);
resize();

// ---- the frame loop ----
let last = performance.now(), statT = 0, fpsN = 0, fpsT = 0;
function frame(now){
  requestAnimationFrame(frame);
  if (AR.on) return;                         // the headset runs its own loop
  const dt = Math.min(0.1, (now - last) / 1000) * G.timeScale; last = now;
  if (!G.playing || !G.mode) return;
  try {
    fit();
    const want = G.mode.needs();
    for (const n of want) if (!vision.status[n]) loadModel(n);
    updateModelNote(want);
    const src = cam.source;
    const ready = src && (cam.still || src.readyState >= 2);
    if (ready) vision.run(want, src, cam.w, cam.h, now);
    G.mode.update(dt, now);
    if (!G.noRender || G.wantPhoto) draw(dt);
    G.frames++;
    fpsN++; fpsT += now - (G._lt || now); G._lt = now;
    if (fpsT > 1000){ G.fps = Math.round(fpsN * 1000 / fpsT); fpsN = 0; fpsT = 0; }
    statT -= dt;
    if (statT <= 0){
      statT = 0.3;
      const s = (G.mode.summary ? G.mode.summary() : '') ;
      const line = s + (s ? ' · ' : '') + G.fps + ' fps';
      if ($('stats').textContent !== line) $('stats').textContent = line;
    }
  } catch (e) {
    console.error(e);
    G.errors.push(String(e && e.stack || e));
  }
}
function draw(dt){
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, innerWidth, innerHeight);
  G.mode.draw(octx);
  drawBits(octx, dt);
  if (G.wantPhoto){ G.wantPhoto = false; takePhoto(); }
}
G.renderNow = () => draw(0);

// a photo of what's on screen: the camera picture, the drawings and the 3D layer, put together right
// after drawing (a WebGL canvas is only readable straight after it has drawn)
function takePhoto(){
  const c = document.createElement('canvas');
  c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (cam.source) drawCovering(g, cam.source);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(overlay, 0, 0, c.width, c.height);
  if (G.mode && G.mode.three) g.drawImage(threeCanvas, 0, 0, c.width, c.height);
  sfx.shutter();
  const flash = $('flash'); flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const img = $('ph-img');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.src = url; img.dataset.url = url;
    $('photo').classList.add('show');
    $('ph-save').onclick = async () => {
      const file = new File([blob], 'camera-magic.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })){
        try { await navigator.share({ files: [file], title: 'Camera Magic' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a'); a.href = url; a.download = 'camera-magic.jpg'; document.body.append(a); a.click(); a.remove();
    };
  }, 'image/jpeg', 0.9);
}
G.takePhoto = () => { G.wantPhoto = true; };
requestAnimationFrame(frame);

// ---- offline ----
if (isStandalone() && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
(async function offlineReady(){
  if (!('caches' in window)) return;
  const name = 'camera-magic-' + (document.body.dataset.version || '');
  for (let i = 0; i < 120; i++){
    try {
      if (await caches.has(name) && await (await caches.open(name)).match('/experiments/camera-magic/__offline-ready__')){ $('offline').textContent = '✓ Saved on this device: plays offline'; return; }
    } catch (e) { return; }
    await new Promise((r) => setTimeout(r, 2000));
  }
})();

window.__loaded();
