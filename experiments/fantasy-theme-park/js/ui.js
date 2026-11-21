// The interface. Everything the player can see and press is described once, as data:
//   tabs()   the toolbar;  tray()  the options of the current tool;  panel()  the open panel
// and every press is an action id handled by act(id). The HTML below draws that data on screen, and
// vr.js draws the very same data on the tablet in your hand, so nothing works on only one of them.
import { CATALOG, model } from './models.js';
import { SURFACES, GROUNDS, ROAD, LANDS } from './park.js';
import { THEMES, landName, parkName } from './names.js';
import { objName } from './objects.js';
import { FENCES } from './structures.js';
import { esc } from './util.js';
import { TERRAIN_MODES } from './tools.js';
import { ICON } from './icons.js';
import { TEMPLATES, STYLES, ROOFS, MATS, USES, bounds as bBounds, groundCells, H as STOREY } from './buildings.js';
import { GOODS, SELLS, STALLS, STALL_ROOFS, STALL_COLORS, goodsFor, defaultMenu, price } from './shops.js';
import { foodName, shopName } from './names.js';
import { FLAT, MOUNTS, RIDE_COLORS, COASTER_PIECES, PIECES, COLORS, CARTS, SPEEDS } from './rides.js';
const SWATCH = { ashlar: '#d8ccb0', brick: '#a0503a', boardwall: '#9a7a60', marble: '#e8e4dc', rockface: '#8a8478', slate: '#4a5060', tiles: '#b0553a', shingles: '#7a5a40', copper: '#5fa08a',
  darkwood: '#4a3426', wood: '#a07a52', white: '#f2efe8', iron: '#24262a', stone: '#b8b0a0', boards: '#9a7450', floortile: '#ddd5c4', pavers: '#9a4a3a', cobbles: '#8a8278' };
const swatchOf = (k) => k.includes('#') ? '#' + k.split('#')[1] : SWATCH[k] || '#888';
const STOREYS = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth'];
const AWNINGS = ['#1e5a3a', '#7a2a2a', '#2a3a6a', '#8a5a2a', '#5a2a6a'];

export const TABS = [
  ['select', 'Select'], ['paths', 'Paths'], ['plants', 'Trees'], ['decor', 'Decor'], ['buildings', 'Buildings'], ['shops', 'Shops'], ['rides', 'Rides'],
  ['terrain', 'Land'], ['lands', 'Lands'], ['park', 'Park'], ['bulldoze', 'Bulldoze'],
];
const SIZES = [[3, 'S'], [6, 'M'], [10, 'L'], [16, 'XL']];
const DECOR = [['lights', 'Lights'], ['furniture', 'Furniture'], ['features', 'Features'], ['props', 'Props']];

export class UI {
  constructor(app){
    this.app = app;
    this.tab = 'select';
    this.dialog = null;        // { title, lines, buttons, input? } shown over everything
    this.toasts = [];
    this.el = (id) => document.getElementById(id);
    this.lastHtml = {};
    this.vrDirty = true;
  }
  get T(){ return this.app.tools; }
  get P(){ return this.app.park; }

