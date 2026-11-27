// The glue gun: a chunky industrial thing with a glass tank of glowing yellow glue on top, copper
// coils round the barrel and a fat nozzle. Two lamps on the back say which shot is next: "1" (green:
// stick the first end) or "2" (amber, blinking: stick the other end). In VR the left gun also has a
// little screen on top: health, wave, aliens left, score and the version.
import * as THREE from 'three';
import { V, textCanvas, roundRect } from './util.js';

const M = {};
function mats(){
  if (M.body) return M;
  M.body = new THREE.MeshStandardMaterial({ color: '#3a3f46', metalness: 0.8, roughness: 0.35 });
  M.dark = new THREE.MeshStandardMaterial({ color: '#16181b', metalness: 0.5, roughness: 0.55 });
  M.grip = new THREE.MeshStandardMaterial({ color: '#1e1a16', metalness: 0, roughness: 0.85 });
  M.copper = new THREE.MeshStandardMaterial({ color: '#c06a32', metalness: 1, roughness: 0.3 });
  M.stripe = new THREE.MeshStandardMaterial({ color: '#e0a800', metalness: 0.3, roughness: 0.5 });
  M.glass = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false });
  M.glue = new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#ffa800', emissiveIntensity: 1.2, roughness: 0.2 });
  return M;
}
export function makeGun(withScreen = false){
  const m = mats();
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  // body (along -Z), barrel, nozzle
  add(new THREE.BoxGeometry(0.06, 0.07, 0.2), m.body, 0, 0, -0.02);
  add(new THREE.BoxGeometry(0.064, 0.02, 0.12), m.stripe, 0, -0.03, -0.03);
  add(new THREE.CylinderGeometry(0.019, 0.019, 0.16, 16).rotateX(Math.PI / 2), m.dark, 0, 0.005, -0.18);
  for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.023, 0.005, 6, 16), m.copper, 0, 0.005, -0.13 - i * 0.025);
  add(new THREE.CylinderGeometry(0.012, 0.026, 0.05, 16).rotateX(-Math.PI / 2), m.body, 0, 0.005, -0.28);
  const tip = add(new THREE.SphereGeometry(0.011, 10, 8), m.glue, 0, 0.005, -0.305);
  // the glue tank on top
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 16).rotateX(Math.PI / 2), m.glass, 0, 0.065, -0.03);
  const glue = add(new THREE.CylinderGeometry(0.024, 0.024, 0.092, 14).rotateX(Math.PI / 2), m.glue, 0, 0.063, -0.03);
  add(new THREE.CylinderGeometry(0.033, 0.033, 0.012, 16).rotateX(Math.PI / 2), m.body, 0, 0.065, 0.025);
  add(new THREE.CylinderGeometry(0.033, 0.033, 0.012, 16).rotateX(Math.PI / 2), m.body, 0, 0.065, -0.085);
  add(new THREE.BoxGeometry(0.012, 0.03, 0.08), m.dark, 0, 0.038, -0.03);
  // grip and trigger
  add(new THREE.BoxGeometry(0.036, 0.11, 0.045), m.grip, 0, -0.075, 0.045, 0.28);
  add(new THREE.BoxGeometry(0.008, 0.03, 0.012), m.dark, 0, -0.045, -0.005, 0.3);
  add(new THREE.TorusGeometry(0.022, 0.004, 6, 12, Math.PI).rotateY(Math.PI / 2), m.dark, 0, -0.037, -0.005, 0, 0, Math.PI);
  // the two lamps on the back: shot 1 and shot 2
  const lampMat = [new THREE.MeshBasicMaterial({ color: '#203020', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#302010', toneMapped: false })];
  const l1 = add(new THREE.CircleGeometry(0.009, 12), lampMat[0], -0.014, 0.012, 0.081);
  const l2 = add(new THREE.CircleGeometry(0.009, 12), lampMat[1], 0.014, 0.012, 0.081);
  // numbers by the lamps
  const lab = textCanvas(128, 64);
  lab.ctx.fillStyle = '#ffffff'; lab.ctx.font = 'bold 44px Arial'; lab.ctx.textAlign = 'center'; lab.ctx.fillText('1', 32, 48); lab.ctx.fillText('2', 96, 48); lab.tex.needsUpdate = true;
  add(new THREE.PlaneGeometry(0.05, 0.025), new THREE.MeshBasicMaterial({ map: lab.tex, transparent: true }), 0, -0.012, 0.0805);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.005, -0.31); g.add(muzzle);
  g.userData = { muzzle, tip, glue, lamps: [l1, l2], lampMat, kick: 0 };
  if (withScreen){
    const sc = textCanvas(256, 128);
    const plane = add(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ map: sc.tex, toneMapped: false }), 0, 0.1, 0.03, -0.9);
    g.userData.screen = { sc, plane, last: '' };
  }
  for (const o of g.children) if (o.isMesh) o.castShadow = false;
  return g;
}
// light the lamp for the next shot (blinking amber while the second end is waiting)
export function setGunState(gun, pending, t){
  const U = gun.userData;
  U.lampMat[0].color.set(pending ? '#203020' : '#5aff5a');
  U.lampMat[1].color.set(pending ? (Math.sin(t * 12) > -0.3 ? '#ffb020' : '#503010') : '#302010');
  U.glue.material.emissiveIntensity = 1.0 + Math.sin(t * 3) * 0.25;
}
// the VR wrist screen on the left gun
export function drawGunScreen(gun, lines){
  const S = gun.userData.screen; if (!S) return;
  const key = lines.join('|'); if (key === S.last) return; S.last = key;
  const g = S.sc.ctx;
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(10,8,16,0.92)'; roundRect(g, 2, 2, 252, 124, 14); g.fill();
  g.strokeStyle = '#ffcf2a'; g.lineWidth = 3; roundRect(g, 2, 2, 252, 124, 14); g.stroke();
  g.textAlign = 'left'; g.fillStyle = '#fff';
  lines.forEach((l, i) => { g.font = i === 0 ? 'bold 30px Arial' : '22px Arial'; g.fillStyle = i === 0 ? '#ffffff' : i === lines.length - 1 ? '#8a8a9a' : '#ffe48a'; g.fillText(l, 12, 34 + i * 30); });
  S.sc.tex.needsUpdate = true;
}
