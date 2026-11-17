/* =========================================================================
   Interface : chargement des données, liste des exercices, affichage
   synchronisé (accords, grattage, groupe), progression, ajout via IA.
   Textes de l'interface : js/i18n.js — contenu traduit : data/i18n/
   ========================================================================= */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
const instName = id => { const k = 'inst.' + id; return t(k) === k ? id : t(k); };

const DIMENSIONS = [
  { id: 'rythme', icon: '🥁' }, { id: 'accords', icon: '✋' }, { id: 'tempo', icon: '⏱️' },
  { id: 'ecoute', icon: '👂' }, { id: 'melodie', icon: '🎵' }, { id: 'picking', icon: '🤌' }
].map(d => ({ ...d, label: t('dim.' + d.id), hint: t('dim.' + d.id + '.hint') }));

/* ---------- stockage local (protégé) ---------- */
const Store = {
  get(k, def) { try { const v = localStorage.getItem('lu.' + k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('lu.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }
};

/* ---------- base de données en mémoire ---------- */
const DB = { chords: {}, styles: {}, packs: [], exercises: {}, loadErrors: [] };

function mergeBundle(b, source) {
  if (!b || typeof b !== 'object') return;
  Object.assign(DB.chords, b.chords || {});
  const styles = Array.isArray(b.styles) ? b.styles : Object.values(b.styles || {});
  styles.forEach(s => { if (s && s.id) DB.styles[s.id] = { ...s, source }; });
  const packs = [...(b.packs || [])];
  if (b.pack) packs.push(b.pack);
  if (Array.isArray(b.exercises) && b.exercises.length) {
    packs.push({ id: 'mes-ajouts', title: t('pack.mine'), description: t('pack.mineDesc'), exercises: b.exercises });
  }
  for (const p of packs) {
    let pack = DB.packs.find(x => x.id === p.id);
    if (!pack) { pack = { ...p, exercises: [], source }; DB.packs.push(pack); }
    for (const ex of p.exercises || []) {
      if (!ex.id) continue;
      if (DB.exercises[ex.id]) pack.exercises = pack.exercises.filter(e => e.id !== ex.id);
      const e = { ...ex, pack: pack.id, source };
      DB.exercises[ex.id] = e;
      pack.exercises.push(e);
    }
  }
  DB.packs.forEach(p => p.exercises = p.exercises.filter(e => DB.exercises[e.id] === e));
}

/** Traduction du contenu : remplace titres, descriptions, conseils… par id */
function applyOverlay(o) {
  for (const [id, f] of Object.entries(o.packs || {})) { const p = DB.packs.find(x => x.id === id); if (p) Object.assign(p, f); }
  for (const [id, f] of Object.entries(o.exercises || {})) if (DB.exercises[id]) Object.assign(DB.exercises[id], f);
  for (const [id, f] of Object.entries(o.styles || {})) if (DB.styles[id]) Object.assign(DB.styles[id], f);
}

async function loadData() {
  try {
    const man = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json();
    for (const f of man.files) {
      try {
        const r = await fetch('data/' + f, { cache: 'no-cache' });
        if (!r.ok) throw new Error(r.status);
        mergeBundle(await r.json(), f);
      } catch (e) { DB.loadErrors.push(`${f} : ${e.message}`); }
    }
    for (const f of (man.i18n && man.i18n[LANG]) || []) {
      try { applyOverlay(await (await fetch('data/' + f, { cache: 'no-cache' })).json()); }
      catch (e) { console.warn('i18n', f, e); }
    }
  } catch (e) {
    DB.loadErrors.push(location.protocol === 'file:' ? t('load.file') : t('load.manifest', { msg: e.message }));
  }
  for (const imp of Store.get('imports', [])) mergeBundle(imp.bundle, 'import:' + imp.id);
}

/* ---------- progression ---------- */
let progress = Store.get('progress', {});
const prog = id => progress[id] || (progress[id] = { best: 0, loops: 0, seconds: 0, mastered: false });
const saveProgress = () => Store.set('progress', progress);

/* ---------- diagrammes d'accords (SVG) ---------- */
function chordSVG(name, small, riffNotes) {
  const frets = DB.chords[name];
  const w = small ? 64 : 96;
  if (!frets) return `<div class="nodiag" style="width:${w}px">?</div>`;
  const f = frets.split('').map(c => (c === 'x' || c === 'X') ? -1 : parseInt(c, 36));
  const played = f.filter(n => n > 0);
  const max = played.length ? Math.max(...played) : 0;
  const base = max > 4 ? Math.min(...played) : 1;
  const xs = [14, 30, 46, 62], y0 = 20, fh = 18, rows = 4;
  let s = `<svg class="diag" viewBox="0 0 76 116" width="${w}" role="img" aria-label="${esc(t('chord.aria', { name, frets }))}">`;
  s += base === 1 ? `<rect x="13" y="${y0 - 3}" width="50" height="4" class="nut"/>` : `<text x="70" y="${y0 + 12}" class="fr">${base}</text>`;
  for (let r = 0; r <= rows; r++) s += `<line x1="14" x2="62" y1="${y0 + r * fh}" y2="${y0 + r * fh}" class="fret"/>`;
  xs.forEach(x => s += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + rows * fh}" class="str"/>`);
  f.forEach((n, i) => {
    if (n === -1) s += `<text x="${xs[i]}" y="13" class="mute">×</text>`;
    else if (n === 0) s += `<circle cx="${xs[i]}" cy="10" r="4" class="open"/>`;
    else s += `<circle cx="${xs[i]}" cy="${y0 + (n - base + 0.5) * fh}" r="6.5" class="dot"/>`;
  });
  // notes du riff de la mesure (anneaux) : on voit où elles tombent par rapport à l'accord
  (riffNotes || []).forEach(({ i, n }) => {
    if (n === 0) s += `<circle cx="${xs[i]}" cy="10" r="5.5" class="rnote"/>`;
    else if (n >= base && n < base + rows) s += `<circle cx="${xs[i]}" cy="${y0 + (n - base + 0.5) * fh}" r="8" class="rnote"/>`;
  });
  ['G', 'C', 'E', 'A'].forEach((l, i) => s += `<text x="${xs[i]}" y="112" class="sl">${l}</text>`);
  return s + '</svg>';
}

/* ---------- libellés de comptage ---------- */
function countLabels(len, beats) {
  const per = len / beats;
  const subs = per === 1 ? [''] : [2, 3, 4].includes(per) ? t('count.subs' + per).split(',') : null;
  const out = [];
  for (let i = 0; i < len; i++) {
    const b = Math.floor(i / per), k = i % per;
    out.push(k === 0 ? String(b + 1) : (subs ? subs[k] : '·'));
  }
  return out;
}
const STRUM_GLYPH = { D: '↓', d: '↓', U: '↑', u: '↑', X: '✕', x: '✕', P: 'P', p: 'p', F: 'F', f: 'f', G: 'G', g: 'g', C: 'C', c: 'c', E: 'E', e: 'e', A: 'A', a: 'a', B: 'G+A', b: 'g+a', R: '⇊', r: '⇊', '.': '', '-': '–' };
const STRUM_NAME = Object.fromEntries('DdUuXxPpFfGgCcEeAaBbRr'.split('').map(c => [c, t('strum.' + c)]));

/* ======================================================================
   Liste des exercices
   ====================================================================== */
let filter = Store.get('filter', 'all');
let currentId = null;

function renderFilters() {
  const el = $('#filters');
  const chips = [{ id: 'all', label: t('dim.all'), icon: '✨' }, ...DIMENSIONS];
  el.innerHTML = chips.map(d => `<button class="chip ${filter === d.id ? 'on' : ''}" data-f="${d.id}" title="${esc(d.hint || '')}">${d.icon} ${esc(d.label)}</button>`).join('');
  el.onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    filter = b.dataset.f; Store.set('filter', filter); renderFilters(); renderList();
  };
}

function exMatches(ex) {
  return filter === 'all' || (ex.focus || []).some(f => norm(f) === filter);
}

function renderList() {
  const el = $('#packs');
  el.innerHTML = DB.loadErrors.length ? `<div class="alert">${DB.loadErrors.map(esc).join('<br>')}</div>` : '';
  for (const pack of DB.packs) {
    const exs = [...pack.exercises].sort((a, b) => (a.level || 1) - (b.level || 1)).filter(exMatches);
    if (!exs.length) continue;
    const done = pack.exercises.filter(e => prog(e.id).mastered).length;
    const sec = document.createElement('section');
    sec.className = 'pack';
    sec.innerHTML = `<h3>${esc(pack.title)} <small>${done}/${pack.exercises.length}</small></h3>
      ${pack.description ? `<p class="muted">${esc(pack.description)}</p>` : ''}
      <ul>${exs.map(ex => {
        const p = prog(ex.id), tg = ex.tempo?.target;
        return `<li><button class="ex ${ex.id === currentId ? 'cur' : ''} ${p.mastered ? 'ok' : ''}" data-id="${esc(ex.id)}">
          <span class="lvl" title="${esc(t('ex.levelTitle', { n: ex.level || 1 }))}">${'●'.repeat(ex.level || 1)}</span>
          <span class="t">${esc(ex.title)}</span>
          <span class="meta">${(ex.focus || []).map(f => DIMENSIONS.find(d => d.id === norm(f))?.icon || '').join('')}
            ${p.best ? `<b>${p.best}</b>${tg ? '/' + tg : ''} bpm` : ''} ${p.mastered ? '✅' : ''}</span>
        </button></li>`;
      }).join('')}</ul>`;
    el.appendChild(sec);
  }
  el.onclick = e => { const b = e.target.closest('.ex'); if (b) selectExercise(b.dataset.id); };
}

/* ======================================================================
   Exercice courant
   ====================================================================== */
let C = null;        // ce qui est joué (l'exercice entier, ou une seule mesure)
let FULL = null;     // l'exercice entier compilé
const ui = { lastBar: null, lastChord: null, cells: null, focus: null };

function selectExercise(id) {
  const ex = DB.exercises[id];
  if (!ex) return;
  try { C = FULL = compileExercise(ex, DB); }
  catch (e) { alert(t('ex.loadError', { msg: e.message })); return; }
  ui.focus = null;
  currentId = id;
  Store.set('current', id);
  Player.load(C);
  const o = ex.options || {};
  Object.assign(Player.opts, {
    guide: o.guide || 'on', silence: !!o.silence, ramp: o.ramp !== false,
    click: o.click !== undefined ? !!o.click : Player.opts.click
  });
  syncOptionInputs();
  ui.lastChord = null;
  $('#chordNext').dataset.chord = '';
  renderHeader(); renderTempoInputs(); renderLoop(); renderLanes(0, 0); renderChords(0); renderList();
  $('#practice').classList.remove('empty');
  $('#mTitle').textContent = ex.title;
  document.body.classList.remove('drawer');
  if (window.innerWidth < 900) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderHeader() {
  const ex = C.ex, st = C.style;
  const dims = (ex.focus || []).map(f => DIMENSIONS.find(d => d.id === norm(f))).filter(Boolean);
  $('#exHeader').innerHTML = `
    <div class="exTitle">
      <h2>${esc(ex.title)}</h2>
      <div class="tags">
        <span class="tag style">${esc(st.name)}${st.origin ? ' · ' + esc(st.origin) : ''}</span>
        <span class="tag">${esc(t('ex.level', { n: ex.level || 1 }))}</span>
        ${dims.map(d => `<span class="tag dim">${d.icon} ${esc(d.label)}</span>`).join('')}
        ${C.melody ? `<span class="tag mel">${esc(t('ex.melodyTag', { inst: instName(C.melody.inst) }))}</span>` : ''}
      </div>
    </div>
    ${ex.description ? `<p>${esc(ex.description)}</p>` : ''}
    ${ex.goal ? `<p class="goal">🎯 <b>${t('ex.goal')}</b> ${esc(ex.goal)}</p>` : ''}
    ${C.warnings.length ? `<div class="alert small">${C.warnings.map(esc).join('<br>')}</div>` : ''}`;
  const tips = ex.tips || [];
  $('#tips').innerHTML = `
    ${tips.length ? `<h4>${t('ex.tips')}</h4><ul>${tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${st.description ? `<h4>${esc(t('ex.about', { name: st.name }))}</h4><p>${esc(st.description)}</p>` : ''}
    ${legendHTML()}`;
}

function legendHTML() {
  const used = new Set((C.strum || []).flat());
  const items = [...used].filter(c => STRUM_NAME[c]).map(c => `<span><b>${STRUM_GLYPH[c]}</b> ${esc(STRUM_NAME[c])}</span>`);
  if (C.riff) items.push(`<span><b>A3</b> ${esc(t('ex.legendRiff'))}</span>`);
  if (C.melody) items.push(`<span><b>E5</b> ${esc(t('ex.legendMelody'))}</span>`);
  return items.length ? `<h4>${t('ex.legend')}</h4><p class="legend">${items.join('')}</p>` : '';
}

function renderTempoInputs() {
  const tp = C.tempo;
  $('#tStart').value = tp.start; $('#tTarget').value = tp.target;
  $('#tStep').value = tp.step; $('#tEvery').value = tp.every;
  updateBpm(Player.bpm);
  updateRecord();
}
function updateRecord() {
  const p = prog(C.ex.id);
  $('#record').innerHTML = p.best
    ? t('rec.line', { best: p.best, target: C.tempo.target, ok: p.mastered ? '✅' : '', loops: p.loops, min: Math.round(p.seconds / 60) })
    : esc(t('rec.none', { target: C.tempo.target }));
}

/** Dessine la mesure courante : comptage, grattage, riff, pistes du groupe */
function renderLanes(s, g) {
  const loopBar = Math.floor(s / C.spb);
  const bar = Math.floor(g / C.spb);
  ui.lastBar = bar + ':' + loopBar;
  const rows = [];
  const mainLen = C.strum ? barOf(C.strum, s, C.spb).length : C.riff ? barOf(C.riff, s, C.spb).length : C.beats * 2;
  const labels = countLabels(mainLen, C.beats);
  rows.push({ key: 'count', name: t('grid.count'), cells: labels.map((l, i) => ({ html: esc(l), cls: i % (mainLen / C.beats) === 0 ? 'beat' : 'sub' })) });
  if (C.strum) {
    rows.push({ key: 'strum', name: t('grid.strum'), main: true,
      cells: barOf(C.strum, s, C.spb).map(c => ({ html: STRUM_GLYPH[c] ?? esc(c), cls: 'st-' + (c === '.' ? 'rest' : c.toLowerCase()) + (c !== '.' && c === c.toLowerCase() ? ' light' : ''), title: STRUM_NAME[c] || '' })) });
  }
  if (C.riff) {
    rows.push({ key: 'riff', name: t('grid.riff'), main: true,
      cells: barOf(C.riff, s, C.spb).map(tk => ({ html: tk === '.' ? '' : esc(tk), cls: tk === '.' ? 'st-rest' : 'riff s-' + tk[0].toUpperCase() })) });
  }
  const band = [];
  if (C.melody) {
    band.push({ key: 'melody', name: '🎼 ' + instName(C.melody.inst), band: true, mel: true, muted: Player.muted.has('melody'),
      cells: barOf(C.melody.bars, s, C.spb).map(tk => ({ html: tk === '.' || tk === '-' ? '' : esc(tk), cls: tk === '.' ? 'off' : tk === '-' ? 'mel hold' : 'mel' })) });
  }
  for (const [name, pat] of Object.entries(C.tracks)) {
    band.push({ key: name, name, band: true, muted: Player.muted.has(name),
      cells: barOf(pat, g, C.spb).map(c => ({ html: c === '.' ? '' : esc(c), cls: c === '.' ? 'off' : 'hit' + (c !== c.toLowerCase() && isNaN(c) ? ' acc' : '') })) });
  }
  const html = r => `<div class="row ${r.main ? 'main' : ''} ${r.mel ? 'melrow' : ''} ${r.band ? 'band' : ''} ${r.muted ? 'muted' : ''}" data-key="${r.key}">
      <div class="lbl" ${r.band ? `title="${esc(t('grid.muteTitle'))}" data-mute="${r.key}"` : ''}>${esc(r.name)}${r.band && r.muted ? ' 🔇' : ''}</div>
      <div class="cells${r.cells.length > 16 ? ' dense' : ''}" style="--n:${r.cells.length}">${r.cells.map(c => `<div class="cell ${c.cls}" ${c.title ? `title="${esc(c.title)}"` : ''}>${c.html}</div>`).join('')}</div>
    </div>`;
  $('#grid').innerHTML = rows.map(html).join('');
  $('#band').innerHTML = band.map(html).join('');
  renderForm(loopBar);
  markLoopBar(ui.focus ?? loopBar);
  ui.cells = [...document.querySelectorAll('#grid .row, #band .row')].map(r => ({ key: r.dataset.key, cells: [...r.querySelectorAll('.cell')] }));
}

/** Structure du morceau : où suis-je, que vient-il ensuite ? */
function renderForm(loopBar) {
  const info = $('#barInfo'), form = $('#form');
  if (ui.focus != null) { info.innerHTML = '🔁 ' + esc(t('loop.focusInfo', { n: ui.focus + 1, total: FULL.bars })); form.innerHTML = ''; return; }
  if (!C.sections) { info.textContent = t('grid.bar', { n: loopBar + 1, total: C.bars }); form.innerHTML = ''; return; }
  const i = C.sections.findIndex(sc => loopBar >= sc.start && loopBar < sc.start + sc.bars);
  const cur = C.sections[Math.max(0, i)], nxt = C.sections[(i + 1) % C.sections.length];
  const left = cur.start + cur.bars - loopBar;
  info.innerHTML = `<b>${esc(cur.name)}</b> · ${esc(t('grid.sectionBar', { n: loopBar - cur.start + 1, total: cur.bars }))}` +
    (C.sections.length > 1 ? ` <span class="muted">— ${left === 1
      ? '<b class="soonTxt">' + esc(t('grid.nextSectionSoon', { name: nxt.name })) + '</b>'
      : esc(t('grid.nextSectionIn', { name: nxt.name, n: left }))}</span>` : '');
  // les noms de section viennent du contenu (traduits par data/i18n)
  form.innerHTML = C.sections.map((sc, k) => `<span class="sec ${k === i ? 'on' : ''}" style="flex:${sc.bars}">${esc(sc.name)}<small>${esc(t('grid.barsShort', { n: sc.bars }))}</small></span>`).join('');
}

/* ---------- toute la boucle : vue d'ensemble et mesure isolée ---------- */
function barChords(F, k) {
  const out = [];
  for (let s = k * F.spb; s < (k + 1) * F.spb; s++) {
    const c = F.chordAt[s];
    if (!out.length || out[out.length - 1].chord !== c) out.push({ chord: c, steps: 0 });
    out[out.length - 1].steps++;
  }
  return out;
}

/** Tablature d'une mesure de riff : corde de La en haut, comme sur une tablature imprimée */
function tabHTML(bar) {
  return `<div class="tab">${['A', 'E', 'C', 'G'].map(st => `<div class="tabline s-${st}" style="--n:${bar.length}"><i>${st}</i>${bar.map(tk => {
    const m = /^([GCEA])(\d{1,2})$/i.exec(tk);
    return `<span>${m && m[1].toUpperCase() === st ? m[2] : ''}</span>`;
  }).join('')}</div>`).join('')}</div>`;
}
function miniStrum(bar) {
  return `<div class="mini" style="--n:${bar.length}">${bar.map(c => `<span class="st-${c === '.' ? 'rest' : c.toLowerCase()}">${STRUM_GLYPH[c] ?? esc(c)}</span>`).join('')}</div>`;
}

function renderLoop() {
  const box = $('#loopBox'), F = FULL;
  if (!F || F.bars < 2 || !(F.riff || F.strum)) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('#loopBars').innerHTML = Array.from({ length: F.bars }, (_, k) => {
    const chords = barChords(F, k).map(c => esc(c.chord)).join(' → ');
    const body = F.riff ? tabHTML(barOf(F.riff, k * F.spb, F.spb)) : miniStrum(barOf(F.strum, k * F.spb, F.spb));
    return `<button class="lbar ${ui.focus === k ? 'focus' : ''}" data-bar="${k}" title="${esc(t('loop.focusTitle', { n: k + 1 }))}">
      <span class="lhead"><b>${k + 1}</b> ${chords}</span>${body}</button>`;
  }).join('');
  $('#loopBack').classList.toggle('hidden', ui.focus == null);
}
function markLoopBar(k) {
  document.querySelectorAll('#loopBars .lbar').forEach((b, i) => b.classList.toggle('on', i === k));
}

/** Travailler une seule mesure en boucle (k = null : revenir à l'exercice entier) */
function focusBar(k) {
  const F = FULL;
  if (!F) return;
  const bpm = Player.bpm, was = Player.playing, muted = new Set(Player.muted);
  if (k == null || k === ui.focus) { ui.focus = null; C = F; }
  else {
    const bar = p => barOf(p, k * F.spb, F.spb);
    const ex = {
      ...F.ex, sections: undefined,
      chords: barChords(F, k).map(c => `${c.chord}:${c.steps / F.sub}`).join(' '),
      strum: F.strum ? bar(F.strum).join('') : undefined,
      riff: F.riff ? bar(F.riff).join(' ') : undefined,
      melody: F.melody ? { instrument: F.melody.inst, notes: bar(F.melody.bars).join(' ') } : undefined
    };
    try { C = compileExercise(ex, DB); } catch { return; }
    // une mesure = une boucle très courte : on accélère au même rythme que sur l'exercice entier
    C.tempo = { ...F.tempo, every: F.tempo.every * F.bars };
    ui.focus = k;
  }
  Player.load(C);
  Player.muted.clear(); muted.forEach(m => Player.muted.add(m));
  Player.setBpm(bpm);
  ui.lastChord = null; $('#chordNext').dataset.chord = '';
  renderLoop(); renderLanes(0, 0); renderChords(0);
  if (was) Player.start();
}

function highlight(s, g, silent) {
  for (const r of ui.cells) {
    let idx;
    if (r.key === 'strum') idx = cellIndex(C.strum, s, C.spb);
    else if (r.key === 'riff') idx = cellIndex(C.riff, s, C.spb);
    else if (r.key === 'melody') idx = cellIndex(C.melody.bars, s, C.spb);
    else if (r.key === 'count') idx = Math.floor((s % C.spb) * r.cells.length / C.spb);
    else idx = cellIndex(C.tracks[r.key], g, C.spb);
    r.cells.forEach((c, i) => c.classList.toggle('now', i === idx && !silent));
  }
}

function nextChange(s) {
  const cur = C.chordAt[s];
  for (let k = 1; k < C.loopSteps; k++) {
    const j = (s + k) % C.loopSteps;
    if (C.chordAt[j] !== cur) return { chord: C.chordAt[j], beats: Math.ceil(k / C.sub), steps: k };
  }
  return null;
}

function renderChords(s) {
  const cur = C.chordAt[s];
  const nx = nextChange(s);
  let riffNotes = null, key = cur;
  if (C.riff) {
    const seen = new Set();
    riffNotes = barOf(C.riff, s, C.spb).map(tk => /^([GCEA])(\d{1,2})$/i.exec(tk)).filter(Boolean)
      .map(m => ({ i: 'GCEA'.indexOf(m[1].toUpperCase()), n: +m[2] }))
      .filter(r => { const k = r.i + ':' + r.n; return !seen.has(k) && seen.add(k); });
    key += '|' + Math.floor(s / C.spb);
  }
  if (key !== ui.lastChord) {
    $('#chordNow').innerHTML = `<div class="cname">${esc(cur)}</div>${chordSVG(cur, false, riffNotes)}${riffNotes ? `<div class="rlegend">${esc(t('chord.riffLegend'))}</div>` : ''}`;
    ui.lastChord = key;
    $('#chordNow').classList.remove('pop'); void $('#chordNow').offsetWidth; $('#chordNow').classList.add('pop');
  }
  const el = $('#chordNext');
  if (!nx) { el.innerHTML = `<div class="muted small">${esc(t('chord.single'))}</div>`; el.dataset.chord = ''; el.classList.remove('soon'); return; }
  if (el.dataset.chord !== nx.chord) { el.innerHTML = `<div class="nlabel">${esc(t('chord.next'))}</div><div class="cname sm">${esc(nx.chord)}</div>${chordSVG(nx.chord, true)}<div class="countdown"></div>`; el.dataset.chord = nx.chord; }
  $('.countdown', el).textContent = nx.beats <= 1 ? t('chord.now') : t('chord.inBeats', { n: nx.beats });
  el.classList.toggle('soon', nx.beats <= 1);
}

function renderBeatDots(pos, countIn) {
  for (const el of [$('#beats'), $('#mBeats')]) {
    if (el.children.length !== C.beats || el.dataset.acc !== String(C.accents)) {
      el.innerHTML = Array.from({ length: C.beats }, (_, i) => `<span class="${C.accents?.includes(i + 1) ? 'acc' : ''}">${i + 1}</span>`).join('');
      el.dataset.acc = String(C.accents);
      el.classList.toggle('many', C.beats > 6);
    }
    const beat = Math.floor(pos / C.sub);
    [...el.children].forEach((d, i) => { d.classList.toggle('on', i === beat); d.classList.toggle('one', i === 0 && beat === 0); d.classList.toggle('ci', !!countIn); });
  }
}

/* ---------- boucle d'animation ---------- */
let lastTick = performance.now();
function frame(now) {
  const evs = Player.drain();
  for (const ev of evs) {
    if (ev.g < 0) {
      if (ev.countIn != null) {
        $('#status').innerHTML = `<span class="big">${ev.countIn}</span> ${esc(t('status.countIn'))}`;
        renderBeatDots((ev.g + C.spb), true);
      }
      continue;
    }
    const key = Math.floor(ev.g / C.spb) + ':' + Math.floor(ev.s / C.spb);
    if (key !== ui.lastBar) renderLanes(ev.s, ev.g);
    highlight(ev.s, ev.g, ev.silent);
    if (ev.pos % C.sub === 0) { renderBeatDots(ev.pos); renderChords(ev.s); }
    $('#practice').classList.toggle('silent', !!ev.silent);
    $('#status').innerHTML = ev.silent
      ? t('status.silent')
      : esc(t('status.loop', { n: ev.loopIdx + 1 })) + (ev.guide ? '' : t('status.guideOff'));
  }
  if (Player.playing && currentId) prog(currentId).seconds += (now - lastTick) / 1000;
  lastTick = now;
  requestAnimationFrame(frame);
}

/* ---------- transport et réglages ---------- */
function updateBpm(v) {
  $('#bpm').textContent = v;
  $('#mBpm').textContent = v;
  if (C) {
    const pct = Math.max(0, Math.min(100, (v - C.tempo.start) / Math.max(1, C.tempo.target - C.tempo.start) * 100));
    $('#tempoBar').style.width = pct + '%';
  }
}

function syncOptionInputs() {
  const o = Player.opts;
  $('#optCount').checked = o.countIn; $('#optClick').checked = o.click;
  $('#optGuide').value = o.guide; $('#optSilence').checked = o.silence; $('#optRamp').checked = o.ramp;
}

function togglePlay() {
  if (!C) return;
  if (Player.playing) Player.stop(); else Player.start();
}

function flash(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(flash.t); flash.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function readyText() { return t(isMobile() ? 'status.readyMobile' : 'status.ready'); }

function bindControls() {
  const slower = () => Player.setBpm(Player.bpm - 2), faster = () => Player.setBpm(Player.bpm + 2);
  $('#play').onclick = togglePlay;
  $('#minus').onclick = slower;
  $('#plus').onclick = faster;
  $('#tooFast').onclick = () => { Player.tooFast(); flash(t('flash.tooFast')); };
  $('#restart').onclick = () => { if (!C) return; Player.stop(); Player.setBpm(C.tempo.start); };

  // barre de transport mobile + tiroir des exercices
  $('#mPlay').onclick = togglePlay;
  $('#mMinus').onclick = slower;
  $('#mPlus').onclick = faster;
  $('#mTooFast').onclick = () => $('#tooFast').click();
  $('#btnList').onclick = () => document.body.classList.toggle('drawer');
  $('#drawerClose').onclick = () => document.body.classList.remove('drawer');
  $('#backdrop').onclick = () => document.body.classList.remove('drawer');
  $('#exHeader').onclick = e => { if (e.target.closest('p')) $('#exHeader').classList.toggle('full'); };
  $('#langBtn').textContent = LANG === 'fr' ? 'EN' : 'FR';
  $('#langBtn').onclick = () => { saveProgress(); setLang(LANG === 'fr' ? 'en' : 'fr'); };
  if (isMobile()) $('#settingsBox').open = false;
  $('#status').textContent = readyText();

  const tIn = () => {
    if (!C) return;
    const tp = FULL.tempo;
    tp.start = +$('#tStart').value || tp.start;
    tp.target = +$('#tTarget').value || tp.target;
    tp.step = Math.max(1, +$('#tStep').value || 1);
    tp.every = Math.max(1, +$('#tEvery').value || 1);
    if (C !== FULL) Object.assign(C.tempo, tp, { every: tp.every * FULL.bars });
    if (!Player.playing) Player.setBpm(C.tempo.start);
    updateRecord();
  };
  ['#tStart', '#tTarget', '#tStep', '#tEvery'].forEach(s => $(s).onchange = tIn);
  $('#optCount').onchange = e => Player.opts.countIn = e.target.checked;
  $('#optClick').onchange = e => Player.opts.click = e.target.checked;
  $('#optGuide').onchange = e => Player.opts.guide = e.target.value;
  $('#optSilence').onchange = e => Player.opts.silence = e.target.checked;
  $('#optRamp').onchange = e => Player.opts.ramp = e.target.checked;
  const vols = Object.assign({ group: 0.8, guide: 0.8, click: 0.6, melody: 0.8 }, Store.get('vols', {}));
  for (const k of ['group', 'guide', 'click', 'melody']) {
    const el = $('#vol-' + k); el.value = vols[k];
    Engine.setVolume(k, +vols[k]);
    el.oninput = () => { vols[k] = +el.value; Engine.setVolume(k, vols[k]); Store.set('vols', vols); };
  }
  $('#loopBars').onclick = e => { const b = e.target.closest('[data-bar]'); if (b) focusBar(+b.dataset.bar); };
  $('#loopBack').onclick = () => focusBar(null);
  $('#band').onclick = e => {
    const l = e.target.closest('[data-mute]'); if (!l) return;
    const k = l.dataset.mute;
    Player.muted.has(k) ? Player.muted.delete(k) : Player.muted.add(k);
    ui.lastBar = null; if (!Player.playing) renderLanes(0, 0);
  };
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select') || $('#aiDialog').open) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); faster(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); slower(); }
    else if (e.key === 't' || e.key === 'T') $('#tooFast').click();
    else if (e.key === 'Escape') document.body.classList.remove('drawer');
  });

  Player.on('bpm', updateBpm);
  Player.on('state', playing => {
    $('#play').textContent = t(playing ? 'btn.stop' : 'btn.play');
    $('#play').classList.toggle('on', playing);
    $('#mPlay').textContent = playing ? '■' : '▶';
    $('#mPlay').classList.toggle('on', playing);
    if (playing) {
      // la lecture repart du début : afficher la 1re mesure dès le décompte
      renderLanes(0, 0); renderChords(0);
    } else {
      $('#status').textContent = readyText();
      $('#practice').classList.remove('silent');
      ui.cells && ui.cells.forEach(r => r.cells.forEach(c => c.classList.remove('now')));
      saveProgress(); renderList();
    }
  });
  Player.on('loop', ({ bpm, clean }) => {
    if (ui.focus != null) return; // une mesure isolée ne compte pas pour la maîtrise de l'exercice
    const p = prog(currentId);
    p.loops++;
    if (clean && bpm > p.best) p.best = bpm;
    if (clean && bpm >= C.tempo.target && !p.mastered) {
      p.mastered = true;
      setTimeout(() => flash(t('flash.mastered')), 150);
    }
    saveProgress(); updateRecord();
  });
  Player.on('ramp', bpm => setTimeout(() => flash(t('flash.ramp', { bpm })), 120));
  window.addEventListener('beforeunload', saveProgress);
}

/* ======================================================================
   Ajouter du contenu avec une IA
   ====================================================================== */
let promptTemplate = '';

async function openAI() {
  if (!promptTemplate) {
    try { promptTemplate = await (await fetch(t('ai.promptFile'), { cache: 'no-cache' })).text(); }
    catch { promptTemplate = '(' + t('ai.promptFile') + ' ?)\n\n{{EXISTANT}}\n\n{{DEMANDE}}'; }
  }
  renderImports();
  $('#aiResult').innerHTML = '';
  $('#aiDialog').showModal();
}

function existingSummary() {
  const st = Object.values(DB.styles).map(s => t('sum.style', {
    id: s.id, name: s.name, beats: s.beats || 4, sub: s.subdivision || 4,
    cells: (s.beats || 4) * (s.subdivision || 4), tracks: Object.keys(s.tracks || {}).join(', ')
  })).join('\n');
  const ch = Object.entries(DB.chords).map(([k, v]) => `${k}=${v}`).join(', ');
  const exs = Object.values(DB.exercises).map(e => t('sum.ex', { id: e.id, level: e.level || 1, style: e.style, title: e.title })).join('\n');
  const done = Object.values(DB.exercises).filter(e => prog(e.id).best)
    .map(e => t('sum.rec', { title: e.title, best: prog(e.id).best, ok: prog(e.id).mastered ? t('sum.ok') : '' })).join('\n');
  return `${t('sum.styles')}:\n${st}\n\n${t('sum.chords')}:\n${ch}\n\n${t('sum.exercises')}:\n${exs}\n\n${t('sum.progress')}:\n${done || t('sum.noRecord')}`;
}

function buildPrompt() {
  const wish = $('#aiWish').value.trim() || t('ai.defaultWish');
  return promptTemplate.replace('{{EXISTANT}}', existingSummary()).replace('{{DEMANDE}}', wish);
}

function extractJSON(text) {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1];
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error(t('ai.noJson'));
  return JSON.parse(s.slice(a, b + 1));
}

/** Vérifie un bundle sans l'importer : renvoie erreurs et avertissements */
function validateBundle(b) {
  const errors = [], warnings = [];
  const tmp = { chords: { ...DB.chords, ...(b.chords || {}) }, styles: { ...DB.styles } };
  for (const [k, v] of Object.entries(b.chords || {})) {
    if (!/^[0-9a-cxX]{4}$/.test(v)) errors.push(t('val.chord', { k, v }));
  }
  const styles = Array.isArray(b.styles) ? b.styles : Object.values(b.styles || {});
  for (const s of styles) {
    if (!s.id) { errors.push(t('val.styleId')); continue; }
    tmp.styles[s.id] = s;
    for (const k of Object.keys(s.tracks || {})) {
      if (!(k in Engine.INSTRUMENTS)) errors.push(t('val.inst', { id: s.id, k, list: Object.keys(Engine.INSTRUMENTS).join(', ') }));
    }
  }
  const exs = [...(b.exercises || [])];
  [...(b.packs || []), ...(b.pack ? [b.pack] : [])].forEach(p => {
    if (!p.id || !p.title) errors.push(t('val.pack'));
    exs.push(...(p.exercises || []));
  });
  if (!exs.length && !styles.length && !Object.keys(b.chords || {}).length) errors.push(t('val.empty'));
  for (const ex of exs) {
    if (!ex.id || !ex.title) { errors.push(t('val.exId')); continue; }
    if (!tmp.styles[ex.style]) { errors.push(t('val.style', { id: ex.id, style: ex.style })); continue; }
    if (!ex.strum && !ex.riff) warnings.push(t('val.noStrum', { id: ex.id }));
    if (ex.strum && /[^DdUuXxPpFfGgCcEeAaBbRr.\-|\s]/.test(ex.strum)) errors.push(t('val.badStrum', { id: ex.id, strum: ex.strum }));
    try {
      const c = compileExercise(ex, tmp);
      c.warnings.forEach(w => warnings.push(`${ex.id} : ${w}`));
    } catch (e) { errors.push(`${ex.id} : ${e.message}`); }
    if (DB.exercises[ex.id]) warnings.push(t('val.exists', { id: ex.id }));
  }
  return { errors, warnings, count: exs.length, styles: styles.length };
}

function importFromText() {
  const out = $('#aiResult');
  let b;
  try { b = extractJSON($('#aiPaste').value); }
  catch (e) { out.innerHTML = `<div class="alert">${t('ai.badJson', { msg: esc(e.message) })}</div>`; return; }
  const v = validateBundle(b);
  if (v.errors.length) {
    out.innerHTML = `<div class="alert"><b>${t('ai.toFix')}</b><br>${v.errors.map(esc).join('<br>')}</div>
      <p class="small">${t('ai.fixHint')}</p>`;
    return;
  }
  const imports = Store.get('imports', []);
  const id = (b.packs?.[0]?.id || b.pack?.id || b.styles?.[0]?.id || 'import') + '-' + Date.now().toString(36);
  const title = b.packs?.[0]?.title || b.pack?.title || b.styles?.[0]?.name || 'Import';
  imports.push({ id, title, date: new Date().toISOString().slice(0, 10), bundle: b });
  Store.set('imports', imports);
  mergeBundle(b, 'import:' + id);
  renderList(); renderImports();
  out.innerHTML = `<div class="ok">${esc(t('ai.imported', { n: v.count, s: v.styles }))}${v.warnings.length ? '<br><small>' + v.warnings.map(esc).join('<br>') + '</small>' : ''}</div>`;
  $('#aiPaste').value = '';
}

function renderImports() {
  const imports = Store.get('imports', []);
  $('#importList').innerHTML = imports.length
    ? imports.map(i => `<li><span>${esc(i.title)} <small class="muted">${esc(i.date)}</small></span>
        <span><button class="ghost" data-dl="${esc(i.id)}" title="${esc(t('ai.downloadTitle'))}">${esc(t('ai.download'))}</button>
        <button class="ghost danger" data-del="${esc(i.id)}">${esc(t('ai.delete'))}</button></span></li>`).join('')
    : `<li class="muted">${esc(t('ai.noImport'))}</li>`;
}

function bindAI() {
  $('#btnAI').onclick = openAI;
  $('#aiClose').onclick = () => $('#aiDialog').close();
  $('#aiCopy').onclick = async () => {
    const p = buildPrompt();
    try { await navigator.clipboard.writeText(p); flash(t('flash.copied')); }
    catch { $('#aiPaste').value = p; flash(t('flash.copyFail')); }
  };
  $('#aiShow').onclick = () => { $('#aiPreview').textContent = buildPrompt(); $('#aiPreview').classList.toggle('hidden'); };
  $('#aiImport').onclick = importFromText;
  $('#importList').onclick = e => {
    const del = e.target.closest('[data-del]'), dl = e.target.closest('[data-dl]');
    const imports = Store.get('imports', []);
    if (del) {
      if (!confirm(t('ai.confirmDelete'))) return;
      Store.set('imports', imports.filter(i => i.id !== del.dataset.del));
      location.reload();
    }
    if (dl) {
      const i = imports.find(x => x.id === dl.dataset.dl); if (!i) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(i.bundle, null, 2)], { type: 'application/json' }));
      a.download = i.id.replace(/-[a-z0-9]+$/, '') + '.json';
      a.click();
    }
  };
}

/* ======================================================================
   Démarrage
   ====================================================================== */
(async function main() {
  applyStaticI18n();
  bindControls(); bindAI();
  await loadData();
  renderFilters(); renderList();
  const saved = Store.get('current');
  const first = saved && DB.exercises[saved]
    ? saved
    : DB.packs[0]?.exercises.slice().sort((a, b) => (a.level || 1) - (b.level || 1))[0]?.id;
  if (first) selectExercise(first);
  requestAnimationFrame(frame);
})();
