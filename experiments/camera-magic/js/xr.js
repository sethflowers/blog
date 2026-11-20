// 🥽 AR in a headset (a Quest 3's passthrough: your room, with things added). An iPad's Safari has no
// WebXR AR, so this only appears where the browser says it can do it ('immersive-ar').
// Bubbles float up around you: pop them by touching them with your hands or controllers, or point and
// pull the trigger. Pip follows you about on the floor. A sign on your left wrist shows the version and
// your score. B or Y leaves.
//
// The headset's own browser can't hand a web page the camera's picture, so there's no object spotting
// here: the headset tracks your head, hands and floor itself.
import * as THREE from 'three';
import { getRenderer, addLights, mat, makePip, animatePip } from '/experiments/camera-magic/js/three-layer.js';
import { rand } from '/experiments/camera-magic/js/util.js';
import { sfx } from '/experiments/camera-magic/js/audio.js';

const VERSION = document.body.dataset.version || '';
const MAX = 16, SPARKS = 80;
let scene = null, camera = null, pip = null, bubbleGeo = null, sparkMesh = null, sign = null, signTex = null, hint = null;
const bubbleMats = [];
export const AR = { on: false, session: null, bubbles: [], popped: 0, posed: false, spawn: 0, sparks: [], prevButtons: new Map(), head: new THREE.Vector3(), tips: [], pipHome: new THREE.Vector3(), time: 0, hintT: 0, signText: '', inputs: [] };
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), rayO = new THREE.Vector3(), rayD = new THREE.Vector3();

export async function arSupported(){
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { return false; }
}

function build(){
  if (scene) return;
  scene = new THREE.Scene();
  addLights(scene);
  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 50);
  bubbleGeo = new THREE.SphereGeometry(1, 24, 16);
  for (const c of [0x9ad8ff, 0xffa8e0, 0xb8ffb0, 0xffe48a]){
    bubbleMats.push(new THREE.MeshPhongMaterial({ color: c, specular: 0xffffff, shininess: 120, transparent: true, opacity: 0.42, depthWrite: false }));
  }
  // sparkles when a bubble pops: one shared mesh, recycled
  sparkMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 6, 4), mat('spark', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }), SPARKS);
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkMesh.frustumCulled = false;
  for (let i = 0; i < SPARKS; i++){ AR.sparks.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() }); hideSpark(i); }
  scene.add(sparkMesh);
  pip = makePip(); pip.scale.setScalar(0.3); pip.visible = false;
  scene.add(pip);
  // the wrist sign (a canvas texture, redrawn only when its text changes)
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  signTex = new THREE.CanvasTexture(c); signTex.colorSpace = THREE.SRGBColorSpace;
  sign = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  sign.visible = false;
  scene.add(sign);
  // the start hint, placed in front of you once the headset knows where you are
  const hc = document.createElement('canvas'); hc.width = 1024; hc.height = 256;
  const g = hc.getContext('2d');
  g.fillStyle = 'rgba(20,20,50,.85)'; roundRect(g, 0, 0, 1024, 256, 50); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 64px sans-serif';
  g.fillText('Pop the bubbles!', 512, 100);
  g.font = '40px sans-serif'; g.fillText('Touch them, or point and pull the trigger', 512, 170);
  g.fillText('B or Y to leave', 512, 222);
  const ht = new THREE.CanvasTexture(hc); ht.colorSpace = THREE.SRGBColorSpace;
  hint = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), new THREE.MeshBasicMaterial({ map: ht, transparent: true }));
  hint.visible = false;
  scene.add(hint);
}
function roundRect(g, x, y, w, h, r){ g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

function drawSign(){
  const text = `🫧 ${AR.popped} popped`;
  if (text === AR.signText) return;
  AR.signText = text;
  const g = signTex.image.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(20,20,50,.88)'; roundRect(g, 0, 0, 512, 256, 40); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = 'bold 56px sans-serif'; g.fillText(text, 256, 100);
  g.font = '34px sans-serif'; g.fillText('Camera Magic v' + VERSION, 256, 168);
  g.fillText('B / Y: leave', 256, 218);
  signTex.needsUpdate = true;
}

export async function startAR(onEnd){
  build();
  const renderer = getRenderer();
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
  AR.session = session; AR.on = true; AR.posed = false; AR.popped = 0; AR.time = 0; AR.signText = '';
  for (const b of AR.bubbles) b.mesh.removeFromParent();
  AR.bubbles = [];
  pip.visible = false; hint.visible = false; sign.visible = false;
  session.addEventListener('end', () => {
    AR.on = false; AR.session = null;
    renderer.setAnimationLoop(null);
    renderer.xr.enabled = false;
    for (const b of AR.bubbles) b.mesh.removeFromParent();
    AR.bubbles = [];
    onEnd && onEnd();
  });
  await renderer.xr.setSession(session);
  try { if (session.updateTargetFrameRate && session.supportedFrameRates && [...session.supportedFrameRates].includes(72)) session.updateTargetFrameRate(72); } catch (e) {}
  let last = performance.now();
  renderer.setAnimationLoop((t, frame) => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    try { arFrame(dt, frame); } catch (e) { console.warn('[camera-magic] AR frame', e); }
    renderer.render(scene, camera);
  });
}
export function stopAR(){ if (AR.session) AR.session.end().catch(() => {}); }

