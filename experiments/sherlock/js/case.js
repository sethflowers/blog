// The case file: what you've found out so far, what's left to do, the comparisons in your notebook, and
// what happens when you accuse someone. Built on a mystery from mystery.js; no three.js here.
import { PROF, PROFESSIONS, TRACE_KINDS, SOLES, PATTERNS, HEIGHTS, CAR_NAME, WEAPONS, DIFFICULTY, fitter, placeCar } from './mystery.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const first = (p) => p.name.split(' ')[0];
const placeName = (pl) => (pl.startsWith('cabin') ? 'cabin ' + pl.slice(5) : 'the ' + CAR_NAME[pl]);

export class Case {
  constructor(m, saved){
    this.m = m; this.D = DIFFICULTY[m.difficulty];
    this.P = m.people; this.victim = this.P[m.victim]; this.murderer = this.P[m.murderer];
    this.suspects = this.P.filter((p) => p !== this.victim);
    this.weapon = WEAPONS.find((w) => w.id === m.weapon);
    this.found = new Set(saved ? saved.found : []);
    this.crossed = new Set(saved ? saved.crossed : []);
    this.warnings = saved ? saved.warnings : this.D.warnings;
    this.time = saved ? saved.time : 0;
    this.stage = saved ? saved.stage : 'intro';      // intro → found (body) → done
    this.order = saved ? saved.order || [] : [];      // the order clues were found in (for the markers)
  }
  save(){ return { found: [...this.found], crossed: [...this.crossed], warnings: this.warnings, time: this.time, stage: this.stage, order: this.order }; }
  has(id){ return this.found.has(id); }
  learn(id){ if (this.found.has(id)) return false; this.found.add(id); this.order.push(id); return true; }
  get hasHair(){ return this.m.kinds.includes('hair'); }
  get hasFibre(){ return this.m.kinds.includes('fibre'); }

  // ---------- what things tell you ----------
  bodyText(){
    const V = this.victim;
    return `${V.name}, the ${PROF[V.prof].name.toLowerCase()}. Someone hit them on the head with something heavy, in the dark. Their pocket watch broke when they fell: it stopped at ${this.m.time}.`;
  }
  traceText(){
    const c = this.m.clues.trace, P = PROF[c.prof];
    if (c.show === 'exact') return `On ${first(this.victim)}'s coat there's ${P.trace}. That comes from the work of a ${P.name.toLowerCase()}!`;
    const could = PROFESSIONS.filter((q) => q.kind === c.kind).map((q) => `${q.trace} (${q.name.toLowerCase()}s)`);
    return `On ${first(this.victim)}'s coat there's ${TRACE_KINDS[c.kind]}. Under the magnifying glass it could be ${could.slice(0, -1).join(', ')} or ${could[could.length - 1]}.`;
  }
  hairText(){ return `Caught on ${first(this.victim)}'s collar: a ${this.m.clues.hair.colour} hair. It isn't theirs.`; }
  lookBody(){ const out = [this.traceText()]; if (this.hasHair) out.push(this.hairText()); return out.join('\n\n'); }
  noteText(){ return `In ${first(this.victim)}'s pocket, a crumpled note:\n"${this.m.victimNote.join(' ')}"`; }
  weaponText(){ return `${cap(this.weapon.name)}, lying on the floor. It belongs on ${this.weapon.from}.`; }
  printText(){
    const c = this.m.clues.print;
    if (c.show === 'full') return `A clear fingerprint! It's ${PATTERNS[c.pattern]}. Take everyone's fingerprints, then compare them in your notebook to find whose it is.`;
    return `Only part of a fingerprint, smudged. You can just see it's ${PATTERNS[c.pattern]}. Whose fingerprints have ${PATTERNS[c.pattern]}?`;
  }
  footText(){
    const c = this.m.clues.foot, where = `Footprints in the ${this.m.medium}, going towards the ${this.dirOfPrints()} of the train.`;
    if (c.show === 'both') return `${where} Size ${c.size}, made by ${SOLES[c.sole]}.`;
    if (c.show === 'size') return `${where} They're smudged: you can measure them (size ${c.size}) but you can't tell what kind of shoe made them.`;
    return `${where} They're smudged: you can see the pattern of ${SOLES[c.sole]}, but you can't measure them.`;
  }
  dirOfPrints(){ return this.m.clues.direction ? this.m.clues.direction.dir : (this.m.murderer % 2 ? 'front' : 'back'); }
  fibreText(){ return `A ${this.m.clues.fibre.colour} thread, caught on the door frame. It's been torn from someone's clothes as they hurried through.`; }
  doorPrinter(){ const h = this.m.herrings.find((x) => x.what === 'door'); return h ? this.P[h.who] : null; }
  glassPrinter(){ const h = this.m.herrings.find((x) => x.what === 'glass'); return h ? this.P[h.who] : null; }
  doorText(){ const p = this.doorPrinter(); return p ? `A clear fingerprint on the door handle, ${PATTERNS[p.pattern]}. Compare it in your notebook.` : 'Smudges all over the handle: lots of people have used this door today. Nothing clear.'; }
  glassText(){ const p = this.glassPrinter(); return p ? `Two sets of fingerprints on the glass: ${first(this.victim)}'s, and a clear one that's ${PATTERNS[p.pattern]}. Compare it in your notebook.` : `Only ${first(this.victim)}'s fingerprints. They had a drink before dinner.`; }
  cokeText(){ return `${this.m.cokePrints.length} different sets of fingerprints on the bottle. Lots of people had some Coke at dinner, so it doesn't prove anything. (It's very good Coke.)`; }

