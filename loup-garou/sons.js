/*
 * Moteur de sons du Pad Loup-Garou.
 * Tous les sons sont SYNTHÉTISÉS en direct par le navigateur (Web Audio API) :
 * aucun fichier à télécharger, aucun problème de droits d'auteur.
 * Chaque son est une fonction (ctx, sortie, reverb) -> { stop() }.
 */
(function () {
  "use strict";

  let ctx = null, maitre = null, reverb = null, bruitBlanc = null;

  // --- Déblocage iOS ---
  // Sur iPhone, le son Web Audio est coupé par le bouton silencieux et mis en pause
  // (état "interrupted") quand on change d'appli. On joue en boucle un fichier
  // audio muet : iOS considère alors la page comme un lecteur de musique.
  let audioMuet = null;
  function wavMuet() {
    const n = 8000, buf = new Uint8Array(44 + n), v = new DataView(buf.buffer);
    const txt = (o, t) => { for (let i = 0; i < t.length; i++) buf[o + i] = t.charCodeAt(i); };
    txt(0, "RIFF"); v.setUint32(4, 36 + n, true); txt(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); txt(36, "data"); v.setUint32(40, n, true);
    buf.fill(128, 44);
    let b = ""; buf.forEach((c) => (b += String.fromCharCode(c)));
    return "data:audio/wav;base64," + btoa(b);
  }
  function debloquer() {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    try {
      if (!audioMuet) {
        audioMuet = document.createElement("audio");
        audioMuet.src = wavMuet(); audioMuet.loop = true;
        audioMuet.setAttribute("playsinline", ""); audioMuet.setAttribute("x-webkit-airplay", "deny");
      }
      if (audioMuet.paused) audioMuet.play().catch(() => {});
    } catch (e) {}
    if (ctx) {
      if (ctx.state !== "running") ctx.resume().catch(() => {});
      // un tout petit son vide lancé pendant le toucher finit de déverrouiller iOS
      const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource();
      src.buffer = b; src.connect(ctx.destination); src.start(0);
    }
  }

  function init() {
    if (ctx) { debloquer(); return ctx; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    maitre = ctx.createGain(); maitre.gain.value = 0.8;
    maitre.connect(comp); comp.connect(ctx.destination);
    // Réverbération "grande église / forêt" : réponse impulsionnelle générée
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb.buffer = ir;
    const retour = ctx.createGain(); retour.gain.value = 0.55;
    reverb.connect(retour); retour.connect(maitre);
    // Bruit blanc réutilisable (vent, pluie, feu…)
    bruitBlanc = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = bruitBlanc.getChannelData(0);
    for (let i = 0; i < b.length; i++) b[i] = Math.random() * 2 - 1;
    debloquer();
    return ctx;
  }

  // ---------- petits outils ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const choix = (t) => t[Math.floor(Math.random() * t.length)];
  const note = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI -> Hz

  /** Bus de sortie d'un son : volume + envoi vers la réverb + panoramique. */
  function bus(sortie, vol, envoiReverb = 0.3, pan = 0) {
    const g = ctx.createGain(); g.gain.value = vol;
    let entree = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(g); entree = p;
    }
    g.connect(sortie);
    if (envoiReverb > 0) { const s = ctx.createGain(); s.gain.value = envoiReverb; g.connect(s); s.connect(reverb); }
    return { entree, gain: g };
  }

  function bruit(boucle = true) {
    const s = ctx.createBufferSource(); s.buffer = bruitBlanc; s.loop = boucle;
    s.loopStart = 0; s.loopEnd = bruitBlanc.duration; s.start(0, rnd(0, 3));
    return s;
  }

  /** Enveloppe simple attaque / déclin sur un gain. */
  function env(param, t, crete, attaque, declin, fin = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(crete, t + attaque);
    param.exponentialRampToValueAtTime(fin, t + attaque + declin);
  }

  /** Répète `fn` à intervalles aléatoires jusqu'à l'arrêt. */
  function boucleAleatoire(fn, min, max, premierDelai) {
    let actif = true, timer = null;
    const tick = () => { if (!actif) return; fn(); timer = setTimeout(tick, rnd(min, max) * 1000); };
    timer = setTimeout(tick, (premierDelai ?? rnd(min, max)) * 1000);
    return () => { actif = false; clearTimeout(timer); };
  }

  /** Coupe proprement une liste de nœuds après un fondu. */
  function arretAvecFondu(g, noeuds, arrets = [], duree = 1.5) {
    return {
      stop() {
        arrets.forEach((f) => f());
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + duree);
        setTimeout(() => noeuds.forEach((n) => { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }), duree * 1000 + 200);
      },
    };
  }

  // ---------- les sons ----------
  const SONS = {};

  /** Hurlement d'un loup (one-shot). */
  function hurlement(sortie, pan = 0, base = rnd(330, 420), duree = rnd(2.5, 4)) {
    const t = ctx.currentTime + 0.02;
    const b = bus(sortie, 0.22, 0.8, pan);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
    o.type = "sine"; o2.type = "triangle";
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = rnd(4, 6); vg.gain.value = 0;
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(base * 0.025, t + 1);
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const haut = base * rnd(1.7, 2.0);
    [o, o2].forEach((osc, i) => {
      const m = i ? 2 : 1;
      osc.frequency.setValueAtTime(base * 0.8 * m, t);
      osc.frequency.exponentialRampToValueAtTime(haut * m, t + 0.7);
      osc.frequency.setValueAtTime(haut * m, t + duree * 0.55);
      osc.frequency.exponentialRampToValueAtTime(base * 1.1 * m, t + duree);
    });
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 0.5);
    g.gain.setValueAtTime(1, t + duree * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    g2.gain.value = 0.12;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(b.entree);
    [o, o2, vib].forEach((n) => { n.start(t); n.stop(t + duree + 0.1); });
  }

  SONS.loups = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    // Réveil : 2 ou 3 loups qui hurlent ensemble
    hurlement(g, -0.5); setTimeout(() => hurlement(g, 0.5), 900); setTimeout(() => hurlement(g, 0.1, rnd(280, 320)), 1800);
    const stop = boucleAleatoire(() => {
      const n = choix([1, 1, 2, 3]);
      for (let i = 0; i < n; i++) setTimeout(() => hurlement(g, rnd(-0.9, 0.9)), i * rnd(400, 1500));
    }, 5, 11, 7);
    return arretAvecFondu(g, [], [stop]);
  };

  SONS.meute = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    for (let i = 0; i < 6; i++) setTimeout(() => hurlement(g, rnd(-1, 1), rnd(260, 460)), i * 450);
    const stop = boucleAleatoire(() => { for (let i = 0; i < 3; i++) setTimeout(() => hurlement(g, rnd(-1, 1)), i * 600); }, 4, 7, 5);
    return arretAvecFondu(g, [], [stop]);
  };

  /** Nappe de musique angoissante (drone + dissonances + coups de stress). */
  SONS.peur = (sortie) => {
    const b = bus(sortie, 0.0001, 0.5), t = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.32, t + 4);
    const filtre = ctx.createBiquadFilter(); filtre.type = "lowpass"; filtre.frequency.value = 400; filtre.Q.value = 6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 300;
    lfo.connect(lg); lg.connect(filtre.frequency); filtre.connect(b.entree);
    const noeuds = [lfo];
    [[36, -8], [36, 7], [37, 0], [42, 3], [24, 0]].forEach(([n, det]) => {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = note(n); o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = n === 24 ? 0.5 : 0.18; o.connect(og); og.connect(filtre); noeuds.push(o);
    });
    // Aigus de verre qui grincent
    const aigu = ctx.createGain(); aigu.gain.value = 0.025; aigu.connect(b.entree);
    [88, 89].forEach((n) => { const o = ctx.createOscillator(); o.frequency.value = note(n); o.connect(aigu); noeuds.push(o); });
    const trem = ctx.createOscillator(), tg = ctx.createGain(); trem.frequency.value = 0.3; tg.gain.value = 0.02;
    trem.connect(tg); tg.connect(aigu.gain); noeuds.push(trem);
    noeuds.forEach((n) => n.start());
    // Montées dissonantes de temps en temps
    const stop = boucleAleatoire(() => {
      const t0 = ctx.currentTime, d = rnd(3, 6), base = choix([60, 61, 63, 66]);
      const sg = ctx.createGain(); sg.connect(b.entree);
      sg.gain.setValueAtTime(0.0001, t0); sg.gain.exponentialRampToValueAtTime(0.12, t0 + d);
      sg.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.6);
      [0, 1, 6].forEach((i) => {
        const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = note(base + i);
        o.frequency.linearRampToValueAtTime(note(base + i + 1), t0 + d);
        const f = ctx.createBiquadFilter(); f.frequency.value = 2000; o.connect(f); f.connect(sg); o.start(t0); o.stop(t0 + d + 0.7);
      });
    }, 9, 16, 6);
    return arretAvecFondu(b.gain, noeuds, [stop], 2.5);
  };

  /** Battements de cœur qui accélèrent doucement. */
  SONS.coeur = (sortie) => {
    const b = bus(sortie, 0.9, 0.05);
    let bpm = 62, actif = true, timer;
    const boum = (t, f, v) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.15);
      env(g.gain, t, v, 0.01, 0.22); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + 0.3);
    };
    const battre = () => {
      if (!actif) return;
      const t = ctx.currentTime + 0.02; boum(t, 95, 0.9); boum(t + 0.17, 80, 0.6);
      bpm = Math.min(100, bpm + 0.6);
      timer = setTimeout(battre, 60000 / bpm);
    };
    battre();
    return arretAvecFondu(b.gain, [], [() => { actif = false; clearTimeout(timer); }], 1);
  };

  /** Grillons. */
  SONS.grillons = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    const grillon = (pan, f) => {
      const b = bus(g, 0.06, 0.2, pan);
      return boucleAleatoire(() => {
        const t = ctx.currentTime;
        for (let i = 0; i < 3; i++) {
          const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = f;
          env(og.gain, t + i * 0.055, 1, 0.005, 0.035); o.connect(og); og.connect(b.entree); o.start(t + i * 0.055); o.stop(t + i * 0.055 + 0.06);
        }
      }, 0.5, 1.1, rnd(0, 1));
    };
    const stops = [grillon(-0.7, 4300), grillon(0.6, 4700), grillon(0.1, 5100)];
    return arretAvecFondu(g, [], stops);
  };

  /** Hibou : « hou… hou-hou ». */
  SONS.hibou = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    const hou = (t, d, pan) => {
      const b = bus(g, 0.12, 0.7, pan), o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.setValueAtTime(390, t); o.frequency.linearRampToValueAtTime(340, t + d);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(1, t + d * 0.3); og.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(og); og.connect(b.entree); o.start(t); o.stop(t + d + 0.05);
    };
    const stop = boucleAleatoire(() => {
      const t = ctx.currentTime + 0.05, pan = rnd(-0.8, 0.8);
      hou(t, 0.5, pan); hou(t + 0.9, 0.22, pan); hou(t + 1.2, 0.6, pan);
    }, 7, 14, 2.5);
    return arretAvecFondu(g, [], [stop]);
  };

  /** Vent qui souffle. */
  SONS.vent = (sortie) => {
    const b = bus(sortie, 0.0001, 0.3), t = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.35, t + 3);
    const n = bruit(), f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 500; f.Q.value = 2.5;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 350;
    const lfo2 = ctx.createOscillator(), lg2 = ctx.createGain(), vg = ctx.createGain(); lfo2.frequency.value = 0.13; lg2.gain.value = 0.4; vg.gain.value = 0.6;
    lfo.connect(lg); lg.connect(f.frequency); lfo2.connect(lg2); lg2.connect(vg.gain);
    n.connect(f); f.connect(vg); vg.connect(b.entree); lfo.start(); lfo2.start();
    return arretAvecFondu(b.gain, [n, lfo, lfo2], [], 2.5);
  };

  /** Pluie. */
  SONS.pluie = (sortie) => {
    const b = bus(sortie, 0.0001, 0.15), t = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.28, t + 2);
    const n = bruit(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 900; lp.type = "lowpass"; lp.frequency.value = 7000;
    n.connect(hp); hp.connect(lp); lp.connect(b.entree);
    const stop = boucleAleatoire(() => { // gouttes
      const tt = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(rnd(1500, 3500), tt); o.frequency.exponentialRampToValueAtTime(rnd(400, 900), tt + 0.03);
      env(g.gain, tt, rnd(0.05, 0.15), 0.002, 0.04); o.connect(g); g.connect(b.entree); o.start(tt); o.stop(tt + 0.06);
    }, 0.03, 0.15);
    return arretAvecFondu(b.gain, [n], [stop], 2);
  };

  /** Coup de tonnerre (et nouveaux coups au hasard). */
  function coupDeTonnerre(sortie) {
    const t = ctx.currentTime, b = bus(sortie, 0.9, 0.6, rnd(-0.5, 0.5));
    const crack = bruit(false), cf = ctx.createBiquadFilter(), cg = ctx.createGain();
    cf.type = "highpass"; cf.frequency.value = 1500; env(cg.gain, t, 0.6, 0.005, 0.4);
    crack.connect(cf); cf.connect(cg); cg.connect(b.entree);
    const gr = bruit(false), gf = ctx.createBiquadFilter(), gg = ctx.createGain();
    gf.type = "lowpass"; gf.frequency.setValueAtTime(600, t); gf.frequency.exponentialRampToValueAtTime(80, t + 4);
    gg.gain.setValueAtTime(0.0001, t); gg.gain.linearRampToValueAtTime(1.4, t + 0.15);
    gg.gain.setTargetAtTime(0.6, t + 0.3, 0.5); gg.gain.exponentialRampToValueAtTime(0.0001, t + rnd(4, 6));
    gr.connect(gf); gf.connect(gg); gg.connect(b.entree);
    crack.stop(t + 1); gr.stop(t + 6.5);
  }
  SONS.tonnerre = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    coupDeTonnerre(g);
    const stop = boucleAleatoire(() => coupDeTonnerre(g), 8, 16);
    return arretAvecFondu(g, [], [stop]);
  };

  /** Glas : cloche d'église qui sonne 3 fois. */
  function cloche(sortie, t, f = 196, vol = 0.25) {
    const b = bus(sortie, vol, 0.7);
    [[0.5, 1, 6], [1, 0.8, 4], [1.19, 0.5, 3], [1.5, 0.4, 2.5], [2, 0.35, 2.5], [2.74, 0.25, 1.6], [3.0, 0.2, 1.4], [4.07, 0.15, 1]].forEach(([r, v, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f * r;
      env(g.gain, t, v * 0.3, 0.004, d); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + d + 0.1);
    });
  }
  SONS.glas = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    const t = ctx.currentTime + 0.6; for (let i = 0; i < 3; i++) cloche(g, t + i * 2.6);
    return arretAvecFondu(g, [], [], 3);
  };

  /** Coq (chant stylisé « co-co-ri-co »). */
  SONS.coq = (sortie) => {
    const b = bus(sortie, 0.16, 0.4, 0.3), t = ctx.currentTime + 0.3;
    const o = ctx.createOscillator(); o.type = "sawtooth";
    const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), g = ctx.createGain();
    f1.type = "bandpass"; f1.frequency.value = 1100; f1.Q.value = 4; f2.type = "bandpass"; f2.frequency.value = 2500; f2.Q.value = 5;
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(b.entree);
    const seg = [[0, 0.14, 520, 600], [0.2, 0.14, 560, 650], [0.42, 0.18, 700, 800], [0.68, 0.9, 820, 560]];
    g.gain.setValueAtTime(0.0001, t);
    seg.forEach(([d, l, a, z]) => {
      o.frequency.setValueAtTime(a, t + d); o.frequency.linearRampToValueAtTime(z, t + d + l);
      g.gain.setValueAtTime(0.0001, t + d); g.gain.linearRampToValueAtTime(1, t + d + 0.03);
      g.gain.setValueAtTime(1, t + d + l - 0.04); g.gain.linearRampToValueAtTime(0.0001, t + d + l);
    });
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 28; vg.gain.value = 18; vib.connect(vg); vg.connect(o.frequency);
    o.start(t); vib.start(t); o.stop(t + 1.8); vib.stop(t + 1.8);
    return arretAvecFondu(b.gain, [], [], 1);
  };

  /** Chants d'oiseaux. */
  SONS.oiseaux = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    const chant = () => {
      const b = bus(g, 0.09, 0.4, rnd(-0.9, 0.9)), t0 = ctx.currentTime, n = Math.floor(rnd(3, 8)), base = rnd(2200, 3800);
      for (let i = 0; i < n; i++) {
        const t = t0 + i * rnd(0.08, 0.14), o = ctx.createOscillator(), og = ctx.createGain();
        const a = base * rnd(0.85, 1.25);
        o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(a * rnd(1.2, 1.6), t + 0.06);
        env(og.gain, t, 1, 0.01, 0.07); o.connect(og); og.connect(b.entree); o.start(t); o.stop(t + 0.1);
      }
    };
    const stop = boucleAleatoire(chant, 0.6, 2.2, 1.5);
    return arretAvecFondu(g, [], [stop], 2);
  };

  /** Harpe magique (Cupidon). */
  SONS.harpe = (sortie) => {
    const b = bus(sortie, 0.16, 0.8), gamme = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];
    const pince = (t, n) => {
      [1, 2, 3].forEach((h, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = i ? "sine" : "triangle"; o.frequency.value = note(n) * h;
        env(g.gain, t, 0.3 / (h * h), 0.005, 2.2 / h); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + 2.5);
      });
    };
    const arpege = () => {
      const t = ctx.currentTime + 0.05, dep = Math.floor(rnd(0, 4));
      for (let i = 0; i < 7; i++) pince(t + i * 0.12, gamme[dep + i]);
    };
    arpege();
    const stop = boucleAleatoire(arpege, 3.5, 6);
    return arretAvecFondu(b.gain, [], [stop], 2);
  };

  /** Nappe mystique scintillante (Voyante). */
  SONS.mystique = (sortie) => {
    const b = bus(sortie, 0.0001, 0.8), t = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.12, t + 3);
    const noeuds = [];
    [57, 64, 71, 72, 76].forEach((n, i) => {
      [-6, 6].forEach((det) => {
        const o = ctx.createOscillator(); o.frequency.value = note(n); o.detune.value = det;
        const g = ctx.createGain(); g.gain.value = 0.12; o.connect(g); g.connect(b.entree); noeuds.push(o);
        const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.1 + i * 0.07; lg.gain.value = 0.08;
        lfo.connect(lg); lg.connect(g.gain); noeuds.push(lfo);
      });
    });
    noeuds.forEach((n) => n.start());
    const stop = boucleAleatoire(() => { // scintillements
      const tt = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = note(choix([84, 88, 91, 93, 96])); env(g.gain, tt, 0.15, 0.01, 1.5);
      o.connect(g); g.connect(b.entree); o.start(tt); o.stop(tt + 1.6);
    }, 0.3, 1.2);
    return arretAvecFondu(b.gain, noeuds, [stop], 2.5);
  };

  /** Chœur céleste « aaah » (Salvateur). */
  SONS.choeur = (sortie) => {
    const b = bus(sortie, 0.0001, 0.8), t = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.1, t + 3);
    const formants = [[800, 1], [1150, 0.5], [2900, 0.25]], noeuds = [];
    const mix = ctx.createGain(); mix.gain.value = 1;
    formants.forEach(([f, v]) => {
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 8;
      const g = ctx.createGain(); g.gain.value = v * 3; mix.connect(bp); bp.connect(g); g.connect(b.entree);
    });
    const accords = [[50, 57, 62, 66], [48, 55, 60, 67], [45, 52, 57, 64], [43, 50, 55, 62]];
    const voix = accords[0].map((n) => {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = note(n);
      const v = ctx.createOscillator(), vg = ctx.createGain(); v.frequency.value = rnd(4.5, 5.5); vg.gain.value = 4;
      v.connect(vg); vg.connect(o.detune); o.connect(mix); noeuds.push(o, v); return o;
    });
    noeuds.forEach((n) => n.start());
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % accords.length;
      voix.forEach((o, k) => o.frequency.setTargetAtTime(note(accords[i][k]), ctx.currentTime, 0.4));
    }, 4500);
    return arretAvecFondu(b.gain, noeuds, [() => clearInterval(timer)], 2.5);
  };

  /** Chaudron qui bouillonne (Sorcière). */
  SONS.chaudron = (sortie) => {
    const b = bus(sortie, 0.3, 0.4);
    const n = bruit(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 250; ng.gain.value = 0.3; n.connect(lp); lp.connect(ng); ng.connect(b.entree);
    const stop = boucleAleatoire(() => {
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = rnd(150, 450);
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rnd(2, 4), t + rnd(0.04, 0.1));
      env(g.gain, t, rnd(0.15, 0.4), 0.005, 0.08); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + 0.15);
    }, 0.05, 0.35);
    return arretAvecFondu(b.gain, [n], [stop], 1.5);
  };

  /** Crépitement de feu. */
  SONS.feu = (sortie) => {
    const b = bus(sortie, 0.0001, 0.2), t = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.4, t + 2);
    const n = bruit(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 400; ng.gain.value = 0.35; n.connect(lp); lp.connect(ng); ng.connect(b.entree);
    const stop = boucleAleatoire(() => {
      const tt = ctx.currentTime, c = bruit(false), hp = ctx.createBiquadFilter(), g = ctx.createGain();
      hp.type = "highpass"; hp.frequency.value = rnd(1500, 4000); env(g.gain, tt, rnd(0.1, 0.6), 0.001, rnd(0.01, 0.04));
      c.connect(hp); hp.connect(g); g.connect(b.entree); c.stop(tt + 0.08);
    }, 0.03, 0.25);
    return arretAvecFondu(b.gain, [n], [stop], 2);
  };

  /** Murmures de foule (débat). */
  SONS.foule = (sortie) => {
    const b = bus(sortie, 0.0001, 0.3), t = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.5, t + 2);
    const noeuds = [];
    for (let i = 0; i < 5; i++) {
      const n = bruit(), f1 = ctx.createBiquadFilter(), g = ctx.createGain();
      f1.type = "bandpass"; f1.frequency.value = rnd(400, 1200); f1.Q.value = 6;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = rnd(2, 5); lg.gain.value = 0.25; g.gain.value = 0.25;
      const lfoF = ctx.createOscillator(), lfg = ctx.createGain(); lfoF.frequency.value = rnd(1.5, 4); lfg.gain.value = rnd(200, 400);
      lfo.connect(lg); lg.connect(g.gain); lfoF.connect(lfg); lfg.connect(f1.frequency);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (pan.pan) pan.pan.value = rnd(-0.8, 0.8);
      n.connect(f1); f1.connect(g); g.connect(pan); pan.connect(b.entree); lfo.start(); lfoF.start(); noeuds.push(n, lfo, lfoF);
    }
    return arretAvecFondu(b.gain, noeuds, [], 2);
  };

  /** Tambour de vote. */
  SONS.tambour = (sortie) => {
    const b = bus(sortie, 0.8, 0.35);
    let actif = true, timer, tempo = 88, mesure = 0;
    const frappe = (t, f, v) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.25);
      env(g.gain, t, v, 0.003, 0.45); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + 0.5);
      const n = bruit(false), nf = ctx.createBiquadFilter(), ng = ctx.createGain(); nf.type = "bandpass"; nf.frequency.value = 900;
      env(ng.gain, t, v * 0.25, 0.002, 0.06); n.connect(nf); nf.connect(ng); ng.connect(b.entree); n.stop(t + 0.1);
    };
    const tick = () => {
      if (!actif) return;
      const t = ctx.currentTime + 0.05, n = 60 / tempo;
      frappe(t, 110, 0.9); frappe(t + n * 1.5, 100, 0.5); frappe(t + n * 2, 110, 0.9); frappe(t + n * 3, 90, 0.7);
      mesure++; tempo = Math.min(120, tempo + 1.5);
      timer = setTimeout(tick, n * 4 * 1000);
    };
    tick();
    return arretAvecFondu(b.gain, [], [() => { actif = false; clearTimeout(timer); }], 1.2);
  };

  /** Cri d'horreur / coup de violon strident. */
  SONS.cri = (sortie) => {
    const t = ctx.currentTime + 0.05, b = bus(sortie, 0.35, 0.7);
    [81, 82, 83, 84, 87].forEach((n) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = note(n);
      o.frequency.linearRampToValueAtTime(note(n) * 0.97, t + 1.5);
      env(g.gain, t, 0.12, 0.01, 1.8); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + 2);
    });
    const o = ctx.createOscillator(), g = ctx.createGain(); // boum grave
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.5);
    env(g.gain, t, 1.2, 0.005, 2); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + 2.2);
    return arretAvecFondu(b.gain, [], [], 1);
  };

  /** Coup de fusil du Chasseur. */
  SONS.coup_de_feu = (sortie) => {
    const t = ctx.currentTime + 0.05, b = bus(sortie, 1, 0.9);
    const n = bruit(false), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    env(g.gain, t, 1.2, 0.001, 0.5); n.connect(f); f.connect(g); g.connect(b.entree); n.stop(t + 0.8);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    env(og.gain, t, 1, 0.002, 0.4); o.connect(og); og.connect(b.entree); o.start(t); o.stop(t + 0.5);
    return arretAvecFondu(b.gain, [], [], 2);
  };

  /** Fanfare de victoire. */
  SONS.fanfare = (sortie) => {
    const b = bus(sortie, 0.22, 0.5), t0 = ctx.currentTime + 0.1, croche = 0.18;
    const melodie = [[67, 1], [67, 1], [67, 1], [72, 3], [67, 1], [72, 1], [76, 4], [74, 1], [72, 1], [74, 1], [76, 2], [79, 6]];
    let t = t0;
    const cuivre = (t, n, d) => {
      [0, -12, 4].forEach((iv, k) => {
        const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = note(n + iv); lp.type = "lowpass";
        lp.frequency.setValueAtTime(800, t); lp.frequency.linearRampToValueAtTime(3000, t + 0.05);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(k ? 0.12 : 0.25, t + 0.03);
        g.gain.setValueAtTime(k ? 0.12 : 0.25, t + d * 0.85); g.gain.linearRampToValueAtTime(0.0001, t + d);
        o.connect(lp); lp.connect(g); g.connect(b.entree); o.start(t); o.stop(t + d + 0.05);
      });
    };
    melodie.forEach(([n, d]) => { cuivre(t, n, d * croche); t += d * croche; });
    [0, 3, 6, 9].forEach((i) => { // timbales
      const tt = t0 + i * croche * 2, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(98, tt); o.frequency.exponentialRampToValueAtTime(70, tt + 0.4);
      env(g.gain, tt, 0.8, 0.003, 0.6); o.connect(g); g.connect(b.entree); o.start(tt); o.stop(tt + 0.7);
    });
    return arretAvecFondu(b.gain, [], [], 2);
  };

  /** Musique médiévale douce (luth + bourdon) pour l'accueil. */
  SONS.medieval = (sortie) => {
    const b = bus(sortie, 0.0001, 0.5), t0 = ctx.currentTime;
    b.gain.gain.linearRampToValueAtTime(0.2, t0 + 2);
    const bourdon = [50, 57].map((n) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.value = note(n); lp.type = "lowpass"; lp.frequency.value = 500; g.gain.value = 0.06;
      o.connect(lp); lp.connect(g); g.connect(b.entree); o.start(); return o;
    });
    const gamme = [62, 64, 65, 67, 69, 71, 72, 74]; // ré dorien
    let idx = 0;
    const luth = (t, n) => {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = "triangle"; o2.type = "sawtooth"; o.frequency.value = note(n); o2.frequency.value = note(n);
      lp.type = "lowpass"; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.6);
      const g2 = ctx.createGain(); g2.gain.value = 0.15;
      env(g.gain, t, 0.35, 0.004, 1.2); o.connect(g); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(b.entree);
      o.start(t); o2.start(t); o.stop(t + 1.3); o2.stop(t + 1.3);
    };
    let actif = true, timer;
    const phrase = () => {
      if (!actif) return;
      const t = ctx.currentTime + 0.05, rythme = choix([[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [1.5, 0.5, 1, 1]]);
      let dt = 0;
      rythme.forEach((r) => {
        idx = Math.max(0, Math.min(gamme.length - 1, idx + choix([-2, -1, -1, 1, 1, 2, 0])));
        luth(t + dt, gamme[idx]); if (Math.random() < 0.3) luth(t + dt, gamme[idx] - 12);
        dt += r * 0.38;
      });
      timer = setTimeout(phrase, dt * 1000 + rnd(200, 900));
    };
    phrase();
    return arretAvecFondu(b.gain, bourdon, [() => { actif = false; clearTimeout(timer); }], 2);
  };

  /** Croassements de corbeau. */
  SONS.corbeau = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    const croa = (t, pan) => {
      const b = bus(g, 0.25, 0.6, pan), o = ctx.createOscillator(), n = bruit(false);
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), og = ctx.createGain(), ng = ctx.createGain(), env1 = ctx.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(rnd(480, 560), t); o.frequency.exponentialRampToValueAtTime(rnd(300, 360), t + 0.35);
      f1.type = "bandpass"; f1.frequency.value = 1300; f1.Q.value = 3; f2.type = "bandpass"; f2.frequency.value = 2400; f2.Q.value = 4;
      og.gain.value = 0.7; ng.gain.value = 0.25;
      o.connect(og); n.connect(ng); og.connect(f1); og.connect(f2); ng.connect(f1); f1.connect(env1); f2.connect(env1); env1.connect(b.entree);
      env1.gain.setValueAtTime(0.0001, t); env1.gain.linearRampToValueAtTime(1, t + 0.03);
      env1.gain.setValueAtTime(1, t + 0.25); env1.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.start(t); o.stop(t + 0.45); n.stop(t + 0.45);
    };
    const serie = () => { const t = ctx.currentTime + 0.05, pan = rnd(-0.8, 0.8), n = choix([2, 3, 3, 4]); for (let i = 0; i < n; i++) croa(t + i * 0.5, pan); };
    serie();
    const stop = boucleAleatoire(serie, 5, 10);
    return arretAvecFondu(g, [], [stop]);
  };

  /** Flûte envoûtante (Joueur de Flûte). */
  SONS.flute = (sortie) => {
    const b = bus(sortie, 0.14, 0.7), gamme = [69, 72, 74, 76, 79, 81, 84];
    let actif = true, timer, idx = 3;
    const souffle = (t, n, d) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), v = ctx.createOscillator(), vg = ctx.createGain();
      o.frequency.value = note(n); v.frequency.value = 5.5; vg.gain.value = note(n) * 0.012;
      v.connect(vg); vg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.08);
      g.gain.setValueAtTime(0.45, t + d * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + d);
      const n2 = bruit(false), hp = ctx.createBiquadFilter(), ng = ctx.createGain(); hp.type = "bandpass"; hp.frequency.value = note(n) * 2; hp.Q.value = 2; ng.gain.value = 0.04;
      n2.connect(hp); hp.connect(ng); ng.connect(g);
      o.connect(g); g.connect(b.entree); o.start(t); v.start(t); o.stop(t + d + 0.05); v.stop(t + d + 0.05); n2.stop(t + d + 0.05);
    };
    const phrase = () => {
      if (!actif) return;
      let t = ctx.currentTime + 0.05;
      const n = Math.floor(rnd(4, 8));
      for (let i = 0; i < n; i++) {
        idx = Math.max(0, Math.min(gamme.length - 1, idx + choix([-2, -1, 1, 1, 2])));
        const d = choix([0.3, 0.3, 0.6, 0.9]); souffle(t, gamme[idx], d); t += d;
      }
      timer = setTimeout(phrase, (t - ctx.currentTime) * 1000 + rnd(600, 1600));
    };
    phrase();
    return arretAvecFondu(b.gain, [], [() => { actif = false; clearTimeout(timer); }], 2);
  };

  /** Grognement d'ours (Montreur d'Ours). */
  SONS.grognement = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    const grogne = () => {
      const t = ctx.currentTime + 0.05, d = rnd(1.2, 2), b = bus(g, 0.6, 0.4, rnd(-0.4, 0.4));
      const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), eg = ctx.createGain(), n = bruit(false), ng = ctx.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(rnd(70, 90), t); o.frequency.linearRampToValueAtTime(rnd(50, 65), t + d);
      const am = ctx.createOscillator(), amg = ctx.createGain(); am.frequency.value = rnd(18, 26); amg.gain.value = 0.4;
      am.connect(amg); amg.connect(eg.gain);
      lp.type = "lowpass"; lp.frequency.value = 500; lp.Q.value = 5; ng.gain.value = 0.3;
      o.connect(lp); n.connect(ng); ng.connect(lp); lp.connect(eg); eg.connect(b.entree);
      eg.gain.setValueAtTime(0.0001, t); eg.gain.linearRampToValueAtTime(0.8, t + 0.25);
      eg.gain.setValueAtTime(0.8, t + d * 0.7); eg.gain.linearRampToValueAtTime(0.0001, t + d);
      o.start(t); am.start(t); o.stop(t + d + 0.1); am.stop(t + d + 0.1); n.stop(t + d + 0.1);
    };
    grogne(); setTimeout(grogne, 1800);
    const stop = boucleAleatoire(grogne, 6, 12);
    return arretAvecFondu(g, [], [stop]);
  };

  /** Coups de marteau de juge. */
  SONS.marteau = (sortie) => {
    const b = bus(sortie, 0.9, 0.5), t0 = ctx.currentTime + 0.05;
    [0, 0.35, 0.7].forEach((d) => {
      const t = t0 + d, o = ctx.createOscillator(), g = ctx.createGain(), n = bruit(false), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
      env(g.gain, t, 0.9, 0.001, 0.15); o.connect(g); g.connect(b.entree); o.start(t); o.stop(t + 0.2);
      bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 1.5; env(ng.gain, t, 0.6, 0.001, 0.05);
      n.connect(bp); bp.connect(ng); ng.connect(b.entree); n.stop(t + 0.1);
    });
    return arretAvecFondu(b.gain, [], [], 1);
  };

  // ---------- lecteur ----------
  let enCours = []; // { stop() }
  let audioFichier = null;

  function toutArreter(rapide) {
    enCours.forEach((s) => { try { s.stop(); } catch (e) {} });
    enCours = [];
    if (audioFichier) {
      const a = audioFichier; audioFichier = null;
      if (rapide) { a.pause(); return; }
      const fade = setInterval(() => { a.volume = Math.max(0, a.volume - 0.08); if (a.volume <= 0) { a.pause(); clearInterval(fade); } }, 100);
    }
  }

  /** Joue une scène : un mp3 perso s'il existe, sinon les sons synthétisés. */
  async function jouer(scene, fichierDisponible) {
    init();
    toutArreter(false);
    if (fichierDisponible && scene.fichier) {
      const a = new Audio(scene.fichier); a.loop = scene.boucle !== false; a.volume = maitre.gain.value;
      audioFichier = a; a.play().catch(() => {});
      return;
    }
    const sortie = ctx.createGain(); sortie.connect(maitre);
    (scene.sons || []).forEach((nom) => { if (SONS[nom]) enCours.push(SONS[nom](sortie)); });
  }

  function volume(v) {
    init();
    maitre.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    if (audioFichier) audioFichier.volume = v;
  }

  function test() {
    init();
    const t = ctx.currentTime + 0.05;
    [0, 0.18].forEach((d, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = i ? 880 : 660;
      env(g.gain, t + d, 0.4, 0.01, 0.3); o.connect(g); g.connect(maitre); o.start(t + d); o.stop(t + d + 0.4);
    });
    return ctx.state;
  }

  window.SonsLoupGarou = { init, jouer, toutArreter, volume, test, etat: () => (ctx ? ctx.state : "non démarré"), liste: () => Object.keys(SONS), SONS };
})();