  // --- descriptions ---------------------------------------------------------------------------
  tabs(){ return TABS.map(([id, label]) => ({ id: 'tab:' + id, label, icon: id, on: this.tab === id })); }
  tray(){
    const T = this.T, o = T.opts, o_ = T.opts, P = this.P, k = T.kind, S = [];
    const o_id = (t) => t.opts.id;
    const chips = (label, list) => S.push({ label, kind: 'chips', items: list });
    const cards = (label, list) => S.push({ label, kind: 'cards', items: list });
    switch (this.tab){
      case 'select': return { hint: 'Tap anything to see it, name it, turn it, move it or remove it. Drag to look round; two fingers to zoom and turn.', sections: [] };
      case 'paths':
        cards('Surface', SURFACES.filter(Boolean).map((s) => ({ id: 'surf:' + s.id, label: s.name, swatch: s.id === ROAD ? 'tarmac' : s.key, on: o.surface === s.id })));
        chips('Width', [1, 2, 3, 4].map((w) => ({ id: 'pw:' + w, label: w * 2 + ' m', on: o.width === w })));
        chips('Lay it', [['brush', 'Paint'], ['line', 'Straight'], ['area', 'Plaza'], ['erase', 'Rub out']].map(([m, l]) => ({ id: 'pmode:' + m, label: l, on: o.mode === m })));
        if (o.surface !== ROAD) chips('Queue line', [{ id: 'queue', label: o.queue ? 'Queue: on' : 'Queue: off', on: o.queue }]);
        return { hint: o.mode === 'line' ? 'Drag from one end to the other.' : o.mode === 'area' ? 'Drag out a rectangle for a plaza.' : o.mode === 'erase' ? 'Drag over a path to take it up.' : 'Drag to lay a path. Over water it becomes a bridge.', sections: S };
      case 'plants':
        cards('Trees', this.catItems('trees')); cards('Plants', this.catItems('plants'));
        if (T.kind === 'place' && CATALOG[o.type] && CATALOG[o.type].cat === 'trees') chips('', [{ id: 'scatter', label: o.scatter ? 'Scatter: on' : 'Scatter: off', on: o.scatter }]);
        return { hint: o.scatter ? 'Drag to plant a wood.' : 'Tap where it goes (drag to see where first).', sections: S };
      case 'decor':
        for (const [c, l] of DECOR) cards(l, this.catItems(c));
        cards('Fences and walls', Object.entries(FENCES).map(([id, f]) => ({ id: 'fence:' + id, label: f.name, thumb: 'fence_' + id, on: k === 'fence' && o.type === id })));
        cards('Signs', [{ id: 'tool:sign', label: 'Sign', thumb: 'sign', on: k === 'sign' }]);
        if (k === 'place' && CATALOG[o.type] && CATALOG[o.type].colors) chips('Colour', CATALOG[o.type].colors.map((c) => ({ id: 'color:' + c, swatchColor: c, label: '', on: (o.color || CATALOG[o.type].colors[0]) === c })));
        if (k === 'place' || k === 'sign') chips('Turn', [{ id: 'rot:-1', label: '⟲ 15°' }, { id: 'rot:1', label: '15° ⟳' }]);
        return { hint: k === 'fence' ? 'Drag from where it starts to where it ends.' : 'Tap where it goes.', sections: S };
      case 'terrain':
        chips('Shape', TERRAIN_MODES.map(([m, l]) => ({ id: 'tmode:' + m, label: l, on: k === 'terrain' && o.mode === m })).concat([{ id: 'wmode:add', label: 'Water', on: k === 'water' && o.mode === 'add' }, { id: 'wmode:drain', label: 'Drain', on: k === 'water' && o.mode === 'drain' }]));
        if (k === 'terrain' && o.mode === 'paint') cards('Ground', GROUNDS.map((g, i) => ({ id: 'ground:' + i, label: g, swatch: ['grass', 'dirt', 'rock', 'sand'][i], on: o.ground === i })));
        chips('Brush', SIZES.map(([s, l]) => ({ id: 'size:' + s, label: l, on: o.size === s })));
        return { hint: k === 'water' ? (o.mode === 'add' ? 'Paint where the water goes: it fills at the level where you start, and digs its own bed.' : 'Paint over water to drain it.') : { raise: 'Hold to raise the ground.', lower: 'Hold to lower it.', flatten: 'Hold to level it to where you started.', smooth: 'Hold to smooth it out.', paint: 'Paint the ground.' }[o.mode], sections: S };
      case 'lands': {
        const lands = P.s.lands.map((l, i) => ({ id: 'land:' + (i + 1), label: l.name, sub: THEMES[l.theme] ? THEMES[l.theme].name : '', swatchColor: l.color, on: o.land === i + 1 }));
        cards('Your lands', lands.concat([{ id: 'newland', label: '＋ New land', sub: 'Choose a theme' }]));
        chips('Brush', [{ id: 'lmode:paint', label: 'Paint', on: o.mode !== 'erase' }, { id: 'lmode:erase', label: 'Rub out', on: o.mode === 'erase' }].concat(SIZES.map(([s, l]) => ({ id: 'size:' + s, label: l, on: o.size === s }))));
        if (o.land) chips('This land', [{ id: 'renameland', label: 'Rename' }, { id: 'themeland', label: 'Theme: ' + (THEMES[P.s.lands[o.land - 1]?.theme]?.name || '') }, { id: 'tool:arch', label: 'Put up an arch' }, { id: 'delland', label: 'Remove' }]);
        return { hint: !P.s.lands.length ? 'Lands are the sections of your park. Make one, then paint it on the map.' : k === 'arch' ? 'Tap a path where it goes into the land: an arch with its name goes across it.' : 'Paint where this land is. Its name goes on arches, signs and the map.', sections: S };
      }
      case 'buildings': {
        if (k === 'bedit'){
          const o = P.obj(o_id(T)); if (!o){ return { hint: 'That building has gone.', sections: [] }; }
          chips('Change', [['rooms', 'Rooms'], ['walls', 'Walls'], ['roof', 'Roof'], ['look', 'Materials'], ['extras', 'Extras']].map(([m, l]) => ({ id: 'bmode:' + m, label: l, on: o_.mode === m })).concat([{ id: 'bdone', label: 'Done' }]));
          const om = { wall: 'plaster#efe6d4', base: 'ashlar', roof: 'slate', trim: 'darkwood', floor: 'boards', ...(o.m || {}) };
          if (o_.mode === 'rooms'){
            chips('Storey', o.floors.map((_, l) => ({ id: 'blevel:' + l, label: STOREYS[l], on: (o_.level || 0) === l })).concat([{ id: 'baddstorey', label: '＋ Storey' }, { id: 'bremstorey', label: '− Top storey' }]));
            return { hint: `Drag over the grid to add rooms to the ${STOREYS[o_.level || 0].toLowerCase()} storey; drag over rooms to take them away. The storeys above are lifted off so you can see in.`, sections: S };
          }
          if (o_.mode === 'walls'){ chips('Wall', STYLES.map(([st, l]) => ({ id: 'bstyle:' + st, label: l, on: o_.style === st }))); return { hint: 'Choose a style, then tap the walls to change.', sections: S }; }
          if (o_.mode === 'roof'){ chips('Roof', ROOFS.map(([r, l]) => ({ id: 'broof:' + r, label: l, on: (o.roof || 'hip') === r }))); return { hint: 'The roof fits itself over every part of the building.', sections: S }; }
          if (o_.mode === 'look'){
            for (const [part, label] of [['wall', 'Walls'], ['roof', 'Roof'], ['trim', 'Woodwork'], ['base', 'Stonework'], ['floor', 'Floors']]) chips(label, MATS[part].map(([mk, l]) => ({ id: `bmat:${part}:${mk}`, label: l, swatchColor: swatchOf(mk), on: om[part] === mk })));
            chips('', [{ id: 'btimber', label: o.timber ? 'Timber framing: on' : 'Timber framing: off', on: !!o.timber }]);
            return { hint: 'Tap to change what it\'s made of.', sections: S };
          }
          chips('Add', [['tower', 'Tower'], ['chimney', 'Chimney'], ['awning', 'Awning'], ['sign', 'Sign'], ['remove', 'Take away']].map(([x, l]) => ({ id: 'bextra:' + x, label: l, on: o_.extra === x })));
          if (o_.extra === 'awning' || o_.extra === 'sign') chips('Colour', (o_.extra === 'sign' ? ['#173826', '#22305a', '#5a1a1a', '#5a3018', '#2a2a2a'] : AWNINGS).map((c) => ({ id: 'bcolor:' + c, swatchColor: c, label: '', on: o_.color === c })));
          if (o_.extra === 'tower') chips('Tower top', [['cone', 'Spire'], ['dome', 'Dome'], ['battlement', 'Battlements']].map(([r, l]) => ({ id: 'btroof:' + r, label: l, on: (o_.towerRoof || 'cone') === r })));
          return { hint: { tower: 'Tap a corner of the building for a round tower (tap it again to take it away).', chimney: 'Tap the roof where a chimney goes.', awning: 'Tap a ground-floor wall for an awning over it.', sign: 'Tap a wall to put a sign on it.', remove: 'Tap a tower, chimney, awning or sign to take it away.' }[o_.extra || 'tower'], sections: S };
        }
        const byTheme = {}; for (const [id, t] of Object.entries(TEMPLATES)) (byTheme[t.theme] = byTheme[t.theme] || []).push({ id: 'btpl:' + id, label: t.name, thumb: 'tpl:' + id, on: k === 'building' && o.tpl === id && !o.move });
        cards('Build', Object.values(byTheme).flat());
        const mine = (this.app.blueprints || []).filter((d) => d.kind === 'building');
        if (mine.length) cards('Your designs', mine.map((d) => ({ id: 'bbp:' + d.id, label: d.name, thumb: 'bp:' + d.id, on: k === 'building' && o.bp === d.id })).concat([{ id: 'designs', label: 'Manage designs' }]));
        if (k === 'building') chips('Turn', [{ id: 'rot:-6', label: '⟲ 90°' }, { id: 'rot:6', label: '90° ⟳' }]);
        return { hint: k === 'building' ? 'Tap where it goes. It turns in quarter turns and lines up with the paths.' : 'Choose a building, then tap where it goes. Tap a building with Select to change it.', sections: S };
      }
      case 'shops': {
        cards('Stalls', Object.entries(STALLS).map(([id, st]) => ({ id: 'stall:' + id, label: st.name, thumb: 'stall:' + id, on: k === 'stall' && o.kind === id && !o.bp })));
        cards('Seating', this.catItems('seating')); cards('Facilities', this.catItems('facilities'));
        const mine = (this.app.blueprints || []).filter((d) => d.kind === 'stall');
        if (mine.length) cards('Your designs', mine.map((d) => ({ id: 'sbp:' + d.id, label: d.name, thumb: 'bp:' + d.id, on: k === 'stall' && o.bp === d.id })).concat([{ id: 'designs', label: 'Manage designs' }]));
        if (k === 'place' && CATALOG[o.type] && CATALOG[o.type].colors) chips('Colour', CATALOG[o.type].colors.map((c) => ({ id: 'color:' + c, swatchColor: c, label: '', on: (o.color || CATALOG[o.type].colors[0]) === c })));
        if (k === 'stall' || k === 'place') chips('Turn', [{ id: 'rot:-1', label: '⟲ 15°' }, { id: 'rot:1', label: '15° ⟳' }]);
        return { hint: k === 'stall' ? 'Tap where it goes: on a plaza or beside a path. Tap it afterwards to name it, change its menu and its look.' : 'Stalls, seating and facilities. For a café, restaurant, shop or toilets, tap a building and choose what it\'s for.', sections: S };
      }
      case 'rides': {
        if (k === 'cedit'){
          const o = P.obj(o_.id), st = o && this.app.rides.stats(o); if (!o) return { hint: 'That ride has gone.', sections: [] };
          cards('Track', COASTER_PIECES.map((t) => ({ id: 'cpiece:' + t, label: PIECES[t].name, thumb: 'piece:' + t })));
          chips('', [{ id: 'cundo', label: 'Take a piece off' }, { id: 'cfinish', label: 'Finish', on: false }, { id: 'cclear', label: 'Clear' }, { id: 'cride', label: 'Ride it' }, { id: 'cdone', label: 'Done' }]);
          chips('Train', CARTS.map((c) => ({ id: 'ccart:' + c.id, label: c.name, on: o.cart === c.id })));
          chips('Colour', COLORS.map((c, i) => ({ id: 'ccolor:' + i, swatchColor: '#' + c.rail.toString(16).padStart(6, '0'), label: '', on: (o.color || 0) === i })));
          chips('Speed', SPEEDS.map((sp, i) => ({ id: 'cspeed:' + i, label: sp.name, on: (o.speed ?? 2) === i })));
          return { hint: st && st.complete ? `${o.name}: Fun ${st.fun} · Scary ${st.scary} · Queasy ${st.queasy} · ${Math.round(st.topSpeed * 2.237)} mph · ${Math.round(st.height)} m high` : `${o.pieces.length} pieces. Tap pieces to lay track from the arrow; Finish finds the way back to the station.`, sections: S };
        }
        if (k === 'redit'){
          const o = P.obj(o_.id); if (!o) return { hint: 'That ride has gone.', sections: [] };
          chips('Size', FLAT[o.kind].sizes.map((z) => ({ id: 'rsize:' + z, label: z + ' m', on: o.size === z })));
          if (o.kind === 'carousel'){ chips('Tiers', [1, 2].map((t) => ({ id: 'rtiers:' + t, label: t === 1 ? 'One' : 'Two', on: (o.tiers || 1) === t }))); chips('Ride on', MOUNTS.map(([m, l]) => ({ id: 'rmounts:' + m, label: l, on: o.mounts === m }))); }
          else { chips('Gondolas', [12, 16, 24, 32].map((g) => ({ id: 'rgond:' + g, label: String(g), on: o.gondolas === g }))); chips('Cars', [['cabin', 'Glazed cabins'], ['open', 'Open cars']].map(([c, l]) => ({ id: 'rcabin:' + c, label: l, on: o.cabin === c }))); chips('', [{ id: 'rlights', label: o.lights !== false ? 'Lights: on' : 'Lights: off', on: o.lights !== false }]); }
          chips('Colour', RIDE_COLORS.map((c) => ({ id: 'rcolor:' + c, swatchColor: c, label: '', on: o.color === c })));
          chips(o.kind === 'carousel' ? 'Canopy stripes' : 'Gondola colour', RIDE_COLORS.map((c) => ({ id: 'rcolor2:' + c, swatchColor: c, label: '', on: o.color2 === c })));
          chips('Speed', [[0, 'Gentle'], [1, 'Lively'], [2, 'Brisk']].map(([v, l]) => ({ id: 'rspeed:' + v, label: l, on: (o.speed ?? 1) === v })).concat([{ id: 'cride', label: 'Ride it' }, { id: 'rdone', label: 'Done' }]));
          const st = this.app.rides.stats(o);
          return { hint: st ? `${o.name}: Fun ${st.fun} · Scary ${Math.round(st.scary * 10) / 10} · Queasy ${st.queasy}` : '', sections: S };
        }
        cards('Coasters', [{ id: 'newcoaster', label: 'Coaster', thumb: 'ride:coaster', on: k === 'coaster' && !o.hang }, { id: 'newhang', label: 'Hanging coaster', thumb: 'ride:hang', on: k === 'coaster' && o.hang }]);
        cards('Rides', Object.entries(FLAT).map(([id, f]) => ({ id: 'newride:' + id, label: f.name, thumb: 'ride:' + id, on: k === 'ride' && o.kind === id })));
        if (k === 'coaster' || k === 'ride') chips('Turn', [{ id: 'rot:-6', label: '⟲ 90°' }, { id: 'rot:6', label: '90° ⟳' }]);
        return { hint: k === 'coaster' ? 'Tap where the station goes (the arrow shows which way the train leaves). Then lay the track.' : k === 'ride' ? 'Tap where it goes, beside a path.' : 'Build a ride, design it, name it, and ride it.', sections: S };
      }
      case 'park':
        cards('Build', [{ id: 'tool:lot', label: 'Car park', thumb: 'lot', on: k === 'lot' }, { id: 'roadtool', label: 'Road', swatch: 'tarmac' }, { id: 'selectgate', label: 'Entrance', thumb: 'gate' }]);
        chips('Your park', [{ id: 'renamepark', label: 'Rename the park' }, { id: 'menu', label: 'Menu' }]);
        return { hint: k === 'lot' ? 'Drag out a car park (at least 12 x 12 m). Put it by a road, with a path to the entrance.' : 'Car parks, roads and the entrance. Guests will drive in on the highway.', sections: S };
      case 'bulldoze':
        chips('Brush', SIZES.slice(0, 3).map(([s, l]) => ({ id: 'size:' + s, label: l, on: o.size === s })).concat([{ id: 'bpaths', label: o.paths === false ? 'Paths: keep' : 'Paths: remove', on: o.paths !== false }]));
        return { hint: 'Tap a thing to remove it, or drag over trees and paths. Undo puts them back.', sections: S };
    }
    return { sections: [] };
  }
  catItems(cat){
    const T = this.T;
    return Object.entries(CATALOG).filter(([, c]) => c.cat === cat).map(([id, c]) => ({ id: 'place:' + id, label: c.name, thumb: id, on: T.kind === 'place' && T.opts.type === id }));
  }
  // the panel: a dialog, or what's selected
  panel(){
    if (this.dialog) return this.dialog;
    const id = this.app.selected, o = id && this.P.obj(id);
    if (!o) return null;
    const lines = [], b = [];
    let title = objName(o);
    if (o.type === 'gate'){ title = this.P.s.name; lines.push('The park\'s entrance. Its name is across the arch.'); b.push({ id: 'renamepark', label: 'Rename the park' }); }
    if (o.type === 'lot'){ const g = this.app.objects.structs.get(o.id); lines.push(`Car park · ${o.w * 2} × ${o.d * 2} m · room for ${g ? g.userData.bays : '?'} cars`); b.push({ id: 'renameobj', label: 'Rename' }); }
    if (o.type === 'arch'){ const L = this.P.s.lands[(o.land || 1) - 1]; lines.push('Arch into ' + (L ? L.name : 'a land')); b.push({ id: 'archland', label: 'Change land' }); }
    if (o.type === 'sign'){ title = '“' + o.name + '”'; b.push({ id: 'renameobj', label: 'Change words' }); }
    if (o.type === 'building'){
      const bb = bBounds(o), w = (bb.i1 - bb.i0 + 1) * 2, d = (bb.j1 - bb.j0 + 1) * 2, n = o.floors.length;
      lines.push(`${n === 1 ? 'One storey' : n + ' storeys'} · ${w} × ${d} m · ${o.floors.reduce((a, f) => a + f.length, 0) * 4} m² of rooms`);
      const use = USES.find(([u]) => u === (o.use || '')), fit = (this.app.objects.structs.get(o.id) || { userData: {} }).userData.fit;
      if (o.use) lines.push(use[1] + (o.use === 'restaurant' ? ` · ${this.seatsAt(o)} seats` : o.use === 'toilets' && fit ? ` · ${fit.cubicles} cubicles` : o.use === 'firstaid' && fit ? ` · ${fit.beds} beds` : '') + (o.menu && ['food', 'restaurant', 'shop'].includes(o.use) ? ` · ${o.menu.length} things on the menu` : ''));
      b.push({ id: 'bedit', label: 'Edit', kind: 'primary' }, { id: 'buse', label: o.use ? 'Use: ' + use[1] : 'What is it for?' });
      if (['food', 'restaurant', 'shop'].includes(o.use)) b.push({ id: 'menuedit', label: 'Menu' });
      b.push({ id: 'renameobj', label: 'Rename' }, { id: 'brot:-1', label: '⟲ Turn' }, { id: 'brot:1', label: 'Turn ⟳' }, { id: 'bmove', label: 'Move' }, { id: 'savedesign', label: 'Save design' }, { id: 'objdel', label: 'Remove', kind: 'danger' });
      const land = this.P.landAt(...(() => { const g = this.app.objects.structs.get(o.id); return g ? [g.position.x, g.position.z] : [o.x, o.z]; })());
      if (land) lines.push('In ' + land.name);
      return { title, lines, buttons: b, close: 'deselect' };
    }
    if (o.type === 'coaster' || o.type === 'ride'){
      const st = this.app.rides.stats(o);
      if (st && st.complete) lines.push(`Fun ${st.fun} · Scary ${Math.round(st.scary * 10) / 10} · Queasy ${st.queasy}`, `Top speed ${Math.round(st.topSpeed * 2.237)} mph · ${Math.round(st.height)} m high` + (st.length ? ` · ${Math.round(st.length)} m of track` : '') + (st.inversions ? ` · ${st.inversions} upside down` : ''));
      else lines.push('The track isn\'t finished: tap Edit to lay it (Finish closes the loop).');
      if (o.open === false) lines.push('Closed');
      b.push({ id: 'cride', label: 'Ride it', kind: 'primary' }, { id: o.type === 'coaster' ? 'cedit' : 'redit', label: 'Edit' }, { id: 'ropen', label: o.open === false ? 'Open it' : 'Close it' }, { id: 'renameobj', label: 'Rename' });
      if (o.type === 'ride') b.push({ id: 'objrot:-1', label: '⟲ Turn' }, { id: 'objrot:1', label: 'Turn ⟳' }, { id: 'rmove', label: 'Move' });
      b.push({ id: 'objdel', label: 'Remove', kind: 'danger' });
      return { title, lines, buttons: b, close: 'deselect' };
    }
    if (o.type === 'stall'){
      lines.push(`${STALLS[o.kind].name} · ${(SELLS.find(([k]) => k === o.sells) || [0, ''])[1]} · ${(o.menu || []).length} things on the menu`);
      b.push({ id: 'menuedit', label: 'Menu', kind: 'primary' }, { id: 'stalldesign', label: 'Change its look' }, { id: 'renameobj', label: 'Rename' }, { id: 'objrot:-1', label: '⟲ Turn' }, { id: 'objrot:1', label: 'Turn ⟳' }, { id: 'objmove', label: 'Move' }, { id: 'savedesign', label: 'Save design' }, { id: 'objdel', label: 'Remove', kind: 'danger' });
      return { title, lines, buttons: b, close: 'deselect' };
    }
    const c = CATALOG[o.type];
    if (c && model(o.type).seats) lines.push(`Seats ${model(o.type).seats}`);
    if (c && c.colors){ for (const col of c.colors) b.push({ id: 'objcolor:' + col, swatchColor: col, label: '', on: o.color === col }); }
    if (o.type === 'sign') for (const col of ['#173826', '#22305a', '#5a1a1a', '#3a2a1a', '#2a2a2a']) b.push({ id: 'objcolor:' + col, swatchColor: col, label: '', on: o.color === col });
    if (!o.type.startsWith('fence_') && o.type !== 'lot') b.push({ id: 'objrot:-1', label: '⟲ Turn' }, { id: 'objrot:1', label: 'Turn ⟳' });
    if (!o.type.startsWith('fence_') && o.type !== 'lot') b.push({ id: 'objmove', label: 'Move' });
    if (o.type !== 'gate') b.push({ id: 'objdel', label: 'Remove', kind: 'danger' });
    const land = this.P.landAt(o.x, o.z);
    if (land && o.type !== 'arch') lines.push('In ' + land.name);
    return { title, lines, buttons: b, close: 'deselect' };
  }