function spawnBubble(){
  const a = rand(0, Math.PI * 2), d = rand(0.45, 1.4), r = rand(0.06, 0.12);
  const m = new THREE.Mesh(bubbleGeo, bubbleMats[Math.floor(Math.random() * bubbleMats.length)]);
  m.scale.setScalar(r);
  m.position.set(AR.head.x + Math.sin(a) * d, rand(0.5, 1.2), AR.head.z + Math.cos(a) * d);
  scene.add(m);
  AR.bubbles.push({ mesh: m, r, vy: rand(0.08, 0.18), wob: rand(0, 6) });
}

function popBubble(i){
  const b = AR.bubbles[i];
  AR.bubbles.splice(i, 1);
  b.mesh.removeFromParent();
  AR.popped++;
  sfx.pop(0.8 + Math.random() * 0.5);
  let n = 0;
  for (const s of AR.sparks){
    if (s.life > 0) continue;
    s.life = 0.6; s.p.copy(b.mesh.position); s.v.set(rand(-1, 1), rand(-0.5, 1.2), rand(-1, 1)).multiplyScalar(0.8);
    if (++n >= 10) break;
  }
  pip.userData.happy = 0.8;
}
function hideSpark(i){ tmpM.makeScale(0, 0, 0); sparkMesh.setMatrixAt(i, tmpM); }

// read the hands and controllers: fingertips / controller tips to touch with, rays to point with
function readInputs(frame, ref){
  AR.tips.length = 0; AR.inputs.length = 0;
  const session = AR.session;
  for (const src of session.inputSources){
    if (src.hand){
      for (const j of ['index-finger-tip', 'thumb-tip']){
        const js = src.hand.get(j); const p = js && frame.getJointPose && frame.getJointPose(js, ref);
        if (p) AR.tips.push(new THREE.Vector3(p.transform.position.x, p.transform.position.y, p.transform.position.z));
      }
      const w = src.hand.get('wrist'); const wp = w && frame.getJointPose && frame.getJointPose(w, ref);
      if (wp && src.handedness === 'left') AR.inputs.push({ wrist: wp.transform });
      continue;
    }
    const gp = src.gripSpace && frame.getPose(src.gripSpace, ref);
    const rp = src.targetRaySpace && frame.getPose(src.targetRaySpace, ref);
    if (gp){
      const p = gp.transform.position, o = gp.transform.orientation;
      // the tip of the controller, a few cm forward along the handle
      tmpQ.set(o.x, o.y, o.z, o.w);
      AR.tips.push(new THREE.Vector3(0, 0, -0.05).applyQuaternion(tmpQ).add(tmpV.set(p.x, p.y, p.z)));
      if (src.handedness === 'left') AR.inputs.push({ wrist: gp.transform });
    }
    const buttons = src.gamepad ? src.gamepad.buttons : [];
    const prev = AR.prevButtons.get(src) || [];
    const pressed = (i) => !!(buttons[i] && buttons[i].pressed) && !prev[i];
    if (rp && pressed(0)) AR.inputs.push({ ray: rp.transform });
    if (pressed(5)){ stopAR(); }
    AR.prevButtons.set(src, buttons.map((b) => b.pressed));
  }
}

