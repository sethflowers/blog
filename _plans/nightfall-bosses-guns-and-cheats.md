# Implementation plan: Nightfall — bosses, an arsenal, and a cheats menu

Henry's Nightfall (`_experiments/nightfall-zombie-fps.html`) is a working first-person zombie
wave shooter. This plan adds, in order:

1. A **weapon system** with seven guns you switch between (the current rifle becomes one of them).
2. **Huge bosses** every fifth wave, with a boss health bar, ground-shaking footsteps and rewards.
3. A **pause / cheats menu** with toggles such as infinite ammo, bottomless clip, god mode,
   one-shot kills, slow motion, rapid fire and more.
4. **Silly zombie heads**: big-head mode, banana heads, hamburger heads, pumpkin heads, and so
   on, plus confetti blood, helium voices, party mode and ragdoll launches.

This plan is written to be followed step by step. Do the steps in order. Each step ends with a
check. Do not skip the checks. Do not add features that are not in this plan until every required
step is done; the "Stretch goals" section at the end lists what to add if time remains.

Line numbers below refer to the file **as it is before you start**. They drift as you insert
code, so always confirm with `grep -n` before editing. The section banners in the file
(`/* ==== RENDERER / SCENE ==== */`, `/* ==== ZOMBIES ==== */`, and so on) are stable anchors.

---

## 0. Ground rules

- **Read the whole game file first.** It is one 1790-line HTML file with all CSS, HTML and
  JavaScript inside. Everything below assumes you know its layout:

  | Lines | What is there |
  |---|---|
  | 1–6 | Jekyll front matter. Leave it alone. |
  | 7–178 | `<head>` with all CSS, then the HTML: canvas, overlays, HUD, touch buttons, start/over screens. |
  | 180–470 | Procedural canvas textures (`asphalt`, `skin`, `face`, `cloth`, …). Leave alone. |
  | 472–553 | Renderer, scene, lights (`moon`, `flashlight`, `muzzleLight`), materials. |
  | 555–684 | World: `colliders`, `shootables`, `ARENA`, buildings, cars, lamps, barriers. |
  | 686–716 | `gun` viewmodel (`buildGun`) and the muzzle `flash`. **Section 2 replaces this.** |
  | 718–763 | Particles (`burst`) and blood pool decals (`bloodPool`). |
  | 765–911 | `GEO`, `limbPivot`, `makeZombie`, `killZombie`. **Sections 3 and 5 change these.** |
  | 913–927 | `state` and `player`. |
  | 930–1116 | Synthesised audio: `initAudio`, the `sfx` table, `wakeAudio`, `unlockMobileAudio`. |
  | 1118–1161 | `ui` element refs and `updateAmmo` / `updateHealth` / `updateRemaining`. |
  | 1163–1261 | Input: virtual stick, touch handlers, keyboard, pointer lock, `toggleTorch`. |
  | 1263–1337 | `shoot`, `hitMark`, `doReload`. **Section 2 rewrites `shoot`.** |
  | 1339–1361 | `resolve` (AABB collision). |
  | 1363–1393 | `startWave`, `spawnOne`. |
  | 1395–1422 | `hurtPlayer`, `gameOver`. |
  | 1424–1453 | Film grain, `resize`. |
  | 1455–1717 | `animate` and the big `update(dt)`. |
  | 1719–1790 | `resetGame`, `beginPlay`, button wiring, boot, service worker registration. |

- **Keep it one file.** All new code goes into `_experiments/nightfall-zombie-fps.html`. The only
  other file you touch is `experiments/nightfall-zombie-fps/sw.js` (one line, section 9).
- **Three.js r128** (`experiments/nightfall-zombie-fps/three.min.js`). Do not upgrade it. There is
  no `CapsuleGeometry`. `TorusGeometry(radius, tube, radialSegments, tubularSegments, arc)`,
  `ConeGeometry`, `CylinderGeometry`, `SphereGeometry`, `BoxGeometry`, `PlaneGeometry`,
  `CircleGeometry`, `LatheGeometry`, `CanvasTexture`, `PointLight`, `Group` all exist.
- **Colour gotcha.** The renderer uses `sRGBEncoding`. Textured materials look right. An
  **untextured** `MeshStandardMaterial({color:0x...})` must call
  `mat.color.convertSRGBToLinear()` or dark colours come out pale grey (see the comment at
  line 819). Every new untextured material in this plan needs that call. For textures made from a
  canvas, use the existing helper `tex(canvas, repeat, true)` (the `true` marks it sRGB).
- **Plain ES5-style JavaScript** inside the existing `(function(){ "use strict"; ... })();`.
  `var`, function declarations, no modules, no build step. Match the file's style.
- **Mobile is first class.** Every new control needs a touch button, not only a key. Any new
  overlay must work with a finger (see the touch gotcha in section 4.3).
- **Performance budget.** The game runs on phones. Do not add per-zombie lights, per-zombie
  textures, or per-frame allocations in loops. Share geometries and materials; clone a material
  only when a zombie needs its own opacity fade (explained in 5.2).
- **Syntax check after every step.** This extracts the inline script and parses it:

  ```sh
  awk '/<script>/{f=1;next}/<\/script>/{f=0}f' _experiments/nightfall-zombie-fps.html > /tmp/game.js && node --check /tmp/game.js && echo OK
  ```

  (Use your scratchpad directory instead of `/tmp` if you have one.)
- **Run the headless smoke test** (section 10) at every **COMMIT** point. It takes 20 seconds.
- Commit after each milestone (marked **COMMIT** below). Push at the end with
  `git push -u origin claude/nightfall-game-mod-plan-rosyl7`. Do not open a pull request.
- Never put a model name or model identifier in any file, commit message, or comment.

---

## 1. State and shared helpers (do this first; everything else depends on it)

### 1.0 Cheats stub

Sections 2 and 3 read flags from a `cheats` object that section 4 fills in properly. So that the
game runs between now and then, add this one line directly after the `player` object (line ~926):

```js
var cheats={};   // replaced by the real cheats system in section 4
```

Every `cheats.xxx` read in sections 2 and 3 is then simply `undefined` (falsy), which is the
"off" behaviour. Section 4.1 tells you to replace this line.

### 1.1 Extend `state` (line ~915)

Add these fields to the `state` object literal. Keep the existing ones.

```js
paused:false,            // cheats menu open
shake:0,                 // camera shake amount, decays each frame
wi:0,                    // index into weapons[] of the equipped gun
switchT:0,               // >0 while lowering/raising the gun during a swap
fireLatch:false,         // semi-auto: true once a shot fired until trigger released
unlocked:{},             // weapon key -> true
toastT:0
```

`mag`, `magSize`, `reserve`, `reloadT` stay in `state` but from section 2 on they always mirror
the equipped weapon (`cur()` below writes them back). This keeps `updateAmmo` and the reload
code changes small.

### 1.2 Camera shake helper

Add after the `player` object:

```js
function shake(amount){ state.shake=Math.min(1.5, state.shake+amount); }
```

In `update(dt)`, directly **after** the line `camera.position.set(player.pos.x + bobX*0.4, ...)`
(line ~1511), add:

```js
if(state.shake>0.001){
  camera.position.x += (Math.random()-0.5)*state.shake*0.22;
  camera.position.y += (Math.random()-0.5)*state.shake*0.16;
  camera.rotation.z  = (Math.random()-0.5)*state.shake*0.05;
  state.shake *= Math.pow(0.03, dt);
} else { state.shake=0; camera.rotation.z=0; }
```

Note `camera.rotation.order='YXZ'` is already set at the top of `update`, so setting `rotation.z`
here is safe.

### 1.3 Toast (one-line HUD message)

HTML, inside `#hud` after `#kills`:

```html
<div class="stat" id="toast"></div>
```

CSS:

```css
#toast{top:calc(env(safe-area-inset-top) + 74px);left:50%;transform:translateX(-50%);
  font-size:12px;letter-spacing:.28em;color:var(--bone);opacity:0;transition:opacity .25s;
  white-space:nowrap;text-shadow:0 0 6px #000;}
```

JS (add `toast:document.getElementById('toast')` to `ui`, then):

```js
function toast(msg, secs){
  ui.toast.textContent=msg; ui.toast.style.opacity=1; state.toastT=secs||2.2;
}
```

In `update`, anywhere near the `hitTimer` line: `if(state.toastT>0){ state.toastT-=dt; if(state.toastT<=0) ui.toast.style.opacity=0; }`

### 1.4 Explosion (used by the grenade launcher, explosive rounds and the Colossus slam)

Add after `bloodPool` (line ~763). It damages every living zombie in a radius with linear
falloff, optionally hurts the player, and does the effects.

