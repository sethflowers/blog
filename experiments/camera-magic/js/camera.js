// The camera: starts the iPad's back or selfie camera, shows it full screen behind everything, and
// maps points from the camera picture (0..1 across and down) to the screen. The picture fills the
// screen like CSS object-fit: cover (cropped, never squashed); the selfie camera is shown mirrored, so
// it works like a mirror, and every overlay is mirrored with it.
//
// For tests (and a computer with no camera) a still picture can stand in for the camera: useImage().
import { $ } from '/experiments/camera-magic/js/util.js';

export const cam = {
  facing: 'environment',   // 'environment' = back camera, 'user' = selfie camera
  mirror: false,
  stream: null,
  source: null,            // what the vision models look at: the <video>, or a canvas holding a still picture
  w: 0, h: 0,              // that source's size in pixels
  live: false,             // a real camera is running
  still: false,            // a still picture is standing in for the camera
  error: '',
  // screen mapping, refreshed by fit()
  sw: 1, sh: 1, scale: 1, ox: 0, oy: 0,
};

const video = () => $('video');
const stillEl = () => $('still');

export function cameraSupported(){
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// explain why the camera didn't start, in words a person can act on
function why(e){
  const n = e && e.name;
  if (!window.isSecureContext) return 'The camera only works on a secure (https) page.';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The camera is switched off for this page. On an iPad: Settings › Apps › Safari › Camera › Allow (or tap "aA" in the address bar › Website Settings › Camera), then Try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'Another app is using the camera. Close it and Try again.';
  return 'The camera did not start' + (e && e.message ? ': ' + e.message : '.');
}

export async function startCamera(facing = cam.facing){
  cam.error = '';
  if (!cameraSupported()){ cam.error = window.isSecureContext ? 'This browser cannot use the camera.' : 'The camera only works on a secure (https) page.'; throw new Error(cam.error); }
  stopCamera();
  const v = video();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    // some cameras refuse the size: try again asking for nothing in particular
    if (e && e.name === 'OverconstrainedError'){
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); } catch (e2) { cam.error = why(e2); throw e2; }
    } else { cam.error = why(e); throw e; }
  }
  cam.stream = stream;
  cam.facing = facing;
  const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
  // a laptop's only camera faces the user even when we asked for the back one: mirror it then too
  cam.mirror = (settings.facingMode || facing) === 'user' || (!settings.facingMode && !isTouch());
  v.srcObject = stream;
  v.muted = true; v.playsInline = true;
  await v.play().catch(() => {});
  // wait for the first frame so the size is known
  const t0 = performance.now();
  while (!v.videoWidth && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
  cam.source = v; cam.live = true; cam.still = false;
  v.style.display = 'block'; stillEl().style.display = 'none';
  document.body.classList.toggle('mirror', cam.mirror);
  fit();
  return cam;
}

export function stopCamera(){
  if (cam.stream){ for (const t of cam.stream.getTracks()) t.stop(); }
  cam.stream = null; cam.live = false;
  const v = video(); if (v) v.srcObject = null;
}

export async function flipCamera(){
  return startCamera(cam.facing === 'user' ? 'environment' : 'user');
}

// a still picture in place of the camera (tests, or no camera)
export async function useImage(url, { mirror = false } = {}){
  stopCamera();
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = stillEl();
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  cam.source = c; cam.still = true; cam.mirror = mirror; cam.facing = mirror ? 'user' : 'environment';
  c.style.display = 'block'; video().style.display = 'none';
  document.body.classList.toggle('mirror', mirror);
  fit();
  return cam;
}

function isTouch(){ return matchMedia && matchMedia('(pointer: coarse)').matches; }

// how the picture sits on the screen (object-fit: cover)
export function fit(){
  const s = cam.source;
  cam.w = s ? (s.videoWidth || s.width || 0) : 0;
  cam.h = s ? (s.videoHeight || s.height || 0) : 0;
  cam.sw = innerWidth; cam.sh = innerHeight;
  if (!cam.w || !cam.h){ cam.scale = 1; cam.ox = cam.oy = 0; return; }
  cam.scale = Math.max(cam.sw / cam.w, cam.sh / cam.h);
  cam.ox = (cam.sw - cam.w * cam.scale) / 2;
  cam.oy = (cam.sh - cam.h * cam.scale) / 2;
}

// a point in the picture (0..1) -> screen pixels
export function toScreen(nx, ny){
  let x = cam.ox + nx * cam.w * cam.scale;
  const y = cam.oy + ny * cam.h * cam.scale;
  if (cam.mirror) x = cam.sw - x;
  return { x, y };
}
// screen pixels -> a point in the picture (0..1)
export function fromScreen(x, y){
  if (cam.mirror) x = cam.sw - x;
  return { x: (x - cam.ox) / (cam.w * cam.scale), y: (y - cam.oy) / (cam.h * cam.scale) };
}
// a box in the picture (0..1) -> a screen rectangle
export function boxToScreen(b){
  const a = toScreen(b.x, b.y), c = toScreen(b.x + b.w, b.y + b.h);
  return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
}
// draw something sized like the picture (a mask) onto the screen the same way the picture is drawn
export function drawCovering(ctx, img){
  ctx.save();
  if (cam.mirror){ ctx.translate(cam.sw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(img, cam.ox, cam.oy, cam.w * cam.scale, cam.h * cam.scale);
  ctx.restore();
}

// the current picture as an image (for photos)
export function grabFrame(ctx){
  if (!cam.source) return;
  drawCovering(ctx, cam.source);
}
