// Riding and jumping, and the show-jumping competitions.
//
// You ride in gears: halt, walk, trot, canter, gallop (push forward / pull back to change), and steer.
// Jumps: ride straight at the middle of a fence, at a canter, and press Jump as you come in (the horse
// picks its own take-off spot from there). Too slow, crooked or late and the horse may knock a rail or
// refuse. How high a horse can jump comes from its breed, its training (which grows as you jump), and
// how fresh and happy it is.
//
// Shows: every third day at the show grounds. Enter a class (70 cm, 90 cm, 1.10 m), ride through the
// timing posts, jump 1 to 8 in order and back through the posts. 4 faults for a rail down or a refusal,
// 1 for each second over the time allowed; three refusals and you're out. Seven other riders compete.
import * as THREE from 'three';
import { V, clamp, lerp, damp, angleDiff, fmtMoney } from './util.js';
import { BREEDS } from './horse.js';
import { SHOW, SHOW_START, ARENA, pushOut, inBox } from './world.js';
import { isShowDay } from './farm.js';
import { sfx } from './audio.js';

export const GEARS = ['Halt', 'Walk', 'Trot', 'Canter', 'Gallop'];
const GEAR_SPEED = [0, 1.6, 3.6, 6.2, 9.6];
export const CLASSES = [
  { id: 'novice', name: 'Novice 70 cm', height: 0.7, fee: 40, prizes: [400, 220, 120, 60], time: 72 },
  { id: 'inter', name: 'Intermediate 90 cm', height: 0.9, fee: 75, prizes: [900, 500, 250, 120], time: 66 },
  { id: 'adv', name: 'Advanced 1.10 m', height: 1.1, fee: 150, prizes: [2000, 1100, 550, 250], time: 62 },
];
const RIVALS = ['Emma & Starlight', 'Leo & Thunder', 'Mia & Pickle', 'Oliver & Jazz', 'Ava & Rocket', 'Noah & Biscuit', 'Zoe & Midnight', 'Sam & Clover', 'Lily & Duke', 'Max & Bonnie'];

export class Riding {
  constructor(scene, farm, world){
    this.scene = scene; this.farm = farm; this.world = world;
    this.horse = null; this.gear = 0; this.input = { steer: 0, up: false, down: false, jump: false, halt: false };
    this.jumpBuffer = 0; this.flight = null; this.refuseT = 0;
    this.jumps = [...world.jumps.map((j) => ({ ...j, show: false })), ...world.showJumps.map((j) => ({ ...j, show: true }))];
    for (const j of this.jumps){ j.height0 = j.height; j.resetT = 0; }
    this.show = { state: 'idle' };
    this.prevPos = V();
    this.listeners = {};
  }
  on(ev, f){ (this.listeners[ev] = this.listeners[ev] || []).push(f); }
  emit(ev, a){ for (const f of this.listeners[ev] || []) f(a); }
  say(t, k){ this.farm.say(t, k); }

  canMount(h){
    if (!h) return 'No horse.';
    if (!h.tacked()) return `${h.data.name} needs a saddle pad, saddle, girth and bridle first.`;
    if (h.mode === 'stall') return `Lead ${h.data.name} out of the stall first.`;
    if (h.data.needs.health < 40) return `${h.data.name} isn't well enough to ride.`;
    return null;
  }
  mount(h){
    const why = this.canMount(h); if (why){ this.say(why, 'hint'); return false; }
    this.horse = h; h.mode = 'ridden'; h.leader = null; h.tie = null; h.data.place = 'ridden';
    this.gear = 0; h.control = { speed: 0, turn: 0, neck: 0 };
    this.prevPos.copy(h.pos);
    h.ignoreCollider = null;
    sfx.snort(h.model.muzzle());
    this.emit('mount', h);
    return true;
  }
  dismount(){
    const h = this.horse; if (!h) return null;
    if (this.flight) return null;
    if (this.show.state === 'riding') this.retire('You dismounted.');
    h.control = null; h.speed = 0;
    this.horse = null;
    this.emit('dismount', h);
    return h;
  }

