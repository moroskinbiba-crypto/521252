/* TGRMLither Animation Engine — deterministic keyframes and temporal modulation. */
(function attachAnimationEngine(root) {
  "use strict";
  const VERSION = 1;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const clone = value => JSON.parse(JSON.stringify(value));
  const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
  const EFFECT_KEYS = new Set(["scanlines", "glow", "chromatic", "vignette", "noise", "epsilon", "jpeg", "lick", "stress", "modlines"]);

  function safePath(path, settings) {
    if (typeof path !== "string" || !path || path.length > 120) return false;
    const parts = path.split(".");
    if (parts.some(part => !part || RESERVED.has(part))) return false;
    if (parts.length === 2 && parts[0] === "effects" && EFFECT_KEYS.has(parts[1])) return Array.isArray(settings.effects);
    let cursor = settings;
    for (const part of parts) {
      if (cursor === null || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, part)) return false;
      cursor = cursor[part];
    }
    return cursor === null || ["number", "string", "boolean"].includes(typeof cursor);
  }

  function getPath(settings, path) {
    if (!safePath(path, settings)) return undefined;
    if (path.startsWith("effects.")) return settings.effects.includes(path.slice(8));
    return path.split(".").reduce((value, part) => value[part], settings);
  }

  function setPath(settings, path, value) {
    if (!safePath(path, settings)) return false;
    if (path.startsWith("effects.")) {
      const effect = path.slice(8), enabled = Boolean(value);
      settings.effects = enabled ? [...new Set([...settings.effects, effect])] : settings.effects.filter(item => item !== effect);
      return true;
    }
    const parts = path.split(".");
    let target = settings;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    const key = parts[parts.length - 1];
    const current = target[key];
    if (typeof current === "number") {
      const next = Number(value);
      if (!Number.isFinite(next)) return false;
      target[key] = next;
    } else if (typeof current === "boolean") {
      target[key] = Boolean(value);
    } else if (typeof current === "string" && typeof value === "string") {
      target[key] = value.slice(0, 160);
    } else {
      return false;
    }
    return true;
  }

  function listPaths(settings) {
    const paths = [];
    if (Array.isArray(settings.effects)) for (const effect of EFFECT_KEYS) paths.push("effects." + effect);
    const visit = (value, prefix) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (RESERVED.has(key)) continue;
        const path = prefix ? prefix + "." + key : key;
        if (typeof child === "number" && Number.isFinite(child)) paths.push(path);
        else if (typeof child === "boolean") paths.push(path);
        else if (typeof child === "string" && ["algorithm", "palette", "colorMode", "patternShape", "qualityMode", "shapeDistribution", "asciiSet", "asciiColorMode", "neoGlowDirection"].includes(path)) paths.push(path);
        else if (child && typeof child === "object" && !Array.isArray(child)) visit(child, path);
        else if (Array.isArray(child) && path === "algorithmLayers") child.forEach((layer, index) => {
          if (!layer) return;
          for (const property of ["opacity", "enabled", "algorithm", "blend"]) {
            if (Object.prototype.hasOwnProperty.call(layer, property) && (typeof layer[property] === "boolean" || typeof layer[property] === "string" || Number.isFinite(layer[property]))) paths.push(path + "." + index + "." + property);
          }
        });
        else if (Array.isArray(child) && path === "shapeBands") child.forEach((band, index) => {
          if (!band) return;
          for (const property of ["size", "rotation", "shape", "color"]) {
            if (Object.prototype.hasOwnProperty.call(band, property) && (typeof band[property] === "boolean" || typeof band[property] === "string" || Number.isFinite(band[property]))) paths.push(path + "." + index + "." + property);
          }
        });
      }
    };
    visit(settings, "");
    return [...new Set(paths)].filter(path => safePath(path, settings)).sort();
  }

  function createClip(input) {
    return normalise(input);
  }

  function normalise(input) {
    const raw = input && typeof input === "object" ? input : {};
    const durationMs = clamp(Math.round(Number(raw.durationMs) || 5000), 250, 60000);
    const fps = clamp(Math.round(Number(raw.fps) || 24), 1, 60);
    const tracks = {};
    let totalFrames = 0;
    if (raw.tracks && typeof raw.tracks === "object" && !Array.isArray(raw.tracks)) {
      for (const [path, source] of Object.entries(raw.tracks).slice(0, 100)) {
        if (!source || typeof source !== "object" || !Array.isArray(source.keyframes)) continue;
        const frames = [];
        for (const frame of source.keyframes.slice(0, 200)) {
          const timeMs = clamp(Math.round(Number(frame && frame.timeMs) || 0), 0, durationMs);
          const value = frame && frame.value;
          if (!["number", "string", "boolean"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))) continue;
          frames.push({
            timeMs,
            value: typeof value === "string" ? value.slice(0, 160) : value,
            easing: ["linear", "easeIn", "easeOut", "easeInOut", "step"].includes(frame.easing) ? frame.easing : "linear"
          });
        }
        frames.sort((a, b) => a.timeMs - b.timeMs);
        const deduped = [];
        for (const frame of frames) {
          if (deduped.length && deduped[deduped.length - 1].timeMs === frame.timeMs) deduped[deduped.length - 1] = frame;
          else deduped.push(frame);
        }
        totalFrames += deduped.length;
        if (deduped.length || (source.oscillator && typeof source.oscillator === "object")) {
          const sourceOscillator = source.oscillator && typeof source.oscillator === "object" ? source.oscillator : null;
          let oscillator = null;
          if (sourceOscillator) {
            const amount = Number(sourceOscillator.amount);
            const frequency = Number(sourceOscillator.frequency);
            if (Number.isFinite(amount) && Number.isFinite(frequency)) oscillator = {
              wave: ["sine", "triangle", "saw", "square"].includes(sourceOscillator.wave) ? sourceOscillator.wave : "sine",
              amount: clamp(amount, -1000, 1000),
              frequency: clamp(frequency, 0.01, 20),
              phase: clamp(Number(sourceOscillator.phase) || 0, -Math.PI * 4, Math.PI * 4)
            };
          }
          tracks[path] = { keyframes: deduped, oscillator };
        }
      }
    }
    if (totalFrames > 1000) {
      for (const path of Object.keys(tracks)) {
        if (totalFrames <= 1000) break;
        totalFrames -= tracks[path].keyframes.length;
        delete tracks[path];
      }
    }
    return { version: VERSION, durationMs, fps, loop: raw.loop !== false, tracks };
  }

  function setKeyframe(clipInput, path, timeMs, value, easing) {
    const clip = normalise(clipInput);
    if (typeof path !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*$/.test(path)) throw new Error("Недопустимый параметр анимации");
    if (!["number", "string", "boolean"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Недопустимое значение ключевого кадра");
    const time = clamp(Math.round(Number(timeMs) || 0), 0, clip.durationMs);
    const track = clip.tracks[path] || { keyframes: [], oscillator: null };
    if (!track.keyframes.some(frame => frame.timeMs === time) && Object.values(clip.tracks).reduce((sum, item) => sum + item.keyframes.length, 0) >= 1000) throw new Error("В клипе достигнут лимит 1000 ключевых кадров");
    const frame = { timeMs: time, value, easing: ["linear", "easeIn", "easeOut", "easeInOut", "step"].includes(easing) ? easing : "linear" };
    const index = track.keyframes.findIndex(item => item.timeMs === time);
    if (index >= 0) track.keyframes[index] = frame;
    else track.keyframes.push(frame);
    track.keyframes.sort((a, b) => a.timeMs - b.timeMs);
    clip.tracks[path] = track;
    return clip;
  }

  function removeKeyframe(clipInput, path, timeMs) {
    const clip = normalise(clipInput);
    const track = clip.tracks[path];
    if (!track) return clip;
    track.keyframes = track.keyframes.filter(frame => frame.timeMs !== Math.round(Number(timeMs)));
    if (!track.keyframes.length) delete clip.tracks[path];
    return clip;
  }

  function setOscillator(clipInput, path, oscillator) {
    const clip = normalise(clipInput);
    if (!clip.tracks[path]) clip.tracks[path] = { keyframes: [], oscillator: null };
    if (!oscillator) clip.tracks[path].oscillator = null;
    else {
      const amount = Number(oscillator.amount), frequency = Number(oscillator.frequency);
      if (!Number.isFinite(amount) || !Number.isFinite(frequency)) throw new Error("Параметры модуляции должны быть числами");
      clip.tracks[path].oscillator = {
        wave: ["sine", "triangle", "saw", "square"].includes(oscillator.wave) ? oscillator.wave : "sine",
        amount: clamp(amount, -1000, 1000),
        frequency: clamp(frequency, 0.01, 20),
        phase: clamp(Number(oscillator.phase) || 0, -Math.PI * 4, Math.PI * 4)
      };
    }
    if (!clip.tracks[path].keyframes.length && !clip.tracks[path].oscillator) delete clip.tracks[path];
    return clip;
  }

  function ease(t, mode) {
    if (mode === "easeIn") return t * t;
    if (mode === "easeOut") return 1 - (1 - t) * (1 - t);
    if (mode === "easeInOut") return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return t;
  }

  function waveAt(timeMs, oscillator) {
    const phase = ((timeMs / 1000) * oscillator.frequency * Math.PI * 2 + oscillator.phase) / (Math.PI * 2);
    const unit = ((phase % 1) + 1) % 1;
    if (oscillator.wave === "triangle") return 1 - 4 * Math.abs(unit - .5);
    if (oscillator.wave === "saw") return unit * 2 - 1;
    if (oscillator.wave === "square") return unit < .5 ? 1 : -1;
    return Math.sin(phase * Math.PI * 2);
  }

  function valueAt(track, timeMs, fallback) {
    const frames = track.keyframes;
    if (!frames.length) return fallback;
    if (timeMs <= frames[0].timeMs) return frames[0].value;
    if (timeMs >= frames[frames.length - 1].timeMs) return frames[frames.length - 1].value;
    let left = frames[0], right = frames[1];
    for (let index = 1; index < frames.length; index++) {
      if (timeMs <= frames[index].timeMs) { left = frames[index - 1]; right = frames[index]; break; }
    }
    if (typeof left.value !== "number" || typeof right.value !== "number" || left.easing === "step") return left.value;
    const span = Math.max(1, right.timeMs - left.timeMs);
    const t = ease(clamp((timeMs - left.timeMs) / span, 0, 1), left.easing);
    return left.value + (right.value - left.value) * t;
  }

  function evaluate(settingsInput, clipInput, timeMs) {
    const settings = clone(settingsInput || {});
    const clip = normalise(clipInput);
    const time = clamp(Number(timeMs) || 0, 0, clip.durationMs);
    for (const [path, track] of Object.entries(clip.tracks)) {
      if (!safePath(path, settings)) continue;
      const fallback = getPath(settings, path);
      let value = valueAt(track, time, fallback);
      if (typeof value === "number" && track.oscillator) value += waveAt(time, track.oscillator) * track.oscillator.amount;
      setPath(settings, path, value);
    }
    return settings;
  }

  const api = Object.freeze({ version: VERSION, createClip, normalise, listPaths, getPath, setPath, setKeyframe, removeKeyframe, setOscillator, evaluate, waveAt });
  root.TGRMAnimationEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
