// Animals that wander, graze, flee and can be bonked (chickens can be picked up and thrown),
// and two villagers who walk their rounds, turn to face you, wave and talk.
import * as THREE from 'three';
import { boxMesh, multiBox, rng, COL, textCanvas, wrapText } from './util.js';
import { surfaceHeight, pushOut, PLACES } from './world.js';
import { Avatar, blobShadow } from './avatar.js';
import { sfx } from './audio.js';

const R = rng(11);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), m1 = new THREE.Matrix4();
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// ---------- animal models (forward is -Z) ----------
function leg(w, h, color, x, y, z){
  const g = new THREE.Group(); g.position.set(x, y, z);
  g.add(boxMesh(w, h, w, color, 0, -h / 2, 0)); return g;
}
const SPECIES = {
  sheep: {
    speed: 0.7, run: 2.6, radius: 0.38, center: 0.55, sound: 'bleat',
    build(g){
      const body = boxMesh(0.5, 0.48, 0.78, { all: 0xf1efe8, ny: 0xd8d6cf }, 0, 0.58, 0); g.add(body);
      const head = new THREE.Group(); head.position.set(0, 0.72, -0.4);
      const hb = [[0.24, 0.26, 0.26, 0x3a3330, 0, 0, -0.08], [0.28, 0.1, 0.2, 0xf1efe8, 0, 0.13, -0.05]];
      for (const s of [-1, 1]) hb.push([0.04, 0.03, 0.01, 0xffffff, s * 0.07, 0.04, -0.215], [0.1, 0.04, 0.06, 0x3a3330, s * 0.16, 0.06, -0.05]);
      head.add(multiBox(hb));
      g.add(head);
      const legs = [[-0.15, -0.26], [0.15, -0.26], [-0.15, 0.26], [0.15, 0.26]].map(([x, z]) => { const l = leg(0.11, 0.36, 0x3a3330, x, 0.36, z); g.add(l); return l; });
      return { head, legs, body };
    },
  },
  pig: {
    speed: 0.8, run: 2.4, radius: 0.36, center: 0.45, sound: 'oink',
    build(g){
      const body = boxMesh(0.46, 0.42, 0.72, 0xf0a3a8, 0, 0.45, 0); g.add(body);
      const head = new THREE.Group(); head.position.set(0, 0.52, -0.38);
      const hb = [[0.34, 0.32, 0.28, 0xf0a3a8, 0, 0, -0.1], [0.16, 0.1, 0.06, 0xe68590, 0, -0.04, -0.27]];
      for (const s of [-1, 1]) hb.push([0.04, 0.02, 0.01, 0x5a2a30, s * 0.035, -0.04, -0.302], [0.05, 0.05, 0.01, 0x222222, s * 0.1, 0.06, -0.245], [0.06, 0.08, 0.02, 0xe68590, s * 0.12, 0.17, -0.05]);
      head.add(multiBox(hb));
      g.add(head);
      const legs = [[-0.13, -0.24], [0.13, -0.24], [-0.13, 0.24], [0.13, 0.24]].map(([x, z]) => { const l = leg(0.11, 0.24, 0xe68590, x, 0.24, z); g.add(l); return l; });
      return { head, legs, body };
    },
  },
  chicken: {
    speed: 0.55, run: 2.8, radius: 0.16, center: 0.26, sound: 'cluck', grab: true,
    build(g){
      const body = multiBox([[0.2, 0.2, 0.28, 0xffffff, 0, 0.27, 0], [0.12, 0.12, 0.06, 0xf4f4f4, 0, 0.36, 0.15]]); g.add(body);
      const head = new THREE.Group(); head.position.set(0, 0.42, -0.12);
      head.add(multiBox([[0.12, 0.16, 0.12, 0xffffff], [0.1, 0.04, 0.07, 0xf2b630, 0, 0.0, -0.09], [0.04, 0.06, 0.03, 0xd42a2a, 0, -0.06, -0.07],
        [0.03, 0.05, 0.1, 0xd42a2a, 0, 0.1, 0], [0.01, 0.03, 0.03, 0x111111, -0.06, 0.03, -0.03], [0.01, 0.03, 0.03, 0x111111, 0.06, 0.03, -0.03]]));
      g.add(head);
      const legs = [-0.05, 0.05].map((x) => { const l = leg(0.03, 0.16, 0xf2b630, x, 0.17, 0.02); g.add(l); return l; });
      const wings = [-1, 1].map((s) => { const w = new THREE.Group(); w.position.set(s * 0.1, 0.34, 0); w.add(boxMesh(0.03, 0.14, 0.22, 0xeeeeee, s * 0.015, -0.07, 0)); g.add(w); return w; });
      return { head, legs, body, wings };
    },
  },
};