  // ---------- people ----------
  lookText(p){
    const A = p.avatar;
    return `${p.name}: ${PROF[p.prof].name.toLowerCase()}. ${cap(HEIGHTS[p.heightBand])} (${this.heightM(p)} m). ${cap(p.hair)} hair${p.photo ? '' : A === 4 || A === 6 ? ' (under a headscarf)' : ''}, ${p.coat} clothes. On their hands and clothes: ${PROF[p.prof].trace}.`;
  }
  heightM(p){ const base = p.female ? 1.66 : 1.78, k = { short: 0.94, medium: 1, tall: 1.07 }[p.heightBand]; return (base * k).toFixed(2); }
  shoeText(p){ return `${p.name.split(' ')[0]} wears ${SOLES[p.sole]}, size ${p.shoe}.`; }
  printOf(p){ return { pattern: p.pattern, seed: this.m.seed * 31 + p.i }; }
  // the weapon's print as you see it (the murderer's, maybe only part of it)
  weaponPrint(){ const c = this.m.clues.print; return { pattern: c.pattern, seed: this.m.seed * 31 + c.owner, part: c.show === 'full' ? 'full' : 'partial' }; }

  // ---------- your notebook's comparisons ----------
  printCompare(target = 'weapon'){
    const known = this.suspects.filter((p) => this.has(`p${p.i}-prints`));
    const c = this.m.clues.print, full = target !== 'weapon' || c.show === 'full';
    const owner = target === 'weapon' ? this.murderer : target === 'door' ? this.doorPrinter() : this.glassPrinter();
    return known.map((p) => ({ p, match: full ? p === owner : p.pattern === c.pattern, why: full ? (p === owner ? 'Every ridge matches!' : 'Different') : p.pattern === c.pattern ? `Also ${PATTERNS[p.pattern]}` : `${cap(PATTERNS[p.pattern])}: different` }));
  }
  shoeCompare(){
    const c = this.m.clues.foot;
    return this.suspects.filter((p) => this.has(`p${p.i}-shoes`)).map((p) => {
      const size = p.shoe === c.size, sole = p.sole === c.sole;
      const match = c.show === 'both' ? size && sole : c.show === 'size' ? size : sole;
      const why = c.show === 'both' ? `size ${p.shoe} ${size ? '✓' : '✗'}, ${SOLES[p.sole]} ${sole ? '✓' : '✗'}` : c.show === 'size' ? `size ${p.shoe} ${size ? '✓' : '✗'}` : `${SOLES[p.sole]} ${sole ? '✓' : '✗'}`;
      return { p, match, why };
    });
  }
  // the clues you've found, each with who fits it (as far as you know)
  clueList(){
    const out = [];
    const add = (id, title, text, extra = {}) => { if (this.has(id)) out.push({ id, title, text, ...extra }); };
    add('body', '⚰️ The body', this.bodyText());
    add('body-look', '🔍 On the body', this.lookBody());
    add('note', '📝 The note', this.noteText());
    add('weapon-print', '🖐 Fingerprint on the weapon', this.printText(), { print: this.weaponPrint() });
    add('foot', '👣 The footprints', this.footText(), { shoe: this.m.clues.foot });
    add('fibre', '🧵 A thread', this.fibreText());
    add('door', '🚪 The door handle', this.doorText(), this.doorPrinter() ? { print: { ...this.printOf(this.doorPrinter()), part: 'full' }, target: 'door' } : {});
    add('glass', '🥃 The glass', this.glassText(), this.glassPrinter() ? { print: { ...this.printOf(this.glassPrinter()), part: 'full' }, target: 'glass' } : {});
    add('coke', '🥤 The Coke', this.cokeText());
    add('conductor', '🎩 The conductor', this.m.conductorSays);
    return out;
  }
  // what you know about whether p could have done it: { out: [reasons they can't have], fits: [clues they fit] }
  reasons(p){
    const out = [], fits = [], m = this.m;
    // alibis
    if (p.with != null){ const o = this.P[p.with]; if (this.has(`p${p.i}-where`) && this.has(`p${o.i}-where`)) out.push(`was with ${first(o)} (they both say so)`); }
    if (m.confirmed.includes(p.i) && this.has('conductor')) out.push('the conductor heard them in their cabin');
    const F = (k) => fitter(k, m.clues)(p);
    if (this.has('weapon-print') && this.has(`p${p.i}-prints`)) (F('print') ? fits : out).push(F('print') ? 'fingerprint' : 'fingerprint doesn\'t match');
    if (this.has('foot') && this.has(`p${p.i}-shoes`)) (F('foot') ? fits : out).push(F('foot') ? 'footprints' : 'shoes don\'t match');
    if (this.has('body-look')) (F('trace') ? fits : out).push(F('trace') ? 'trace on the coat' : 'wrong kind of trace');
    if (this.hasHair && this.has('body-look') && this.has(`p${p.i}-look`)) (F('hair') ? fits : out).push(F('hair') ? 'hair colour' : 'wrong hair colour');
    if (this.hasFibre && this.has('fibre') && this.has(`p${p.i}-look`)) (F('fibre') ? fits : out).push(F('fibre') ? 'thread colour' : 'wrong colour clothes');
    if (m.kinds.includes('height') && m.heightWitness != null && this.has(`p${m.heightWitness}-heard`) && this.has(`p${p.i}-look`)) (F('height') ? fits : out).push(F('height') ? 'height' : 'wrong height');
    if (m.kinds.includes('direction') && m.dirWitness != null && this.has(`p${m.dirWitness}-heard`) && this.has(`p${p.i}-where`)) (F('direction') ? fits : out).push(F('direction') ? 'went that way' : 'was the other way');
    return { out, fits };
  }