  // ---------- each frame ----------
  update(dt){
    // knocked rails go back up after a while
    for (const j of this.jumps){
      if (j.poles.some((p) => p.down)){
        j.resetT += dt;
        if (!j.show && j.resetT > 8) this.resetJump(j);
      }
      for (const p of j.poles) if (p.anim != null && p.anim < 1){
        p.anim = Math.min(1, p.anim + dt * 2.2);
        const u = p.anim, m = p.mesh;
        m.position.y = lerp(p.rest.y, 0.06, u * u); m.position.z = p.rest.z + p.side * u * 0.6;
        m.rotation.z = p.restRot.z * (1 - u) + p.fallRot * u;
      }
    }
    const h = this.horse;
    if (!h) return;
    const B = BREEDS[h.data.breed], N = h.data.needs, I = this.input;
    // gears
    if (I.up && this.gear < 4 && !this.flight){ this.gear++; if (this.gear === 4 && N.energy < 25){ this.gear = 3; this.say(`${h.data.name} is too tired to gallop.`, 'hint'); } }
    if (I.down && this.gear > 0) this.gear--;
    if (I.halt) this.gear = 0;
    I.up = I.down = I.halt = false;
    if (N.energy < 12 && this.gear > 2){ this.gear = 2; this.say(`${h.data.name} is tired. Time for a rest.`, 'hint'); }
    this.refuseT -= dt;
    let target = GEAR_SPEED[this.gear] * (this.gear === 4 ? 0.75 + B.speed * 0.35 : 0.9 + B.speed * 0.15) * Math.sqrt(h.model.scale);
    if (this.refuseT > 0) target = 0;
    // steering: quicker when slow
    const maxTurn = [1.2, 1.5, 1.35, 1.15, 0.8][this.gear];
    let turn = (this.flight ? 0 : -I.steer) * maxTurn;
    // speeding up and slowing down like a horse would
    const sp = h.control.speed;
    const acc = target > sp ? 2.4 : 4.5;
    let speed = sp + clamp(target - sp, -acc * dt, acc * dt);
    // jumping
    if (I.jump){ this.jumpBuffer = 0.9; I.jump = false; }
    this.jumpBuffer -= dt;
    if (this.flight){
      const f = this.flight; f.t += dt;
      speed = f.speed;
      if (!f.knocked && f.knock && f.t > f.dur * 0.55){ f.knocked = true; this.knock(f.jump, f.knockPole); }
      if (f.t >= f.dur){ this.land(f); this.flight = null; }
    } else this.approach(h, speed, (s) => { speed = s; });
    // energy and fitness
    const hours = dt / 60;
    N.energy = Math.max(0, N.energy - hours * [0, 1, 4, 9, 16][this.gear]);
    h.data.fitness = clamp(h.data.fitness + hours * [0, 0.002, 0.006, 0.01, 0.012][this.gear], 0, 1);
    if (this.gear > 0) N.happy = Math.min(100, N.happy + hours * 3);
    h.control.speed = speed; h.control.turn = turn;
    h.control.neck = this.gear === 0 ? 0.15 : 0;
    // keep a ridden horse out of fences and walls (done in Horse.update), and away from jump wings
    this.show.state !== 'idle' && this.updateShow(dt, h);
    this.prevPos.copy(h.pos);
  }

