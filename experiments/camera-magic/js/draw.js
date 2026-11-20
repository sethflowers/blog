// Drawing what the models found, over the camera picture (on the 2D overlay canvas, in screen pixels).
import { cam, toScreen, boxToScreen, drawCovering } from '/experiments/camera-magic/js/camera.js';
import { HAND_LINKS, POSE_LINKS, TIPS } from '/experiments/camera-magic/js/vision.js';
import { nameOf, iconOf, colourOf } from '/experiments/camera-magic/js/labels.js';
import { pill } from '/experiments/camera-magic/js/util.js';

export function drawObjects(ctx, objects, { faint = false, highlight = null } = {}){
  for (const o of objects){
    const r = boxToScreen(o.box);
    const hot = highlight && highlight.includes(o.label);
    const c = hot ? '#ffe14a' : colourOf(o.label);
    ctx.lineWidth = hot ? 6 : faint ? 2 : 4;
    ctx.strokeStyle = c;
    ctx.globalAlpha = faint && !hot ? 0.55 : 1;
    ctx.setLineDash(faint && !hot ? [8, 8] : []);
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.stroke();
    ctx.setLineDash([]);
    const text = `${iconOf(o.label)} ${nameOf(o.label)}${faint ? '' : '  ' + Math.round(o.score * 100) + '%'}`;
    pill(ctx, text, r.x, Math.max(4, r.y - 32), { bg: hot ? '#ffe14a' : c, fg: '#111', size: faint ? 15 : 18 });
    ctx.globalAlpha = 1;
  }
}

export function handPoints(hand){ return hand.pts.map((p) => toScreen(p.x, p.y)); }

export function drawHands(ctx, hands, { tips = false } = {}){
  for (const hd of hands){
    const s = handPoints(hd);
    ctx.lineWidth = 4; ctx.strokeStyle = hd.side === 'Left' ? 'rgba(120,220,255,.9)' : 'rgba(255,170,90,.9)';
    ctx.beginPath();
    for (const [a, b] of HAND_LINKS){ ctx.moveTo(s[a].x, s[a].y); ctx.lineTo(s[b].x, s[b].y); }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const p of s){ ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 6.283); ctx.fill(); }
    if (tips) for (const i of TIPS) glow(ctx, s[i].x, s[i].y, 16, 'rgba(255,255,255,.9)');
  }
}

export function glow(ctx, x, y, r, colour){
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, colour); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
}

export function drawPose(ctx, pose){
  if (!pose) return;
  const s = pose.pts.map((p) => toScreen(p.x, p.y));
  const vis = (i) => (pose.pts[i].visibility ?? 1) > 0.4;
  ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(120,255,140,.9)';
  ctx.beginPath();
  for (const [a, b] of POSE_LINKS) if (vis(a) && vis(b)){ ctx.moveTo(s[a].x, s[a].y); ctx.lineTo(s[b].x, s[b].y); }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (let i = 0; i < s.length; i++) if (vis(i)){ ctx.beginPath(); ctx.arc(s[i].x, s[i].y, 5, 0, 6.283); ctx.fill(); }
}

export function drawFaceDots(ctx, face){
  if (!face) return;
  ctx.fillStyle = 'rgba(140,240,255,.85)';
  const pts = face.pts;
  for (let i = 0; i < pts.length; i++){
    const p = toScreen(pts[i].x, pts[i].y);
    ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
  }
}

// the person cut-out: everything that isn't a person tinted (look mode), or swapped for a backdrop
const maskCanvas = document.createElement('canvas');
let maskImg = null;
export function drawMask(ctx, mask, { tint = [90, 40, 210], alpha = 170, backdrop = null } = {}){
  if (!mask) return;
  if (maskCanvas.width !== mask.w || maskCanvas.height !== mask.h){
    maskCanvas.width = mask.w; maskCanvas.height = mask.h; maskImg = null;
  }
  const mctx = maskCanvas.getContext('2d');
  if (!maskImg) maskImg = mctx.createImageData(mask.w, mask.h);
  const d = maskImg.data, m = mask.data;
  if (backdrop){
    // backdrop pixels (same size as the mask), shown wherever there's no person
    const b = backdrop;
    for (let i = 0, j = 0; i < m.length; i++, j += 4){
      d[j] = b[j]; d[j + 1] = b[j + 1]; d[j + 2] = b[j + 2];
      const a = 1 - m[i];
      d[j + 3] = a > 0.85 ? 255 : a < 0.25 ? 0 : (a - 0.25) / 0.6 * 255;
    }
  } else {
    for (let i = 0, j = 0; i < m.length; i++, j += 4){
      d[j] = tint[0]; d[j + 1] = tint[1]; d[j + 2] = tint[2]; d[j + 3] = (1 - m[i]) * alpha;
    }
  }
  mctx.putImageData(maskImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  drawCovering(ctx, maskCanvas);
}
export { cam };

// just the person from the camera picture (everything else see-through), at up to 960 px across,
// for backdrops: the mask is scaled up smoothly, so the edges stay soft
const personCanvas = document.createElement('canvas');
const softMask = document.createElement('canvas');
let softImg = null;
export function personLayer(mask){
  if (!mask || !cam.source || !cam.w) return null;
  const k = Math.min(1, 960 / cam.w);
  const w = Math.round(cam.w * k), hgt = Math.round(cam.h * k);
  if (personCanvas.width !== w || personCanvas.height !== hgt){ personCanvas.width = w; personCanvas.height = hgt; }
  if (softMask.width !== mask.w || softMask.height !== mask.h){ softMask.width = mask.w; softMask.height = mask.h; softImg = null; }
  const sctx = softMask.getContext('2d');
  if (!softImg) softImg = sctx.createImageData(mask.w, mask.h);
  const d = softImg.data, m = mask.data;
  for (let i = 0, j = 0; i < m.length; i++, j += 4){
    const a = (m[i] - 0.3) / 0.4;
    d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
  }
  sctx.putImageData(softImg, 0, 0);
  const pctx = personCanvas.getContext('2d');
  pctx.globalCompositeOperation = 'copy';
  pctx.drawImage(cam.source, 0, 0, w, hgt);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.imageSmoothingEnabled = true;
  pctx.drawImage(softMask, 0, 0, w, hgt);
  pctx.globalCompositeOperation = 'source-over';
  return personCanvas;
}