  // ---------- the to-do list ----------
  jobs(){
    const J = [], m = this.m, n = (k) => this.suspects.filter((p) => this.has(`p${p.i}-${k}`)).length, S = this.suspects.length;
    if (!this.has('body')){ J.push({ id: 'go', text: `Go to the ${CAR_NAME[m.scene]}: something has happened!`, target: 'body' }); return J; }
    if (!this.has('body-look')) J.push({ id: 'body-look', text: 'Look closely at the body 🔍', target: 'body' });
    if (!this.has('note')) J.push({ id: 'note', text: 'Check the victim\'s pockets', target: 'body' });
    if (!this.has('weapon-print')) J.push({ id: 'weapon', text: `Dust the ${this.weapon.name.replace(/^an? /, '')} for fingerprints 🖌`, target: 'weapon' });
    if (!this.has('foot')) J.push({ id: 'foot', text: 'Measure the footprints 📏', target: 'foot' });
    if (this.hasFibre && !this.has('fibre')) J.push({ id: 'fibre', text: 'Search the scene for more clues', target: 'fibre' });
    const talked = this.suspects.filter((p) => this.has(`p${p.i}-where`) && this.has(`p${p.i}-heard`)).length;
    if (talked < S) J.push({ id: 'talk', text: `Question everyone (${talked}/${S}) 💬`, target: 'person' });
    if (n('prints') < S) J.push({ id: 'prints', text: `Take everyone's fingerprints (${n('prints')}/${S}) 🖐`, target: 'person' });
    if (n('shoes') < S) J.push({ id: 'shoes', text: `Check everyone's shoes (${n('shoes')}/${S}) 👟`, target: 'person' });
    if ((this.hasHair || this.hasFibre || m.kinds.includes('height')) && n('look') < S) J.push({ id: 'look', text: `Look carefully at everyone (${n('look')}/${S}) 👀`, target: 'person' });
    if (!this.has('conductor')) J.push({ id: 'conductor', text: 'Talk to the conductor 🎩', target: 'conductor' });
    J.push({ id: 'accuse', text: 'Work out who did it, then accuse them! 👉', target: 'accuse', last: true });
    return J;
  }
  progress(){ const all = this.jobs().filter((j) => !j.last).length; return all; }

