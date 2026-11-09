/*
 * Moteur de sons du Pad Loup-Garou.
 * Tous les sons sont SYNTHÉTISÉS en direct par le navigateur (Web Audio API) :
 * aucun fichier à télécharger, aucun problème de droits d'auteur.
 * Chaque son est une fonction (ctx, sortie, reverb) -> { stop() }.
 */
(function () {
  "use strict";

  let ctx = null, maitre = null, reverb = null, bruitBlanc = null;
  let busVoix = null, busAmbiance = null, canard = null, reverbVoix = null, retourVoix = null;
  const niveaux = { voix: 1, ambiance: 1, echoVoix: 1 };

  /** Égalisation : ramène chaque enregistrement à un niveau commun (mesure de son volume moyen). */
  const CIBLE = 0.1, normes = new WeakMap();
  function gainNormalise(buf) {
    if (normes.has(buf)) return normes.get(buf);
    let somme = 0, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i += 4) { const v = d[i]; if (v > 0.002 || v < -0.002) { somme += v * v; n++; } }
    }
    const rms = n ? Math.sqrt(somme / n) : CIBLE;
    const f = Math.max(0.25, Math.min(4, CIBLE / rms));
    normes.set(buf, f);
    return f;
  }
  /** Même chose pour les longues musiques lues en continu : mesure pendant les premières secondes. */
  function niveleur(entree, sortie) {
    const n = ctx.createGain(), an = ctx.createAnalyser(); n.gain.value = 1; an.fftSize = 2048;
    entree.connect(n); entree.connect(an); n.connect(sortie);
    const d = new Float32Array(an.fftSize); let somme = 0, nb = 0, tours = 0;
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(d);
      let s = 0; for (const v of d) s += v * v;
      const rms = Math.sqrt(s / d.length);
      if (rms > 0.003) { somme += rms; nb++; }
      if (nb) n.gain.setTargetAtTime(Math.max(0.25, Math.min(4, CIBLE / (somme / nb))), ctx.currentTime, 0.6);
      if (++tours > 24) clearInterval(timer);
    }, 250);
    return n;
  }

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
    // limiteur final : aucun son ne sature
    const limiteur = ctx.createDynamicsCompressor();
    limiteur.threshold.value = -2; limiteur.ratio.value = 20; limiteur.attack.value = 0.003; limiteur.release.value = 0.1;
    maitre.connect(comp); comp.connect(limiteur); limiteur.connect(ctx.destination);
    // table de mixage : voix du narrateur / musique et ambiances
    busVoix = ctx.createGain(); busVoix.gain.value = niveaux.voix; busVoix.connect(maitre);
    busAmbiance = ctx.createGain(); busAmbiance.gain.value = niveaux.ambiance;
    // « canard » : baisse toute la musique et les ambiances (échos compris) quand le narrateur parle
    canard = ctx.createGain(); canard.gain.value = 1; busAmbiance.connect(canard); canard.connect(maitre);
    // Réverbération "grande église / forêt" : réponse impulsionnelle générée
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb.buffer = ir;
    const retour = ctx.createGain(); retour.gain.value = 0.55;
    reverb.connect(retour); retour.connect(busAmbiance);  // l'écho des ambiances suit le mixage
    // écho séparé pour la voix du narrateur : il suit le curseur Voix
    reverbVoix = ctx.createConvolver(); reverbVoix.buffer = ir;
    retourVoix = ctx.createGain(); retourVoix.gain.value = 0.55 * niveaux.echoVoix;
    reverbVoix.connect(retourVoix); retourVoix.connect(busVoix);
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
    // L'éclair d'abord (lumières), le grondement juste après, comme en vrai
    const orage = () => {
      try { config.surEclair && config.surEclair(); } catch (e) {}
      setTimeout(() => {
        const p = cheminEchantillon("tonnerre");
        if (p) jouerUneFois(p, g, 0.9); else coupDeTonnerre(g);
      }, rnd(350, 1100));
    };
    orage();
    const stop = boucleAleatoire(orage, 9, 18);
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

  /** Attaque des loups : uniquement de vrais enregistrements (dossier sounds/lib), aux bons instants. */
  SONS.attaque = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 1; g.connect(sortie);
    // 0 s : la meute hurle dans le noir
    enregistrementA("meute", g, 0, 0.9) || enregistrementA("loups", g, 0, 0.9);
    // 2,4 s : bond et grognements (synchronisés avec les flashs des lampes)
    enregistrementA("grognement_loup", g, 2.4, 1.0);
    enregistrementA("grognement_loup", g, 4.2, 0.8);
    // 5 s : cri de la victime, morsures
    enregistrementA("cri_homme1", g, 5.0, 0.85);
    // puis un second homme agonise, et enfin la femme hurle, pendant que la meute dévore
    enregistrementA("cri_homme2", g, 6.8, 0.85);
    enregistrementA("cri_victime", g, 8.6, 0.9);
    enregistrementA("morsure", g, 5.1, 1.0);
    enregistrementA("morsure", g, 5.5, 0.8);
    // 6 s : la meute dévore sa proie pendant 9 s
    enregistrementA("devorement", g, 6.0, 1.0, 9);
    // 12,5 s : un dernier hurlement au loin
    enregistrementA("loups", g, 12.5, 0.5);
    return arretAvecFondu(g, [], [], 1.5);
  };

  /** Musique de terreur pour l'attaque : montée, explosion, puis menace continue (aucun silence). */
  SONS.terreur = (sortie) => {
    const g = ctx.createGain(); g.gain.value = 0.75; g.connect(sortie);
    const t0 = ctx.currentTime + 0.05, noeuds = [];
    const boum = (t, f = 55, v = 1) => { // grosse percussion grave (type taiko)
      const o = ctx.createOscillator(), og = ctx.createGain(), n = bruit(false), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
      o.frequency.setValueAtTime(f * 2.2, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      env(og.gain, t, v, 0.004, 1.1); o.connect(og); og.connect(g); o.start(t); o.stop(t + 1.2);
      lp.type = "lowpass"; lp.frequency.value = 900; env(ng.gain, t, v * 0.5, 0.002, 0.18);
      n.connect(lp); lp.connect(ng); ng.connect(g); n.stop(t + 0.3);
    };
    const cordes = (t, notes, duree, debut, fin, ouverture) => { // nappe de cordes dissonantes en trémolo
      const b = bus(g, 1, 0.6), f = ctx.createBiquadFilter(), eg = ctx.createGain();
      f.type = "lowpass"; f.frequency.setValueAtTime(ouverture[0], t); f.frequency.exponentialRampToValueAtTime(ouverture[1], t + duree);
      eg.gain.setValueAtTime(debut, t); eg.gain.exponentialRampToValueAtTime(fin, t + duree);
      const trem = ctx.createOscillator(), tg = ctx.createGain(); trem.frequency.value = 9; tg.gain.value = 0.35;
      trem.connect(tg); tg.connect(eg.gain); trem.start(t); trem.stop(t + duree + 0.1);
      f.connect(eg); eg.connect(b.entree);
      notes.forEach((n) => [-9, 9].forEach((det) => {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = note(n); o.detune.value = det;
        og.gain.value = 0.05; o.connect(og); og.connect(f); o.start(t); o.stop(t + duree + 0.1);
      }));
    };
    // 1) Dans le noir (0-2.4 s) : cordes qui montent, battements de plus en plus rapprochés
    cordes(t0, [40, 41, 46, 52, 53], 2.4, 0.02, 0.5, [300, 2500]);
    [0, 0.8, 1.4, 1.85, 2.15, 2.35].forEach((d, i) => boum(t0 + d, 50, 0.5 + i * 0.1));
    // 2) L'attaque (2.4-5.2 s) : impacts, cris de violons stridents
    const ta = t0 + 2.4;
    boum(ta, 42, 1.4);
    [0, 0.45, 0.8, 1.1, 1.5, 1.9, 2.3, 2.7].forEach((d) => boum(ta + d, 48 + Math.random() * 10, 0.9));
    cordes(ta, [76, 77, 82, 83, 88], 2.8, 0.6, 0.15, [6000, 2500]);
    cordes(ta, [28, 29, 34], 2.8, 0.8, 0.4, [500, 300]);
    // 3) Après (5.2 s et plus) : menace continue jusqu'à la scène suivante
    const tm = t0 + 4.4, bm = bus(g, 0.0001, 0.7), fm = ctx.createBiquadFilter();
    bm.gain.gain.setValueAtTime(0.0001, tm - 0.3); bm.gain.gain.exponentialRampToValueAtTime(0.5, tm + 0.8);
    fm.type = "lowpass"; fm.frequency.value = 600; fm.Q.value = 4; fm.connect(bm.entree);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 350;
    lfo.connect(lg); lg.connect(fm.frequency); lfo.start(tm - 0.3); noeuds.push(lfo);
    [[29, -7], [29, 8], [30, 0], [35, 4], [41, -3]].forEach(([n, det]) => {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = note(n); o.detune.value = det;
      og.gain.value = 0.12; o.connect(og); og.connect(fm); o.start(tm - 0.3); noeuds.push(o);
    });
    const stop = boucleAleatoire(() => { // boum lointain et souffle qui monte, régulièrement
      const t = ctx.currentTime + 0.05; boum(t, 45, 0.6);
      const n = bruit(false), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      bp.type = "bandpass"; bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2500, t + 2.5); bp.Q.value = 3;
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.12, t + 2.4); ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      n.connect(bp); bp.connect(ng); ng.connect(g); n.stop(t + 3);
    }, 3.5, 6, 6.5);
    return arretAvecFondu(g, noeuds, [stop], 2.5);
  };

  /** Tic-tac d'une vieille horloge qui accélère (le vote). */
  SONS.horloge = (sortie) => {
    const b = bus(sortie, 0.55, 0.25);
    let actif = true, timer, intervalle = 0.62, tic = true;
    const coup = (t, aigu) => {
      const n = bruit(false), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = "bandpass"; bp.frequency.value = aigu ? 3200 : 2300; bp.Q.value = 9;
      env(g.gain, t, 0.9, 0.001, 0.045); n.connect(bp); bp.connect(g); g.connect(b.entree); n.stop(t + 0.08);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = aigu ? 1900 : 1500;
      env(og.gain, t, 0.12, 0.001, 0.03); o.connect(og); og.connect(b.entree); o.start(t); o.stop(t + 0.05);
    };
    const debut = performance.now();
    const tick = () => {
      if (!actif) return;
      coup(ctx.currentTime + 0.02, tic); tic = !tic;
      try { config.surTic && config.surTic(); } catch (e) {}
      // d'abord un tic-tac régulier, puis il accélère
      if (performance.now() - debut > 8000) intervalle = Math.max(0.28, intervalle * 0.95);
      timer = setTimeout(tick, intervalle * 1000);
    };
    tick();
    return arretAvecFondu(b.gain, [], [() => { actif = false; clearTimeout(timer); }], 1.2);
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

  // ---------- vrais enregistrements (dossier sounds/lib) ----------
  let config = { echantillons: new Set(), narrateur: true, voixSombre: true, grave: 0.5, surEclair: null, surHurlement: null, surPic: null, surTic: null, surDebutVoix: null, surFinVoix: null };
  function configurer(c) {
    if (c.echantillons) c.echantillons = new Set(c.echantillons);
    Object.assign(config, c);
  }
  const tampons = {};
  function charger(url) {
    if (!tampons[url]) {
      tampons[url] = fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); })
        .then((b) => new Promise((ok, ko) => ctx.decodeAudioData(b, ok, ko)));
      tampons[url].catch(() => delete tampons[url]);
    }
    return tampons[url];
  }
  function cheminEchantillon(nom, dossier = "lib") {
    for (const ext of ["mp3", "m4a", "wav", "flac", "aac"]) {
      const p = `sounds/${dossier}/${nom}.${ext}`;
      if (config.echantillons.has(p)) return p;
    }
    return null;
  }
  // boucle = ambiance continue ; ponctuel = revient de temps en temps ; unique = joué une fois
  const TYPE = { loups: "ponctuel", meute: "boucle", hibou: "ponctuel", corbeau: "ponctuel", grognement: "ponctuel",
    glas: "unique", coq: "unique", coup_de_feu: "unique", fanfare: "unique", marteau: "unique", cri: "unique", attaque: "unique", brabanconne: "unique" };
  // Si l'enregistrement manque, ce son synthétisé le remplace
  const REMPLACANT = { brabanconne: "fanfare" };
  const VOLUME = { medieval: 0.55, peur: 0.6, loups: 0.8, meute: 0.8, foule: 0.45, vent: 0.5, pluie: 0.5, feu: 0.6,
    grillons: 0.35, oiseaux: 0.5, coeur: 0.8, glas: 0.7, coq: 0.7 };

  function jouerUneFois(url, sortie, vol, pan) {
    return charger(url).then((buf) => {
      const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = vol * gainNormalise(buf);
      let dernier = g;
      if (pan !== undefined && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); dernier = p; }
      src.connect(g); dernier.connect(sortie);
      const r = ctx.createGain(); r.gain.value = 0.2; dernier.connect(r); r.connect(reverb);
      src.start(); return { src, duree: buf.duration };
    }).catch(() => null);
  }

  /** Joue l'enregistrement « nom » de sounds/lib dans `delai` secondes (en boucle pendant `duree` si donnée).
   *  Renvoie false s'il n'existe pas (on garde alors la version synthétisée). */
  function enregistrementA(nom, sortie, delai, vol, duree) {
    const url = cheminEchantillon(nom);
    if (!url) return false;
    const t = ctx.currentTime + delai;
    charger(url).then((buf) => {
      const src = ctx.createBufferSource(), g = ctx.createGain(), r = ctx.createGain();
      src.buffer = buf; src.connect(g); g.connect(sortie); r.gain.value = 0.2; g.connect(r); r.connect(reverb);
      vol = vol * gainNormalise(buf);
      g.gain.setValueAtTime(vol, Math.max(t, ctx.currentTime));
      if (duree) {
        src.loop = true;
        g.gain.setValueAtTime(vol, t + duree - 2); g.gain.linearRampToValueAtTime(0.0001, t + duree);
        src.start(Math.max(t, ctx.currentTime), rnd(0, Math.max(0, buf.duration - 1) * 0.3)); src.stop(t + duree + 0.1);
      } else {
        src.start(Math.max(t, ctx.currentTime));
      }
    }).catch(() => {});
    return true;
  }

  function echantillon(url, type, sortie, vol, quand) {
    const g = ctx.createGain(), t = ctx.currentTime; g.connect(sortie);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (type === "boucle" ? 2.5 : 0.05));
    const sources = []; let actif = true, timer;
    if (type === "boucle") {
      // Lecture en continu (comme un lecteur de musique) : marche aussi pour les très longs fichiers,
      // sans tout charger en mémoire.
      const a = new Audio(); a.src = url; a.loop = true; a.preload = "auto"; a.crossOrigin = "anonymous";
      const src = ctx.createMediaElementSource(a); niveleur(src, g);
      const r = ctx.createGain(); r.gain.value = 0.15; g.connect(r); r.connect(reverb);
      a.addEventListener("loadedmetadata", () => {
        // départ au hasard dans les ambiances courtes, au début pour les longues musiques
        if (a.duration && a.duration < 300) { try { a.currentTime = rnd(0, a.duration * 0.6); } catch (e) {} }
      }, { once: true });
      a.play().catch(() => {});
      sources.push({ stop() { a.pause(); a.removeAttribute("src"); a.load(); }, disconnect() { try { src.disconnect(); } catch (e) {} } });
    } else if (type === "unique") {
      jouerUneFois(url, g, 1).then((x) => x && sources.push(x.src));
    } else {
      const tick = async () => {
        if (!actif) return;
        if (quand) { try { quand(); } catch (e) {} }  // ex. hurlement -> « yeux » rouges sur une lampe
        const x = await jouerUneFois(url, g, 1, rnd(-0.7, 0.7));
        if (x) sources.push(x.src);
        timer = setTimeout(tick, ((x && x.duree) || 5) * 1000 + rnd(4000, 10000));
      };
      tick();
    }
    return arretAvecFondu(g, sources, [() => { actif = false; clearTimeout(timer); }], 2);
  }

  /** Une couche sonore : le vrai enregistrement s'il existe, sinon le son synthétisé. */
  // Ces sons restent synthétisés : les enregistrements trouvés en ligne contenaient
  // des commentaires parlés ou grésillaient.
  const TOUJOURS_SYNTHE = new Set(["coeur", "tambour", "attaque"]);  // séquences composées : jamais remplacées
  function couche(nom, sortie, volumes) {
    if (nom !== "tonnerre" && !TOUJOURS_SYNTHE.has(nom)) {
      const p = cheminEchantillon(nom);
      const vol = (volumes && volumes[nom]) ?? VOLUME[nom] ?? 0.7;
      if (p) return echantillon(p, TYPE[nom] || "boucle", sortie, vol, nom === "loups" ? config.surHurlement : null);
    }
    const synthe = SONS[nom] || SONS[REMPLACANT[nom]];
    return synthe ? synthe(sortie) : null;
  }

  // ---------- narrateur ----------
  let jetonVoix = 0, sourceVoix = null, busScene = null;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  function choisirVoix() {
    const vs = ("speechSynthesis" in window ? speechSynthesis.getVoices() : []).filter((v) => /^fr/i.test(v.lang));
    const score = (v) => (/premium|enhanced|améliorée|neural|natural/i.test(v.name) ? 10 : 0)
      + (/thomas|amélie|audrey|aurélie|daniel|google/i.test(v.name) ? 3 : 0) + (v.lang === "fr-FR" ? 1 : 0);
    return vs.sort((a, b) => score(b) - score(a))[0];
  }
  function attenuerAmbiance(oui) {
    if (canard) canard.gain.setTargetAtTime(oui ? 0.28 : 1, ctx.currentTime, 0.35);
    else if (busScene) busScene.gain.setTargetAtTime(oui ? 0.28 : 1, ctx.currentTime, 0.35);
  }
  function arreterVoix() {
    jetonVoix++;
    try { sourceVoix && sourceVoix.stop(); } catch (e) {}
    sourceVoix = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    attenuerAmbiance(false);
  }
  async function dire(id, cle, texte, jeton) {
    const url = cheminEchantillon(`${id}-${cle}`, "voix");
    attenuerAmbiance(true);
    if (url) {
      const buf = await charger(url).catch(() => null);
      if (buf && jeton === jetonVoix) {
        await new Promise((fin) => {
          const src = ctx.createBufferSource(), g = ctx.createGain(), r = ctx.createGain();
          src.buffer = buf; g.gain.value = 1.15; r.gain.value = 0.3;
          if (config.voixSombre) {
            // Voix sombre : un peu plus grave et lente, basses renforcées, aigus adoucis, écho plus profond
            const grave = Math.max(0, Math.min(1, config.grave ?? 0.5));  // curseur 🎚️ Grave
            src.playbackRate.value = 1 - 0.2 * grave;
            const basses = ctx.createBiquadFilter(), presence = ctx.createBiquadFilter(), douceur = ctx.createBiquadFilter();
            basses.type = "lowshelf"; basses.frequency.value = 200; basses.gain.value = 12 * grave;
            presence.type = "peaking"; presence.frequency.value = 3000; presence.Q.value = 1; presence.gain.value = -3;
            douceur.type = "lowpass"; douceur.frequency.value = 7000;
            src.connect(basses); basses.connect(presence); presence.connect(douceur); douceur.connect(g);
            r.gain.value = 0.5; g.gain.value = 1.3;
          } else {
            src.connect(g);
          }
          g.gain.value *= gainNormalise(buf);
          g.connect(busVoix || maitre); g.connect(r); r.connect(reverbVoix || reverb);
          src.onended = fin; src.start(); sourceVoix = src;
        });
        return;
      }
    }
    if (jeton !== jetonVoix || !("speechSynthesis" in window)) return;
    await new Promise((fin) => {
      const u = new SpeechSynthesisUtterance(texte.replace(/…/g, "... "));
      u.lang = "fr-FR"; const v = choisirVoix(); if (v) u.voice = v;
      u.rate = 0.88; u.pitch = 0.8; u.volume = Math.min(1, niveaux.voix);
      u.onend = u.onerror = fin; speechSynthesis.speak(u);
      setTimeout(fin, 30000);
    });
  }
  const signal = (nom) => { try { config[nom] && config[nom](); } catch (e) {} };
  async function narrer(liste, delai = 0) {
    arreterVoix();
    const jeton = jetonVoix;
    await pause(400 + delai * 1000);
    if (jeton === jetonVoix) signal("surDebutVoix");
    for (const [id, cle, texte] of liste) {
      if (jeton !== jetonVoix) return;
      await dire(id, cle, texte, jeton);
      await pause(500);
    }
    if (jeton === jetonVoix) { attenuerAmbiance(false); signal("surFinVoix"); }
  }
  function debloquerVoix() {
    try { if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); speechSynthesis.getVoices(); } } catch (e) {}
  }

  // ---------- lecteur ----------
  let enCours = []; // { stop() }
  let audioFichier = null;

  // Lumière qui réagit au son (ex. glouglous du chaudron) : détection des pics de volume
  let minuterieReactif = null;
  function ecouterPics(sortie) {
    const an = ctx.createAnalyser(); an.fftSize = 1024; sortie.connect(an);
    const d = new Float32Array(an.fftSize);
    let moyenne = 0, dernier = 0;
    minuterieReactif = setInterval(() => {
      an.getFloatTimeDomainData(d);
      let s = 0; for (const v of d) s += v * v;
      const rms = Math.sqrt(s / d.length);
      const maintenant = performance.now();
      if (moyenne && rms > moyenne * 1.35 && rms > 0.02 && maintenant - dernier > 1000) {
        dernier = maintenant;
        try { config.surPic && config.surPic(); } catch (e) {}
      }
      moyenne = moyenne ? moyenne * 0.9 + rms * 0.1 : rms;
    }, 60);
  }

  function toutArreter(rapide) {
    clearInterval(minuterieReactif); minuterieReactif = null;
    arreterVoix();
    enCours.forEach((s) => { try { s.stop(); } catch (e) {} });
    enCours = [];
    if (audioFichier) {
      const a = audioFichier; audioFichier = null;
      if (rapide) { a.pause(); return; }
      const fade = setInterval(() => { a.volume = Math.max(0, a.volume - 0.08); if (a.volume <= 0) { a.pause(); clearInterval(fade); } }, 100);
    }
  }

  /** Joue une scène : son mp3 perso s'il existe, sinon les couches d'ambiance, puis le narrateur. */
  async function jouer(scene, fichierDisponible, precedente) {
    init();
    toutArreter(false);
    if (fichierDisponible && scene.fichier) {
      // Le fichier de la scène passe par la table de mixage : il baisse quand le narrateur parle
      // et suit le curseur Musique & ambiances.
      const a = new Audio(scene.fichier); a.loop = scene.boucle !== false; a.volume = 1;
      const sortie = ctx.createGain(); sortie.connect(busAmbiance || maitre); busScene = sortie;
      // volume propre au fichier de la scène (ex. musique d'accueil plus basse que le feu)
      const vf = ctx.createGain(); vf.gain.value = scene.volume_fichier ?? 1; vf.connect(sortie);
      try { niveleur(ctx.createMediaElementSource(a), vf); a.route = true; }
      catch (e) { a.volume = Math.min(1, maitre.gain.value * niveaux.ambiance); }
      audioFichier = a; a.play().catch(() => {});
      // sons joués en même temps que le fichier (ex. crépitement du feu)
      (scene.sons_avec_fichier || []).forEach((nom) => { const c = couche(nom, sortie, scene.volumes); if (c) enCours.push(c); });
    } else {
      const sortie = ctx.createGain(); sortie.connect(busAmbiance || maitre); busScene = sortie;
      (scene.sons || []).forEach((nom) => { const c = couche(nom, sortie, scene.volumes); if (c) enCours.push(c); });
      if (scene.lumiere && scene.lumiere.reactif) ecouterPics(sortie);
    }
    if (config.narrateur) {
      const liste = [];
      const dodo = precedente && precedente.id !== scene.id && precedente.quand && precedente.voix && precedente.voix.dodo
        ? [precedente.id, "dodo", precedente.voix.dodo] : null;
      if (dodo && !scene.dodo_apres) liste.push(dodo);
      if (scene.voix && scene.voix.reveil) liste.push([scene.id, "reveil", scene.voix.reveil]);
      if (dodo && scene.dodo_apres) liste.push(dodo);  // ex. l'attaque, puis « les loups se rendorment »
      if (liste.length) return narrer(liste, scene.voix_delai || 0);
      else { arreterVoix(); setTimeout(() => signal("surFinVoix"), 300); }
    } else {
      setTimeout(() => signal("surFinVoix"), 300);  // sans narrateur : on passe directement à la suite
    }
  }

  function volume(v) {
    init();
    maitre.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    if (audioFichier && !audioFichier.route) audioFichier.volume = Math.min(1, v * niveaux.ambiance);
  }

  /** Table de mixage : niveau de la voix et de la musique/ambiances (0 à 2). */
  function mixage(m) {
    Object.assign(niveaux, m);
    if (busVoix) busVoix.gain.setTargetAtTime(niveaux.voix, ctx.currentTime, 0.05);
    if (busAmbiance) busAmbiance.gain.setTargetAtTime(niveaux.ambiance, ctx.currentTime, 0.05);
    if (retourVoix) retourVoix.gain.setTargetAtTime(0.55 * niveaux.echoVoix, ctx.currentTime, 0.05);
    if (audioFichier && maitre && !audioFichier.route) audioFichier.volume = Math.min(1, maitre.gain.value * niveaux.ambiance);
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

  window.SonsLoupGarou = { init, jouer, toutArreter, volume, mixage, test, configurer, debloquerVoix, arreterVoix, etat: () => (ctx ? ctx.state : "non démarré"), liste: () => Object.keys(SONS), SONS };
})();