function arFrame(dt, frame){
  if (!frame) return;
  const renderer = getRenderer();
  const ref = renderer.xr.getReferenceSpace();
  const vp = frame.getViewerPose(ref);
  if (!vp) return;                    // no head pose yet: place nothing
  AR.time += dt;
  const hp = vp.transform.position;
  AR.head.set(hp.x, hp.y, hp.z);
  const o = vp.transform.orientation;
  tmpQ.set(o.x, o.y, o.z, o.w);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(tmpQ); fwd.y = 0; fwd.normalize();
  if (!AR.posed){
    AR.posed = true;
    hint.position.copy(AR.head).addScaledVector(fwd, 1.2); hint.position.y = AR.head.y - 0.1;
    hint.lookAt(AR.head.x, hint.position.y, AR.head.z);
    hint.visible = true; AR.hintT = 10;
    pip.position.set(AR.head.x + fwd.x * 0.9, 0, AR.head.z + fwd.z * 0.9);
    pip.visible = true;
  }
  AR.hintT -= dt;
  if (hint.visible && AR.hintT <= 0) hint.visible = false;
  readInputs(frame, ref);

  // bubbles
  AR.spawn -= dt;
  if (AR.spawn <= 0 && AR.bubbles.length < MAX){ spawnBubble(); AR.spawn = rand(0.4, 1.0); }
  for (let i = AR.bubbles.length - 1; i >= 0; i--){
    const b = AR.bubbles[i];
    b.wob += dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.x += Math.sin(b.wob * 1.3) * 0.04 * dt;
    if (b.mesh.position.y > 2.6){ b.mesh.removeFromParent(); AR.bubbles.splice(i, 1); continue; }
    let popped = false;
    for (const t of AR.tips) if (t.distanceTo(b.mesh.position) < b.r + 0.03){ popBubble(i); popped = true; break; }
    if (popped) continue;
  }
  // point and pull the trigger: the nearest bubble along the ray
  for (const inp of AR.inputs){
    if (!inp.ray) continue;
    const p = inp.ray.position, q = inp.ray.orientation;
    rayO.set(p.x, p.y, p.z); rayD.set(0, 0, -1).applyQuaternion(tmpQ.set(q.x, q.y, q.z, q.w));
    let best = -1, bd = 1e9;
    AR.bubbles.forEach((b, i) => {
      tmpV.copy(b.mesh.position).sub(rayO);
      const along = tmpV.dot(rayD);
      if (along < 0) return;
      const off = Math.sqrt(Math.max(0, tmpV.lengthSq() - along * along));
      if (off < b.r + 0.04 && along < bd){ bd = along; best = i; }
    });
    if (best >= 0) popBubble(best); else sfx.click();
  }
  // sparkles
  AR.sparks.forEach((s, i) => {
    if (s.life <= 0) return;
    s.life -= dt; s.v.y -= 2 * dt; s.p.addScaledVector(s.v, dt);
    if (s.life <= 0) hideSpark(i);
    else { tmpM.compose(s.p, tmpQ.identity(), tmpS.setScalar(s.life * 1.6)); sparkMesh.setMatrixAt(i, tmpM); }
  });
  sparkMesh.instanceMatrix.needsUpdate = true;

  // Pip walks to a spot just in front of you and looks up at you
  const home = AR.pipHome.set(AR.head.x + fwd.x * 0.8, 0, AR.head.z + fwd.z * 0.8);
  const to = tmpV.copy(home).sub(pip.position); to.y = 0;
  const d = to.length();
  let speed = 0;
  if (d > 0.15){ pip.position.addScaledVector(to.normalize(), Math.min(d, 0.6 * dt)); speed = 1; }
  const face = speed ? Math.atan2(to.x, to.z) : Math.atan2(AR.head.x - pip.position.x, AR.head.z - pip.position.z);
  let dy = face - pip.rotation.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
  pip.rotation.y += dy * Math.min(1, dt * 5);
  // a pat on the head
  for (const t of AR.tips) if (t.distanceTo(tmpV.copy(pip.position).setY(0.15)) < 0.15 && pip.userData.happy <= 0){ pip.userData.happy = 1.2; sfx.giggle(); }
  animatePip(pip, dt, { speed });

  // the wrist sign
  const wrist = AR.inputs.find((i) => i.wrist);
  if (wrist){
    const p = wrist.wrist.position, q = wrist.wrist.orientation;
    tmpQ.set(q.x, q.y, q.z, q.w);
    sign.position.set(p.x, p.y, p.z).add(tmpV.set(0, 0.06, 0.05).applyQuaternion(tmpQ));
    sign.lookAt(AR.head);
    sign.visible = true;
    drawSign();
  } else sign.visible = false;
}

// for tests: the renderer's memory counts while bubbles come and go
export function arInfo(){ const r = getRenderer(); return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, bubbles: AR.bubbles.length, popped: AR.popped, posed: AR.posed, pip: pip && pip.visible }; }
export { spawnBubble as _spawnBubble };
