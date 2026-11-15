/* =========================================================================
   Interface : chargement des données, liste des exercices, affichage
   synchronisé (accords, grattage, groupe), progression, ajout via IA.
   ========================================================================= */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const DIMENSIONS = [
  { id: 'rythme',  label: 'Rythme',   icon: '🥁', hint: 'main droite, motifs de grattage' },
  { id: 'accords', label: 'Accords',  icon: '✋', hint: 'changements à temps' },
  { id: 'tempo',   label: 'Tempo',    icon: '⏱️', hint: 'tenir et accélérer' },
  { id: 'ecoute',  label: 'Écoute',   icon: '👂', hint: 'se caler sur le groupe, tenir seul' },
  { id: 'melodie', label: 'Mélodie',  icon: '🎵', hint: 'notes en rythme, riffs' },
  { id: 'picking', label: 'Picking',  icon: '🤌', hint: 'jeu aux doigts, arpèges, corde par corde' }
];

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
    packs.push({ id: 'mes-ajouts', title: 'Mes ajouts', description: 'Exercices importés sans parcours.', exercises: b.exercises });
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
  } catch (e) {
    DB.loadErrors.push(location.protocol === 'file:'
      ? "Ouvre l'outil via un serveur web (UwAmp → http://localhost/latin-ukulele/ ou lancer.cmd), pas en double-cliquant le fichier."
      : 'Impossible de lire data/manifest.json : ' + e.message);
  }
  for (const imp of Store.get('imports', [])) mergeBundle(imp.bundle, 'import:' + imp.id);
}

/* ---------- progression ---------- */
let progress = Store.get('progress', {});
const prog = id => progress[id] || (progress[id] = { best: 0, loops: 0, seconds: 0, mastered: false });
const saveProgress = () => Store.set('progress', progress);

/* ---------- diagrammes d'accords (SVG) ---------- */
function chordSVG(name, small) {
  const frets = DB.chords[name];
  const w = small ? 64 : 96;
  if (!frets) return `<div class="nodiag" style="width:${w}px">?</div>`;
  const f = frets.split('').map(c => (c === 'x' || c === 'X') ? -1 : parseInt(c, 36));
  const played = f.filter(n => n > 0);
  const max = played.length ? Math.max(...played) : 0;
  const base = max > 4 ? Math.min(...played) : 1;
  const xs = [14, 30, 46, 62], y0 = 20, fh = 18, rows = 4;
  let s = `<svg class="diag" viewBox="0 0 76 116" width="${w}" role="img" aria-label="Accord ${esc(name)} : ${esc(frets)}">`;
  s += base === 1 ? `<rect x="13" y="${y0 - 3}" width="50" height="4" class="nut"/>` : `<text x="70" y="${y0 + 12}" class="fr">${base}</text>`;
  for (let r = 0; r <= rows; r++) s += `<line x1="14" x2="62" y1="${y0 + r * fh}" y2="${y0 + r * fh}" class="fret"/>`;
  xs.forEach(x => s += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + rows * fh}" class="str"/>`);
  f.forEach((n, i) => {
    if (n === -1) s += `<text x="${xs[i]}" y="13" class="mute">×</text>`;
    else if (n === 0) s += `<circle cx="${xs[i]}" cy="10" r="4" class="open"/>`;
    else s += `<circle cx="${xs[i]}" cy="${y0 + (n - base + 0.5) * fh}" r="6.5" class="dot"/>`;
  });
  ['G', 'C', 'E', 'A'].forEach((l, i) => s += `<text x="${xs[i]}" y="112" class="sl">${l}</text>`);
  return s + '</svg>';
}

