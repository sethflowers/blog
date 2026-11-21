// Saving: parks live in IndexedDB (a big park would not fit in the 5 MB of localStorage that every
// game on this site shares). One record per park (typed arrays are stored as they are), and a list
// of parks (name, mode, a small picture, when last played) for the title screen.
const DB = 'fantasy-theme-park', VER = 1;
let dbp = null;
function db(){
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('parks')) d.createObjectStore('parks'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn){
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function listParks(){
  const l = await tx('meta', 'readonly', (s) => req(s.get('parks')));
  return (l || []).sort((a, b) => (b.played || 0) - (a.played || 0));
}
async function setList(list){ await tx('meta', 'readwrite', (s) => { s.put(list, 'parks'); }); }
export async function loadPark(id){ return tx('parks', 'readonly', (s) => req(s.get(id))); }
// save a park and its entry in the list (picture: a small JPEG data URL, or keep the old one)
export async function savePark(state, picture){
  const list = await listParks();
  let e = list.find((p) => p.id === state.id);
  if (!e){ e = { id: state.id }; list.push(e); }
  Object.assign(e, { name: state.name, mode: state.mode, land: state.land, played: Date.now(), objects: state.objects.length, lands: state.lands.length });
  if (picture) e.picture = picture;
  await tx('parks', 'readwrite', (s) => { s.put(state, state.id); });
  await setList(list);
}
export async function deletePark(id){
  await tx('parks', 'readwrite', (s) => { s.delete(id); });
  await setList((await listParks()).filter((p) => p.id !== id));
}
export async function renameInList(id, name){
  const list = await listParks(); const e = list.find((p) => p.id === id); if (e){ e.name = name; await setList(list); }
}
export async function getPref(key){ return tx('meta', 'readonly', (s) => req(s.get('pref:' + key))); }
export async function setPref(key, v){ return tx('meta', 'readwrite', (s) => { s.put(v, 'pref:' + key); }); }

// export / import a park as a file: typed arrays become base64 so it's plain JSON
const TYPED = { heights: Float32Array, paint: Uint8Array, water: Float32Array, path: Uint8Array, pflags: Uint8Array, zone: Uint8Array };
export function exportPark(state){
  const out = { ...state, format: 'fantasy-theme-park' };
  for (const k of Object.keys(TYPED)) out[k] = b64(new Uint8Array(state[k].buffer, state[k].byteOffset, state[k].byteLength));
  return JSON.stringify(out);
}
export function importPark(text){
  const o = JSON.parse(text);
  if (o.format !== 'fantasy-theme-park') throw new Error('That file is not a Fantasy Theme Park park.');
  for (const [k, T] of Object.entries(TYPED)){ const bytes = unb64(o[k]); o[k] = new T(bytes.buffer, 0, bytes.byteLength / T.BYTES_PER_ELEMENT); }
  delete o.format;
  return o;
}
function b64(u8){ let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s){ const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