class Animal {
  constructor(kind, scene, x, z){
    this.kind = kind; this.sp = SPECIES[kind];
    this.group = new THREE.Group(); scene.add(this.group);
    this.parts = this.sp.build(this.group);
    this.shadow = blobShadow(this.sp.radius * 2.6); scene.add(this.shadow);
    this.pos = new THREE.Vector3(x, surfaceHeight(x, z), z);
    this.yaw = R() * Math.PI * 2; this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3(); this.air = false;
    this.state = 'idle'; this.timer = R() * 3; this.target = new THREE.Vector3();
    this.phase = 0; this.hitCool = 0; this.soundT = 4 + R() * 10; this.held = null; this.flap = 0;
    this.home = new THREE.Vector3(11, 0, -8.5); this.speedNow = 0; this.graze = 0;
    this.offset = new THREE.Matrix4();
  }
}

export class Creatures {
  constructor(scene, particles){
    this.scene = scene; this.particles = particles;
    this.list = [];
    const spots = [['sheep', 10, -8], ['sheep', 12.5, -9.5], ['sheep', 9, -11], ['pig', 13.5, -7], ['pig', 8, -3],
      ['chicken', 6, -3.5], ['chicken', 7, -2.5], ['chicken', 5.5, -5.5], ['chicken', 9.5, -2]];
    for (const [k, x, z] of spots) this.list.push(new Animal(k, scene, x, z));
  }

  update(dt, player){
    for (const a of this.list){
      a.hitCool -= dt;
      const sp = a.sp;
      if (a.held){ this.animate(a, dt, 0, true); continue; }
      if (a.pulled){
        const h = a.pulled;
        a.pullT += dt;
        // move the body centre toward the hand
        v1.copy(h.pos).sub(v2.set(0, sp.center, 0));
        a.pos.lerp(v1, Math.min(1, dt * 6));
        if (this.center(a).distanceTo(h.pos) < 0.2 || a.pullT > 1.5){ this.grab(a, h); h.heldCreature = a; h.pullingCreature = null; }
        this.animate(a, dt, 0, true);
        continue;
      }
      if (a.air){
        a.vel.y -= (a.kind === 'chicken' && a.vel.y < 0 ? 4 : 9.8) * dt;
        a.pos.addScaledVector(a.vel, dt);
        pushOut(a.pos, sp.radius, a.pos.y, 0.3);
        const g = surfaceHeight(a.pos.x, a.pos.z, a.pos.y + 0.2);
        // tip back upright while flying
        q1.setFromAxisAngle(v1.set(0, 1, 0), a.yaw); a.quat.slerp(q1, Math.min(1, dt * 4));
        if (a.pos.y <= g){ a.pos.y = g; a.air = false; a.vel.set(0, 0, 0); a.state = 'flee'; a.timer = 2 + R() * 2; if (a.kind === 'chicken') sfx.cluck(a.pos); }
        this.animate(a, dt, 0, a.kind === 'chicken');
        continue;
      }
      // what's the player doing?
      const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z, dist = Math.hypot(dx, dz);
      if (dist < 1.6 && player.speed > 1.5 && a.state !== 'flee'){ a.state = 'flee'; a.timer = 1.5 + R(); }
      a.timer -= dt;
      let want = 0, wantYaw = a.yaw;
      if (a.state === 'idle' || a.state === 'graze'){
        a.graze = a.state === 'graze' ? Math.min(1, a.graze + dt * 2) : Math.max(0, a.graze - dt * 3);
        if (a.timer <= 0){
          const ang = R() * Math.PI * 2, r = 1.5 + R() * 4;
          a.target.set(a.home.x + Math.cos(ang) * r * 1.4, 0, a.home.z + Math.sin(ang) * r);
          if (a.pos.distanceTo(a.home) > 8) a.target.copy(a.home);
          a.state = 'walk'; a.timer = 8;
        }
      } else if (a.state === 'walk'){
        a.graze = Math.max(0, a.graze - dt * 3);
        v1.subVectors(a.target, a.pos); v1.y = 0;
        if (v1.length() < 0.4 || a.timer <= 0){ a.state = R() < 0.5 ? 'graze' : 'idle'; a.timer = 2 + R() * 5; }
        else { want = sp.speed; wantYaw = Math.atan2(-v1.x, -v1.z); }
      } else if (a.state === 'flee'){
        a.graze = 0;
        want = sp.run; wantYaw = Math.atan2(dx, dz) + Math.sin(a.phase * 0.3) * 0.4;
        if (a.timer <= 0){ a.state = 'idle'; a.timer = 1 + R() * 2; }
      }
      // turn, then walk the way it faces
      const dy = wrap(wantYaw - a.yaw);
      a.yaw = wrap(a.yaw + Math.sign(dy) * Math.min(Math.abs(dy), dt * (want > 1 ? 6 : 2.5)));
      const turnSlow = Math.max(0, 1 - Math.abs(dy) / 1.5);
      a.speedNow += (want * turnSlow - a.speedNow) * Math.min(1, dt * 5);
      a.pos.x += -Math.sin(a.yaw) * a.speedNow * dt;
      a.pos.z += -Math.cos(a.yaw) * a.speedNow * dt;
      // keep out of walls and out of the player's feet
      if (dist < 0.45 + sp.radius){ const k = (0.45 + sp.radius - dist) / Math.max(dist, 0.01); a.pos.x += dx * k; a.pos.z += dz * k; }
      if (pushOut(a.pos, sp.radius, a.pos.y, 0.3) && a.state === 'walk') a.timer = Math.min(a.timer, 0.5);
      const g = surfaceHeight(a.pos.x, a.pos.z, a.pos.y + 0.3);
      a.pos.y += (g - a.pos.y) * Math.min(1, dt * 12);
      q1.setFromAxisAngle(v1.set(0, 1, 0), a.yaw); a.quat.copy(q1);
      a.soundT -= dt;
      if (a.soundT <= 0){ a.soundT = 6 + R() * 14; sfx[sp.sound](v1.copy(a.pos).setY(a.pos.y + sp.center)); }
      this.animate(a, dt, a.speedNow, false);
    }
  }