  // ---------- accusing ----------
  accuse(i){
    const p = this.P[i];
    if (p === this.murderer) return { right: true };
    const why = this.whyNot(p);
    if (this.warnings > 0){ this.warnings--; return { right: false, warning: true, why }; }
    return { right: false, why };
  }
  whyNot(p){
    const m = this.m;
    if (p.with != null) return `${p.name} was with ${this.P[p.with].name} in ${placeName(p.place)} the whole time. They both said so.`;
    if (m.confirmed.includes(p.i)) return `The conductor heard ${p.name} in cabin ${p.cabin} during the blackout.`;
    for (const k of m.kinds){
      if (fitter(k, m.clues)(p)) continue;
      return {
        print: `${first(p)}'s fingerprints don't match the one on the ${this.weapon.name.replace(/^an? /, '')}.`,
        foot: `${first(p)}'s shoes don't match the footprints.`,
        trace: `The ${PROF[m.clues.trace.prof].trace} on the coat doesn't come from a ${PROF[p.prof].name.toLowerCase()}'s work.`,
        hair: `${first(p)}'s hair is ${p.hair}, not ${m.clues.hair.colour}.`,
        fibre: `${first(p)}'s clothes are ${p.coat}, not ${m.clues.fibre.colour}.`,
        direction: `The footsteps went towards the ${m.clues.direction ? m.clues.direction.dir : ''} of the train, but ${first(p)} was in ${placeName(p.place)}.`,
        height: `The figure in the lightning was ${HEIGHTS[m.clues.height.band]}. ${first(p)} is ${HEIGHTS[p.heightBand]}.`,
      }[k];
    }
    return `${p.name} didn't do it.`;
  }
  // how it really happened, and the clues that prove it
  solution(){
    const m = this.m, M = this.murderer, V = this.victim, lines = [];
    lines.push(`${M.name} said they were in ${placeName(M.place)}, on their own. But really they crept to the ${CAR_NAME[m.scene]} in the dark, and hit ${first(V)} with ${this.weapon.name}.`);
    const why = m.victimNote.find((t) => t.includes(M.name));
    if (why) lines.push(`Why? ${first(V)}'s note says it: "${why}"`);
    for (const k of m.kinds){
      const t = {
        print: m.clues.print.show === 'full' ? `The fingerprint on the ${this.weapon.name.replace(/^an? /, '')} was ${first(M)}'s.` : `The fingerprint on the ${this.weapon.name.replace(/^an? /, '')} was ${PATTERNS[M.pattern]}, like ${first(M)}'s.`,
        foot: `The footprints matched ${first(M)}'s ${SOLES[M.sole]} (size ${M.shoe}).`,
        trace: `The ${PROF[M.prof].trace} on ${first(V)}'s coat came from ${first(M)}, the ${PROF[M.prof].name.toLowerCase()}.`,
        hair: `The ${M.hair} hair on ${first(V)}'s collar was ${first(M)}'s.`,
        fibre: `The ${M.coat} thread on the door frame came from ${first(M)}'s clothes.`,
        direction: `The footsteps hurried towards the ${m.clues.direction ? m.clues.direction.dir : ''} of the train, where ${first(M)} said they'd been.`,
        height: `The figure in the lightning was ${HEIGHTS[M.heightBand]}, like ${first(M)}.`,
      }[k];
      if (t) lines.push(t);
    }
    const clear = [];
    for (const [a, b] of m.pairs) clear.push(`${first(this.P[a])} and ${first(this.P[b])} were together, so neither of them could have done it.`);
    for (const i of m.confirmed) clear.push(`The conductor heard ${first(this.P[i])} in their cabin.`);
    return { lines, clear };
  }
  rank(right){
    if (!right) return 'Case not solved';
    const t = this.time / 60, d = this.m.difficulty;
    const used = this.D.warnings - this.warnings;
    if (used) return 'Junior Detective';
    if (d === 'hard') return t < 25 ? 'Sherlock!' : 'Chief Inspector';
    if (d === 'medium') return t < 15 ? 'Chief Inspector' : 'Inspector';
    return t < 10 ? 'Inspector' : 'Detective';
  }
}
export { placeName, first, placeCar };
