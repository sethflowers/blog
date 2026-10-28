// A small, dark "torchlit stone room" environment map for anything shiny (steel, iron, wet skin, water).
// Without one, metal in a dark scene reflects nothing and reads as flat black. Built once at startup
// from a tiny procedural scene, so there is no image to download.
import * as THREE from 'three';

export function makeEnvMap(renderer){
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050403);
  // the room: dim grey-brown stone all round
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), new THREE.MeshBasicMaterial({ color: 0x15110d, side: THREE.BackSide }));
  room.position.y = 2;
  scene.add(room);
  // a darker floor and a slightly lighter band at eye height, so reflections have a horizon
  const band = new THREE.Mesh(new THREE.CylinderGeometry(4.9, 4.9, 1.2, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x2a2018, side: THREE.BackSide }));
  band.position.y = 1.4; scene.add(band);
  // torch flames: small, very bright warm blobs around the walls
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.2).multiplyScalar(14) });
  for (const [x, y, z, s] of [[-4.6, 2.2, 1.5, 0.25], [4.6, 2.0, -2.0, 0.3], [1.0, 2.3, 4.6, 0.22], [-2.5, 2.1, -4.6, 0.2]]){
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8), flame); m.position.set(x, y, z); scene.add(m);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(s * 4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.22, 0.07), transparent: true, opacity: 0.6 }));
    glow.position.copy(m.position); scene.add(glow);
  }
  // a faint cold patch overhead, like moonlight through a grate
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.32, 0.5) }));
  moon.position.set(0, 4.4, 0); moon.rotation.x = Math.PI / 2; scene.add(moon);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.03);
  pm.dispose();
  return rt.texture;
}