```js
var boomLight=new THREE.PointLight(0xffa860, 0, 18, 2); scene.add(boomLight);
function explode(pos, radius, dmg, hurtsPlayer){
  burst(pos, null, 16, 'spark'); burst(pos, null, 10, 'dust');
  boomLight.position.copy(pos); boomLight.position.y+=0.4; boomLight.intensity=9;
  var d=pos.distanceTo(player.pos);
  shake(Math.max(0, 1.0-d/16));
  sfx.boom(d);
  for(var i=0;i<zombies.length;i++){
    var z=zombies[i]; if(z.dead) continue;
    var zd=Math.hypot(z.group.position.x-pos.x, z.group.position.z-pos.z);
    if(zd<radius){
      var f=1-zd/radius;
      damageZombie(z, dmg*(0.35+0.65*f), false, z.group.position.clone().setY(1.0), null);
    }
  }
  if(hurtsPlayer && d<radius*0.8 && !cheats.god) hurtPlayer(Math.round(28*(1-d/(radius*0.8))));
}
```

In `update`, near the `muzzleLight.intensity` decay line, add:
`boomLight.intensity += (0 - boomLight.intensity) * Math.min(1, dt*10);`

`damageZombie` is defined in section 2.5 and `sfx.boom` in 2.7. Until those exist the syntax
check passes but the game would throw at runtime if something exploded, which is fine: do
sections 1 and 2 together before running the smoke test.

**Check:** syntax check passes.

---

## 2. Weapon system

### 2.1 Weapon table

Add a new section banner `/* ==== WEAPONS ==== */` right before the `VIEWMODEL` banner (line ~686)
and put the table there. Every gun is data plus a small viewmodel builder.

| key | name (HUD) | auto | mag | reserve | fireCd | body dmg | head dmg | pellets | spread/shot | max spread | cone | reload s | recoil | falloff start m | unlock wave | sound |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `pistol` | SIDEARM | no | 12 | ∞ (see below) | 0.16 | 38 | 120 | 1 | 0.006 | 0.03 | 0 | 1.2 | 0.9 | 22 | 1 | `pistol` |
| `rifle` | CARBINE | yes | 30 | 150 | 0.105 | 34 | 105 | 1 | 0.011 | 0.055 | 0 | 1.9 | 1.2 | — | 1 | `rifle` |
| `shotgun` | PUMP | no | 6 | 36 | 0.75 | 16/pellet | 40/pellet | 9 | 0 | 0 | 0.045 | 2.6 | 3.0 | 12 | 2 | `shotgun` |
| `smg` | SMG | yes | 40 | 200 | 0.058 | 20 | 58 | 1 | 0.009 | 0.08 | 0 | 1.6 | 0.6 | 18 | 3 | `smg` |
| `sniper` | BOLT | no | 5 | 30 | 1.1 | 240 | 700 | 1 | 0 | 0 | 0 | 2.4 | 4.5 | — | 4 | `sniper` |
| `lmg` | BELT-FED | yes | 100 | 300 | 0.075 | 30 | 90 | 1 | 0.014 | 0.11 | 0 | 4.2 | 1.5 | — | 6 | `lmg` |
| `launcher` | THUMPER | no | 1 | 12 | 0.9 | (explosion 260, radius 3.6) | — | 0 | 0 | 0 | 0 | 1.8 | 3.0 | — | 8 | `thump` |

Extra per-weapon fields:

- `pierce`: number of zombies one shot can pass through. `sniper: 4`, everything else `1`.
- `projectile: true` on `launcher` only. Its shot spawns a grenade (2.6) instead of a raycast.
- `muzzleZ`: where the flash sits on the viewmodel (`pistol -0.42`, `rifle -0.92`,
  `shotgun -0.98`, `smg -0.62`, `sniper -1.12`, `lmg -1.0`, `launcher -0.7`).
- `flashScale`: `shotgun 1.8`, `sniper 1.5`, `lmg 1.2`, `launcher 1.4`, others `1`.
- `infiniteReserve: true` on the pistol, so the player can never be left with nothing.
- `build`: function returning a `THREE.Group` viewmodel (2.3).

Encode as an array **in this order** (it is the switch order and the number-key order):

```js
var WEAPONS=[
  {key:'pistol',  name:'SIDEARM',  auto:false, mag:12,  reserve:Infinity, infiniteReserve:true, fireCd:0.16,  dmg:38,  headDmg:120, pellets:1, spreadAdd:0.006, maxSpread:0.03, cone:0,     reload:1.2, recoil:0.9, falloff:22, unlock:1, sound:'pistol',  pierce:1, muzzleZ:-0.42, flashScale:1,   build:buildPistol},
  {key:'rifle',   name:'CARBINE',  auto:true,  mag:30,  reserve:150, fireCd:0.105, dmg:34,  headDmg:105, pellets:1, spreadAdd:0.011, maxSpread:0.055, cone:0,    reload:1.9, recoil:1.2, falloff:0,  unlock:1, sound:'rifle',   pierce:1, muzzleZ:-0.92, flashScale:1,   build:buildRifle},
  /* ...shotgun, smg, sniper, lmg, launcher in the same shape... */
];
```

`falloff:0` means no falloff. Damage beyond `falloff` metres is multiplied by
`Math.max(0.3, 1-(dist-falloff)/18)`.

### 2.2 Per-weapon ammo state

```js
var weapons=[];   // {def, mag, reserve}
function cur(){ return weapons[state.wi]; }
function syncAmmoState(){   // copy equipped weapon into state so old code keeps working
  var w=cur(); state.mag=w.mag; state.magSize=w.def.mag; state.reserve=w.reserve;
}
function initWeapons(){
  weapons.length=0;
  WEAPONS.forEach(function(d){ weapons.push({def:d, mag:d.mag, reserve:d.reserve}); });
  state.unlocked={pistol:true, rifle:true};
  if(cheats.allGuns) WEAPONS.forEach(function(d){ state.unlocked[d.key]=true; });
  state.wi=1; // start on the carbine
  equip(1, true);
}
```

Every place that writes `state.mag` or `state.reserve` must write to `cur()` **instead**, then
call `syncAmmoState()`. Those places are: `shoot` (mag--), the reload completion block in
`update` (line ~1550), the wave-clear ammo bonus (`state.reserve+=60`, line ~1602), and
`resetGame` (line ~1732). Search for `state.mag` and `state.reserve` and fix every hit. Read
sites (`updateAmmo`, `doReload`, `if(state.mag===0) doReload()`) can keep reading from `state`.

### 2.3 Viewmodels

Rename the existing `buildGun` IIFE into `function buildRifle(){ var g=new THREE.Group(); ... return g; }`
(replace `gun.add(...)` inside it with `g.add(...)`). `gun` stays as an **empty holder group**
attached to the camera; the equipped viewmodel is its single child. All the sway/recoil code in
`update` moves the holder, so it needs no change.

Add the other six builders next to it. Each is boxes and cylinders, built the same way as
`buildRifle`, with the two shared materials `dark` and `poly` hoisted to module level (and a
third, `wood`, `0x3a2416` roughness 0.8, with `convertSRGBToLinear()`). Rough recipes; exact
numbers do not matter, silhouettes do:

- **Pistol**: slide `box(0.06,0.07,0.32, 0,0.02,-0.1)`, frame `box(0.055,0.05,0.2, 0,-0.02,-0.05, poly)`,
  grip `box(0.05,0.15,0.08, 0,-0.12,0.04, poly)` tilted `rotation.x=0.25`, tiny front sight.
- **Shotgun**: long barrel cylinder radius 0.028 length 0.9, a second parallel tube (the magazine
  tube) below it, pump `box(0.07,0.06,0.18, 0,-0.03,-0.55, wood)`, wooden stock `box(0.07,0.12,0.26, 0,-0.05,0.26, wood)`.
- **SMG**: stubby receiver `box(0.09,0.11,0.42)`, short barrel 0.2, long magazine
  `box(0.05,0.28,0.09, 0,-0.18,-0.12, poly)` angled forward, folding wire stock: two thin boxes.
- **Sniper**: long barrel 1.1, a scope: cylinder radius 0.03 length 0.28 on top at `y=0.12`,
  with two small cylinder rings; bolt handle: small cylinder sticking out to the right; wooden stock.
- **LMG**: fat receiver `box(0.13,0.16,0.6)`, barrel with a box heat shield around it, bipod:
  two thin cylinders angled down from the front, ammo box `box(0.14,0.14,0.16, -0.12,-0.1,-0.05, poly)`
  hanging off the left side.
- **Launcher**: short fat tube cylinder radius 0.055 length 0.5, a drum: cylinder radius 0.09
  length 0.12 rotated so its axis points forward, sitting under the tube; stock and grip.

Every builder ends with `g.traverse(function(o){ if(o.isMesh) o.renderOrder=2; })` (the rifle
already does this) and returns `g`.

### 2.4 Equip and switch

```js
function equip(i, instant){
  if(!weapons[i] || !state.unlocked[weapons[i].def.key]) return;
  if(i===state.wi && !instant) return;
  state.wi=i;
  var w=cur();
  while(gun.children.length) gun.remove(gun.children[0]);
  var vm=w.def.build(); gun.add(vm);
  flash.position.z = w.def.muzzleZ; gun.add(flash);      // flash must be re-added; removing children above removed it
  state.reloading=false; state.fireLatch=true;
  state.switchT = instant?0:0.28;
  syncAmmoState(); updateAmmo();
  ui.wpnName.textContent=w.def.name;
}
function cycleWeapon(dir){
  for(var n=1;n<=weapons.length;n++){
    var i=(state.wi+dir*n+weapons.length*n)%weapons.length;
    if(state.unlocked[weapons[i].def.key]){ equip(i); return; }
  }
}
```