/* ---------- libellés de comptage ---------- */
function countLabels(len, beats) {
  const per = len / beats;
  const subs = { 1: [''], 2: ['', 'et'], 3: ['', 'et', 'a'], 4: ['', 'i', 'et', 'a'] }[per];
  const out = [];
  for (let i = 0; i < len; i++) {
    const b = Math.floor(i / per), k = i % per;
    out.push(k === 0 ? String(b + 1) : (subs ? subs[k] : '·'));
  }
  return out;
}
const STRUM_GLYPH = { D: '↓', d: '↓', U: '↑', u: '↑', X: '✕', x: '✕', P: 'P', p: 'p', F: 'F', f: 'f', G: 'G', g: 'g', C: 'C', c: 'c', E: 'E', e: 'e', A: 'A', a: 'a', B: 'G+A', b: 'g+a', '.': '', '-': '–' };
const STRUM_NAME = { D: 'bas', d: 'bas léger', U: 'haut', u: 'haut léger', X: 'étouffé', x: 'étouffé léger', P: 'pouce', p: 'pouce léger', F: 'pincé C+E+A', f: 'pincé léger',
  G: 'corde de Sol (pouce)', g: 'corde de Sol, doux', C: 'corde de Do (pouce)', c: 'corde de Do, doux',
  E: 'corde de Mi (index)', e: 'corde de Mi, doux', A: 'corde de La (majeur)', a: 'corde de La, doux',
  B: 'pincé G + A (pouce + majeur)', b: 'pincé G + A, doux' };

/* ======================================================================
   Liste des exercices
   ====================================================================== */
let filter = Store.get('filter', 'all');
let currentId = null;

