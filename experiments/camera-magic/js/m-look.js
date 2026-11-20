// 🌍 Look around: balloons hidden all around you in 3D. Turn the iPad (its gyroscope turns the 3D
// view to match, so the balloons stay put in the room as you turn) and tap them to pop them. Arrows at
// the edge of the screen point to the nearest one. On a computer, or with no gyroscope, drag to look.
// (Turning only: a web page on an iPad can't tell when you walk about, so the balloons move with you.)
import * as THREE from 'three';
import { getRenderer, addLights, mat, makePip, animatePip } from '/experiments/camera-magic/js/three-layer.js';
import { h, say, banner, burst, rand, save, store } from '/experiments/camera-magic/js/util.js';
import { sfx } from '/experiments/camera-magic/js/audio.js';

const COUNT = 12;
const COLOURS = [0xff4a5a, 0xffc23a, 0x4ab0ff, 0x6ad86a, 0xc070ff, 0xff8ad0];
let scene = null, pcam = null, balloonGeo = null, stringGeo = null, pip = null;
const S = { balloons: [], popped: 0, yaw: 0, pitch: 0, gyro: false, ori: null, dragYaw: 0, time: 0, done: false, asked: false };
const euler = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), zee = new THREE.Vector3(0, 0, 1);
const qYaw = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), ray = new THREE.Raycaster();

function onOrient(e){ if (e.alpha != null){ S.ori = e; S.gyro = true; } }

// iOS asks for permission to read the gyroscope; this must run inside a tap
export async function askGyro(){
  if (S.asked) return;
  S.asked = true;
  try {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function'){
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted'){ say('No gyroscope: drag to look around instead.'); return; }
    }
    addEventListener('deviceorientation', onOrient);
  } catch (e) { /* not a tap, or not supported: drag to look */ S.asked = false; }
}

function build(){
  if (scene) return;
  scene = new THREE.Scene();
  addLights(scene);
  pcam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
  pcam.rotation.order = 'YXZ';
  balloonGeo = new THREE.SphereGeometry(0.35, 24, 18);
  balloonGeo.scale(1, 1.2, 1);
  stringGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.9, 4);
  stringGeo.translate(0, -0.42 - 0.45, 0);
  // Pip floats in front of you to start with, holding nothing, just to say hi
  pip = makePip(); pip.scale.setScalar(0.5); pip.position.set(0.9, -0.6, -2.4); pip.rotation.y = -0.4;
  scene.add(pip);
}

function scatter(){
  for (const b of S.balloons) b.mesh.removeFromParent();   // shapes and materials are shared: nothing to free
  S.balloons = [];
  for (let i = 0; i < COUNT; i++){
    // all the way round you, a little above and below eye level
    const yaw = (i / COUNT) * Math.PI * 2 + rand(-0.2, 0.2), d = rand(3, 6), y = rand(-0.8, 1.8);
    const g = new THREE.Group();
    const ball = new THREE.Mesh(balloonGeo, mat('balloon-' + (i % COLOURS.length), { color: COLOURS[i % COLOURS.length], roughness: 0.3 }));
    const str = new THREE.Mesh(stringGeo, mat('string', { color: 0xffffff }));
    g.add(ball, str);
    g.position.set(Math.sin(yaw) * d, y, -Math.cos(yaw) * d);
    g.userData.phase = rand(0, 6);
    scene.add(g);
    S.balloons.push({ mesh: g, ball, y0: y });
  }
  S.popped = 0; S.done = false; S.time = 0;
  show();
}
function show(){
  banner(S.done ? `<b>All ${COUNT} popped!</b> 🎈 in ${Math.round(S.time)} s <small>Best ${save.best.look ? Math.round(save.best.look) + ' s' : '–'} · 🔁 for more</small>`
                : `<b>🎈 ${S.popped} / ${COUNT}</b> <small>${S.gyro ? 'Turn around to find them all' : 'Drag to look around'}</small>`);
}