The switch animation in `update`, just before the `/* ---- firing ---- */` block:

```js
if(state.switchT>0){
  state.switchT-=dt;
  gun.position.y -= 0.35;                 // dip the holder; the sway lerp brings it back up
  if(state.switchT<0) state.switchT=0;
}
```

Also guard `shoot`: `if(state.switchT>0) return;` at the top, and `doReload` the same.

**Inputs:**

- Keyboard, in the existing `keydown` handler: `Digit1`..`Digit7` → `equip(n-1)`; `KeyQ` → `cycleWeapon(1)`.
- Mouse wheel: `document.addEventListener('wheel', function(e){ if(state.running&&!state.paused) cycleWeapon(e.deltaY>0?1:-1); }, {passive:true});`
- Touch: new button `<div class="btn hidden" id="wpn">WPN</div>`, CSS like `#reload` but
  `right:calc(env(safe-area-inset-right) + 124px); bottom:calc(env(safe-area-inset-bottom) + 92px);`
  width/height 58px. In `onTouchStart`, add `if(el===ui.wpn){ cycleWeapon(1); continue; }`.
  Add `wpn` to `ui`, and to the show/hide lists in `beginPlay` and `gameOver` (they toggle
  `fire`, `reload`, `torch`; add `wpn` and later `menuBtn`).

**HUD:** add `<div id="wpnName">CARBINE</div>` as the first child of `#ammo`, CSS
`font-size:10px;letter-spacing:.3em;color:var(--bone-dim);margin-bottom:6px;`. Add to `ui`.

`updateAmmo` becomes:

```js
function updateAmmo(){
  var w=cur();
  ui.ammoMag.textContent = cheats.clip ? '∞' : state.mag;
  ui.ammoRes.textContent = (cheats.ammo || w.def.infiniteReserve) ? '∞' : state.reserve;
  ui.reloadHint.style.opacity = (state.mag===0 && !state.reloading && !cheats.clip) ? 1 : 0;
}
```

### 2.5 Rewrite `shoot()` around `damageZombie()`

Split the damage part of the current `shoot` into a reusable function:

```js
function findZombie(obj){          // walk up to the zombie whose group contains this mesh
  var node=obj;
  while(node){
    for(var k=0;k<zombies.length;k++) if(zombies[k].group===node) return zombies[k];
    node=node.parent;
  }
  return null;
}
function damageZombie(z, dmg, head, point, normal){
  if(!z || z.dead) return;
  if(cheats.oneShot) dmg=1e9;
  z.hp-=dmg; z.hitFlash=0.09;
  burst(point, normal, head?9:5, 'blood');
  hitMark(head); sfx.hit(head);
  if(z.hp>0 && Math.random()<0.6) sfx.zgrunt();
  if(!z.boss){   // bosses do not stagger
    var kb=new THREE.Vector3().subVectors(z.group.position, player.pos).setY(0).normalize().multiplyScalar(head?0.22:0.11);
    z.group.position.add(kb);
  }
  if(z.hp<=0) killZombie(z);
}
```

New `shoot()`:

```js
function shoot(){
  var w=cur(), d=w.def;
  if(state.reloading || state.switchT>0) return;
  if(state.mag<=0 && !cheats.clip){ sfx.dry(); return; }
  if(!cheats.clip){ w.mag--; syncAmmoState(); }
  updateAmmo();
  sfx.shot(d.sound);

  state.recoilVel += d.recoil*(1 + state.spread*3);
  state.spread = Math.min(d.maxSpread, state.spread + d.spreadAdd);
  gun.position.z = -0.42 + 0.06*Math.min(2, d.recoil);
  flashMat.opacity=1; flash.rotation.z=Math.random()*6.28;
  flash.scale.setScalar(rand(0.8,1.35)*d.flashScale);
  muzzleLight.intensity=5.5*d.flashScale;

  if(d.projectile){ fireGrenade(); return; }

  for(var p=0;p<d.pellets;p++){
    var sp = d.cone>0 ? d.cone : state.spread;
    ndc.set(rand(-sp,sp), rand(-sp,sp));
    raycaster.setFromCamera(ndc, camera);
    var targets=[];
    for(var i=0;i<zombies.length;i++) if(!zombies[i].dead) targets.push(zombies[i].group);
    var zHits=raycaster.intersectObjects(targets, true);
    var wHits=raycaster.intersectObjects(shootables, false);
    var wd = wHits.length? wHits[0].distance : Infinity;

    var hitCount=0, seen=[];
    for(var h=0; h<zHits.length && hitCount<d.pierce; h++){
      var hit=zHits[h];
      if(hit.distance>wd) break;
      var z=findZombie(hit.object);
      if(!z || z.dead || seen.indexOf(z)>=0) continue;
      seen.push(z); hitCount++;
      var head = hit.object.userData.part==='head';
      var dmg = head? d.headDmg : d.dmg;
      if(d.falloff>0 && hit.distance>d.falloff) dmg*=Math.max(0.3, 1-(hit.distance-d.falloff)/18);
      damageZombie(z, dmg, head, hit.point, hit.face?hit.face.normal:null);
      if(cheats.boomRounds) explode(hit.point, 2.4, dmg*0.6, false);
    }
    if(hitCount===0 && wHits.length){
      var wh=wHits[0];
      burst(wh.point, wh.face?wh.face.normal:null, 4, 'dust');
      if(Math.random()<0.35) burst(wh.point, wh.face?wh.face.normal:null, 3, 'spark');
      if(p===0) sfx.impact();
      if(cheats.boomRounds) explode(wh.point, 2.4, 60, true);
    }
  }
}
```

`zHits` is sorted by distance by three.js, so `break` on `hit.distance>wd` is correct.

### 2.6 Grenade projectile (launcher)

```js
var grenades=[];
var grenadeGeo=new THREE.SphereGeometry(0.07,8,6);
var grenadeMat=new THREE.MeshStandardMaterial({color:0x2e3a22, roughness:0.6, metalness:0.3}); grenadeMat.color.convertSRGBToLinear();
function fireGrenade(){
  var m=new THREE.Mesh(grenadeGeo, grenadeMat);
  var dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  m.position.copy(camera.position).addScaledVector(dir, 0.9); m.position.y-=0.15;
  scene.add(m);
  grenades.push({mesh:m, vel:dir.multiplyScalar(24).add(new THREE.Vector3(0,2.5,0)), t:0});
}
function hitsCollider(p){
  for(var i=0;i<colliders.length;i++){ var c=colliders[i];
    if(p.x>c.minX&&p.x<c.maxX&&p.z>c.minZ&&p.z<c.maxZ) return true; }
  return Math.abs(p.x)>ARENA.x+0.3 || Math.abs(p.z)>ARENA.z+0.3;
}
```

In `update`, after the particles block:

```js
for(var gi=grenades.length-1; gi>=0; gi--){
  var G=grenades[gi]; G.t+=dt;
  G.vel.y-=14*dt;
  G.mesh.position.addScaledVector(G.vel, dt);
  var near=false;
  for(var zi=0;zi<zombies.length && !near;zi++){
    var zz=zombies[zi]; if(zz.dead) continue;
    var r=0.7*(zz.scale||1);
    near = Math.hypot(zz.group.position.x-G.mesh.position.x, zz.group.position.z-G.mesh.position.z)<r
           && G.mesh.position.y < 2.0*(zz.scale||1);
  }
  if(near || G.mesh.position.y<0.06 || hitsCollider(G.mesh.position) || G.t>3){
    explode(G.mesh.position.clone(), 3.6, 260, true);
    scene.remove(G.mesh); grenades.splice(gi,1);
  }
}
```

Clear `grenades` in `resetGame` (remove meshes from the scene too).

### 2.7 Weapon sounds

Replace `sfx.shot` in `initAudio` with a version that takes the preset name. Keep the existing
body as the `rifle` case.