  animate(a, dt, speed, flapping){
    a.phase += dt * (2 + speed * 7);
    const p = a.parts, sw = Math.min(1, speed * 1.2) * 0.6;
    p.legs.forEach((l, i) => { l.rotation.x = Math.sin(a.phase + (i % 2 === (i < 2 ? 0 : 1) ? 0 : Math.PI)) * sw; });
    if (flapping){ p.legs.forEach((l, i) => { l.rotation.x = Math.sin(a.phase * 3 + i) * 0.5; }); }
    p.head.rotation.x = -a.graze * 0.7 + (a.kind === 'chicken' ? Math.sin(a.phase * 1.5) * 0.15 * Math.min(1, speed + 0.3) : 0);
    if (p.wings){
      a.flap = flapping ? a.flap + dt * 30 : 0;
      const ang = flapping ? 0.3 + Math.abs(Math.sin(a.flap)) * 1.1 : 0.05;
      p.wings[0].rotation.z = -ang; p.wings[1].rotation.z = ang;
    }
    a.group.position.copy(a.pos);
    if (!a.held) a.group.position.y += Math.abs(Math.sin(a.phase)) * 0.02 * Math.min(1, speed);
    a.group.quaternion.copy(a.quat);
    const g = surfaceHeight(a.pos.x, a.pos.z, a.pos.y + 0.3);
    a.shadow.position.set(a.group.position.x, g + 0.02, a.group.position.z);
    a.shadow.scale.setScalar(Math.max(0.3, 1 - (a.group.position.y - g) * 0.5));
  }

