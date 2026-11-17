/* =========================================================================
   Moteur audio : synthèse de tous les sons (aucun fichier audio requis).
   - Ukulélé : algorithme Karplus-Strong (corde pincée)
   - Percussions / basse : oscillateurs + bruit filtré
   ========================================================================= */
'use strict';

const Engine = (() => {
  let ctx = null, master = null, noiseBuf = null;
  const buses = {};
  const vols = { group: 0.8, guide: 0.8, click: 0.6, melody: 0.8 };
  const ksCache = new Map();

  // Cordes du ukulélé en accord standard GCEA (re-entrant) : numéros MIDI
  const STRINGS = { G: 67, C: 60, E: 64, A: 69 };
  const STRING_ORDER = ['G', 'C', 'E', 'A'];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // Instruments disponibles pour les styles (et caractères qu'ils comprennent)
  const INSTRUMENTS = {
    kick:    'x X',
    bass:    '1 3 5 7 8',
    guiro:   'x (court) X (long)',
    conga:   'h (aigu ouvert) l (grave) m (étouffé) s (claqué) — majuscule = accent',
    bongo:   'h (aigu) l (grave) — majuscule = accent',
    clave:   'x X',
    rim:     'x X',
    shaker:  'x X',
    cowbell: 'x X',
    snare:   'x X',
    hihat:   'x (fermée) o (ouverte)',
    keys:    'x X (accord plaqué au piano)',
    palmas:  'x (sorda : paumes creuses, sourd) X (sonora : claquée, brillante)',
    cajon:   'b (grave) s (claqué) g (fantôme) — majuscule = accent',
    castanets: 'x X (coup) r (roulement, carretilla)'
  };

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
    for (const k of Object.keys(vols)) {
      const g = ctx.createGain(); g.gain.value = vols[k]; g.connect(master); buses[k] = g;
    }
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function setVolume(bus, v) {
    vols[bus] = v;
    if (buses[bus]) buses[bus].gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  }

  /* ---------- briques de base ---------- */
  function envGain(dest, t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }
  function osc(type, freq, t, dur, dest, freqEnd) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  function noise(t, dur, dest, type, freq, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    s.connect(f); f.connect(dest);
    s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.05);
  }

  /* ---------- ukulélé (Karplus-Strong) ---------- */
  function ksBuffer(midi) {
    if (ksCache.has(midi)) return ksCache.get(midi);
    const sr = ctx.sampleRate, N = Math.max(2, Math.round(sr / mtof(midi)));
    const len = Math.floor(sr * 1.6);
    const buf = ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    for (let i = 1; i < N; i++) ring[i] = 0.5 * (ring[i] + ring[i - 1]); // son plus doux (nylon)
    let idx = 0;
    const decay = 0.9965;
    for (let i = 0; i < len; i++) {
      const next = (idx + 1) % N, v = ring[idx];
      out[i] = v;
      ring[idx] = decay * 0.5 * (v + ring[next]);
      idx = next;
    }
    ksCache.set(midi, buf);
    return buf;
  }
  function prepare(midis) { if (!ctx) return; midis.forEach(m => m != null && ksBuffer(m)); }

  function pluck(midi, t, vel, dur) {
    if (midi == null) return;
    const s = ctx.createBufferSource(); s.buffer = ksBuffer(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.09);
    s.connect(g); g.connect(buses.guide);
    s.start(t); s.stop(t + dur + 0.12);
  }

  /** notes = [G, C, E, A] (midi ou null) ; ch = caractère du motif de grattage */
  function strumChar(ch, notes, t, stepDur) {
    const dur = Math.min(Math.max(stepDur * 2.2, 0.25), 0.9);
    switch (ch) {
      case 'D': case 'd': {
        const v = ch === 'D' ? 0.32 : 0.16;
        notes.forEach((m, i) => pluck(m, t + i * 0.014, v, dur));
        break;
      }
      case 'U': case 'u': {
        const v = ch === 'U' ? 0.26 : 0.13;
        [...notes].reverse().forEach((m, i) => pluck(m, t + i * 0.010, v * (i === 3 ? 0.6 : 1), dur));
        break;
      }
      case 'X': case 'x': { // étouffé / chuck
        const g = envGain(buses.guide, t, ch === 'X' ? 0.55 : 0.35, 0.001, 0.045);
        noise(t, 0.07, g, 'bandpass', 1300, 0.9);
        notes.forEach((m, i) => pluck(m, t + i * 0.006, 0.18, 0.035));
        break;
      }
      case 'P': case 'p': // pouce : cordes graves (G et C)
        pluck(notes[1], t, ch === 'P' ? 0.38 : 0.22, dur);
        pluck(notes[0], t + 0.012, 0.18, dur);
        break;
      case 'G': case 'g': case 'C': case 'c': case 'E': case 'e': case 'A': case 'a': { // une seule corde (picking)
        const idx = { g: 0, c: 1, e: 2, a: 3 }[ch.toLowerCase()];
        pluck(notes[idx], t, ch === ch.toUpperCase() ? 0.42 : 0.24, Math.max(dur, 0.7));
        break;
      }
      case 'B': case 'b': { // pincé extérieur : G + A ensemble (pouce + majeur)
        const v = ch === 'B' ? 0.36 : 0.2;
        pluck(notes[0], t, v, Math.max(dur, 0.7)); pluck(notes[3], t, v, Math.max(dur, 0.7));
        break;
      }
      case 'R': case 'r': { // rasgueado : 4 doigts qui se déplient l'un après l'autre (a, m, i… en éventail)
        const v = ch === 'R' ? 0.3 : 0.16, span = Math.min(stepDur * 0.8, 0.13);
        for (let k = 0; k < 4; k++) {
          const tt = t + k * span / 4;
          notes.forEach((m, i) => pluck(m, tt + i * 0.005, v * (k === 3 ? 1.15 : 0.7), dur));
        }
        break;
      }
      case 'F': case 'f': // pincé des doigts : C E A en même temps
        [notes[1], notes[2], notes[3]].forEach(m => pluck(m, t, ch === 'F' ? 0.28 : 0.16, dur * 0.8));
        break;
    }
  }

  /** token de riff, ex. "A3" = corde de La, 3e case */
  function riffNote(token) {
    const m = /^([GCEA])(\d{1,2})$/i.exec(token);
    if (!m) return null;
    return STRINGS[m[1].toUpperCase()] + parseInt(m[2], 10);
  }
  function playRiff(token, t, stepDur) {
    const midi = riffNote(token);
    if (midi != null) pluck(midi, t, 0.5, Math.min(Math.max(stepDur * 1.8, 0.2), 0.7));
  }

  /* ---------- harmonie : basse et accords ---------- */
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function parseChordName(name) {
    const m = /^([A-G])([#b]?)(.*)$/.exec(name || '');
    if (!m) return null;
    let pc = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    pc = (pc + 12) % 12;
    const rest = m[3] || '';
    const dim = /dim|°/.test(rest);
    const minor = dim || /^m(?!aj)/.test(rest);
    const maj7 = /maj7/.test(rest);
    const dom7 = !maj7 && /7/.test(rest);
    return { pc, minor, maj7, dom7, dim };
  }
  function bassNote(chordName, ch) {
    const c = parseChordName(chordName);
    if (!c) return null;
    const root = 36 + c.pc; // octave de C2 à B2
    switch (ch) {
      case '1': return root;
      case '3': return root + (c.minor ? 3 : 4);
      case '5': { const f = c.dim ? 6 : 7; return root + f <= 50 ? root + f : root + f - 12; }
      case '7': return root + (c.maj7 ? 11 : 10);
      case '8': return root + 12;
    }
    return null;
  }

  /* ---------- percussions ---------- */
  const isAcc = ch => ch !== ch.toLowerCase();
  const play = {
    kick(t, ch) {
      const g = envGain(buses.group, t, isAcc(ch) ? 1 : 0.8, 0.002, 0.33);
      osc('sine', 140, t, 0.33, g, 42);
    },
    bass(t, ch, info) {
      const m = bassNote(info.chord, ch);
      if (m == null) return;
      const dur = Math.min(info.stepDur * 3, 0.55);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 650;
      const g = envGain(buses.group, t, 0.75, 0.008, dur);
      f.connect(g);
      osc('triangle', mtof(m), t, dur, f);
      osc('sine', mtof(m), t, dur, f);
    },
    guiro(t, ch, info) {
      const long = ch === 'X';
      const dur = long ? Math.min(info.stepDur * 1.7, 0.3) : 0.045;
      const tick = 0.011, n = Math.max(3, Math.floor(dur / tick));
      const g = ctx.createGain(); g.connect(buses.group);
      g.gain.setValueAtTime(0.0001, t);
      const peak = long ? 0.45 : 0.38;
      for (let i = 0; i < n; i++) {
        const tt = t + i * tick;
        g.gain.setValueAtTime(0.01, tt);
        g.gain.linearRampToValueAtTime(peak, tt + 0.002);
        g.gain.linearRampToValueAtTime(0.02, tt + tick * 0.9);
      }
      g.gain.linearRampToValueAtTime(0.0001, t + n * tick + 0.01);
      noise(t, n * tick + 0.03, g, 'bandpass', 3300, 1.3);
    },
    conga(t, ch) {
      const l = ch.toLowerCase(), acc = isAcc(ch);
      const map = { h: [330, 0.22], l: [215, 0.3], m: [320, 0.05], s: [440, 0.07] };
      const [f, d] = map[l] || map.h;
      const g = envGain(buses.group, t, acc ? 0.9 : 0.6, 0.002, d);
      osc('sine', f * 1.12, t, d, g, f);
      if (l === 's') noise(t, 0.06, envGain(buses.group, t, 0.45, 0.001, 0.05), 'bandpass', 2200, 0.8);
    },
    bongo(t, ch) {
      const l = ch.toLowerCase();
      const f = l === 'l' ? 420 : 620;
      const g = envGain(buses.group, t, isAcc(ch) ? 0.7 : 0.45, 0.001, 0.09);
      osc('sine', f * 1.15, t, 0.09, g, f);
    },
    clave(t, ch) {
      osc('sine', 2500, t, 0.08, envGain(buses.group, t, isAcc(ch) ? 0.7 : 0.5, 0.001, 0.06));
    },
    rim(t, ch) {
      const g = envGain(buses.group, t, isAcc(ch) ? 0.6 : 0.4, 0.001, 0.04);
      osc('triangle', 1700, t, 0.05, g);
      noise(t, 0.03, g, 'bandpass', 3000, 1);
    },
    shaker(t, ch) {
      noise(t, 0.07, envGain(buses.group, t, isAcc(ch) ? 0.28 : 0.13, 0.006, 0.05), 'highpass', 6500, 0.7);
    },
    cowbell(t, ch) {
      const g = envGain(buses.group, t, isAcc(ch) ? 0.35 : 0.22, 0.001, 0.16);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 1.5;
      f.connect(g);
      osc('square', 560, t, 0.17, f); osc('square', 845, t, 0.17, f);
    },
    snare(t, ch) {
      const acc = isAcc(ch);
      noise(t, 0.16, envGain(buses.group, t, acc ? 0.7 : 0.5, 0.001, 0.14), 'bandpass', 1800, 0.7);
      osc('triangle', 190, t, 0.08, envGain(buses.group, t, 0.4, 0.001, 0.07));
    },
    hihat(t, ch) {
      const open = ch.toLowerCase() === 'o';
      noise(t, open ? 0.28 : 0.05, envGain(buses.group, t, isAcc(ch) ? 0.25 : 0.15, 0.001, open ? 0.25 : 0.03), 'highpass', 8000, 0.7);
    },
    palmas(t, ch) {
      if (ch === 'X') { // sonora : doigts claqués dans la paume, plusieurs micro-impacts brillants
        [0, 0.006, 0.013].forEach((d, i) => noise(t + d, 0.02, envGain(buses.group, t + d, i === 2 ? 0.55 : 0.32, 0.0005, 0.014), 'bandpass', 2300, 1.3));
        noise(t + 0.013, 0.13, envGain(buses.group, t + 0.013, 0.3, 0.001, 0.1), 'bandpass', 1900, 0.9);
      } else { // sorda : paumes creuses, son mat
        noise(t, 0.07, envGain(buses.group, t, 0.4, 0.001, 0.05), 'bandpass', 850, 1.1);
      }
    },
    cajon(t, ch) {
      const l = ch.toLowerCase(), acc = isAcc(ch);
      if (l === 'b') {
        osc('sine', 125, t, 0.22, envGain(buses.group, t, acc ? 0.95 : 0.7, 0.002, 0.2), 58);
        noise(t, 0.03, envGain(buses.group, t, 0.18, 0.001, 0.02), 'lowpass', 900, 0.7);
      } else if (l === 's') {
        noise(t, 0.13, envGain(buses.group, t, acc ? 0.6 : 0.42, 0.001, 0.11), 'bandpass', 2600, 0.8);
        osc('triangle', 240, t, 0.06, envGain(buses.group, t, 0.3, 0.001, 0.05));
      } else {
        noise(t, 0.04, envGain(buses.group, t, 0.14, 0.001, 0.03), 'bandpass', 1800, 0.8);
      }
    },
    castanets(t, ch, info) {
      const hit = (tt, v) => {
        osc('sine', 3100, tt, 0.03, envGain(buses.group, tt, v, 0.0005, 0.02));
        noise(tt, 0.02, envGain(buses.group, tt, v * 0.6, 0.0005, 0.015), 'bandpass', 4600, 2);
      };
      if (ch.toLowerCase() === 'r') {
        const sp = Math.min(info.stepDur / 4, 0.045);
        for (let i = 0; i < 4; i++) hit(t + i * sp, 0.2 + i * 0.07);
      } else hit(t, isAcc(ch) ? 0.5 : 0.35);
    },
    keys(t, ch, info) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
      const g = envGain(buses.group, t, isAcc(ch) ? 0.22 : 0.15, 0.004, 0.25);
      f.connect(g);
      (info.notes || []).forEach(m => m != null && osc('triangle', mtof(m - 12), t, 0.3, f));
    }
  };

  function playInstrument(name, ch, t, info) {
    const fn = play[name];
    if (fn) fn(t, ch, info);
  }

  /* ---------- instruments mélodiques ---------- */
  const MELODY_INSTRUMENTS = { flute: "Flûte (gaita)", accordion: "Accordéon", trumpet: "Trompette" };

  /** "A4", "C#5", "Bb4" -> numéro MIDI (A4 = 69) */
  function noteToMidi(tok) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(tok || "");
    if (!m) return null;
    return 12 * (parseInt(m[3], 10) + 1) + PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  }

  function playMelody(inst, midi, t, dur) {
    if (midi == null) return;
    const f = mtof(midi), rel = 0.07;
    dur = Math.max(dur, 0.08);
    const end = t + dur + rel + 0.05;
    const out = ctx.createGain(); out.connect(buses.melody);
    const peak = inst === "flute" ? 0.32 : 0.2, sus = peak * (inst === "trumpet" ? 0.75 : 0.85);
    const a = Math.min(inst === "flute" ? 0.05 : 0.03, dur * 0.4), d = Math.min(a + 0.1, dur);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(peak, t + a);
    out.gain.linearRampToValueAtTime(sus, t + d);
    out.gain.setValueAtTime(sus, t + dur);
    out.gain.linearRampToValueAtTime(0, t + dur + rel);
    const mk = (type, freq, gain, dest) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = gain; o.connect(g); g.connect(dest);
      o.start(t); o.stop(end); return o;
    };
    const vibrato = (oscs, depth) => {
      if (dur < 0.25) return;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, t + 0.15); lg.gain.linearRampToValueAtTime(depth, t + 0.35);
      lfo.connect(lg); oscs.forEach(o => lg.connect(o.frequency));
      lfo.start(t); lfo.stop(end);
    };
    if (inst === "trumpet") {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1;
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(Math.min(f * 7, 5000), t + a + 0.02);
      lp.frequency.linearRampToValueAtTime(Math.min(f * 4, 3500), t + d + 0.05);
      lp.connect(out);
      const o = mk("sawtooth", f, 1, lp);
      o.frequency.setValueAtTime(f * 0.97, t); o.frequency.linearRampToValueAtTime(f, t + 0.04);
      vibrato([o], f * 0.004);
    } else if (inst === "accordion") {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200; lp.Q.value = 0.7;
      lp.connect(out);
      mk("sawtooth", f * 0.997, 0.5, lp); mk("sawtooth", f * 1.003, 0.5, lp); mk("square", f / 2, 0.25, lp);
    } else { // flûte / gaita
      const o1 = mk("sine", f, 1, out), o2 = mk("sine", f * 2, 0.12, out);
      const ng = ctx.createGain(); ng.gain.value = 0.25; ng.connect(out);
      noise(t, dur + rel, ng, "bandpass", f * 2, 3);
      vibrato([o1, o2], f * 0.006);
    }
  }

  function click(t, accent) {
    osc('square', accent ? 1760 : 1180, t, 0.03, envGain(buses.click, t, accent ? 0.35 : 0.22, 0.001, 0.025));
  }

  /** frets "0003" (G C E A) -> notes MIDI */
  function chordNotes(frets) {
    if (!frets) return [null, null, null, null];
    return STRING_ORDER.map((s, i) => {
      const c = frets[i];
      if (c == null || c === 'x' || c === 'X') return null;
      return STRINGS[s] + parseInt(c, 36); // parseInt base 36 : "a" = 10, "b" = 11…
    });
  }

  return {
    init, setVolume, prepare, strumChar, playRiff, riffNote, playInstrument, click,
    chordNotes, parseChordName, INSTRUMENTS, MELODY_INSTRUMENTS, noteToMidi, playMelody,
    get ctx() { return ctx; }
  };
})();