```js
sfx.shot=function(kind){
  var p=rand(0.9,1.1);
  switch(kind){
    case 'pistol':
      noise(0.02, 7000, 0.7, 0.5, 'highpass'); noise(0.09, 2800*p, 1.2, 0.4); noise(0.25, 420*p, 1.2, 0.22);
      tone('sine', 190*p, 50, 0.1, 0.4); break;
    case 'shotgun':
      noise(0.03, 5000, 0.7, 0.6, 'highpass'); noise(0.22, 1400*p, 0.8, 0.5); noise(0.6, 220*p, 1.0, 0.45);
      noise(0.8, 700, 0.5, 0.14, 'bandpass'); tone('sine', 110*p, 28, 0.3, 0.7); break;
    case 'smg':
      noise(0.018, 6500, 0.8, 0.4, 'highpass'); noise(0.09, 2600*p, 1.0, 0.3); noise(0.2, 380*p, 1.1, 0.18);
      tone('sine', 170*p, 44, 0.09, 0.35); break;
    case 'sniper':
      noise(0.03, 6000, 0.6, 0.6, 'highpass'); noise(0.25, 1800*p, 0.9, 0.5); noise(0.9, 260*p, 1.0, 0.4);
      noise(1.2, 800, 0.4, 0.16, 'bandpass'); tone('sine', 120*p, 26, 0.35, 0.7); tone('square', 140*p, 40, 0.12, 0.16); break;
    case 'lmg':
      noise(0.025, 6000, 0.7, 0.5, 'highpass'); noise(0.16, 2000*p, 0.9, 0.45); noise(0.45, 300*p, 1.1, 0.34);
      tone('sine', 140*p, 34, 0.2, 0.6); break;
    case 'thump':
      noise(0.05, 900, 1.0, 0.5); noise(0.3, 240*p, 1.0, 0.4); tone('sine', 90*p, 30, 0.35, 0.7); break;
    default: /* rifle: the existing six lines */
  }
};
sfx.boom=function(dist){
  var v=Math.max(0.05, 1-dist/40);
  noise(0.08, 3000, 0.6, 0.5*v, 'highpass'); noise(0.5, 900, 0.7, 0.6*v); noise(1.4, 180, 0.8, 0.6*v);
  tone('sine', 70, 20, 0.9, 0.8*v); noise(1.8, 500, 0.4, 0.2*v, 'bandpass', 0.1);
};
```

Add `'boom'` (and, for section 3, `'roar'`, `'stomp'`, `'bossdie'`, and for section 5 `'unlock'`)
to the no-op list at line ~938 so they are safe before `initAudio` runs.

### 2.8 Unlocks and the wave-clear bonus

In `startWave(n)`, after setting `state.wave`:

```js
WEAPONS.forEach(function(d, i){
  if(d.unlock===n && !state.unlocked[d.key]){
    state.unlocked[d.key]=true;
    toast('NEW WEAPON: '+d.name+'  ·  '+(i+1), 3.5);
    sfx.unlock();
  }
});
```

`sfx.unlock=function(){ ping(660,0.3,0.12); ping(880,0.35,0.12,0.15); ping(1320,0.5,0.1,0.3); };`

Replace the wave-clear `state.reserve+=60; updateAmmo();` (line ~1602) with:

```js
weapons.forEach(function(w){ if(!w.def.infiniteReserve) w.reserve+=Math.round(w.def.reserve*0.4); });
syncAmmoState(); updateAmmo();
```

### 2.9 Semi-auto trigger

In `update`'s firing block:

```js
var d=cur().def;
var canFire = d.auto || cheats.rapid || !state.fireLatch;
if(firing && state.fireCd<=0 && !sprinting && canFire){
  state.fireCd = cheats.rapid ? Math.min(0.05, d.fireCd*0.3) : d.fireCd;
  state.fireLatch=true;
  shoot();
  if(state.mag===0 && !cheats.clip) doReload();
}
if(!firing) state.fireLatch=false;
```

Reload completion (line ~1550) becomes:

```js
var w=cur(), need=w.def.mag-w.mag;
var take = (cheats.ammo || w.def.infiniteReserve) ? need : Math.min(need, w.reserve);
w.mag+=take; if(!(cheats.ammo || w.def.infiniteReserve)) w.reserve-=take;
state.reloading=false; syncAmmoState(); updateAmmo();
```

`doReload` guard becomes
`if(state.reloading || state.switchT>0 || cheats.clip || state.mag===state.magSize || (state.reserve<=0 && !cheats.ammo && !cur().def.infiniteReserve)) return;`
and `state.reloadT=cur().def.reload;`.

`resetGame`: replace `state.mag=30; state.reserve=150;` with `initWeapons();`.

`camera.add(gun)` stays; nothing is added to `gun` at load time any more, `initWeapons()`
does it. Because `resetGame` is only called from `beginPlay`, also call `initWeapons()` once at
boot (right before `buildGrain()`) so the start screen renders a gun. It is cheap.

**Check:** syntax check; smoke test (section 10) shows wave 1 with `CARBINE` in the HUD and no
console errors. Then run the extended smoke steps for weapons: press `1`, confirm HUD says
`SIDEARM`; press `3` at wave 1, confirm HUD still says `SIDEARM` (locked).

**COMMIT**: "Nightfall: weapon system with seven guns"

---

## 3. Bosses

### 3.1 Boss table

Add in the ZOMBIES section, above `makeZombie`:

```js
var BOSSES={
  brute:    {name:'THE BRUTE',    scale:3.4, hp:2600, hpPerWave:350, speed:1.15, runner:false, attack:30, attackCd:1.8, reach:3.2,  fall:1.4, tint:[0.00,0.35,0.30]},
  stalker:  {name:'THE STALKER',  scale:2.2, hp:1800, hpPerWave:300, speed:4.6,  runner:true,  attack:18, attackCd:0.8, reach:2.2,  fall:1.0, tint:[0.75,0.30,0.25], lunge:true},
  colossus: {name:'THE COLOSSUS', scale:5.0, hp:5000, hpPerWave:500, speed:0.8,  runner:false, attack:45, attackCd:2.6, reach:4.6,  fall:2.0, tint:[0.10,0.45,0.22], slam:true}
};
var BOSS_ORDER=['brute','stalker','colossus'];
function bossesForWave(n){
  if(n%5!==0) return [];
  var idx=n/5-1, list=[], count=1+Math.floor(idx/3);
  for(var i=0;i<count;i++) list.push(BOSS_ORDER[(idx+i)%BOSS_ORDER.length]);
  return list;
}
```

`tint` is `[h,s,l]` for the skin colour.

### 3.2 `makeZombie(opts)`

Change the signature from `makeZombie(runner)` to `makeZombie(opts)` with
`opts = {runner:bool, boss:string|null}`. Fix the one caller in `spawnOne`
(`makeZombie({runner:runner})`). Inside:

- `var B = opts.boss ? BOSSES[opts.boss] : null;`
- `var runner = B ? B.runner : !!opts.runner;`
- Skin colour: if `B`, `skinCol.setHSL(B.tint[0],B.tint[1],B.tint[2])`.
- Eyes: if `B`, `emissive 0xff2a10`, `emissiveIntensity 2.2`.
- Scale: replace `g.scale.setScalar(rand(0.92,1.08))` with

  ```js
  var scale = B ? B.scale : rand(0.92,1.08) * (cheats.size==='tiny'?0.45 : cheats.size==='giant'?1.8 : 1);
  g.scale.setScalar(scale);
  ```

- In the `z` object add `boss:B, bossKey:opts.boss||null, scale:scale, stepIdx:0, special:0`, and:
  - `hp`/`maxHp`: `B ? B.hp + B.hpPerWave*state.wave : state.zHP`
  - `speed`: `B ? B.speed : (existing expression)`
- `resolve` radius later uses `Math.min(1.4, 0.36*scale)`.

### 3.3 Spawning

In `startWave(n)`, after computing `toSpawn`:

```js
bossesForWave(n).forEach(function(key, i){ spawnBoss(key, i); });
```

```js
function spawnBoss(key, i){
  var z=makeZombie({boss:key});
  var side = (player.pos.z>0) ? -1 : 1;            // far end from the player
  z.group.position.set((i-0.5)*8, 0, side*(ARENA.z-3));
  z.group.rotation.y = side>0 ? Math.PI : 0;
  shake(0.9); sfx.roar();
  toast(BOSSES[key].name, 3);
  updateRemaining(); updateBossBar();
}
```

Bosses are pushed into `zombies` by `makeZombie`, so they count toward `alive` and
`updateRemaining` without more work.

### 3.4 Boss HUD bar

HTML, inside `#waveBox` after `#remaining`:

```html
<div id="bossBox" class="hidden"><div id="bossName">THE BRUTE</div><div id="bossTrack"><div id="bossFill"></div></div></div>
```

CSS:

```css
#bossBox{margin-top:10px;}
#bossName{font-size:10px;letter-spacing:.34em;color:var(--blood);}
#bossTrack{width:220px;height:5px;margin:5px auto 0;background:rgba(230,225,214,.14);}
#bossFill{height:100%;width:100%;background:var(--blood);transition:width .15s linear;}
```

```js
function updateBossBar(){
  var hp=0, max=0, name='';
  for(var i=0;i<zombies.length;i++){ var z=zombies[i];
    if(z.boss && !z.dead){ hp+=Math.max(0,z.hp); max+=z.maxHp; name = name? 'BOSSES' : z.boss.name; } }
  ui.bossBox.classList.toggle('hidden', max===0);
  if(max>0){ ui.bossName.textContent=name; ui.bossFill.style.width=(100*hp/max)+'%'; }
}
```

Call `updateBossBar()` at the end of `damageZombie` and in `killZombie`. Add `bossBox`,
`bossName`, `bossFill` to `ui`.

### 3.5 Boss behaviour in `update`

Inside the per-zombie loop, after `resolve(g.position, ...)`:

- **Separation:** bosses should shove, not be shoved. Multiply `sepX`/`sepZ` by
  `z.boss ? 0.15 : 1` before applying. Also, in the inner separation loop, use
  `var want = 0.5*(z.scale + zombies[j].scale)` in place of the fixed `1.0` distance.
