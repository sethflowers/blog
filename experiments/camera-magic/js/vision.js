// What the camera sees: Google's MediaPipe models, run on this device (nothing is uploaded).
// Each model is loaded the first time a mode needs it (with a "Loading the hand tracker…" note), and
// each runs only while the current mode wants it, at its own rate, so an iPad isn't asked to run
// everything at once.
//
// Results are in picture coordinates (0..1 across and down), and kept in `R`:
//   R.objects  [{ label, score, box: {x,y,w,h} }]
//   R.hands    [{ pts: [21 × {x,y,z}], side: 'Left'|'Right' }]
//   R.face     { pts: [478 × {x,y,z}], blend: { jawOpen: 0.7, ... } } or null
//   R.pose     { pts: [33 × {x,y,z,visibility}] } or null
//   R.mask     { data: Float32Array, w, h } (how sure each pixel is a person) or null
import { ObjectDetector, HandLandmarker, FaceLandmarker, PoseLandmarker, ImageSegmenter } from '/experiments/camera-magic/lib/mediapipe/vision_bundle.mjs';

const V = document.body.dataset.version || '0';
const BASE = '/experiments/camera-magic/';
// the vision library's own files, under versioned addresses so the offline copy matches the page
const FILESET = { wasmLoaderPath: BASE + 'lib/mediapipe/vision_wasm_internal.js?v=' + V,
                  wasmBinaryPath: BASE + 'lib/mediapipe/vision_wasm_internal.wasm?v=' + V };

export const MODELS = {
  objects: { name: 'the object spotter', cls: ObjectDetector, file: 'efficientdet_lite0.tflite', every: 110,
    opts: { scoreThreshold: 0.35, maxResults: 8 } },
  hands: { name: 'the hand tracker', cls: HandLandmarker, file: 'hand_landmarker.task', every: 0,
    opts: { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 } },
  face: { name: 'the face tracker', cls: FaceLandmarker, file: 'face_landmarker.task', every: 0,
    opts: { numFaces: 1, outputFaceBlendshapes: true } },
  pose: { name: 'the body tracker', cls: PoseLandmarker, file: 'pose_landmarker_lite.task', every: 30,
    opts: { numPoses: 1 } },
  segment: { name: 'the cut-out tool', cls: ImageSegmenter, file: 'selfie_segmenter.tflite', every: 30,
    opts: { outputConfidenceMasks: true, outputCategoryMask: false } },
};

export const R = { objects: [], hands: [], face: null, pose: null, mask: null, at: {} };
export const timing = {};          // model -> milliseconds the last run took
export const status = {};          // model -> 'loading' | 'ready' | 'failed'
// GPU first; falls back to the CPU if the GPU can't run it (add ?cpu to the address to use the CPU only)
export const opts = { delegate: /[?&]cpu\b/.test(location.search) ? 'CPU' : 'GPU' };
const tasks = {}, loading = {}, lastRun = {}, lastStamp = {};
let lastSource = null;

// the segmenter looks at a small copy of the picture: much quicker, and the mask is smoothed anyway
const small = document.createElement('canvas');

export function isReady(name){ return status[name] === 'ready'; }

export function load(name, onState){
  if (tasks[name]) return Promise.resolve(tasks[name]);
  if (loading[name]) return loading[name];
  const m = MODELS[name];
  status[name] = 'loading'; onState && onState(name, 'loading');
  const make = (delegate) => m.cls.createFromOptions(FILESET, {
    baseOptions: { modelAssetPath: BASE + 'models/' + m.file + '?v=' + V, delegate },
    runningMode: 'VIDEO', ...m.opts });
  loading[name] = (async () => {
    let t;
    try { t = await make(opts.delegate); }
    catch (e) {
      if (opts.delegate === 'CPU') throw e;
      console.warn('[camera-magic] ' + name + ' on the GPU failed, using the CPU', e);
      t = await make('CPU');
    }
    tasks[name] = t; status[name] = 'ready'; onState && onState(name, 'ready');
    return t;
  })().catch((e) => {
    status[name] = 'failed'; loading[name] = null; onState && onState(name, 'failed', e);
    console.warn('[camera-magic] could not load ' + name, e);
    return null;
  });
  return loading[name];
}