  // centre of the animal's body, for hits
  center(a){ return v2.copy(a.group.position).add(v1.set(0, a.sp.center, 0)); }
  raycast(o, d, max){
    let best = null;
    for (const a of this.list){
      if (a.held) continue;
      const c = this.center(a), r = a.sp.radius;
      v1.subVectors(c, o); const tc = v1.dot(d); if (tc < 0) continue;
      const d2 = v1.lengthSq() - tc * tc; if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2);
      if (t < max && (!best || t < best.t)) best = { t, c: a };
    }
    return best;
  }
  hitSphere(p, r){
    for (const a of this.list){ if (a.held) continue; if (this.center(a).distanceTo(p) < a.sp.radius + r) return a; }
    return null;
  }
  hit(a, dir, strength){
    if (a.hitCool > 0 || a.held) return;
    a.hitCool = 0.5;
    const k = a.kind === 'chicken' ? 1.6 : 1;
    a.vel.set(dir.x, 0, dir.z).normalize().multiplyScalar(2.2 * strength * k); a.vel.y = 2.6 * strength * k;
    a.air = true; a.state = 'flee'; a.timer = 3;
    a.yaw = Math.atan2(-dir.x, -dir.z);
    this.particles.burst(this.center(a), a.kind === 'pig' ? 0xf0a3a8 : 0xffffff, a.kind === 'chicken' ? 12 : 8, 1.5, a.kind === 'chicken' ? 0.03 : 0.05, 0.8, a.kind === 'chicken' ? 0.15 : 0.6);
    if (a.kind === 'chicken') sfx.squawk(a.pos); else sfx[a.sp.sound](a.pos);
  }

  // ---- picking up chickens ----
  near(h){
    let best = null, bd = 0.32;
    for (const a of this.list){
      if (!a.sp.grab || a.held || a.pulled) continue;
      const d = this.center(a).distanceTo(h.pos);
      if (d < bd){ bd = d; best = a; }
    }
    return best;
  }
  pointAt(h){
    if (!h.rayQuat) return null;
    const d = v2.set(0, 0, -1).applyQuaternion(h.rayQuat).clone();
    let best = null, bs = 1e9;
    for (const a of this.list){
      if (!a.sp.grab || a.held || a.pulled) continue;
      v1.subVectors(this.center(a), h.rayPos);
      const along = v1.dot(d); if (along < 0.4 || along > 12) continue;
      const perp = v1.addScaledVector(d, -along).length();
      if (perp > 0.2 + along * 0.05) continue;
      if (perp / along < bs){ bs = perp / along; best = a; }
    }
    return best ? { c: best, score: bs } : null;
  }
  grab(a, h){
    a.held = h; a.air = false; a.pulled = null;
    m1.compose(h.pos, h.quat, v1.set(1, 1, 1)).invert();
    a.group.updateMatrix();
    a.offset.multiplyMatrices(m1, a.group.matrix);
    sfx.squawk(a.pos);
  }
  grabAt(h){ const a = this.near(h); if (a) this.grab(a, h); return a; }
  // fly toward a hand that is pulling it, then land in it
  pull(a, h){ a.pulled = h; a.pullT = 0; a.air = false; sfx.squawk(a.pos); }
  stopPull(a){ if (a.pulled){ a.pulled = null; a.air = true; a.vel.set(0, 0, 0); } }
  holdUpdate(a, h){
    m1.compose(h.pos, h.quat, v1.set(1, 1, 1)).multiply(a.offset);
    m1.decompose(a.pos, a.quat, v1);
    a.group.position.copy(a.pos);
  }
  release(a, vel){
    a.held = null; a.air = true;
    a.vel.copy(vel).multiplyScalar(1.1); a.vel.y += 0.5;
    v1.set(0, 0, -1).applyQuaternion(a.quat); a.yaw = Math.atan2(-v1.x, -v1.z);
  }
}

// ---------- villagers ----------
const LINES = {
  Mara: ["Hi! I'm Mara.", 'Grab the sword off the table with your side grip.', 'Swing it fast to slice the melons on the posts!', 'The pistol fires with the trigger. Try the bottles at the range.', 'Let go of a weapon by your hip to holster it.', 'Press B to send everything back to the table.', 'Rest a finger on the right trigger to build. Left trigger breaks.', 'Wave both hands over your head and the dragon comes!'],
  Bo: ["Howdy, I'm Bo. These are my animals.", 'You can pick the chickens up. Gently! Or point at one and squeeze.', 'Throw the ball to knock bottles off the rail.', 'Seen yourself in the mirror? It\'s on the shed.', 'Y switches smooth and snap turning.', 'Stand up tall and press X if your body looks the wrong size.', 'The truck, tank and chopper are in the yard. Touch one and squeeze to get in.', 'Click the left stick to climb out of a vehicle.'],
};
const OUCH = ['Ouch!', 'Hey! Watch it!', "I'm not a melon!", 'Careful with that!'];