- **Footsteps:** after the walk animation lines:

  ```js
  if(z.boss){
    var si=Math.floor(z.phase/Math.PI);
    if(si!==z.stepIdx){ z.stepIdx=si; var f=Math.max(0,1-dist/34)*z.scale/3.4; shake(0.16*f); sfx.stomp(dist); }
  }
  ```

- **Attack reach:** replace `if(dist<1.5 && z.attackCd<=0)` with
  `var reach = z.boss ? z.boss.reach : 1.5*z.scale; if(dist<reach && z.attackCd<=0)`, and use
  `z.boss ? z.boss.attackCd : (z.runner?0.95:1.35)` and `z.boss ? z.boss.attack : (z.runner?9:12)`.
  Also change the slow-down-when-close line `if(dist<1.35) mvSpeed*=0.15;` to
  `if(dist<reach*0.9) mvSpeed*=0.15;`.
- **Stalker lunge:** `z.special-=dt; if(z.boss && z.boss.lunge && z.special<=0){ z.special=6; z.lungeT=0.7; sfx.roar(); }`
  then `if(z.lungeT>0){ z.lungeT-=dt; mvSpeed*=3; }` (put before the position update).
- **Colossus slam:** `if(z.boss && z.boss.slam && z.special<=0 && dist<9){ z.special=7; z.slamT=0.9; }`
  and `if(z.slamT>0){ z.slamT-=dt; z.parts.armL.rotation.x=z.parts.armR.rotation.x=-2.8; if(z.slamT<=0){ explode(g.position.clone().setY(0.3), 5.5, 0, true); } }`
  (radius 5.5, zero zombie damage, hurts the player if within range).
- **Death fall:** replace `var fall=Math.min(1, z.deadT/0.7);` with
  `var fall=Math.min(1, z.deadT/(z.boss?z.boss.fall:0.7));` and start the fade at
  `z.deadT > 3.4 + (z.boss? z.boss.fall : 0)`.

### 3.6 Boss death rewards

In `killZombie`, before `updateRemaining()`:

```js
if(z.boss){
  burst(new THREE.Vector3(z.group.position.x, 1.5*z.scale/3, z.group.position.z), null, 40, 'blood');
  for(var k=0;k<3;k++) bloodPool(z.group.position.x+rand(-1.5,1.5), z.group.position.z+rand(-1.5,1.5));
  shake(1.0); sfx.bossdie();
  state.health=Math.min(100, state.health+25); updateHealth();
  weapons.forEach(function(w){ if(!w.def.infiniteReserve) w.reserve+=Math.round(w.def.reserve*0.5); });
  syncAmmoState(); updateAmmo();
  toast(z.boss.name+' DOWN', 3);
}
```

The particle pool is 110; a 40-particle burst is fine.

### 3.7 Boss sounds

```js
sfx.roar=function(){ tone('sawtooth', 48, 26, 1.6, 0.5, 0, 400); noise(1.2, 160, 0.8, 0.3); tone('square', 60, 30, 0.6, 0.15, 0.1, 300); };
sfx.stomp=function(dist){ var v=Math.max(0, 0.6*(1-dist/34)); if(v<0.01) return; tone('sine', 55, 24, 0.28, v); noise(0.18, 140, 0.9, v*0.6); };
sfx.bossdie=function(){ tone('sawtooth', 70, 18, 2.4, 0.4, 0, 500); noise(2.0, 200, 0.7, 0.35); tone('sine', 50, 20, 1.6, 0.5, 0.2); };
```

### 3.8 Start screen text

Update the `<p>` in `#start` to:
`Left side of the screen moves you. Drag the right side to aim. Push the stick to the edge to sprint.<br>New guns unlock as you survive. Something huge arrives every fifth wave.<br>Tap ≡ for cheats. Best with sound on.`

**Check:** temporarily change `if(n%5!==0)` to `if(n%1!==0)` so a boss spawns at wave 1, run the
smoke test, confirm the screenshot shows a very large red-skinned zombie at the far end and the
boss bar is visible (`#bossBox` not hidden). Change it back. Run syntax check.

**COMMIT**: "Nightfall: bosses every fifth wave"

---

## 4. Pause and cheats menu

### 4.1 Cheat definitions and storage

Add a new section banner `/* ==== CHEATS ==== */` immediately after the `state`/`player`
definitions, **replacing** the `var cheats={};` stub from section 1.0 (so `cheats` exists before
any function that reads it runs).

```js
var CHEAT_DEFS=[
  {key:'ammo',      type:'toggle', label:'INFINITE AMMO',    desc:'Reserve never runs out.'},
  {key:'clip',      type:'toggle', label:'BOTTOMLESS CLIP',  desc:'Never reload.'},
  {key:'god',       type:'toggle', label:'GOD MODE',         desc:'Nothing hurts you.'},
  {key:'oneShot',   type:'toggle', label:'ONE-SHOT KILLS',   desc:'Anything you hit dies. Bosses too.'},
  {key:'rapid',     type:'toggle', label:'RAPID FIRE',       desc:'Every gun is full auto and fast.'},
  {key:'boomRounds',type:'toggle', label:'EXPLOSIVE ROUNDS', desc:'Every bullet explodes.'},
  {key:'allGuns',   type:'toggle', label:'ALL GUNS',         desc:'Unlock everything now.'},
  {key:'speed',     type:'toggle', label:'SPEED DEMON',      desc:'You move much faster.'},
  {key:'slowmo',    type:'toggle', label:'SLOW MOTION',      desc:'Zombies move at a third speed. You do not.'},
  {key:'horde',     type:'toggle', label:'HORDE',            desc:'Twice as many zombies at once.'},
  {key:'bigHead',   type:'toggle', label:'BIG HEAD MODE',    desc:'Heads two and a half times bigger.'},
  {key:'head',      type:'select', label:'HEAD SWAP',        options:['normal','banana','hamburger','pumpkin','watermelon','beachball','tv','random']},
  {key:'size',      type:'select', label:'ZOMBIE SIZE',      options:['normal','tiny','giant']},
  {key:'confetti',  type:'toggle', label:'CONFETTI BLOOD',   desc:'Zombies bleed party.'},
  {key:'helium',    type:'toggle', label:'HELIUM VOICES',    desc:'Squeaky zombies.'},
  {key:'party',     type:'toggle', label:'PARTY MODE',       desc:'Disco lights. Zombies dance.'},
  {key:'ragdoll',   type:'toggle', label:'SEND THEM FLYING', desc:'Kills launch zombies into the air.'},
  {key:'skipWave',  type:'action', label:'SKIP WAVE'},
  {key:'boss',      type:'action', label:'SUMMON A BOSS'},
  {key:'refill',    type:'action', label:'REFILL AMMO + HEALTH'},
  {key:'reset',     type:'action', label:'TURN ALL CHEATS OFF'}
];
var CHEAT_KEY='nightfall.cheats.v1';
var cheats={};
function defaultCheats(){
  var c={}; CHEAT_DEFS.forEach(function(d){ if(d.type==='toggle') c[d.key]=false; if(d.type==='select') c[d.key]=d.options[0]; });
  return c;
}
function loadCheats(){
  cheats=defaultCheats();
  try{ var s=JSON.parse(localStorage.getItem(CHEAT_KEY)||'{}');
       CHEAT_DEFS.forEach(function(d){ if(d.type!=='action' && s[d.key]!==undefined) cheats[d.key]=s[d.key]; }); }catch(e){}
}
function saveCheats(){ try{ localStorage.setItem(CHEAT_KEY, JSON.stringify(cheats)); }catch(e){} }
function anyCheat(){
  return CHEAT_DEFS.some(function(d){ return (d.type==='toggle' && cheats[d.key]) || (d.type==='select' && cheats[d.key]!==d.options[0]); });
}
loadCheats();
```

### 4.2 Menu markup and CSS

Add a new screen after `#over`:

```html
<div class="screen hidden" id="menu">
  <h2>CHEATS</h2>
  <div id="cheatGrid"></div>
  <div class="menuRow">
    <button class="go" id="resumeBtn">RESUME</button>
    <button class="go quit" id="quitBtn">QUIT TO TITLE</button>
  </div>
</div>
<div class="btn hidden" id="menuBtn">≡</div>
```

CSS:

```css
#menu{z-index:35;justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;
  padding-top:calc(env(safe-area-inset-top) + 28px);background:rgba(4,6,10,.94);}
#menu h2{font-size:13px;letter-spacing:.5em;font-weight:300;color:var(--bone-dim);margin-bottom:18px;}
#cheatGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;width:100%;max-width:720px;}
.cheat{border:1px solid rgba(230,225,214,.22);padding:12px 10px;text-align:left;background:transparent;color:var(--bone-dim);
  font-size:11px;letter-spacing:.14em;line-height:1.5;cursor:pointer;}
.cheat b{display:block;font-weight:400;color:var(--bone);}
.cheat small{display:block;font-size:10px;letter-spacing:.04em;opacity:.7;margin-top:3px;}
.cheat.on{border-color:var(--blood);background:rgba(168,31,34,.16);}
.cheat.on b{color:#ffb3b0;}
.cheat.action{border-style:dashed;}
.menuRow{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:40px;}
.menuRow .go{margin-top:24px;}
.go.quit{border-color:rgba(168,31,34,.6);color:#ffb3b0;}
#menuBtn{width:44px;height:44px;left:calc(env(safe-area-inset-left) + 16px);top:calc(env(safe-area-inset-top) + 16px);font-size:18px;}
#cheatTag{position:fixed;z-index:10;pointer-events:none;left:calc(env(safe-area-inset-left) + 70px);top:calc(env(safe-area-inset-top) + 30px);
  font-size:10px;letter-spacing:.3em;color:var(--blood);}
```

