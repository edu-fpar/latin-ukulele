/* =========================================================================
   Lecteur : transforme un exercice (JSON) en "partition" jouable,
   puis la programme dans le temps (horloge Web Audio, très précise).
   ========================================================================= */
'use strict';

/* ---------- Compilation ---------- */

/** "C:4 G7:4" ou [{chord:"C",beats:4}] -> [{chord, beats}] */
function parseProgression(chords, beatsPerBar) {
  if (!chords) return [];
  if (typeof chords === 'string') {
    return chords.split(/[\s|]+/).filter(Boolean).map(tok => {
      const [c, b] = tok.split(':');
      return { chord: c, beats: b ? parseFloat(b) : beatsPerBar };
    });
  }
  return chords.map(c => typeof c === 'string'
    ? { chord: c, beats: beatsPerBar }
    : { chord: c.chord, beats: c.beats || beatsPerBar });
}

/**
 * Découpe un motif en mesures.
 * "D.D.D.D. | D.DU.UDU" -> [["D",".","D",...], [...]]
 * isTokens : les cases sont séparées par des espaces (riffs : "A3 . E0 .")
 * Chaque mesure peut avoir sa propre résolution : 4 cases = noires, 8 = croches, 16 = doubles.
 */
function parsePattern(str, spb, isTokens, warn, label) {
  const segs = String(str).split('|').map(s => isTokens
    ? s.trim().split(/\s+/).filter(Boolean)
    : s.replace(/\s+/g, '').split(''));
  const bars = [];
  for (const seg of segs) {
    if (!seg.length) continue;
    if (seg.length > spb && seg.length % spb === 0) {
      for (let i = 0; i < seg.length; i += spb) bars.push(seg.slice(i, i + spb));
    } else bars.push(seg);
  }
  bars.forEach((b, i) => {
    if (spb % b.length !== 0 && warn) {
      warn(t('warn.pattern', { label, n: i + 1, len: b.length, spb }));
    }
  });
  return bars.length ? bars : [['.']];
}

/** Case déclenchée au pas `step` (ou null). Retourne aussi l'index de case pour l'affichage. */
function cellAt(pattern, step, spb) {
  const bar = pattern[Math.floor(step / spb) % pattern.length];
  const pos = step % spb;
  if ((pos * bar.length) % spb !== 0) return null;
  return bar[(pos * bar.length) / spb];
}
function cellIndex(pattern, step, spb) {
  const bar = pattern[Math.floor(step / spb) % pattern.length];
  return Math.floor(((step % spb) * bar.length) / spb);
}
function barOf(pattern, step, spb) {
  return pattern[Math.floor(step / spb) % pattern.length];
}

