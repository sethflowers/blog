// The device's real camera (from Camera Magic): starts the back or selfie camera into a <video>, takes
// a still picture from it, and explains in plain words why it didn't start when it doesn't.
// On a headset, the browser may or may not hand the page its cameras; when it doesn't, the game
// photographs the gallery instead (main.js), so the camera always does something.
const $ = (id) => document.getElementById(id);

export const cam = { facing: 'environment', mirror: false, stream: null, live: false, error: '' };

export const isBrave = () => !!navigator.brave;
const tryOther = () => isBrave() ? ' In Brave, tap the lion (Shields) or the page settings and allow the camera for this site, or open the page in Safari.' : ' Try opening the page in Safari.';
export function cameraSupported(){ return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

function why(e){
  const n = e && e.name;
  if (!window.isSecureContext) return 'The camera only works on a secure (https) page.';
  if (n === 'NotAllowedError' || n === 'SecurityError') return isBrave() ? 'Brave did not let this page use the camera.' + tryOther()
    : 'The camera is switched off for this page. On an iPad: Settings › Apps › Safari › Camera › Allow (or tap "aA" in the address bar › Website Settings › Camera), then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'Another app is using the camera. Close it and try again.';
  return 'The camera did not start' + (e && e.message ? ': ' + e.message + '.' : '.') + tryOther();
}

export async function startCamera(facing = cam.facing, video = $('cam-video')){
  cam.error = '';
  if (!cameraSupported()){ cam.error = window.isSecureContext ? 'This browser doesn\'t let web pages use the camera.' + tryOther() : 'The camera only works on a secure (https) page.'; throw new Error(cam.error); }
  stopCamera(video);
  let stream;
  const ask = (c) => Promise.race([navigator.mediaDevices.getUserMedia(c), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('the camera did not answer'), { name: 'AbortError' })), 15000))]);
  try {
    stream = await ask({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
  } catch (e) {
    if (e && e.name === 'OverconstrainedError'){
      try { stream = await ask({ audio: false, video: true }); } catch (e2) { cam.error = why(e2); throw e2; }
    } else { cam.error = why(e); throw e; }
  }
  cam.stream = stream; cam.facing = facing;
  const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
  // a laptop's only camera faces you even when we asked for the back one: mirror it then too
  cam.mirror = (settings.facingMode || facing) === 'user' || (!settings.facingMode && !matchMedia('(pointer: coarse)').matches);
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play().catch(() => {});
  const t0 = performance.now();
  while (!video.videoWidth && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
  cam.live = !!video.videoWidth;
  document.body.classList.toggle('cam-mirror', cam.mirror);
  return cam;
}
export function stopCamera(video = $('cam-video')){
  if (cam.stream) for (const t of cam.stream.getTracks()) t.stop();
  cam.stream = null; cam.live = false;
  if (video) video.srcObject = null;
}
export function flipCamera(video){ return startCamera(cam.facing === 'user' ? 'environment' : 'user', video); }

// a still picture from the camera (a mirrored selfie is saved the way you saw it)
export function snap(video = $('cam-video'), max = 1600){
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  const k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  if (cam.mirror){ g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(video, 0, 0, c.width, c.height);
  return c;
}