// every model's timestamps must keep going up, even when the picture changes
function stamp(name, now){
  const t = Math.max(Math.round(now), (lastStamp[name] || 0) + 1);
  lastStamp[name] = t;
  return t;
}

// run the models in `want` (a Set of names) on the source, each at its own rate.
// At most one slow model (objects, segment) per frame so the picture stays smooth.
export function run(want, source, w, h, now){
  if (!source || !w || !h) return;
  if (source !== lastSource){ lastSource = source; R.objects = []; R.hands = []; R.face = null; R.pose = null; R.mask = null; }
  for (const name of Object.keys(MODELS)){
    if (!want.has(name)){ clear(name); continue; }
    const t = tasks[name];
    if (!t) continue;
    if (now - (lastRun[name] || 0) < MODELS[name].every) continue;
    lastRun[name] = now;
    const t0 = performance.now();
    try { runOne(name, t, source, w, h, stamp(name, now)); }
    catch (e) { console.warn('[camera-magic] ' + name + ' failed on this frame', e); }
    timing[name] = performance.now() - t0;
    R.at[name] = now;
  }
}

function clear(name){
  if (name === 'objects') R.objects = [];
  else if (name === 'hands') R.hands = [];
  else if (name === 'face') R.face = null;
  else if (name === 'pose') R.pose = null;
  else if (name === 'segment') R.mask = null;
}

function runOne(name, t, src, w, h, ts){
  if (name === 'objects'){
    const r = t.detectForVideo(src, ts);
    R.objects = (r.detections || []).map((d) => {
      const c = d.categories[0] || {}, b = d.boundingBox || {};
      return { label: c.categoryName || '?', score: c.score || 0,
        box: { x: b.originX / w, y: b.originY / h, w: b.width / w, h: b.height / h } };
    });
  } else if (name === 'hands'){
    const r = t.detectForVideo(src, ts);
    R.hands = (r.landmarks || []).map((pts, i) => ({ pts, side: ((r.handedness || r.handednesses || [])[i] || [{}])[0].categoryName || '' }));
  } else if (name === 'face'){
    const r = t.detectForVideo(src, ts);
    if (r.faceLandmarks && r.faceLandmarks.length){
      const blend = {};
      for (const c of ((r.faceBlendshapes || [])[0] || {}).categories || []) blend[c.categoryName] = c.score;
      R.face = { pts: r.faceLandmarks[0], blend };
    } else R.face = null;
  } else if (name === 'pose'){
    const r = t.detectForVideo(src, ts);
    R.pose = r.landmarks && r.landmarks.length ? { pts: r.landmarks[0] } : null;
  } else if (name === 'segment'){
    const sw = 256, sh = Math.max(1, Math.round(256 * h / w));
    if (small.width !== sw || small.height !== sh){ small.width = sw; small.height = sh; }
    small.getContext('2d').drawImage(src, 0, 0, sw, sh);
    const r = t.segmentForVideo(small, ts);
    const m = r && r.confidenceMasks && r.confidenceMasks[r.confidenceMasks.length - 1];
    if (m){
      const data = m.getAsFloat32Array();
      if (!R.mask || R.mask.w !== m.width || R.mask.h !== m.height) R.mask = { data: new Float32Array(data.length), w: m.width, h: m.height };
      R.mask.data.set(data);
    }
    r && r.close && r.close();
  }
}

// ---- helpers the modes share ----
export const HAND_LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
export const POSE_LINKS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32],[27,31],[28,32],[15,17],[15,19],[17,19],[16,18],[16,20],[18,20],[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10]];
export const TIPS = [4, 8, 12, 16, 20];