  // looking for a fence ahead: take off when the horse gets to its spot, or refuse
  approach(h, speed, setSpeed){
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    for (const j of this.jumps){
      const dx = h.pos.x - j.x, dz = h.pos.z - j.z;
      if (dx * dx + dz * dz > 49) continue;
      const jx = Math.sin(j.yaw), jz = Math.cos(j.yaw);
      const along = dx * jx + dz * jz, across = dx * jz - dz * jx;
      const align = fx * jx + fz * jz;           // +1 going the jump's way, -1 the other way
      const dir = align >= 0 ? 1 : -1;
      const front = -along * dir - j.spread / 2 - 0.05;   // distance to the first rail
      const height = this.heightOf(j);
      const inLine = Math.abs(across) < j.width / 2 - 0.15;
      // walking into the fence: stop
      if (Math.abs(across) < j.width / 2 + 0.25 && Math.abs(along) < j.spread / 2 + 0.75 && speed > 0.05){
        if (front < 0.35 && front > -0.6 && Math.abs(align) > 0.3){
          if (this.jumpBuffer > 0 || speed > 2.5) { /* handled below */ } else { setSpeed(0); h.pos.x -= fx * 0.05; h.pos.z -= fz * 0.05; return; }
        }
      }
      if (!inLine || Math.abs(align) < 0.7 || front < -0.2 || front > 6) continue;
      const allPolesDown = j.poles.every((p) => p.down);
      if (allPolesDown) continue;
      const gear = this.gear, takeoff = 1.0 + height * 0.55 + (speed > 5 ? 0.3 : 0);
      if (this.jumpBuffer > 0 && front <= takeoff && front > 0.25){ this.takeoff(h, j, dir, front, takeoff, speed, align, true); return; }
      if (front <= 0.6 && front > -0.2){
        // no "Jump": a willing, trained horse may jump anyway, otherwise it stops
        const N = h.data.needs;
        const willing = (N.happy / 100) * 0.4 + h.data.skill * 0.6 + (gear >= 3 ? 0.15 : 0) - Math.max(0, height - 0.6);
        if (speed > 2.5 && Math.random() < willing * 0.7){ this.takeoff(h, j, dir, front, takeoff, speed, align, false); return; }
        this.refuse(h, j);
        setSpeed(0);
        return;
      }
    }
  }
  heightOf(j){ return j.show ? j.height0 * j.mesh.scale.y : j.height; }
  takeoff(h, j, dir, front, ideal, speed, align, asked){
    const B = BREEDS[h.data.breed], N = h.data.needs;
    const height = this.heightOf(j);
    const ability = B.jump * 0.55 + h.data.skill * 0.45;
    let clear = (0.55 + ability * 0.95) * Math.sqrt(h.model.scale);
    clear *= N.energy < 30 ? 0.82 : 1; clear *= N.happy < 40 ? 0.9 : 1; clear *= h.data.fitness * 0.15 + 0.88;
    clear *= [0.55, 0.6, 0.85, 1.0, 0.92][this.gear];
    clear *= 1 - Math.min(0.25, Math.abs(front - ideal) * 0.15);
    clear *= 0.85 + 0.15 * clamp((Math.abs(align) - 0.7) / 0.3);
    if (!asked) clear *= 0.92;
    if (j.spread > 0.5) clear *= 0.96;
    const margin = clear - height;
    const pKnock = margin >= 0.1 ? 0 : clamp((0.1 - margin) / 0.35);
    const knock = Math.random() < pKnock;
    const dist = j.spread + 2.4 + height * 1.4 + front;
    const sp = Math.max(speed, 3.6);
    const dur = clamp(dist / sp, 0.55, 1.15);
    this.flight = { jump: j, dir, t: 0, dur, speed: sp, knock, knockPole: knock ? j.poles[Math.floor(Math.random() * j.poles.length)] : null, height };
    h.model.jump(height + 0.22, dur);
    sfx.snort(h.model.muzzle());
    this.jumpBuffer = 0;
    this.emit('takeoff', { horse: h, jump: j });
  }
  land(f){
    const h = this.horse, j = f.jump;
    const rail = f.knock;
    // training: every jump teaches a little (more for bigger fences, up to the breed's limit)
    h.data.skill = clamp(h.data.skill + 0.006 * (0.5 + f.height) * (rail ? 0.5 : 1), 0, 1);
    h.data.needs.energy = Math.max(0, h.data.needs.energy - 1.5);
    sfx.hoof(h.pos, 'sand', 'canter');
    this.emit('land', { horse: h, jump: j, rail, dir: f.dir });
    if (!this.show || this.show.state !== 'riding') this.say(rail ? 'Rail down!' : ['Clear!', 'Lovely jump!', 'Over!', 'Great jump!'][Math.floor(Math.random() * 4)], rail ? 'hint' : 'good');
    if (this.show.state === 'riding') this.showJumped(j, rail, f.dir);
  }
  knock(j, pole){
    if (!pole || pole.down) pole = j.poles.find((p) => !p.down);
    if (!pole) return;
    pole.down = true; pole.anim = 0; pole.side = Math.random() < 0.5 ? -1 : 1; pole.fallRot = pole.restRot.z * 0.2 + (Math.random() - 0.5) * 0.2;
    j.resetT = 0;
    sfx.pole(j.mesh.getWorldPosition(V()));
  }
  resetJump(j){
    for (const p of j.poles){ p.down = false; p.anim = null; p.mesh.position.copy(p.rest); p.mesh.rotation.copy(p.restRot); }
    j.resetT = 0;
  }
  refuse(h, j){
    if (this.refuseT > 0) return;
    this.refuseT = 1.2; this.gear = 1; this.jumpBuffer = 0;
    h.model.anim.pitch = 0.08;
    h.pos.x -= Math.sin(h.yaw) * 0.3; h.pos.z -= Math.cos(h.yaw) * 0.3;
    sfx.snort(h.model.muzzle());
    this.emit('refuse', { horse: h, jump: j });
    if (this.show.state === 'riding' && j.show && j.num === this.show.next + 1) this.showRefusal();
    else this.say(`${h.data.name} stopped! Come in straight at a canter and press Jump as you get close.`, 'hint');
  }