const mode = {
  id: 'look', icon: '🌍', name: 'Look around',
  hint: 'Balloons are hidden all around you. Turn round with the iPad and tap them!',
  three: true, camera: 'environment',
  needs(){ return new Set(); },
  bar(){ return [h('button', { class: 'chip', onclick: () => { scatter(); sfx.click(); } }, '🔁 New balloons'),
                 h('button', { class: 'chip', onclick: () => { S.dragYaw = -yawFromGyro(); S.pitch = 0; } }, '🧭 Face the start')]; },
  enter(){ build(); if (!S.balloons.length) scatter(); else show(); askGyro(); },
  exit(){ banner(''); const r = getRenderer(); r.clear(); },
  drag(dx, dy){
    S.dragYaw += dx * 0.005;
    if (!S.gyro) S.pitch = Math.max(-1.2, Math.min(1.2, S.pitch + dy * 0.005));
  },
  update(dt){
    S.time += S.done ? 0 : dt;
    pcam.aspect = innerWidth / innerHeight;
    // a wider view on a tall screen, so the balloons are the same size either way round
    pcam.fov = pcam.aspect < 1 ? 75 : 55;
    pcam.updateProjectionMatrix();
    if (S.gyro && S.ori){
      const o = S.ori, orient = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || window.orientation || 0);
      euler.set(THREE.MathUtils.degToRad(o.beta), THREE.MathUtils.degToRad(o.alpha), -THREE.MathUtils.degToRad(o.gamma), 'YXZ');
      pcam.quaternion.setFromEuler(euler);
      pcam.quaternion.multiply(q1);
      pcam.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
      qYaw.setFromAxisAngle(yAxis, S.dragYaw);
      pcam.quaternion.premultiply(qYaw);
    } else {
      pcam.rotation.set(S.pitch, S.dragYaw, 0);
    }
    const t = performance.now() / 1000;
    for (const b of S.balloons){ b.mesh.position.y = b.y0 + Math.sin(t * 0.8 + b.mesh.userData.phase) * 0.12; b.mesh.rotation.y = Math.sin(t * 0.5 + b.mesh.userData.phase) * 0.3; }
    animatePip(pip, dt, {});
    pip.position.y = -0.6 + Math.sin(t * 1.3) * 0.08;
    show();
  },
  draw(ctx){
    getRenderer().render(scene, pcam);
    // arrows at the edge of the screen towards the nearest balloon that's off screen
    if (S.done || !S.balloons.length) return;
    let best = null, bestA = 9;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(pcam.quaternion);
    for (const b of S.balloons){
      tmp.copy(b.mesh.position).sub(pcam.position).normalize();
      const a = fwd.angleTo(tmp);
      if (a < bestA){ bestA = a; best = b; }
    }
    if (!best) return;
    tmp.copy(best.mesh.position).project(pcam);
    const on = tmp.z < 1 && Math.abs(tmp.x) < 1 && Math.abs(tmp.y) < 1;
    if (on) return;
    // direction in screen terms (behind you: flip)
    let dx = tmp.x, dy = -tmp.y;
    if (tmp.z > 1){ dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx);
    const W = innerWidth, H = innerHeight, m = 60;
    const k = Math.min((W / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
    const x = W / 2 + Math.cos(ang) * k, y = H / 2 + Math.sin(ang) * k;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(-14, -22); ctx.lineTo(-6, 0); ctx.lineTo(-14, 22); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  },
  tap(x, y){
    ray.setFromCamera({ x: (x / innerWidth) * 2 - 1, y: -(y / innerHeight) * 2 + 1 }, pcam);
    // tapping near a balloon counts: test a slightly bigger sphere than the balloon
    let hit = null, hd = 1e9;
    for (const b of S.balloons){
      const c = b.mesh.position;
      tmp.copy(c).sub(ray.ray.origin);
      const along = tmp.dot(ray.ray.direction);
      if (along < 0) continue;
      const off = tmp.lengthSq() - along * along;
      if (off < 0.5 * 0.5 && along < hd){ hd = along; hit = b; }
    }
    if (!hit) return false;
    popBalloon(hit, x, y);
    return true;
  },
  state: S, scatter, get camera3(){ return pcam; },
  popAt(i){ const b = S.balloons[i]; if (b) popBalloon(b, innerWidth / 2, innerHeight / 2); },
};
export default mode;

function popBalloon(b, x, y){
  S.balloons.splice(S.balloons.indexOf(b), 1);
  b.mesh.removeFromParent();
  S.popped++;
  sfx.pop(0.7); burst(x, y, 30);
  if (!S.balloons.length){
    S.done = true; sfx.found();
    if (!save.best.look || S.time < save.best.look){ save.best.look = S.time; store(); }
    say('You found every balloon! 🎉', 'good', 3000);
  }
  show();
}

function yawFromGyro(){
  if (!S.gyro) return 0;
  const e = new THREE.Euler().setFromQuaternion(pcam.quaternion, 'YXZ');
  return e.y - S.dragYaw;
}