  // --- actions ---------------------------------------------------------------------------------
  act(id){
    const A = this.app, T = this.T, P = this.P, [a, v] = id.split(/:(.*)/s);
    switch (a){
      case 'tab': this.tab = v; this.toolForTab(v); break;
      case 'surf': T.set('path', { ...T.opts, surface: +v, queue: +v === ROAD ? false : T.opts.queue }); break;
      case 'pw': T.set('path', { ...T.opts, width: +v }); break;
      case 'pmode': T.set('path', { ...T.opts, mode: v }); break;
      case 'queue': T.set('path', { ...T.opts, queue: !T.opts.queue, surface: T.opts.surface === ROAD ? 1 : T.opts.surface }); break;
      case 'place': T.set('place', { type: v, scatter: T.kind === 'place' && T.opts.scatter && CATALOG[v].cat === 'trees' }); break;
      case 'scatter': T.set('place', { ...T.opts, scatter: !T.opts.scatter }); break;
      case 'fence': T.set('fence', { type: v }); break;
      case 'color': T.opts.color = v; break;
      case 'rot': T.rot += (+v) * Math.PI / 12; if (T.last) T.hover(T.last); break;
      case 'tool': T.set(v, v === 'arch' ? { land: T.opts.land } : {}); break;
      case 'tmode': T.set('terrain', { ...T.defaults('terrain'), size: T.opts.size || 6, ground: T.opts.ground || 0, mode: v }); break;
      case 'wmode': T.set('water', { mode: v, size: T.opts.size || 6 }); break;
      case 'ground': T.opts.ground = +v; break;
      case 'size': T.opts.size = +v; break;
      case 'lmode': T.set('land', { ...T.opts, mode: v }); break;
      case 'land': T.set('land', { ...T.opts, land: +v, mode: 'paint' }); break;
      case 'newland': this.newLand(); break;
      case 'renameland': { const L = P.s.lands[T.opts.land - 1]; if (L) this.askName({ title: 'Name this land', value: L.name, suggest: () => landName(L.theme) }).then((n) => { if (!n) return; P.begin('Rename land'); P.setLands(P.s.lands.map((l, i) => i === T.opts.land - 1 ? { ...l, name: n } : l)); P.commit(); }); break; }
      case 'themeland': this.chooseTheme((th) => { P.begin('Land theme'); P.setLands(P.s.lands.map((l, i) => i === T.opts.land - 1 ? { ...l, theme: th } : l)); P.commit(); }); break;
      case 'delland': this.confirm('Remove ' + P.s.lands[T.opts.land - 1].name + '?', 'Its cells go back to no land, and its arches come down. (Undo puts it back.)', 'Remove', () => this.removeLand(T.opts.land)); break;
      case 'roadtool': this.tab = 'paths'; T.set('path', { surface: ROAD, width: 3, mode: 'brush', queue: false }); break;
      case 'selectgate': { const g = P.s.objects.find((o) => o.type === 'gate'); if (g){ this.tab = 'select'; T.set('select'); A.select(g.id); A.focus(g.x, g.z, 60); } break; }
      case 'renamepark': this.renamePark(); break;
      case 'bpaths': T.opts.paths = T.opts.paths === false; break;
      case 'deselect': A.select(null); break;
      case 'renameobj': { const o = P.obj(A.selected); if (o) this.askName({ title: o.type === 'sign' ? 'What should the sign say?' : 'Name this car park', value: o.name || '' }).then((n) => { if (!n) return; P.begin('Rename'); P.changeObject(o.id, { name: n }); P.commit(); }); break; }
      case 'objcolor': { const o = P.obj(A.selected); if (o){ P.begin('Colour'); P.changeObject(o.id, { color: v }); P.commit(); } break; }
      case 'objrot': { const o = P.obj(A.selected); if (o){ P.begin('Turn'); P.changeObject(o.id, { r: (o.r || 0) + (+v) * Math.PI / 12 }); P.commit(); } break; }
      case 'objmove': { const o = P.obj(A.selected); if (o){ if (o.type === 'gate' || o.type === 'arch' || o.type === 'sign') this.toast('Tap where it should go.'); T.rot = 0; T.set('move', { id: o.id }); } break; }
      case 'objdel': { const o = P.obj(A.selected); if (o && o.type !== 'gate'){ P.begin('Remove ' + objName(o).toLowerCase()); P.removeObject(o.id); P.commit(); A.select(null); this.toast('Removed. (Undo puts it back.)'); } break; }
      case 'archland': { const o = P.obj(A.selected); if (o && P.s.lands.length){ const n = (o.land % P.s.lands.length) + 1; P.begin('Arch land'); P.changeObject(o.id, { land: n }); P.commit(); } break; }
      case 'undo': { const l = P.undo(); this.toast(l ? 'Undid: ' + l : 'Nothing to undo.'); break; }
      case 'redo': { const l = P.redo(); this.toast(l ? 'Redid: ' + l : 'Nothing to redo.'); break; }
      case 'speed': A.setSpeed(+v); break;
      case 'walk': if (A.riding) A.stopRide(); else A.setMode(A.mode === 'walk' ? 'build' : 'walk'); break;
      case 'vr': if (v === 'life') A.vr.toggleLife(); else if (v === 'shift') A.vr.shift = !A.vr.shift; else A.startVR(); break;
      case 'menu': this.openMenu(); break;
      case 'dlg': { const d = this.dialog; this.dialog = null; if (d && d.on) d.on(v); break; }
      case 'key': this.keyPress(v); break;
      case 'btpl': this.tab = 'buildings'; T.rot = 0; T.set('building', { tpl: v }); A.select(null); break;
      case 'bedit': { const id = A.selected; if (!id) break; const o = P.obj(id); this.tab = 'buildings'; T.set('bedit', { id, mode: 'rooms', level: 0, style: 'window', extra: 'tower' }); A.select(null); const bb = bBounds(o), g = A.objects.structs.get(id); if (g){ const [cx, cz] = [g.position.x, g.position.z]; void cx; void cz; } A.focus(...A.buildingCentre(o), Math.max(30, (bb.i1 - bb.i0 + bb.j1 - bb.j0 + 2) * 5 + o.floors.length * STOREY)); break; }
      case 'bmode': T.set('bedit', { ...T.opts, mode: v }); break;
      case 'blevel': T.set('bedit', { ...T.opts, level: +v }); break;
      case 'baddstorey': T.B.addStorey(); T.set('bedit', { ...T.opts }); break;
      case 'bremstorey': T.B.removeStorey(); T.set('bedit', { ...T.opts }); break;
      case 'bstyle': T.opts.style = v; break;
      case 'broof': T.B.set({ roof: v }, 'Roof'); break;
      case 'bmat': { const [part, mk] = v.split(/:(.*)/s); const o = T.B.o; if (o) T.B.set({ m: { ...(o.m || {}), [part]: mk } }, 'Materials'); break; }
      case 'btimber': { const o = T.B.o; if (o) T.B.set({ timber: !o.timber }, 'Timber framing'); break; }
      case 'bextra': T.opts.extra = v; break;
      case 'bcolor': T.opts.color = v; break;
      case 'btroof': T.opts.towerRoof = v; break;
      case 'bdone': { const id = T.opts.id; T.set('select'); this.tab = 'select'; A.select(id); break; }
      case 'brot': { const o = P.obj(A.selected); if (!o) break; const n = A.rotateBuilding(o, +v); if (n) this.toast(n, 'bad'); break; }
      case 'stall': this.tab = 'shops'; T.rot = 0; T.set('stall', { kind: v, type: 'stall' }); A.select(null); break;
      case 'sbp': this.tab = 'shops'; T.rot = 0; T.set('stall', { bp: v, type: 'stall', kind: ((A.blueprints || []).find((d) => d.id === v) || { data: {} }).data.kind }); A.select(null); break;
      case 'bbp': this.tab = 'buildings'; T.rot = 0; T.set('building', { bp: v }); A.select(null); break;
      case 'buse': this.useDialog(); break;
      case 'menuedit': this.menuDialog(); break;
      case 'stalldesign': this.stallDialog(); break;
      case 'savedesign': this.saveDesign(); break;
      case 'designs': this.designsDialog(); break;
      case 'newcoaster': case 'newhang': this.tab = 'rides'; T.rot = 0; T.set('coaster', { hang: a === 'newhang' }); A.select(null); break;
      case 'newride': this.tab = 'rides'; T.rot = 0; T.set('ride', { kind: v }); A.select(null); break;
      case 'cedit': { const id = T.kind === 'cedit' ? T.opts.id : A.selected; const o = P.obj(id); if (!o) break; this.tab = 'rides'; T.set('cedit', { id }); A.select(null); const [fx, fz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][o.d]; A.focus(o.x + fx * 8, o.z + fz * 8, 90); break; }
      case 'redit': { const id = A.selected; const o = P.obj(id); if (!o) break; this.tab = 'rides'; T.set('redit', { id }); A.select(null); A.focus(o.x, o.z, o.size * 2.5 + 15); break; }
      case 'cpiece': T.R.addPiece(v); break;
      case 'cundo': T.R.undoPiece(); break;
      case 'cfinish': T.R.finish(); break;
      case 'cclear': this.confirm('Clear the track?', 'Every piece comes off (the station stays). Undo puts it back.', 'Clear', () => T.R.clear()); break;
      case 'cdone': case 'rdone': { const id = T.opts.id; T.set('select'); this.tab = 'select'; A.select(id); break; }
      case 'cride': { const o = P.obj(T.kind === 'cedit' || T.kind === 'redit' ? T.opts.id : A.selected); if (o) A.ride(o); break; }
      case 'ccart': case 'ccolor': case 'cspeed': case 'rsize': case 'rtiers': case 'rmounts': case 'rgond': case 'rcabin': case 'rcolor': case 'rcolor2': case 'rspeed': {
        const id = T.opts.id, f = { ccart: { cart: v }, ccolor: { color: +v }, cspeed: { speed: +v }, rsize: { size: +v }, rtiers: { tiers: +v }, rmounts: { mounts: v }, rgond: { gondolas: +v }, rcabin: { cabin: v }, rcolor: { color: v }, rcolor2: { color2: v }, rspeed: { speed: +v } }[a];
        if (a === 'rsize'){ const o = P.obj(id), why = T.R.problemAt(T.R.rideCells({ ...o, size: +v }), id); if (why){ this.toast(why, 'bad'); break; } }
        P.begin('Ride'); P.changeObject(id, f); P.commit(); break;
      }
      case 'rlights': { const o = P.obj(T.opts.id); if (o){ P.begin('Lights'); P.changeObject(o.id, { lights: o.lights === false }); P.commit(); } break; }
      case 'ropen': { const o = P.obj(A.selected); if (o){ P.begin(o.open === false ? 'Open' : 'Close'); P.changeObject(o.id, { open: o.open === false }); P.commit(); } break; }
      case 'rmove': { const o = P.obj(A.selected); if (o){ this.tab = 'rides'; T.rot = 0; T.set('ride', { kind: o.kind, move: o.id }); A.select(null); this.toast('Tap where it should go.'); } break; }
      case 'bmove': { const o = P.obj(A.selected); if (o){ this.tab = 'buildings'; T.rot = 0; T.set('building', { move: o.id }); A.select(null); this.toast('Tap where it should go.'); } break; }
    }
    this.refresh();
  }
  toolForTab(t){
    const T = this.T;
    if (t === 'select') T.set('select');
    else if (t === 'paths') T.set('path', T.kind === 'path' ? T.opts : {});
    else if (t === 'plants') T.set('place', { type: 'oak' });
    else if (t === 'decor') T.set('place', { type: 'lamp1' });
    else if (t === 'terrain') T.set('terrain', {});
    else if (t === 'lands') T.set('land', {});
    else if (t === 'park') T.set('lot', {});
    else if (t === 'buildings') T.set('building', { tpl: 'cottage' });
    else if (t === 'shops') T.set('stall', { kind: 'kiosk', type: 'stall' });
    else if (t === 'rides') T.set('select');
    else if (t === 'bulldoze') T.set('bulldoze', { size: 3 });
    this.app.select(null);
  }