Also add `<div id="cheatTag" class="hidden">CHEATS ON</div>` after `#hud`.

Important: `.screen` is `display:flex; align-items:center`. `#cheatGrid` needs `width:100%` (set
above) or it collapses. The `.screen h1` rule does not apply here because this uses `h2`.

### 4.3 Menu logic

```js
function buildMenu(){
  var grid=document.getElementById('cheatGrid'); grid.innerHTML='';
  CHEAT_DEFS.forEach(function(d){
    var b=document.createElement('button'); b.className='cheat'+(d.type==='action'?' action':''); b.dataset.key=d.key;
    b.addEventListener('click', function(){ pressCheat(d); });
    grid.appendChild(b);
  });
  refreshMenu();
}
function refreshMenu(){
  var btns=document.querySelectorAll('#cheatGrid .cheat');
  for(var i=0;i<btns.length;i++){
    var b=btns[i], d=CHEAT_DEFS.filter(function(x){ return x.key===b.dataset.key; })[0];
    var val=cheats[d.key], on = d.type==='toggle' ? !!val : (d.type==='select' && val!==d.options[0]);
    b.classList.toggle('on', on);
    b.innerHTML='<b>'+d.label+'</b>'+(d.type==='select' ? '<small>'+String(val).toUpperCase()+'  ›</small>' : d.desc ? '<small>'+d.desc+'</small>' : '');
  }
  ui.cheatTag.classList.toggle('hidden', !anyCheat());
}
function pressCheat(d){
  if(d.type==='toggle') cheats[d.key]=!cheats[d.key];
  else if(d.type==='select'){ var i=d.options.indexOf(cheats[d.key]); cheats[d.key]=d.options[(i+1)%d.options.length]; }
  else runAction(d.key);
  applyCheats(d.key);
  saveCheats(); refreshMenu();
}
function openMenu(){
  if(!state.running || state.paused) return;
  state.paused=true; firing=false; endStick(); lookTouch=null;
  ui.menu.classList.remove('hidden');
  if(document.pointerLockElement) document.exitPointerLock();
}
function closeMenu(){
  if(!state.paused) return;
  state.paused=false; ui.menu.classList.add('hidden'); clock.getDelta();
}
function quitToTitle(){
  closeMenu(); gameOver(); ui.over.classList.add('hidden'); ui.start.classList.remove('hidden');
}
```

`gameOver()` plays the death sound and shows the death screen; `quitToTitle` reuses it for the
teardown and then swaps the screen. Acceptable.

Wire it up (next to the existing start/again button wiring; add `touchend` + `preventDefault`
versions too, exactly like the start button does):

```js
document.getElementById('resumeBtn').addEventListener('click', closeMenu);
document.getElementById('quitBtn').addEventListener('click', quitToTitle);
ui.menuBtn.addEventListener('click', openMenu);
```

Keyboard: in `keydown`, `if(e.code==='Escape' || e.code==='Backquote'){ if(state.paused) closeMenu(); else openMenu(); }`.
Note: when pointer lock is active, the browser consumes the first Escape to release the lock and
the page does not see it. Pressing Escape a second time opens the menu. Backquote works on the
first press. Mention both in the start text? No, `≡` is on screen. Leave it.

**Touch gotcha (must do):** the three touch handlers at line ~1188 start with
`if(!state.running) return;` and end with `e.preventDefault()`. While the menu is open,
`preventDefault` on `touchstart` stops the browser from generating `click` events, so the menu
buttons would be dead on a phone. Change each guard to `if(!state.running || state.paused) return;`.
In `onTouchStart`, add `if(el===ui.menuBtn){ openMenu(); continue; }` (before the stick check).

**Pause the loop:** in `animate`, change `if(state.running) update(dt);` to
`if(state.running && !state.paused) update(dt);`. Also gate the `mousemove` and `mousedown`
handlers on `!state.paused`.

Add `menu`, `menuBtn`, `cheatTag` to `ui`; add `menuBtn` to the show list in `beginPlay` and the
hide list in `gameOver`. Call `buildMenu()` at boot before `animate()`.

### 4.4 Where each cheat takes effect

Most are already wired in sections 2 and 3 through `cheats.xxx` reads. Here is the complete map;
verify each exists.

| cheat | where it acts |
|---|---|
| `ammo` | `updateAmmo` shows ∞; reload completion does not subtract; `doReload` guard (2.9). |
| `clip` | `shoot` does not decrement; auto-reload skipped; `doReload` returns; HUD ∞ (2.5, 2.9). |
| `god` | Top of `hurtPlayer`: `if(cheats.god) return;` right after the `running` check. |
| `oneShot` | `damageZombie` (2.5). |
| `rapid` | Firing block (2.9). |
| `boomRounds` | `shoot` (2.5). |
| `allGuns` | `applyCheats`: `if(cheats.allGuns) WEAPONS.forEach(d => state.unlocked[d.key]=true)`. Also `initWeapons`. |
| `speed` | In `update`, `var speed = sprinting? 6.3 : 4.1;` → multiply by `cheats.speed?1.9:1`. |
| `slowmo` | See 4.5. |
| `horde` | `startWave`: `toSpawn *= 2` when on. Spawn gate `alive<11` → `alive<(cheats.horde?22:11)`. |
| `bigHead` | Section 5.3. |
| `head` | Section 5. |
| `size` | `makeZombie` scale (3.2). |
| `confetti` | Section 5.5. |
| `helium` | Section 5.6. |
| `party` | Section 5.7. |
| `ragdoll` | Section 5.8. |

```js
function applyCheats(changedKey){
  if(cheats.allGuns) WEAPONS.forEach(function(d){ state.unlocked[d.key]=true; });
  if(changedKey==='head' || changedKey==='bigHead') reheadAll();      // section 5
  if(changedKey==='party') setParty(cheats.party);                    // section 5.7
  if(state.running) updateAmmo();
}
function runAction(key){
  if(key==='reset'){ cheats=defaultCheats(); applyCheats('head'); setParty(false); return; }
  if(!state.running) return;
  if(key==='skipWave'){ zombies.forEach(function(z){ if(!z.dead) killZombie(z); }); state.toSpawn=0; state.waveBreak=3.1; updateRemaining(); closeMenu(); }
  if(key==='boss'){ spawnBoss(BOSS_ORDER[Math.floor(Math.random()*BOSS_ORDER.length)], 0); closeMenu(); }
  if(key==='refill'){ state.health=100; updateHealth(); weapons.forEach(function(w){ w.mag=w.def.mag; w.reserve=w.def.reserve; }); syncAmmoState(); updateAmmo(); }
}
```

Note `killZombie` increments kills; skipping a wave counting as kills is fine for a cheat.

Call `applyCheats()` once after `initWeapons()` in `resetGame`, so saved cheats apply on start.

### 4.5 Slow motion

`update(dt)` mixes player and world. Introduce `var wdt = cheats.slowmo ? dt*0.33 : dt;` at the
top of `update` and use `wdt` instead of `dt` in exactly these blocks: lamps flicker, spawning,
the whole zombies loop, particles, decals, grenades. Player movement, look, bob, weapon sway,
recoil, firing cooldown, reload, regen, shake and toast keep `dt`. `explode` and `damageZombie`
are unaffected.

### 4.6 Game over line

In `gameOver`, append `(anyCheat() ? ' &nbsp;·&nbsp; cheats on' : '')` to the score string.

**Check:** syntax check; smoke test with `localStorage` pre-set (section 10 shows how) to
`{"god":true,"clip":true}`: HUD ammo shows `∞`, `#cheatTag` is visible, and health stays 100
after 20 s. Click `#menuBtn` → `#menu` visible and `state.paused` (check via the `waveNum` not
changing while zombies would otherwise be spawning: `remaining` text stays constant for 3 s).
Click `#resumeBtn` → hidden.

**COMMIT**: "Nightfall: pause menu with cheats"

---

## 5. Silly heads and other fun

### 5.1 Refactor the head into its own group

In `makeZombie`, everything currently added directly to `g` with `userData.part='head'`
**except the neck** (skull `head`, `hair`, the `jaw` group, sockets, eyes, pupils) moves into a
`headG` group:

```js
var headG=new THREE.Group(); headG.position.set(0,1.76,0.02); g.add(headG);
```