class Villager {
  constructor(scene, name, colors, path, scale){
    this.name = name; this.path = path; this.wp = 0;
    this.avatar = new Avatar({ head: true, simpleHands: true, ...colors });
    this.avatar.setScale(1.62 * scale);
    scene.add(this.avatar.root);
    this.scale = scale;
    this.pos = new THREE.Vector3(path[0][0], 0, path[0][1]);
    this.yaw = 0; this.headPitch = 0; this.headYaw = 0;
    this.state = 'walk'; this.timer = 0; this.speed = 0; this.phase = 0;
    this.waveT = 0; this.greeted = false; this.hitCool = 0; this.push = new THREE.Vector3();
    this.lineI = 0; this.lineT = 0; this.text = '';
    // speech bubble
    const { ctx, tex, canvas } = textCanvas(512, 176);
    this.bubbleCtx = ctx; this.bubbleTex = tex; this.bubbleCanvas = canvas;
    this.bubble = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.33), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.bubble.visible = false; this.bubble.renderOrder = 5;
    scene.add(this.bubble);
    this.headQuat = new THREE.Quaternion(); this.eye = new THREE.Vector3();
    if (colors.hat){
      this.avatar.headM.add(multiBox([[0.42, 0.03, 0.42, 0xe0c060, 0, 0.16, 0], [0.26, 0.12, 0.26, 0xd8b450, 0, 0.22, 0], [0.27, 0.03, 0.27, 0x8a3a2a, 0, 0.18, 0]]));
    }
  }
  say(text){
    if (text === this.text) return;
    this.text = text;
    const g = this.bubbleCtx, W = 512, H = 176;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.strokeStyle = '#2b2b2b'; g.lineWidth = 6;
    g.beginPath(); g.roundRect(6, 6, W - 12, H - 40, 26); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(W / 2 - 18, H - 36); g.lineTo(W / 2, H - 8); g.lineTo(W / 2 + 18, H - 36); g.fill();
    g.fillStyle = '#1d1d1d'; g.font = 'bold 34px "Trebuchet MS", Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = wrapText(g, text, W - 60).slice(0, 3);
    lines.forEach((l, i) => g.fillText(l, W / 2, (H - 34) / 2 + (i - (lines.length - 1) / 2) * 38));
    this.bubbleTex.needsUpdate = true;
    sfx.talk(this.eye);
  }
}