  // seats in a restaurant: chairs inside it, or on a terrace within 8 m of it
  seatsAt(o){
    const cells = groundCells(o), P = this.P;
    let n = 0;
    for (const q of P.s.objects){ const c = CATALOG[q.type] && model(q.type); if (!c || !c.seats) continue; if (cells.some(([x, z]) => Math.abs(x - q.x) < 9 && Math.abs(z - q.z) < 9)) n += c.seats; }
    return n;
  }
  // what a building is for: its inside is fitted out to match (and food places and shops get a menu)
  useDialog(){
    const A = this.app, P = this.P, o = P.obj(A.selected); if (!o) return;
    this.dialog = { title: 'What is ' + o.name + ' for?', lines: ['Its inside is fitted out to match: counters and a menu board for food, shelves for a shop, cubicles and sinks for toilets, beds for first aid. Restaurants get their seats from tables you put in or around them (Shops → Seating).'],
      buttons: USES.map(([u, l]) => ({ id: 'dlg:' + (u || 'none'), label: l, on: (o.use || '') === u })).concat([{ id: 'dlg:cancel', label: 'Cancel' }]),
      on: (v) => {
        if (v === 'cancel') return;
        const use = v === 'none' ? null : v, f = { use };
        const theme = (P.landAt(...A.buildingCentre(o)) || {}).theme || 'main';
        if (['food', 'restaurant', 'shop'].includes(use) && (!o.menu || !o.menu.length || o.use !== use)) f.menu = defaultMenu(use);
        if (use && (o.name === TEMPLATES[o.tpl]?.name || o.name === 'Building' || !o.name)) f.name = use === 'shop' ? shopName() : use === 'toilets' ? 'Toilets' : use === 'firstaid' ? 'First Aid' : foodName(theme);
        P.begin('Use'); P.changeObject(o.id, f); P.commit();
        if (use) this.toast(f.name ? `It's ${f.name} now. Tap Rename to call it something else.` : 'Fitted out.', 'good');
      } };
  }
  // the menu: each thing it could sell, on or off, and its price
  menuDialog(){
    const A = this.app, P = this.P, id = A.selected, o = P.obj(id); if (!o) return;
    const use = o.type === 'stall' ? o.sells : o.use;
    const draw = () => {
      const cur = P.obj(id); if (!cur) return;
      const menu = cur.menu || [];
      this.dialog = { title: 'Menu: ' + cur.name, lines: [menu.length ? `${menu.length} things on the menu. Tap one to add or take it off; − and + change its price.` : 'Nothing on the menu yet: tap things to add them.'],
        rows: goodsFor(use).map((g) => { const m = menu.find((x) => x.id === g); return { buttons: [{ id: 'dlg:t-' + g, label: (m ? '✓ ' : '') + GOODS[g].name, on: !!m, wide: true }, { id: 'dlg:d-' + g, label: '−' }, { id: 'dlg:p-' + g, label: price(m ? m.price : GOODS[g].price), plain: true }, { id: 'dlg:u-' + g, label: '+' }] }; }),
        buttons: [{ id: 'dlg:done', label: 'Done', kind: 'primary' }],
        on: (v) => {
          if (v === 'done' || v === 'cancel') return;
          const [act, g] = [v[0], v.slice(2)], c = P.obj(id); if (!c || !GOODS[g]) return;
          const menu = (c.menu || []).map((x) => ({ ...x })), m = menu.find((x) => x.id === g);
          if (act === 't'){ if (m) menu.splice(menu.indexOf(m), 1); else menu.push({ id: g, price: GOODS[g].price }); }
          else if (act === 'd' || act === 'u'){ if (!m) menu.push({ id: g, price: Math.max(0.5, GOODS[g].price + (act === 'u' ? 0.5 : -0.5)) }); else m.price = Math.min(50, Math.max(0.5, m.price + (act === 'u' ? 0.5 : -0.5))); }
          else { draw(); return; }
          P.begin('Menu'); P.changeObject(id, { menu }); P.commit();
          draw();
        } };
    };
    draw();
  }
  // a stall's look: its shape, roof, paint, stripes and what it sells
  stallDialog(){
    const A = this.app, P = this.P, id = A.selected;
    const draw = () => {
      const o = P.obj(id); if (!o) return;
      this.dialog = { title: o.name, lines: ['Change its shape, roof and colours, and what it sells.'],
        rows: [
          { label: 'Shape', buttons: Object.entries(STALLS).map(([k, st]) => ({ id: 'dlg:k-' + k, label: st.name, on: o.kind === k })) },
          { label: 'Roof', buttons: STALL_ROOFS.map(([k, l]) => ({ id: 'dlg:r-' + k, label: l, on: o.roof === k })) },
          { label: 'Paint', buttons: STALL_COLORS.map((c) => ({ id: 'dlg:c-' + c, swatchColor: c, label: '', on: o.color === c })) },
          { label: 'Stripes', buttons: STALL_COLORS.map((c) => ({ id: 'dlg:s-' + c, swatchColor: c, label: '', on: o.color2 === c })) },
          { label: 'Sells', buttons: SELLS.map(([k, l]) => ({ id: 'dlg:e-' + k, label: l, on: o.sells === k })) },
        ],
        buttons: [{ id: 'dlg:done', label: 'Done', kind: 'primary' }],
        on: (v) => {
          if (v === 'done' || v === 'cancel') return;
          const a = v[0], val = v.slice(2), f = a === 'k' ? { kind: val } : a === 'r' ? { roof: val } : a === 'c' ? { color: val } : a === 's' ? { color2: val } : a === 'e' ? { sells: val, menu: defaultMenu(val) } : null;
          if (f){ P.begin('Stall'); P.changeObject(id, f); P.commit(); }
          draw();
        } };
    };
    draw();
  }
  // keep a copy of a building or stall in your designs (shared by all your parks)
  saveDesign(){
    const A = this.app, o = this.P.obj(A.selected); if (!o) return;
    this.askName({ title: 'Name this design', value: o.name }).then((n) => {
      if (!n) return;
      const data = JSON.parse(JSON.stringify(o)); delete data.id; delete data.x; delete data.z; delete data.r;
      A.addBlueprint({ name: n, kind: o.type === 'stall' ? 'stall' : 'building', data });
      this.toast(`Saved to your designs: build it again from the ${o.type === 'stall' ? 'Shops' : 'Buildings'} tab, in any of your parks.`, 'good');
    });
  }
  designsDialog(){
    const A = this.app, list = A.blueprints || [];
    this.dialog = { title: 'Your designs', lines: [list.length ? 'Designs are shared by all your parks. Remove the ones you don\'t want.' : 'No designs yet: tap a building or stall and choose Save design.'],
      rows: list.map((d) => ({ label: d.name, buttons: [{ id: 'dlg:x-' + d.id, label: 'Remove', kind: 'danger' }] })),
      buttons: [{ id: 'dlg:done', label: 'Done', kind: 'primary' }],
      on: (v) => { if (v.startsWith('x-')){ A.removeBlueprint(v.slice(2)); this.designsDialog(); } } };
  }