Positions become relative to `(0,1.76,0.02)`: skull at `(0,0,0)`; hair `(0,0.012,-0.012)`; jaw
group `(0,-0.05,0)`; sockets `(ex,0.025,0.108)`; eyes `(ex,0.025,0.121)`; pupils
`(ex*1.04,0.024,0.135)`. Keep every `userData.part='head'` tag. Wrap that whole block in a
function so it can be re-used:

```js
function buildNormalHead(mats){ /* returns {group:headG, jaw:jaw, mats:[]} using mats.faceMat, mats.skinMat, ... */ }
```

`mats` is an object holding the per-zombie materials already created above. The normal head
adds no new materials, so `mats:[]`.

Then:

```js
var hk = pickHeadKind();
var built = hk==='normal' ? buildNormalHead({...}) : buildFunnyHead(hk);
g.add(built.group);
built.group.scale.setScalar(cheats.bigHead?2.5:1);
```

and in the `z` object: `head: built.group, jaw: built.jaw`, plus `headMats: built.mats,
headKind: hk`. Push `built.mats` onto `z.mats` (so they fade and dispose with the corpse):
`z.mats=z.mats.concat(built.mats)`.

```js
function pickHeadKind(){
  var k=cheats.head;
  if(k==='random'){ var o=['banana','hamburger','pumpkin','watermelon','beachball','tv']; return o[Math.floor(Math.random()*o.length)]; }
  return k||'normal';
}
```

The walk animation already does `z.parts.head.rotation.z=...` and `z.parts.jaw.rotation.x=...`,
so funny heads must return a real `jaw` Group even if it is empty.

The `g.traverse(... userData.zombie=true)` line runs after, so all head meshes are tagged.
Raycasts hit them because `intersectObjects(targets, true)` is recursive.

### 5.2 Materials for funny heads

Funny heads use module-level shared **geometries** and **base materials**, but each head
**clones** the materials it uses (`mat.clone()`) and returns the clones in `mats`. This is
required because the death fade sets `opacity` on every entry in `z.mats`; sharing would fade
every zombie. Cloning a material is cheap and shares the texture. Every base material calls
`color.convertSRGBToLinear()` if untextured.

Textures made once at load with the existing canvas helpers pattern (`newCanvas`, `tex`):

- `watermelonTex`: 256×256, dark green `#1f5a22` with 10 wavy vertical stripes of `#6fae4a`.
- `beachballTex`: 256×128, six vertical stripes: red, white, blue, white, yellow, white.
- `bunTex`: 256×256 `#c98a3e` with 60 small pale ellipses (`#f1e2b8`) as sesame seeds.
- `tvStaticTex`: 64×64 random greys; set `.magFilter=THREE.NearestFilter`. Re-randomise 8×/s in
  `update` only if any TV heads exist (`ctx.putImageData` + `tex.needsUpdate=true`).
- `pumpkinFaceTex`: 256×256 orange `#e2731b` with two black triangles (eyes) and a jagged black
  mouth drawn on the front third; the sphere's UV wraps, so draw the face centred at x=64.

### 5.3 Head builders

Each returns `{group, jaw, mats}`. The group origin is the neck top; the head sits at roughly
`y = 0.13` (same as the skull radius) so it lines up with the neck. All meshes get
`castShadow=true` and `userData.part='head'`.

- **banana**: `TorusGeometry(0.19, 0.05, 10, 20, Math.PI*0.9)` in `#f2d33a` yellow, rotated so
  the arc curves upward like a smile (`rotation.z=Math.PI*0.55`, `rotation.y=Math.PI/2`), plus
  two small brown (`#5a3a1a`) `ConeGeometry(0.035,0.09)` tips at each end. Group `position.y=0.16`.
  Optional: a few dark brown speckles as tiny flattened spheres.
- **hamburger** (stack on the y axis, centre at 0.12): bottom bun `SphereGeometry(0.17,18,10, 0,2π, π/2, π/2)` (lower
  hemisphere) with `bunTex` at y 0.0, `scale.y 0.5`; patty `CylinderGeometry(0.17,0.17,0.05,18)`
  `#4a2a1a` at y 0.04; cheese `BoxGeometry(0.34,0.012,0.34)` `#f0b429` at y 0.075 rotated
  `y=0.3`; lettuce `CylinderGeometry(0.19,0.17,0.03,12)` `#5fae3e` at y 0.09 with
  `scale(1.05,1,0.95)`; tomato `CylinderGeometry(0.15,0.15,0.03,14)` `#c9352b` at y 0.115; top bun
  upper hemisphere with `bunTex` at y 0.13 `scale.y 0.75`.
- **pumpkin**: sphere radius 0.19 `scale(1,0.85,1)` with `pumpkinFaceTex`; six ridge ellipsoids:
  spheres radius 0.19 `scale(0.35,0.85,1)` rotated around y every 60°, same material; stem
  `CylinderGeometry(0.025,0.035,0.08)` `#3d5a25` on top. Give the face material
  `emissive 0xff7a1a, emissiveIntensity 0.35` so the carved bits glow a little.
- **watermelon**: sphere radius 0.2 `scale(1,1.15,1)` with `watermelonTex`. Optional: a small
  brown stem.
- **beachball**: sphere radius 0.2 with `beachballTex`, `roughness 0.3`.
- **tv**: `BoxGeometry(0.34,0.28,0.3)` `#3b2f26` (wood-grain brown), screen
  `PlaneGeometry(0.26,0.2)` at `z=0.151` with `MeshBasicMaterial({map:tvStaticTex})`, two thin
  cylinder antennae `(0.006,0.006,0.22)` angled out from the top, two small knob cylinders to the
  right of the screen. The screen is a `MeshBasicMaterial` so it glows regardless of light.

Set `headG.scale.setScalar(cheats.bigHead?2.5:1)` for every kind including normal.

### 5.4 Re-heading living zombies

```js
function reheadZombie(z){
  var g=z.group;
  g.remove(z.parts.head);
  z.headMats.forEach(function(m){ m.dispose(); });
  z.mats = z.mats.filter(function(m){ return z.headMats.indexOf(m)<0; });
  var hk=pickHeadKind();
  var built = hk==='normal' ? buildNormalHead(z.baseMats) : buildFunnyHead(hk);
  built.group.scale.setScalar(cheats.bigHead?2.5:1);
  built.group.traverse(function(o){ if(o.isMesh) o.userData.zombie=true; });
  g.add(built.group);
  z.parts.head=built.group; z.parts.jaw=built.jaw; z.headMats=built.mats; z.headKind=hk;
  z.mats=z.mats.concat(built.mats);
}
function reheadAll(){ zombies.forEach(function(z){ if(!z.dead) reheadZombie(z); }); }
```

For this to work, `makeZombie` must store `z.baseMats={skinMat, faceMat, hairMat, socketMat, eyeMat, pupilMat}`
(whatever `buildNormalHead` needs).

### 5.5 Confetti blood

```js
var confettiMats=[0xff3355,0xffcc00,0x33ccff,0x66ff66,0xff66ff,0xffffff].map(function(c){
  var m=new THREE.MeshBasicMaterial({color:c}); m.color.convertSRGBToLinear(); return m; });
```

In `burst`, where it picks the material: `kind==='blood' ? (cheats.confetti ? confettiMats[Math.floor(Math.random()*confettiMats.length)] : bloodMat)`.
Confetti falls slower: `p.grav = kind==='spark'? -6 : (cheats.confetti && kind==='blood' ? -4 : -13)`.
In `bloodPool`, when `cheats.confetti`, use `color: new THREE.Color().setHSL(Math.random(),0.9,0.6)` and opacity target 0.9.

### 5.6 Helium voices

In `initAudio`, add `function zp(){ return cheats.helium?2.4:1; }` and multiply `f0` and `f1`
(and the lowpass cutoff) by `zp()` inside `sfx.zgrunt`, `sfx.growl`, the groan `tone` in
`sfx.splat`, `sfx.roar`, `sfx.bossdie`. Do not touch weapon or player sounds.

### 5.7 Party mode

```js
var partyLights=[], partyT=0;
function setParty(on){
  if(on && !partyLights.length){
    for(var i=0;i<3;i++){ var L=new THREE.PointLight(0xffffff, 2.2, 30, 1.6); scene.add(L); partyLights.push(L); }
  }
  partyLights.forEach(function(L){ L.visible=on; });
  flashlight.color.setHex(0xffe9c4);
}
```

In `update` (with `dt`, not `wdt`), when `cheats.party`:

```js
partyT+=dt;
partyLights.forEach(function(L,i){
  var a=partyT*1.7+i*2.09;
  L.position.set(player.pos.x+Math.cos(a)*7, 4.5+Math.sin(partyT*3+i)*1.5, player.pos.z+Math.sin(a)*7);
  L.color.setHSL((partyT*0.25+i/3)%1, 1, 0.55);
});
flashlight.color.setHSL((partyT*0.4)%1, 0.8, 0.6);
```

In the zombie loop, when `cheats.party` and not a boss: after the facing code add
`g.rotation.y += wdt*5; g.position.y = Math.abs(Math.sin(z.phase*1.5))*0.25;` and make the arms
wave: `z.parts.armL.rotation.x = -2.6 + Math.sin(z.phase*2)*0.5; z.parts.armR.rotation.x = -2.6 - Math.sin(z.phase*2)*0.5;`
(placed after the normal walk animation so it overrides). Zombies still chase and attack.
Bosses do not dance.