export class Villagers {
  constructor(scene){
    this.list = [
      new Villager(scene, 'Mara', { shirt: 0xc8413a, pants: 0x3a3f5c, hair: 0x2a1a10, skin: 0xd59a72 }, [[-2.2, -4.5], [2, -5.8], [0.6, -8.4], [-2.4, -7.2]], 0.98),
      new Villager(scene, 'Bo', { shirt: 0x4f8f3a, pants: 0x6a4a2a, hair: 0x8a5a2a, skin: 0xf0c09a, hat: true }, [[10.5, -3.5], [12, -7.2], [14, -3.6], [8.8, -2.2]], 1.06),
    ];
  }
  update(dt, player, camPos){
    for (const n of this.list){
      n.hitCool -= dt; n.waveT = Math.max(0, n.waveT - dt);
      const dx = player.pos.x - n.pos.x, dz = player.pos.z - n.pos.z, dist = Math.hypot(dx, dz);
      const near = dist < 3.4;
      let want = 0, wantYaw = n.yaw;
      if (near){
        wantYaw = Math.atan2(-dx, -dz);
        if (!n.greeted){ n.greeted = true; n.waveT = 1.8; n.lineI = 0; n.lineT = 0; }
        n.lineT -= dt;
        if (n.lineT <= 0 && n.hitCool < -1.5){ n.say(LINES[n.name][n.lineI % LINES[n.name].length]); n.lineI++; n.lineT = 4.5; }
      } else {
        if (dist > 6){ n.greeted = false; }
        if (n.state === 'wait'){ n.timer -= dt; if (n.timer <= 0) n.state = 'walk'; }
        else {
          const [tx, tz] = n.path[n.wp];
          const ex = tx - n.pos.x, ez = tz - n.pos.z;
          if (Math.hypot(ex, ez) < 0.3){ n.wp = (n.wp + 1) % n.path.length; n.state = 'wait'; n.timer = 1.5 + R() * 2.5; }
          else { want = 1.1; wantYaw = Math.atan2(-ex, -ez); }
        }
      }
      const d = wrap(wantYaw - n.yaw);
      n.yaw = wrap(n.yaw + Math.sign(d) * Math.min(Math.abs(d), dt * 3));
      n.speed += (want * Math.max(0, 1 - Math.abs(d)) - n.speed) * Math.min(1, dt * 4);
      n.pos.x += -Math.sin(n.yaw) * n.speed * dt + n.push.x * dt;
      n.pos.z += -Math.cos(n.yaw) * n.speed * dt + n.push.z * dt;
      n.push.multiplyScalar(Math.exp(-dt * 6));
      if (dist < 0.75){ const k = (0.75 - dist) / Math.max(dist, 0.01); n.pos.x -= dx * k; n.pos.z -= dz * k; }
      pushOut(n.pos, 0.3, n.pos.y);
      n.pos.y = surfaceHeight(n.pos.x, n.pos.z, n.pos.y + 0.5);
      // head: look at the player when near
      const s = n.scale;
      n.phase += dt * n.speed * 5.5;
      n.eye.set(n.pos.x, n.pos.y + 1.62 * s + Math.abs(Math.sin(n.phase)) * 0.025, n.pos.z);
      let hy = 0, hp = 0;
      if (near){
        v1.subVectors(player.head, n.eye);
        hy = wrap(Math.atan2(-v1.x, -v1.z) - n.yaw); hy = Math.max(-1, Math.min(1, hy));
        hp = Math.atan2(v1.y, Math.hypot(v1.x, v1.z));
      }
      n.headYaw += (hy - n.headYaw) * Math.min(1, dt * 5); n.headPitch += (hp - n.headPitch) * Math.min(1, dt * 5);
      n.headQuat.setFromEuler(new THREE.Euler(n.headPitch, n.yaw + n.headYaw, 0, 'YXZ'));
      // arms: swinging as they walk, or waving
      const fwd = v1.set(-Math.sin(n.yaw), 0, -Math.cos(n.yaw)).clone(), right = new THREE.Vector3(-fwd.z, 0, fwd.x), up = new THREE.Vector3(0, 1, 0);
      const grips = [0, 1].map((i) => {
        const side = i === 0 ? -1 : 1;
        const sh = n.eye.clone().addScaledVector(up, -0.27 * s).addScaledVector(right, side * 0.2 * s).addScaledVector(fwd, -0.06 * s);
        if (i === 1 && n.waveT > 0){
          const w = Math.sin(n.waveT * 11) * 0.35;
          const pos = sh.clone().addScaledVector(up, 0.3 * s).addScaledVector(right, 0.28 * s).addScaledVector(fwd, 0.12 * s);
          const X = fwd.clone().negate(), Y = up.clone().negate().applyAxisAngle(fwd, w), Z = new THREE.Vector3().crossVectors(X, Y);
          return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m1.makeBasis(X, Y, Z)) };
        }
        const swing = Math.sin(n.phase + (i ? Math.PI : 0)) * Math.min(1, n.speed) * 0.22;
        const pos = sh.clone().addScaledVector(up, -0.58 * s).addScaledVector(fwd, swing * s + 0.03).addScaledVector(right, side * 0.06 * s);
        const Y = up.clone().addScaledVector(fwd, -swing * 1.2).normalize(), X = right.clone(), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
        return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m1.makeBasis(X, Y, Z)) };
      });
      n.avatar.update(dt, n.eye, n.headQuat, grips, (x, z) => surfaceHeight(x, z, n.pos.y + 0.5), false);
      for (const h of n.avatar.hands) h.setPose(0.15, 0.25, 0.2);
      // bubble above the head, turned toward the camera
      n.bubble.visible = dist < 6 && !!n.text && (near || n.hitCool > -1.5);
      if (n.bubble.visible){
        n.bubble.position.set(n.eye.x, n.eye.y + 0.5, n.eye.z);
        n.bubble.rotation.set(0, Math.atan2(camPos.x - n.eye.x, camPos.z - n.eye.z), 0);
      }
    }
  }
  spheres(n){ return [[n.avatar.pelvis.clone().setY(n.avatar.pelvis.y + 0.25), 0.27], [n.eye, 0.16], [n.avatar.pelvis.clone().setY(n.avatar.pelvis.y - 0.45), 0.2]]; }
  raycast(o, d, max){
    let best = null;
    for (const n of this.list) for (const [c, r] of this.spheres(n)){
      v1.subVectors(c, o); const tc = v1.dot(d); if (tc < 0) continue;
      const d2 = v1.lengthSq() - tc * tc; if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2);
      if (t < max && (!best || t < best.t)) best = { t, n };
    }
    return best;
  }
  hitSphere(p, r){
    for (const n of this.list) for (const [c, rr] of this.spheres(n)) if (c.distanceTo(p) < r + rr) return n;
    return null;
  }
  hit(n, dir){
    if (n.hitCool > 0) return;
    n.hitCool = 0.6;
    n.push.set(dir.x, 0, dir.z).normalize().multiplyScalar(2.2);
    n.text = ''; n.say(OUCH[Math.floor(R() * OUCH.length)]);
    n.lineT = 2.5;
    sfx.ouch(n.eye);
  }
}