function compileExercise(ex, db) {
  const warnings = [];
  const warn = m => warnings.push(m);
  const style = db.styles[ex.style];
  if (!style) throw new Error(t('warn.unknownStyle', { id: ex.style }));
  const beats = style.beats || 4;
  const sub = style.subdivision || 4;
  const spb = beats * sub;

  const prog = parseProgression(ex.chords, beats);
  if (!prog.length) prog.push({ chord: 'C', beats });
  const totalBeats = prog.reduce((a, p) => a + p.beats, 0);
  const bars = Math.max(1, Math.ceil(totalBeats / beats));
  const loopSteps = bars * spb;
  const chordAt = new Array(loopSteps);
  let s = 0;
  for (const p of prog) {
    if (!db.chords[p.chord]) warn(t('warn.chord', { chord: p.chord }));
    const n = Math.round(p.beats * sub);
    for (let i = 0; i < n && s < loopSteps; i++) chordAt[s++] = p.chord;
  }
  while (s < loopSteps) chordAt[s++] = prog[prog.length - 1].chord;

  const tracks = {};
  for (const [name, pat] of Object.entries(style.tracks || {})) {
    if (!(name in Engine.INSTRUMENTS)) { warn(t('warn.inst', { name })); continue; }
    tracks[name] = parsePattern(pat, spb, false, warn, t('lbl.track', { name }));
  }
  const strum = ex.strum ? parsePattern(ex.strum, spb, false, warn, t('lbl.strum')) : null;
  const riff = ex.riff ? parsePattern(ex.riff, spb, true, warn, t('lbl.riff')) : null;

  // Mélodie jouée par un autre instrument : notes "A4", "-" = tenue, "." = silence
  let melody = null;
  if (ex.melody) {
    const m = typeof ex.melody === 'string' ? { notes: ex.melody } : ex.melody;
    const inst = m.instrument || 'flute';
    if (!(inst in Engine.MELODY_INSTRUMENTS)) warn(t('warn.melInst', { inst, list: Object.keys(Engine.MELODY_INSTRUMENTS).join(', ') }));
    const mbars = parsePattern(m.notes || '', spb, true, warn, t('lbl.melody'));
    const len = mbars.length * spb;
    const toks = Array.from({ length: len }, (_, k) => cellAt(mbars, k, spb));
    const events = new Array(len).fill(null);
    toks.forEach((tok, k) => {
      if (!tok || tok === '.' || tok === '-') return;
      const midi = Engine.noteToMidi(tok);
      if (midi == null) { warn(t('warn.melNote', { tok })); return; }
      let j = k + 1;
      while (j < len && (toks[j] == null || toks[j] === '-')) j++;
      events[k] = { midi, steps: j - k };
    });
    if (mbars.length !== bars && loopSteps % len !== 0) warn(t('warn.melBars', { n: mbars.length, bars }));
    melody = { inst, bars: mbars, len, events };
  }

  // Structure du morceau (couplet, refrain…)
  let sections = null;
  if (Array.isArray(ex.sections) && ex.sections.length) {
    let b = 0;
    sections = ex.sections.map(sc => { const o = { name: sc.name, bars: sc.bars || 1, start: b }; b += o.bars; return o; });
    if (b !== bars) warn(t('warn.sections', { n: b, bars }));
  }

  const chordNames = [...new Set(chordAt)];
  const notesByChord = {};
  chordNames.forEach(c => notesByChord[c] = Engine.chordNotes(db.chords[c]));

  const tp = ex.tempo || {};
  const tempo = {
    start: tp.start || style.defaultBpm || 80,
    target: tp.target || (tp.start || style.defaultBpm || 80) + 20,
    step: tp.step || 4,
    every: tp.everyLoops || tp.every || 2
  };

  return {
    ex, style, beats, sub, spb, prog, bars, loopSteps, chordAt, tracks, strum, riff, melody, sections,
    notesByChord, tempo, swing: style.swing || 0, warnings
  };
}

/* ---------- Programmation temporelle ---------- */