Call `setParty(cheats.party)` at boot after `loadCheats()`, and `setParty(false)` in `resetGame`
**only if** `!cheats.party` (that is, just call `setParty(cheats.party)`).

### 5.8 Send them flying (ragdoll launch)

In `killZombie`, when `cheats.ragdoll`:

```js
var away=new THREE.Vector3().subVectors(z.group.position, player.pos).setY(0).normalize();
z.fly={vx:away.x*rand(6,11), vz:away.z*rand(6,11), vy:rand(9,15), spin:rand(-6,6), landed:false};
```

In the `z.dead` branch of the zombie loop, before the existing fall code:

```js
if(z.fly && !z.fly.landed){
  z.fly.vy-=22*wdt;
  g.position.x+=z.fly.vx*wdt; g.position.z+=z.fly.vz*wdt; g.position.y+=z.fly.vy*wdt;
  g.rotation.x+=z.fly.spin*wdt; g.rotation.z+=z.fly.spin*0.6*wdt;
  g.position.x=Math.max(-ARENA.x+0.6, Math.min(ARENA.x-0.6, g.position.x));
  g.position.z=Math.max(-ARENA.z+0.6, Math.min(ARENA.z-0.6, g.position.z));
  if(g.position.y<=0 && z.fly.vy<0){ z.fly.landed=true; g.position.y=0; g.rotation.set(0,g.rotation.y,0); z.deadT=0; bloodPool(g.position.x,g.position.z); sfx.splat(); }
  continue;
}
```

Because `z.deadT` is reset on landing, the normal fall-and-fade sequence runs afterwards.
`z.deadT+=dt` currently sits at the top of the dead branch; make sure the flying block is above
the fall code but the `deadT+=wdt` increment is fine to keep at the top.

**Check:** smoke test with localStorage `{"head":"hamburger","bigHead":true,"confetti":true}`;
screenshot at wave 1 after 6 s shows a zombie with a large burger for a head. Then
`{"head":"banana"}`, `{"head":"tv"}`, `{"head":"pumpkin"}`: eyeball each screenshot. Fire
(hold mouse down via Playwright `page.mouse.down()` after clicking the canvas) with
`{"oneShot":true,"confetti":true}` and confirm no console errors and kills increase.

**COMMIT**: "Nightfall: silly heads, confetti, helium, party mode, ragdolls"

---

## 6. HUD polish and keyboard help

- Start screen: add a second `<p>` under the first, desktop only (`@media (pointer:fine)`):
  `WASD move · mouse aim · 1–7 or Q switch guns · R reload · F light · ` or Esc cheats`.
- `#kills` stays. Nothing else.

**Check:** none beyond the syntax check.

---

## 7. Balance pass (numbers only, no new code)

Play (or run the headless bot in section 10 with `god` on) through wave 5 and confirm:

- The Brute takes 20–40 seconds of carbine fire to kill at wave 5. If it dies in under 15 s
  raise `hp`; if over 60 s lower it.
- The shotgun kills a walker in one close body shot at wave 1 (9 pellets × 16 = 144 ≥ 95 hp).
- The sniper one-shots a walker anywhere on the body through wave 8 (240 ≥ 95+7×16=207).
- Ammo does not run dry on wave 2–3 with normal play. If it does, raise the wave-clear bonus
  from 0.4 to 0.5.

---

## 8. Service worker cache bump

In `experiments/nightfall-zombie-fps/sw.js` change `var CACHE = 'henrys-nightfall-v1';` to
`'henrys-nightfall-v2'`. The `activate` handler deletes old `henrys-nightfall-*` caches, so
existing installs pick up the new page on their next open.

---

## 9. Final checks before the last commit

1. Syntax check passes.
2. `grep -c "convertSRGBToLinear" _experiments/nightfall-zombie-fps.html` is larger than before
   you started (was 1 call covering five materials). Every new untextured `MeshStandardMaterial`
   or `MeshBasicMaterial` with a hex `color` has one.
3. `grep -n "state.reserve\s*[-+]\?=" _experiments/nightfall-zombie-fps.html` and
   `grep -n "state.mag\s*[-+]\?=\|state.mag--" ...` return **no** writes outside `syncAmmoState`.
4. `grep -n "makeZombie(" ...` shows only calls with an object argument.
5. Headless smoke suite (section 10) passes every scenario with zero console errors.
6. Open `git diff --stat`: only `_experiments/nightfall-zombie-fps.html` and
   `experiments/nightfall-zombie-fps/sw.js` changed (plus this plan if you edited it).
7. Front matter at the top of the HTML file is unchanged and `{% raw %}` / `{% endraw %}` still
   wrap the page.

**COMMIT**: "Nightfall: bump offline cache" then `git push -u origin claude/nightfall-game-mod-plan-rosyl7`.

---

## 10. Headless verification recipe

Jekyll is not installed here, so serve the experiment folder directly. Playwright 1.56 and a
Chromium are already installed globally in this environment (`/opt/node22/lib/node_modules`,
`/opt/pw-browsers`). Work in your scratchpad directory.

```sh
S=<your scratchpad dir>
mkdir -p $S/site/experiments/nightfall-zombie-fps
cp experiments/nightfall-zombie-fps/* $S/site/experiments/nightfall-zombie-fps/
# strip the Jekyll front matter and raw tags to get a plain HTML page
sed -e '1,/^---$/{/^---$/!d}' _experiments/nightfall-zombie-fps.html | sed -e '1,/^---$/d' -e '/{% raw %}/d' -e '/{% endraw %}/d' \
  > $S/site/experiments/nightfall-zombie-fps/index.html
(cd $S/site && python3 -m http.server 8123 >/dev/null 2>&1 &)
```

`$S/smoke.js` (the first scenario; copy and vary the `cheats` object and the actions for the others):

```js
const { chromium } = require('playwright');
const cheats = JSON.parse(process.argv[2] || '{}');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8123/experiments/nightfall-zombie-fps/', { waitUntil: 'load' });
  await page.evaluate(c => localStorage.setItem('nightfall.cheats.v1', JSON.stringify(c)), cheats);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.click('#startBtn');
  await page.waitForTimeout(6000);
  const hud = await page.evaluate(() => ({
    wave: document.getElementById('waveNum').textContent,
    remaining: document.getElementById('remaining').textContent,
    weapon: document.getElementById('wpnName').textContent,
    mag: document.getElementById('ammoMag').textContent,
    health: document.getElementById('healthNum').textContent,
    bossBar: !document.getElementById('bossBox').classList.contains('hidden'),
    cheatTag: !document.getElementById('cheatTag').classList.contains('hidden')
  }));
  await page.screenshot({ path: process.argv[3] || 'smoke.png' });
  console.log(JSON.stringify({ hud, errors }));
  await browser.close();
})();
```

Run: `NODE_PATH=/opt/node22/lib/node_modules node $S/smoke.js '{"god":true}' $S/god.png`

Scenarios to run before each commit (all must report `"errors":[]`):

| scenario | cheats | extra actions | expect |
|---|---|---|---|
| plain | `{}` | none | wave 1, `CARBINE`, no cheat tag |
| weapons | `{"allGuns":true}` | `page.keyboard.press('Digit3')` then read HUD | `PUMP` |
| infinite | `{"clip":true,"ammo":true}` | none | mag shows `∞` |
| boss | `{}` | temporarily set `bossesForWave` to return `['brute']` for wave 1, or run the `boss` action via `page.click('#menuBtn'); page.click('[data-key=boss]')` | `bossBar:true`, screenshot shows a giant |
| heads | `{"head":"hamburger","bigHead":true}` | none | screenshot shows burger heads |
| menu | `{}` | `page.click('#menuBtn')`, wait 3 s, `remaining` unchanged, `page.click('#resumeBtn')` | menu pauses and resumes |
| firing | `{"oneShot":true,"confetti":true,"ragdoll":true}` | `page.mouse.click(640,360)` then `page.mouse.down()`; wait 5 s | `KILLS` above 0, no errors |

Look at every screenshot with your image reader. The renderer runs on SwiftShader, so it is
slow and dark, but shapes are clear enough to judge heads and boss size.

Kill the server when done: `pkill -f "http.server 8123"`.

---

## 11. Stretch goals (only after everything above is committed and verified)

- **Weapon pickups** on the ground instead of wave-based unlocks: a spinning viewmodel on a
  crate that unlocks when the player walks within 1.2 m.
- **Minigun** with a 0.6 s spin-up and 250-round belt.
- **Boss intro camera**: freeze input for 1.5 s and swing the camera toward the boss.
- **Zombie head variants beyond the list**: pineapple, toilet, disco ball (`beachballTex` with
  metalness 1), traffic cone.
- **Persistent best wave** in localStorage shown on the title screen, suffixed with "(cheats)"
  if any cheat was on.
- **Screen-space damage numbers** on hits, as short-lived HUD divs positioned by projecting the
  hit point with `Vector3.project(camera)`.