  // --- dialogs: same description on screen and in VR -----
  // a name: on screen a text box; in VR the tablet shows a keyboard
  askName({ title, value = '', suggest }){
    return new Promise((res) => {
      this.dialog = { title, input: value, suggest, lines: [], buttons: [], on: null, res };
      this.dialog.buttons = [suggest ? { id: 'dlg:suggest', label: 'Suggest a name' } : null, { id: 'dlg:cancel', label: 'Cancel' }, { id: 'dlg:ok', label: 'OK', kind: 'primary' }].filter(Boolean);
      const d = this.dialog;
      d.on = (v) => {
        if (v === 'suggest'){ d.input = suggest(); this.dialog = d; return; }
        if (v === 'ok'){ const n = (d.input || '').trim().slice(0, 40); if (!n){ this.dialog = d; this.toast('It needs a name.'); return; } res(n); return; }
        res(null);
      };
      this.refresh();
      setTimeout(() => { const i = this.el('dlg-input'); if (i && !this.app.inVR){ i.focus(); i.select(); } }, 50);
    });
  }
  keyPress(k){
    const d = this.dialog; if (!d || d.input === undefined) return;
    if (k === 'back') d.input = d.input.slice(0, -1); else if (k === 'space') d.input += ' '; else d.input = (d.input + k).slice(0, 40);
  }
  confirm(title, text, yes, fn){
    this.dialog = { title, lines: [text], buttons: [{ id: 'dlg:no', label: 'Cancel' }, { id: 'dlg:yes', label: yes, kind: 'danger' }], on: (v) => { if (v === 'yes') fn(); } };
  }
  chooseTheme(fn){
    this.dialog = { title: 'Choose a theme', lines: ['A land\'s theme sets the style of its arches and the names it suggests.'], buttons: Object.entries(THEMES).map(([k, t]) => ({ id: 'dlg:' + k, label: t.name, swatchColor: t.color })).concat([{ id: 'dlg:cancel', label: 'Cancel' }]), on: (v) => { if (THEMES[v]) fn(v); } };
  }
  newLand(){
    this.chooseTheme((th) => {
      this.askName({ title: 'Name your new land', value: landName(th), suggest: () => landName(th) }).then((n) => {
        if (!n) return;
        const P = this.P; P.begin('New land'); const id = P.addLand(th, n); P.commit();
        this.T.set('land', { ...this.T.opts, land: id, mode: 'paint' });
        this.toast(`Now paint where ${n} is.`);
      });
    });
  }
  removeLand(n){
    const P = this.P, S = P.s;
    P.begin('Remove land');
    for (let k = 0; k < S.zone.length; k++){ const v = S.zone[k]; if (v === n) P.setCell('zone', k % 300, (k / 300) | 0, 0); else if (v > n) P.setCell('zone', k % 300, (k / 300) | 0, v - 1); }
    for (const o of S.objects.slice()) if (o.type === 'arch'){ if (o.land === n) P.removeObject(o.id); else if (o.land > n) P.changeObject(o.id, { land: o.land - 1 }); }
    P.setLands(S.lands.filter((_, i) => i !== n - 1));
    P.commit();
    this.T.set('land', { ...this.T.opts, land: S.lands.length ? 1 : 0 });
  }
  renamePark(){
    this.askName({ title: 'Name your park', value: this.P.s.name, suggest: parkName }).then((n) => { if (!n) return; this.P.begin('Rename park'); this.P.setName(n); this.P.commit(); this.toast('Welcome to ' + n + '!'); });
  }
  openMenu(){
    const A = this.app;
    this.dialog = { title: this.P.s.name, lines: [LANDS[this.P.s.land].name + ' · ' + this.P.s.objects.length.toLocaleString() + ' things built'], buttons: [
      { id: 'dlg:resume', label: 'Back to the park', kind: 'primary' }, { id: 'dlg:rename', label: 'Rename the park' },
      { id: 'dlg:parks', label: 'Your parks' }, A.inVR ? null : { id: 'dlg:export', label: 'Save a copy as a file' },
      { id: 'dlg:turn', label: 'VR turning: ' + (A.settings.smoothTurn ? 'smooth' : 'snap') }, { id: 'dlg:help', label: 'How to play' }].filter(Boolean),
      on: (v) => {
        if (v === 'rename') this.renamePark();
        if (v === 'parks') A.toTitle(true);
        if (v === 'export') A.exportPark();
        if (v === 'turn'){ A.settings.smoothTurn = !A.settings.smoothTurn; A.saveSettings(); this.openMenu(); }
        if (v === 'help') this.help();
      } };
  }
  help(){
    this.dialog = { title: 'How to play', lines: [
      'Choose a tool along the bottom, then tap or drag on the park. Every change can be undone (↶).',
      'Paths: drag to lay them; over water they become bridges. Queue lines get rails. Roads are for cars.',
      'Lands: make a land (Castle Town, Pirate Harbour…), paint where it is, and put an arch with its name across the path into it.',
      'Tap anything with Select to name it, turn it, move it or remove it.',
      'Walk: stroll round your park in first person (left thumb to walk, drag to look).',
      'iPad: one finger draws or pans, two fingers pinch to zoom and twist to turn. Computer: right-drag turns, wheel zooms, WASD moves, Ctrl+Z undoes.',
      'VR: the park is a model on a table. Point and pull the trigger to build; squeeze both grips to move, turn and resize it; B stands you in the park at full size (and back).',
    ], buttons: [{ id: 'dlg:ok', label: 'Got it', kind: 'primary' }], on: () => {} };
  }
  toast(text, kind = ''){
    const t = { text, kind, until: performance.now() + 3500 };
    this.toasts.push(t); if (this.toasts.length > 3) this.toasts.shift();
    this.drawToasts(); this.vrDirty = true;
    setTimeout(() => { this.toasts = this.toasts.filter((x) => x !== t); this.drawToasts(); this.vrDirty = true; }, 3600);
  }