  // ---------- shows ----------
  showOpen(){
    const S = this.farm.state;
    if (!isShowDay(S.day)) return 'The next show is on day ' + (S.day + (3 - (S.day % 3)) % 3 || S.day + 3) + '.';
    if (S.minutes < 9 * 60) return 'The show starts at 9am.';
    if (S.minutes > 17 * 60) return 'The show finished at 5pm. The next one is in three days.';
    return null;
  }
  enter(cls){
    const S = this.farm.state, h = this.horse;
    const why = this.showOpen(); if (why){ this.say(why, 'hint'); return false; }
    if (!h){ this.say('You need to be riding your horse to enter.', 'hint'); return false; }
    if (h.data.owner){ this.say(`${h.data.name} belongs to ${h.data.owner.who}. Only your own horses can compete.`, 'hint'); return false; }
    if (!inBox(h.pos, { x0: SHOW.x0 - 15, x1: SHOW.x1 + 5, z0: SHOW.z0 - 12, z1: SHOW.z1 + 5 })){ this.say('Ride to the show grounds (down the lane, past the drive) to enter.', 'hint'); return false; }
    const done = S.shows[S.day] || [];
    if (done.includes(cls.id)){ this.say('You\'ve already ridden in that class today.', 'hint'); return false; }
    if (S.money < cls.fee){ this.say(`The entry fee is ${fmtMoney(cls.fee)}.`, 'hint'); return false; }
    S.money -= cls.fee;
    for (const j of this.jumps) if (j.show){ j.mesh.scale.y = cls.height / j.height0; this.resetJump(j); }
    this.show = { state: 'entered', cls, next: 0, faults: 0, refusals: 0, rails: 0, time: 0, horse: h };
    sfx.bell();
    this.say(`Entered ${cls.name}. Ride through the red timing posts to start, then jumps 1 to 8 in order and back through the posts. Time allowed: ${cls.time}s.`, 'info');
    this.emit('show', this.show);
    return true;
  }
  crossedStart(h){
    const a = SHOW_START.a, b = SHOW_START.b, p0 = this.prevPos, p1 = h.pos;
    // segments p0-p1 and a-b intersect?
    const d = (p1.x - p0.x) * (b.z - a.z) - (p1.z - p0.z) * (b.x - a.x);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((a.x - p0.x) * (b.z - a.z) - (a.z - p0.z) * (b.x - a.x)) / d;
    const u = ((a.x - p0.x) * (p1.z - p0.z) - (a.z - p0.z) * (p1.x - p0.x)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  updateShow(dt, h){
    const s = this.show;
    if (s.state === 'entered'){
      if (this.crossedStart(h)){ s.state = 'riding'; s.time = 0; sfx.bell(); this.say('Go! Jump 1 is the red and white fence.', 'info'); this.emit('show', s); }
      return;
    }
    if (s.state === 'riding'){
      s.time += dt;
      if (s.next >= 8 && this.crossedStart(h)) return this.finish();
      if (!inBox(h.pos, { x0: SHOW.x0 - 6, x1: SHOW.x1 + 1, z0: SHOW.z0 - 2, z1: SHOW.z1 + 1 })) return this.retire('You left the arena: eliminated.');
      if (s.time > s.cls.time * 2) return this.retire('Time limit exceeded: eliminated.');
    }
  }
  showJumped(j, rail, dir){
    const s = this.show;
    if (!j.show) return;
    if (j.num !== s.next + 1 || dir < 0){ this.say(`That was the wrong fence! Next is number ${s.next + 1}.`, 'hint'); if (rail) s.faults += 0; return; }
    s.next++;
    if (rail){ s.faults += 4; s.rails++; this.say(`Rail down at ${j.num}: 4 faults.`, 'bad'); }
    else this.say(s.next < 8 ? `Clear over ${j.num}. Next: ${s.next + 1}.` : 'All 8 jumped! Back through the timing posts to finish.', 'good');
    this.emit('show', s);
  }
  showRefusal(){
    const s = this.show;
    s.refusals++; s.faults += 4;
    if (s.refusals >= 3) return this.retire('Third refusal: eliminated. Better luck next time!');
    this.say(`Refusal at ${s.next + 1}: 4 faults. Circle round and try again.`, 'bad');
    this.emit('show', s);
  }
  retire(why){
    const s = this.show, S = this.farm.state;
    S.shows[S.day] = [...(S.shows[S.day] || []), s.cls.id];
    sfx.buzzer();
    this.say(why, 'bad');
    this.show = { state: 'idle' };
    this.emit('results', { eliminated: true, why, cls: s.cls });
    this.emit('show', this.show);
  }
  finish(){
    const s = this.show, S = this.farm.state, cls = s.cls, h = s.horse;
    const over = Math.max(0, s.time - cls.time), timeFaults = Math.ceil(over);
    const faults = s.faults + timeFaults;
    // the other riders
    const R = Math.random;
    const diff = { novice: 0.55, inter: 0.42, adv: 0.3 }[cls.id];
    const rivals = RIVALS.slice().sort(() => R() - 0.5).slice(0, 7).map((name) => {
      const clear = R() < diff, f = clear ? 0 : 4 * (1 + Math.floor(R() * R() * 3));
      const t = cls.time * (0.82 + R() * 0.24);
      return { name, faults: f + Math.max(0, Math.ceil(t - cls.time)), time: t };
    });
    const me = { name: `You & ${h.data.name}`, faults, time: s.time, me: true };
    const all = [...rivals, me].sort((a, b) => a.faults - b.faults || a.time - b.time);
    const place = all.indexOf(me) + 1;
    const prize = cls.prizes[place - 1] || 0;
    S.money += prize; S.earned += prize;
    S.shows[S.day] = [...(S.shows[S.day] || []), cls.id];
    if (place <= 4) S.ribbons.push({ place, cls: cls.id, day: S.day, horse: h.data.name });
    this.farm.refreshRibbons();
    h.data.skill = clamp(h.data.skill + 0.03, 0, 1);
    h.data.needs.happy = Math.min(100, h.data.needs.happy + 10);
    this.world.cheer = place <= 3 ? 4 : 1.5;
    sfx.cheer(h.pos, place <= 3 ? 1.5 : 0.6);
    if (prize) sfx.coin();
    this.show = { state: 'idle' };
    for (const j of this.jumps) if (j.show) this.resetJump(j);
    this.farm.save();
    const res = { cls, place, prize, faults, time: s.time, timeFaults, rails: s.rails, refusals: s.refusals, table: all };
    this.say(place === 1 ? `You WON the ${cls.name}! ${fmtMoney(prize)}` : place <= 4 ? `${['', '1st', '2nd', '3rd', '4th'][place]} place! ${fmtMoney(prize)} and a rosette.` : `${place}th place. Keep training!`, place <= 4 ? 'money' : 'info');
    this.emit('results', res);
    this.emit('show', this.show);
  }
}
