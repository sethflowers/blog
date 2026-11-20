// One three.js renderer, see-through, drawn over the camera picture. Pip (the critter), Look around
// and the headset's AR mode all share it (an iPad only allows a handful of WebGL canvases, and the
// vision models take some of them).
import * as THREE from 'three';

let renderer = null;
export function getRenderer(){
  if (renderer) return renderer;
  const canvas = document.getElementById('three');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}
export function resizeRenderer(){
  if (renderer && !renderer.xr.isPresenting) renderer.setSize(innerWidth, innerHeight, false);
}

// materials by name, made once and shared
const mats = new Map();
export function mat(name, opts){
  if (!mats.has(name)) mats.set(name, new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0, ...opts }));
  return mats.get(name);
}

// frees the shapes of something thrown away (not the shared materials)
export function disposeTree(obj){
  obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  obj.removeFromParent();
}

// lights for any scene: a sky light and a sun
export function addLights(scene){
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88aacc, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, 4, 3);
  scene.add(sun);
}

// ---- Pip, the camera critter ----
// A round, fluffy little creature about 1 unit tall (scale it to taste), standing on y = 0, facing +Z.
// Its shapes are made once and shared by every Pip.
let pipGeo = null;
function pipShapes(){
  if (pipGeo) return pipGeo;
  // body: a squashed ball, coloured on the surface (cream belly and pink cheeks are vertex colours)
  const body = new THREE.SphereGeometry(0.5, 40, 28);
  const col = [], p = body.attributes.position, n = new THREE.Vector3(), c = new THREE.Color();
  const fur = new THREE.Color(0x3cc8c0), belly = new THREE.Color(0xfff2d6), cheek = new THREE.Color(0xff8fb0);
  for (let i = 0; i < p.count; i++){
    n.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    c.copy(fur);
    const b = Math.max(0, n.z - 0.35 - Math.max(0, n.y + 0.1) * 1.4);   // front and low: belly
    c.lerp(belly, Math.min(1, b * 3));
    for (const sx of [-1, 1]){                                    // two round cheeks
      const d = Math.hypot(n.x - sx * 0.55, n.y + 0.05, n.z - 0.78);
      if (d < 0.22) c.lerp(cheek, Math.min(1, (0.22 - d) * 9));
    }
    col.push(c.r, c.g, c.b);
  }
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  pipGeo = {
    body,
    eye: new THREE.SphereGeometry(0.12, 20, 14),
    pupil: new THREE.SphereGeometry(0.075, 16, 12),
    shine: new THREE.SphereGeometry(0.025, 8, 6),
    ear: new THREE.CapsuleGeometry(0.09, 0.32, 6, 12),
    earIn: new THREE.CapsuleGeometry(0.05, 0.24, 4, 10),
    foot: new THREE.SphereGeometry(0.12, 14, 10),
    tail: new THREE.SphereGeometry(0.13, 14, 10),
    mouth: new THREE.TorusGeometry(0.06, 0.016, 6, 16, Math.PI),
  };
  return pipGeo;
}

export function makePip(){
  const G = pipShapes();
  const furM = mat('pip-fur', { vertexColors: true, roughness: 0.85 });
  const tealM = mat('pip-teal', { color: 0x3cc8c0, roughness: 0.85 });
  const pinkM = mat('pip-pink', { color: 0xff9ec0, roughness: 0.8 });
  const whiteM = mat('pip-white', { color: 0xffffff, roughness: 0.3 });
  const blackM = mat('pip-black', { color: 0x14141e, roughness: 0.25 });
  const footM = mat('pip-foot', { color: 0x2a9a94, roughness: 0.8 });
  const root = new THREE.Group();          // stays on the ground
  const bob = new THREE.Group();           // bounces and squashes
  root.add(bob);
  const body = new THREE.Mesh(G.body, furM);
  body.scale.set(1, 0.92, 0.95); body.position.y = 0.5;
  bob.add(body);
  const face = new THREE.Group(); face.position.set(0, 0.56, 0.41); bob.add(face);
  const eyes = [];
  for (const sx of [-1, 1]){
    const eye = new THREE.Group(); eye.position.set(sx * 0.17, 0.04, 0.03);
    const white = new THREE.Mesh(G.eye, whiteM); white.scale.z = 0.7;
    const pupil = new THREE.Mesh(G.pupil, blackM); pupil.position.z = 0.06;
    const shine = new THREE.Mesh(G.shine, whiteM); shine.position.set(0.03, 0.035, 0.12);
    eye.add(white, pupil, shine); face.add(eye); eyes.push(eye);
  }
  const mouth = new THREE.Mesh(G.mouth, blackM); mouth.rotation.z = Math.PI; mouth.position.set(0, -0.14, 0.075); face.add(mouth);
  const ears = [];
  for (const sx of [-1, 1]){
    const ear = new THREE.Group(); ear.position.set(sx * 0.24, 0.9, -0.02); ear.rotation.z = -sx * 0.35;
    const outer = new THREE.Mesh(G.ear, tealM); outer.position.y = 0.17;
    const inner = new THREE.Mesh(G.earIn, pinkM); inner.position.set(0, 0.17, 0.075); inner.scale.z = 0.6;   // stands 1.5 cm proud of the ear: never flush
    ear.add(outer, inner); bob.add(ear); ears.push(ear);
  }
  const feet = [];
  for (const sx of [-1, 1]){
    const f = new THREE.Mesh(G.foot, footM); f.scale.set(1, 0.55, 1.3); f.position.set(sx * 0.2, 0.05, 0.12);
    root.add(f); feet.push(f);
  }
  const tail = new THREE.Mesh(G.tail, mat('pip-tail', { color: 0xfff2d6, roughness: 0.9 })); tail.position.set(0, 0.32, -0.47); bob.add(tail);
  root.userData = { bob, eyes, ears, feet, mouth, t: Math.random() * 10, blink: 2, happy: 0 };
  return root;
}

// animate Pip: speed (0..1) makes it walk, `hop` (0..1) lifts it, happy makes the ears wiggle
export function animatePip(pip, dt, { speed = 0, hop = 0, look = null } = {}){
  const u = pip.userData;
  u.t += dt;
  u.happy = Math.max(0, u.happy - dt);
  const walk = Math.sin(u.t * 14) * speed;
  u.bob.position.y = Math.abs(walk) * 0.12 + hop + Math.sin(u.t * 2.2) * 0.015;
  const squash = 1 + Math.sin(u.t * 2.2) * 0.02 - Math.abs(walk) * 0.04;
  u.bob.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  u.feet[0].position.z = 0.12 + walk * 0.12; u.feet[1].position.z = 0.12 - walk * 0.12;
  const wig = u.happy > 0 ? Math.sin(u.t * 30) * 0.3 : Math.sin(u.t * 1.7) * 0.05;
  u.ears[0].rotation.z = 0.35 + wig; u.ears[1].rotation.z = -0.35 - wig;
  // blink every few seconds
  u.blink -= dt;
  const shut = u.blink < 0.12 && u.blink > 0;
  for (const e of u.eyes) e.scale.y = shut ? 0.1 : 1;
  if (u.blink < 0) u.blink = 2 + Math.random() * 3;
  if (look) for (const e of u.eyes){ e.children[1].position.x = look.x * 0.035; e.children[1].position.y = look.y * 0.035; }
}