function renderFilters() {
  const el = $('#filters');
  const chips = [{ id: 'all', label: 'Tout', icon: '✨' }, ...DIMENSIONS];
  el.innerHTML = chips.map(d => `<button class="chip ${filter === d.id ? 'on' : ''}" data-f="${d.id}" title="${esc(d.hint || '')}">${d.icon} ${d.label}</button>`).join('');
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
  if (DB.loadErrors.length) {
    el.innerHTML = `<div class="alert">${DB.loadErrors.map(esc).join('<br>')}</div>`;
  } else el.innerHTML = '';
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
          <span class="lvl" title="niveau ${ex.level || 1}">${'●'.repeat(ex.level || 1)}</span>
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
let C = null;
const ui = { lastBar: null, lastChord: null, cells: null };

function selectExercise(id) {
  const ex = DB.exercises[id];
  if (!ex) return;
  try { C = compileExercise(ex, DB); }
  catch (e) { alert('Exercice impossible à charger : ' + e.message); return; }
  currentId = id;
  Store.set('current', id);
  Player.load(C);
  const o = ex.options || {};
  Object.assign(Player.opts, {
    guide: o.guide || 'on', silence: !!o.silence, ramp: o.ramp !== false,
    click: o.click !== undefined ? !!o.click : Player.opts.click
  });
  syncOptionInputs();
  renderHeader(); renderTempoInputs(); renderLanes(0, 0); renderChords(0); renderList();
  $('#practice').classList.remove('empty');
  if (window.innerWidth < 900) $('#practice').scrollIntoView({ behavior: 'smooth' });
}

function renderHeader() {
  const ex = C.ex, st = C.style;
  const dims = (ex.focus || []).map(f => DIMENSIONS.find(d => d.id === norm(f))).filter(Boolean);
  $('#exHeader').innerHTML = `
    <div class="exTitle">
      <h2>${esc(ex.title)}</h2>
      <div class="tags">
        <span class="tag style">${esc(st.name)}${st.origin ? ' · ' + esc(st.origin) : ''}</span>
        <span class="tag">Niveau ${ex.level || 1}</span>
        ${dims.map(d => `<span class="tag dim">${d.icon} ${d.label}</span>`).join('')}
        ${C.melody ? `<span class="tag mel">🎼 ${esc(Engine.MELODY_INSTRUMENTS[C.melody.inst] || C.melody.inst)} joue la mélodie</span>` : ''}
      </div>
    </div>
    ${ex.description ? `<p>${esc(ex.description)}</p>` : ''}
    ${ex.goal ? `<p class="goal">🎯 <b>Objectif :</b> ${esc(ex.goal)}</p>` : ''}
    ${C.warnings.length ? `<div class="alert small">${C.warnings.map(esc).join('<br>')}</div>` : ''}`;
  const tips = ex.tips || [];
  $('#tips').innerHTML = `
    ${tips.length ? `<h4>Conseils</h4><ul>${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${st.description ? `<h4>À propos : ${esc(st.name)}</h4><p>${esc(st.description)}</p>` : ''}
    ${legendHTML()}`;
}

function legendHTML() {
  const used = new Set((C.strum || []).flat());
  const items = [...used].filter(c => STRUM_NAME[c]).map(c => `<span><b>${STRUM_GLYPH[c]}</b> ${STRUM_NAME[c]}</span>`);
  return items.length ? `<h4>Légende</h4><p class="legend">${items.join('')}${C.riff ? '<span><b>A3</b> corde de La, case 3</span>' : ''}${C.melody ? '<span><b>E5</b> note jouée par l\x27autre instrument (– = note tenue)</span>' : ''}</p>` : '';
}

function renderTempoInputs() {
  const t = C.tempo;
  $('#tStart').value = t.start; $('#tTarget').value = t.target;
  $('#tStep').value = t.step; $('#tEvery').value = t.every;
  updateBpm(Player.bpm);
  updateRecord();
}
function updateRecord() {
  const p = prog(C.ex.id);
  $('#record').innerHTML = p.best
    ? `Record : <b>${p.best} bpm</b> · objectif ${C.tempo.target} ${p.mastered ? '✅' : ''} · ${p.loops} boucles · ${Math.round(p.seconds / 60)} min`
    : `Objectif : ${C.tempo.target} bpm — commence lentement, c'est le secret !`;
}

/** Dessine la mesure courante : comptage, grattage, riff, pistes du groupe */
function renderLanes(s, g) {
  const loopBar = Math.floor(s / C.spb);
  const bar = Math.floor(g / C.spb);
  ui.lastBar = bar + ':' + loopBar;
  const rows = [];
  const mainLen = C.strum ? barOf(C.strum, s, C.spb).length : C.riff ? barOf(C.riff, s, C.spb).length : C.beats * 2;
  const labels = countLabels(mainLen, C.beats);
  rows.push({ key: 'count', name: 'Compte', cells: labels.map((l, i) => ({ html: l, cls: i % (mainLen / C.beats) === 0 ? 'beat' : 'sub' })) });
  if (C.strum) {
    rows.push({ key: 'strum', name: 'Ton grattage', main: true,
      cells: barOf(C.strum, s, C.spb).map(c => ({ html: STRUM_GLYPH[c] ?? esc(c), cls: 'st-' + (c === '.' ? 'rest' : c.toLowerCase()) + (c !== '.' && c === c.toLowerCase() ? ' light' : ''), title: STRUM_NAME[c] || '' })) });
  }
  if (C.riff) {
    rows.push({ key: 'riff', name: 'Ton riff', main: true,
      cells: barOf(C.riff, s, C.spb).map(tk => ({ html: tk === '.' ? '' : esc(tk), cls: tk === '.' ? 'st-rest' : 'riff s-' + tk[0].toUpperCase() })) });
  }
  const band = [];
  if (C.melody) {
    band.push({ key: "melody", name: "🎼 " + (Engine.MELODY_INSTRUMENTS[C.melody.inst] || "mélodie"), band: true, mel: true, muted: Player.muted.has("melody"),
      cells: barOf(C.melody.bars, s, C.spb).map(tk => ({ html: tk === "." ? "" : tk === "-" ? "" : esc(tk), cls: tk === "." ? "off" : tk === "-" ? "mel hold" : "mel" })) });
  }
  for (const [name, pat] of Object.entries(C.tracks)) {
    band.push({ key: name, name, band: true, muted: Player.muted.has(name),
      cells: barOf(pat, g, C.spb).map(c => ({ html: c === '.' ? '' : esc(c), cls: c === '.' ? 'off' : 'hit' + (c !== c.toLowerCase() && isNaN(c) ? ' acc' : '') })) });
  }
  const html = r => `<div class="row ${r.main ? 'main' : ''} ${r.mel ? 'melrow' : ''} ${r.band ? 'band' : ''} ${r.muted ? 'muted' : ''}" data-key="${r.key}">
      <div class="lbl" ${r.band ? `title="Cliquer pour couper/remettre" data-mute="${r.key}"` : ''}>${esc(r.name)}${r.band ? (r.muted ? ' 🔇' : '') : ''}</div>
      <div class="cells" style="--n:${r.cells.length}">${r.cells.map(c => `<div class="cell ${c.cls}" ${c.title ? `title="${esc(c.title)}"` : ''}>${c.html}</div>`).join('')}</div>
    </div>`;
  $('#grid').innerHTML = rows.map(html).join('');
  $('#band').innerHTML = band.map(html).join('');
  renderForm(loopBar);
  ui.cells = [...document.querySelectorAll('#grid .row, #band .row')].map(r => ({ key: r.dataset.key, cells: [...r.querySelectorAll('.cell')] }));
}

/** Structure du morceau : où suis-je, que vient-il ensuite ? */
function renderForm(loopBar) {
  const info = $('#barInfo'), form = $('#form');
  if (!C.sections) { info.textContent = `Mesure ${loopBar + 1}/${C.bars}`; form.innerHTML = ''; return; }
  const i = C.sections.findIndex(sc => loopBar >= sc.start && loopBar < sc.start + sc.bars);
  const cur = C.sections[Math.max(0, i)], nxt = C.sections[(i + 1) % C.sections.length];
  const left = cur.start + cur.bars - loopBar;
  info.innerHTML = `<b>${esc(cur.name)}</b> · mesure ${loopBar - cur.start + 1}/${cur.bars}` +
    (C.sections.length > 1 ? ` <span class="muted">— ${left === 1 ? '<b class="soonTxt">' + esc(nxt.name) + ' à la prochaine mesure !</b>' : esc(nxt.name) + ' dans ' + left + ' mesures'}</span>` : '');
  form.innerHTML = C.sections.map((sc, k) => `<span class="sec ${k === i ? 'on' : ''}" style="flex:${sc.bars}">${esc(sc.name)}<small>${sc.bars} mes.</small></span>`).join('');
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
  if (cur !== ui.lastChord) {
    $('#chordNow').innerHTML = `<div class="cname">${esc(cur)}</div>${chordSVG(cur)}`;
    ui.lastChord = cur;
    $('#chordNow').classList.remove('pop'); void $('#chordNow').offsetWidth; $('#chordNow').classList.add('pop');
  }
  const el = $('#chordNext');
  if (!nx) { el.innerHTML = `<div class="muted small">Un seul accord : concentre-toi sur la main droite.</div>`; el.dataset.chord = ''; return; }
  if (el.dataset.chord !== nx.chord) { el.innerHTML = `<div class="nlabel">ensuite</div><div class="cname sm">${esc(nx.chord)}</div>${chordSVG(nx.chord, true)}<div class="countdown"></div>`; el.dataset.chord = nx.chord; }
  const cd = $('.countdown', el);
  cd.textContent = nx.beats <= 1 ? 'MAINTENANT ! prépare' : `dans ${nx.beats} temps`;
  el.classList.toggle('soon', nx.beats <= 1);
}

function renderBeatDots(pos, countIn) {
  const el = $('#beats');
  if (el.children.length !== C.beats) el.innerHTML = Array.from({ length: C.beats }, (_, i) => `<span>${i + 1}</span>`).join('');
  const beat = Math.floor(pos / C.sub);
  [...el.children].forEach((d, i) => { d.classList.toggle('on', i === beat); d.classList.toggle('one', i === 0 && beat === 0); d.classList.toggle('ci', !!countIn); });
}

/* ---------- boucle d'animation ---------- */
let lastTick = performance.now();
function frame(now) {
  const evs = Player.drain();
  for (const ev of evs) {
    if (ev.g < 0) {
      if (ev.countIn != null) {
        $('#status').innerHTML = `<span class="big">${ev.countIn}</span> décompte…`;
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
      ? '🤫 <b>Le groupe se tait : continue tout seul !</b>'
      : `Boucle ${ev.loopIdx + 1}${ev.guide ? '' : ' · <i>guide coupé : à toi !</i>'}`;
  }
  if (Player.playing && currentId) {
    prog(currentId).seconds += (now - lastTick) / 1000;
  }
  lastTick = now;
  requestAnimationFrame(frame);
}

/* ---------- transport et réglages ---------- */
function updateBpm(v) {
  $('#bpm').textContent = v;
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
  const el = $('#toast'); el.innerHTML = msg; el.classList.add('show');
  clearTimeout(flash.t); flash.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function bindControls() {
  $('#play').onclick = togglePlay;
  $('#minus').onclick = () => Player.setBpm(Player.bpm - 2);
  $('#plus').onclick = () => Player.setBpm(Player.bpm + 2);
  $('#tooFast').onclick = () => { Player.tooFast(); flash('On ralentit un peu 👍 — on reste plus longtemps à ce tempo.'); };
  $('#restart').onclick = () => { if (!C) return; Player.stop(); Player.setBpm(C.tempo.start); };
  const tIn = () => {
    if (!C) return;
    C.tempo.start = +$('#tStart').value || C.tempo.start;
    C.tempo.target = +$('#tTarget').value || C.tempo.target;
    C.tempo.step = Math.max(1, +$('#tStep').value || 1);
    C.tempo.every = Math.max(1, +$('#tEvery').value || 1);
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
  $('#band').onclick = e => {
    const l = e.target.closest('[data-mute]'); if (!l) return;
    const k = l.dataset.mute;
    Player.muted.has(k) ? Player.muted.delete(k) : Player.muted.add(k);
    ui.lastBar = null; if (!Player.playing) renderLanes(0, 0);
  };
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select') || $('#aiDialog').open) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); Player.setBpm(Player.bpm + 2); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); Player.setBpm(Player.bpm - 2); }
    else if (e.key === 't' || e.key === 'T') $('#tooFast').click();
  });

  Player.on('bpm', updateBpm);
  Player.on('state', playing => {
    $('#play').textContent = playing ? '■ Stop' : '▶ Jouer';
    $('#play').classList.toggle('on', playing);
    if (!playing) {
      $('#status').textContent = 'Prêt. Espace pour jouer / arrêter.';
      $('#practice').classList.remove('silent');
      ui.cells && ui.cells.forEach(r => r.cells.forEach(c => c.classList.remove('now')));
      saveProgress(); renderList();
    }
  });
  Player.on('loop', ({ bpm, clean }) => {
    const p = prog(currentId);
    p.loops++;
    if (clean && bpm > p.best) p.best = bpm;
    if (clean && bpm >= C.tempo.target && !p.mastered) {
      p.mastered = true;
      setTimeout(() => flash('🎉 Objectif atteint ! Exercice validé. Tu peux viser plus haut ou passer au suivant.'), 150);
    }
    saveProgress(); updateRecord();
  });
  Player.on('ramp', bpm => setTimeout(() => flash(`⏩ On accélère : ${bpm} bpm`), 120));
  window.addEventListener('beforeunload', saveProgress);
}

/* ======================================================================
   Ajouter du contenu avec une IA
   ====================================================================== */
let promptTemplate = '';

async function openAI() {
  if (!promptTemplate) {
    try { promptTemplate = await (await fetch('docs/prompt-ia.md', { cache: 'no-cache' })).text(); }
    catch { promptTemplate = '(Impossible de charger docs/prompt-ia.md)\n\n{{EXISTANT}}\n\n{{DEMANDE}}'; }
  }
  renderImports();
  $('#aiResult').innerHTML = '';
  $('#aiDialog').showModal();
}

function existingSummary() {
  const st = Object.values(DB.styles).map(s => `- style "${s.id}" (${s.name}) : ${s.beats || 4} temps, subdivision ${s.subdivision || 4} → ${(s.beats || 4) * (s.subdivision || 4)} cases par mesure ; pistes : ${Object.keys(s.tracks || {}).join(', ')}`).join('\n');
  const ch = Object.entries(DB.chords).map(([k, v]) => `${k}=${v}`).join(', ');
  const exs = Object.values(DB.exercises).map(e => `- ${e.id} (niv. ${e.level || 1}, ${e.style}) : ${e.title}`).join('\n');
  const done = Object.values(DB.exercises).filter(e => prog(e.id).best).map(e => `- ${e.title} : record ${prog(e.id).best} bpm${prog(e.id).mastered ? ' (validé)' : ''}`).join('\n');
  return `STYLES EXISTANTS :\n${st}\n\nACCORDS EXISTANTS (cordes G C E A) :\n${ch}\n\nEXERCICES EXISTANTS :\n${exs}\n\nMA PROGRESSION ACTUELLE :\n${done || '- (pas encore de record)'}`;
}

function buildPrompt() {
  const wish = $('#aiWish').value.trim() || "Propose-moi la suite logique de mon apprentissage : un petit parcours de 3 à 5 exercices progressifs.";
  return promptTemplate.replace('{{EXISTANT}}', existingSummary()).replace('{{DEMANDE}}', wish);
}

function extractJSON(text) {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Aucun objet JSON trouvé.');
  return JSON.parse(t.slice(a, b + 1));
}

/** Vérifie un bundle sans l'importer : renvoie erreurs et avertissements */
function validateBundle(b) {
  const errors = [], warnings = [];
  const tmp = {
    chords: { ...DB.chords, ...(b.chords || {}) },
    styles: { ...DB.styles }
  };
  for (const [k, v] of Object.entries(b.chords || {})) {
    if (!/^[0-9a-cxX]{4}$/.test(v)) errors.push(`Accord ${k} : "${v}" doit faire 4 caractères (cases des cordes G C E A, x = non jouée).`);
  }
  const styles = Array.isArray(b.styles) ? b.styles : Object.values(b.styles || {});
  for (const s of styles) {
    if (!s.id) { errors.push('Un style n\'a pas d\'id.'); continue; }
    tmp.styles[s.id] = s;
    for (const k of Object.keys(s.tracks || {})) if (!(k in Engine.INSTRUMENTS)) errors.push(`Style ${s.id} : instrument inconnu "${k}". Disponibles : ${Object.keys(Engine.INSTRUMENTS).join(', ')}`);
  }
  const exs = [...(b.exercises || [])];
  [...(b.packs || []), ...(b.pack ? [b.pack] : [])].forEach(p => {
    if (!p.id || !p.title) errors.push('Chaque pack doit avoir un id et un title.');
    exs.push(...(p.exercises || []));
  });
  if (!exs.length && !styles.length && !Object.keys(b.chords || {}).length) errors.push('Rien à importer (ni pack, ni exercice, ni style, ni accord).');
  for (const ex of exs) {
    if (!ex.id || !ex.title) { errors.push('Un exercice n\'a pas d\'id ou de title.'); continue; }
    if (!tmp.styles[ex.style]) { errors.push(`Exercice ${ex.id} : style "${ex.style}" inconnu.`); continue; }
    if (!ex.strum && !ex.riff) warnings.push(`Exercice ${ex.id} : ni "strum" ni "riff" — seul le groupe jouera.`);
    if (ex.strum && /[^DdUuXxPpFfGgCcEeAaBb.\-|\s]/.test(ex.strum)) errors.push(`Exercice ${ex.id} : caractère non reconnu dans strum "${ex.strum}".`);
    try {
      const c = compileExercise(ex, tmp);
      c.warnings.forEach(w => warnings.push(`${ex.id} : ${w}`));
    } catch (e) { errors.push(`${ex.id} : ${e.message}`); }
    if (DB.exercises[ex.id]) warnings.push(`${ex.id} existe déjà : il sera remplacé.`);
  }
  return { errors, warnings, count: exs.length, styles: styles.length };
}

function importFromText() {
  const out = $('#aiResult');
  let b;
  try { b = extractJSON($('#aiPaste').value); }
  catch (e) { out.innerHTML = `<div class="alert">JSON illisible : ${esc(e.message)}<br>Demande à l'IA de répondre uniquement avec le JSON.</div>`; return; }
  const v = validateBundle(b);
  if (v.errors.length) {
    out.innerHTML = `<div class="alert"><b>À corriger :</b><br>${v.errors.map(esc).join('<br>')}</div>
      <p class="small">Astuce : recopie ces erreurs à l'IA, elle corrigera son JSON.</p>`;
    return;
  }
  const imports = Store.get('imports', []);
  const id = (b.packs?.[0]?.id || b.pack?.id || b.styles?.[0]?.id || 'import') + '-' + Date.now().toString(36);
  const title = b.packs?.[0]?.title || b.pack?.title || b.styles?.[0]?.name || 'Import';
  imports.push({ id, title, date: new Date().toISOString().slice(0, 10), bundle: b });
  Store.set('imports', imports);
  mergeBundle(b, 'import:' + id);
  renderList(); renderImports();
  out.innerHTML = `<div class="ok">✅ Importé : ${v.count} exercice(s), ${v.styles} style(s).${v.warnings.length ? '<br><small>' + v.warnings.map(esc).join('<br>') + '</small>' : ''}</div>`;
  $('#aiPaste').value = '';
}

function renderImports() {
  const imports = Store.get('imports', []);
  $('#importList').innerHTML = imports.length
    ? imports.map(i => `<li><span>${esc(i.title)} <small class="muted">${esc(i.date)}</small></span>
        <span><button class="ghost" data-dl="${esc(i.id)}" title="Télécharger le fichier JSON">⬇ fichier</button>
        <button class="ghost danger" data-del="${esc(i.id)}">Supprimer</button></span></li>`).join('')
    : '<li class="muted">Aucun import pour l\'instant.</li>';
}

function bindAI() {
  $('#btnAI').onclick = openAI;
  $('#aiClose').onclick = () => $('#aiDialog').close();
  $('#aiCopy').onclick = async () => {
    const p = buildPrompt();
    try { await navigator.clipboard.writeText(p); flash('📋 Prompt copié ! Colle-le dans ton IA préférée.'); }
    catch { $('#aiPaste').value = p; flash('Copie impossible : le prompt est dans la zone du bas, copie-le à la main.'); }
  };
  $('#aiShow').onclick = () => { $('#aiPreview').textContent = buildPrompt(); $('#aiPreview').classList.toggle('hidden'); };
  $('#aiImport').onclick = importFromText;
  $('#importList').onclick = e => {
    const del = e.target.closest('[data-del]'), dl = e.target.closest('[data-dl]');
    const imports = Store.get('imports', []);
    if (del) {
      if (!confirm('Supprimer cet import ? (la progression est conservée)')) return;
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
  bindControls(); bindAI();
  await loadData();
  renderFilters(); renderList();
  const first = Store.get('current') && DB.exercises[Store.get('current')]
    ? Store.get('current')
    : DB.packs[0]?.exercises.sort((a, b) => (a.level || 1) - (b.level || 1))[0]?.id;
  if (first) selectExercise(first);
  requestAnimationFrame(frame);
})();