const Player = (() => {
  const P = {
    C: null, playing: false, g: 0, nextTime: 0, timer: null, bpm: 80,
    queue: [], loopsAtTempo: 0, loopClean: true, completed: 0,
    opts: { countIn: true, click: true, guide: 'on', silence: false, ramp: true },
    muted: new Set(),
    listeners: {}
  };
  const emit = (ev, data) => (P.listeners[ev] || []).forEach(f => f(data));
  const on = (ev, f) => (P.listeners[ev] = P.listeners[ev] || []).push(f);

  const stepDur = () => 60 / P.bpm / P.C.sub;

  function load(C) {
    stop();
    P.C = C;
    P.bpm = C.tempo.start;
    P.muted = new Set(C.ex.mute || []);
    emit('bpm', P.bpm);
  }

  function start() {
    if (!P.C || P.playing) return;
    const ctx = Engine.init();
    const all = [];
    Object.values(P.C.notesByChord).forEach(n => all.push(...n));
    (P.C.riff || []).flat().forEach(tok => all.push(Engine.riffNote(tok)));
    Engine.prepare(all);
    P.playing = true;
    P.g = P.opts.countIn ? -P.C.spb : 0;
    P.nextTime = ctx.currentTime + 0.1;
    P.loopsAtTempo = 0; P.loopClean = true; P.completed = 0; P.queue = [];
    P.timer = setInterval(schedule, 25);
    schedule();
    emit('state', true);
  }

  function stop() {
    if (P.timer) clearInterval(P.timer);
    P.timer = null;
    const was = P.playing;
    P.playing = false; P.queue = [];
    if (was) emit('state', false);
  }

  function schedule() {
    const ctx = Engine.ctx;
    while (P.nextTime < ctx.currentTime + 0.12) {
      scheduleStep(P.g, P.nextTime);
      P.nextTime += stepDur();
      P.g++;
      if (P.g > 0 && P.g % P.C.loopSteps === 0) loopEnd();
    }
  }

  function guideActive(loopIdx) {
    if (P.opts.guide === 'on') return true;
    if (P.opts.guide === 'fade') return loopIdx < 2;
    return false;
  }

  function scheduleStep(g, t0) {
    const C = P.C, sd = stepDur();
    if (g < 0) { // décompte
      const pos = g + C.spb;
      if (pos % C.sub === 0) Engine.click(t0, pos === 0);
      P.queue.push({ t: t0, g, countIn: pos % C.sub === 0 ? C.beats - pos / C.sub : null });
      return;
    }
    const s = g % C.loopSteps;
    const pos = s % C.spb;
    const t = t0 + (C.swing && pos % 2 === 1 ? C.swing * sd : 0);
    const barGlobal = Math.floor(g / C.spb);
    const loopIdx = Math.floor(g / C.loopSteps);
    const silent = P.opts.silence && barGlobal % 4 === 3;
    const chord = C.chordAt[s];
    const notes = C.notesByChord[chord];
    const info = { stepDur: sd, chord, notes };
    const guide = guideActive(loopIdx);

    if (!silent) {
      if (P.opts.click && pos % C.sub === 0) Engine.click(t, pos === 0);
      for (const [name, pat] of Object.entries(C.tracks)) {
        if (P.muted.has(name)) continue;
        const ch = cellAt(pat, g, C.spb);
        if (ch && ch !== '.' && ch !== '-') Engine.playInstrument(name, ch, t, info);
      }
      if (C.melody && !P.muted.has('melody')) {
        const ev = C.melody.events[s % C.melody.len];
        if (ev) Engine.playMelody(C.melody.inst, ev.midi, t, ev.steps * sd * 0.94);
      }
      if (guide && C.strum) {
        const ch = cellAt(C.strum, s, C.spb);
        if (ch && ch !== '.' && ch !== '-') Engine.strumChar(ch, notes, t, sd);
      }
      if (guide && C.riff) {
        const tok = cellAt(C.riff, s, C.spb);
        if (tok && tok !== '.' && tok !== '-') Engine.playRiff(tok, t, sd);
      }
    }
    P.queue.push({ t, g, s, pos, chord, silent, loopIdx, guide });
  }

  function loopEnd() {
    P.completed++;
    emit('loop', { bpm: P.bpm, clean: P.loopClean, completed: P.completed });
    P.loopClean = true;
    if (P.opts.ramp) {
      P.loopsAtTempo++;
      const tp = P.C.tempo;
      if (P.loopsAtTempo >= tp.every && P.bpm < tp.target) {
        setBpm(Math.min(tp.target, P.bpm + tp.step));
        P.loopsAtTempo = 0;
        emit('ramp', P.bpm);
      }
    }
  }

  function setBpm(v) {
    P.bpm = Math.max(30, Math.min(240, Math.round(v)));
    emit('bpm', P.bpm);
  }

  /** "Trop vite !" : on redescend et on reste plus longtemps à ce tempo */
  function tooFast() {
    if (!P.C) return;
    P.loopClean = false;
    setBpm(P.bpm - P.C.tempo.step);
    P.loopsAtTempo = -P.C.tempo.every; // on reste deux fois plus longtemps
  }

  /** Événements visuels dont l'heure est arrivée */
  function drain() {
    const ctx = Engine.ctx;
    if (!ctx || !P.playing) return [];
    const out = [];
    while (P.queue.length && P.queue[0].t <= ctx.currentTime) out.push(P.queue.shift());
    return out;
  }

  return {
    load, start, stop, setBpm, tooFast, drain, on,
    get bpm() { return P.bpm; },
    get playing() { return P.playing; },
    get opts() { return P.opts; },
    get muted() { return P.muted; },
    get C() { return P.C; }
  };
})();