  // --- HTML -------------------------------------------------------------------------------------
  refresh(){ this.vrDirty = true; this.drawTabs(); this.drawTray(); this.drawPanel(); this.drawTop(); }
  set(id, html){ if (this.lastHtml[id] === html) return false; this.lastHtml[id] = html; this.el(id).innerHTML = html; return true; }
  drawTabs(){
    this.set('tabs', this.tabs().map((t) => `<button class="tab${t.on ? ' on' : ''}" data-act="${t.id}">${ICON[t.icon] || ''}<span>${t.label}</span></button>`).join(''));
  }
  drawTray(){
    const tr = this.tray(), A = this.app;
    const html = (tr.hint ? `<div class="hint">${esc(tr.hint)}</div>` : '') + tr.sections.map((s) => `<div class="sec ${s.kind}">${s.label ? `<h4>${esc(s.label)}</h4>` : ''}<div class="items">${s.items.map((it) => {
      if (s.kind === 'cards'){
        const img = it.thumb ? `<img src="${A.thumbs.get(it.thumb)}" alt="">` : it.swatch ? `<img src="${A.thumbs.swatch(it.swatch)}" alt="">` : it.swatchColor ? `<i class="sw" style="background:${it.swatchColor}"></i>` : '';
        return `<button class="card${it.on ? ' on' : ''}" data-act="${it.id}">${img}<b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`;
      }
      return `<button class="chip${it.on ? ' on' : ''}" data-act="${it.id}">${it.swatchColor ? `<i class="sw" style="background:${it.swatchColor}"></i>` : ''}${esc(it.label)}</button>`;
    }).join('')}</div></div>`).join('');
    if (this.set('tray', html)) this.el('tray').classList.toggle('empty', !tr.sections.length && !tr.hint);
  }
  drawPanel(){
    const p = this.panel(), el = this.el('panel');
    if (!p){ el.classList.remove('show'); this.set('panel', ''); return; }
    const modal = !!this.dialog;
    el.classList.toggle('show', true); el.classList.toggle('modal', modal);
    const input = p.input !== undefined ? `<input id="dlg-input" maxlength="40" value="${esc(p.input)}" autocomplete="off" spellcheck="false">` : '';
    const html = `<div class="pcard"><div class="phead"><h2>${esc(p.title)}</h2>${p.close ? `<button class="x" data-act="${p.close}" aria-label="Close">${ICON.close}</button>` : ''}</div>
      ${p.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${input}
      ${(p.rows || []).map((r) => `<div class="prow">${r.label ? `<span class="plabel">${esc(r.label)}</span>` : ''}${r.buttons.map((b) => `<button class="pb ${b.kind || ''}${b.on ? ' on' : ''}${b.wide ? ' wide' : ''}${b.plain ? ' plain' : ''}${b.swatchColor && !b.label ? ' swb' : ''}" data-act="${b.id}">${b.swatchColor ? `<i class="sw" style="background:${b.swatchColor}"></i>` : ''}${esc(b.label)}</button>`).join('')}</div>`).join('')}
      <div class="pbtns">${p.buttons.map((b) => `<button class="pb ${b.kind || ''}${b.on ? ' on' : ''}${b.swatchColor && !b.label ? ' swb' : ''}" data-act="${b.id}">${b.swatchColor ? `<i class="sw" style="background:${b.swatchColor}"></i>` : ''}${esc(b.label)}</button>`).join('')}</div></div>`;
    // (don't redraw over a text box being typed in)
    if (p.input !== undefined && this.el('dlg-input') && this.lastHtml.panelTitle === p.title){ const i = this.el('dlg-input'); if (i.value !== p.input && document.activeElement !== i) i.value = p.input; return; }
    this.lastHtml.panelTitle = p.title;
    this.set('panel', html);
    const i = this.el('dlg-input');
    if (i){ i.oninput = () => { if (this.dialog) this.dialog.input = i.value; this.vrDirty = true; }; i.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') this.act('dlg:ok'); if (e.key === 'Escape') this.act('dlg:cancel'); }; }
  }
  drawTop(){
    const A = this.app, P = this.P;
    this.set('t-name', esc(P.s.name));
    this.set('t-time', esc(A.clockText()));
    this.set('t-speed', [[0, 'pause'], [1, 'play'], [2, 'fast'], [4, 'faster']].map(([s, i]) => `<button class="ib${A.speed === s ? ' on' : ''}" data-act="speed:${s}" aria-label="speed ${s}">${ICON[i]}</button>`).join(''));
    this.el('b-undo').disabled = !P.canUndo; this.el('b-redo').disabled = !P.canRedo;
    this.set('b-walk', A.riding ? ICON.walk + '<span>Get off</span>' : ICON[A.mode === 'walk' ? 'build' : 'walk'] + `<span>${A.mode === 'walk' ? 'Build' : 'Walk'}</span>`);
    document.body.classList.toggle('walking', A.mode === 'walk');
  }
  drawToasts(){
    this.el('toasts').innerHTML = this.toasts.map((t) => `<div class="toast ${t.kind}">${esc(t.text)}</div>`).join('');
  }
  // one listener for every button with data-act
  wire(){
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      e.preventDefault(); this.act(b.dataset.act);
    });
  }
}
