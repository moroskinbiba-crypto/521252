const assert = require("node:assert/strict");
const Engine = require("../animation-engine.js");

const settings = {
  threshold: 0,
  brightness: 0,
  invert: false,
  algorithm: "bayer4",
  effectStrength: { noise: 20 },
  effects: ["noise"],
  shapeBands: [{ size: 40, rotation: 0, shape: "circle", color: "#ffffff", customViewBox: [0, 0, 100, 100] }],
  algorithmLayers: [{ opacity: 30, enabled: true, algorithm: "bayer4", blend: "normal" }]
};

let clip = Engine.createClip({ durationMs: 1000, fps: 24, loop: false });
clip = Engine.setKeyframe(clip, "threshold", 0, 0, "linear");
clip = Engine.setKeyframe(clip, "threshold", 1000, 100, "linear");
assert.equal(Engine.evaluate(settings, clip, 500).threshold, 50);
assert.equal(Engine.evaluate(settings, clip, 1000).threshold, 100);

let eased = Engine.createClip({ durationMs: 1000 });
eased = Engine.setKeyframe(eased, "threshold", 0, 0, "easeIn");
eased = Engine.setKeyframe(eased, "threshold", 1000, 100, "linear");
assert.equal(Engine.evaluate(settings, eased, 500).threshold, 25);

let stepped = Engine.createClip({ durationMs: 1000 });
stepped = Engine.setKeyframe(stepped, "algorithm", 0, "bayer2", "step");
stepped = Engine.setKeyframe(stepped, "algorithm", 1000, "floyd", "linear");
assert.equal(Engine.evaluate(settings, stepped, 500).algorithm, "bayer2");
assert.equal(Engine.evaluate(settings, stepped, 1000).algorithm, "floyd");

let booleanTrack = Engine.createClip({ durationMs: 1000 });
booleanTrack = Engine.setKeyframe(booleanTrack, "invert", 0, false);
booleanTrack = Engine.setKeyframe(booleanTrack, "invert", 1000, true);
assert.equal(Engine.evaluate(settings, booleanTrack, 500).invert, false);
assert.equal(Engine.evaluate(settings, booleanTrack, 1000).invert, true);

let nested = Engine.createClip({ durationMs: 1000 });
nested = Engine.setKeyframe(nested, "effectStrength.noise", 0, 0);
nested = Engine.setKeyframe(nested, "effectStrength.noise", 1000, 80);
nested = Engine.setKeyframe(nested, "shapeBands.0.size", 0, 40);
nested = Engine.setKeyframe(nested, "shapeBands.0.size", 1000, 100);
nested = Engine.setKeyframe(nested, "algorithmLayers.0.opacity", 0, 30);
nested = Engine.setKeyframe(nested, "algorithmLayers.0.opacity", 1000, 90);
nested = Engine.setKeyframe(nested, "algorithmLayers.0.enabled", 0, true);
nested = Engine.setKeyframe(nested, "algorithmLayers.0.enabled", 1000, false);
nested = Engine.setKeyframe(nested, "shapeBands.0.color", 0, "#ffffff");
nested = Engine.setKeyframe(nested, "shapeBands.0.color", 1000, "#000000");
nested = Engine.setKeyframe(nested, "effects.noise", 0, true);
nested = Engine.setKeyframe(nested, "effects.noise", 1000, false);
const nestedResult = Engine.evaluate(settings, nested, 500);
assert.equal(nestedResult.effectStrength.noise, 40);
assert.equal(nestedResult.shapeBands[0].size, 70);
assert.equal(nestedResult.algorithmLayers[0].opacity, 60);
assert.equal(nestedResult.algorithmLayers[0].enabled, true);
assert.equal(nestedResult.shapeBands[0].color, "#ffffff", "discrete band colours remain stable before their endpoint");
assert.equal(nestedResult.effects.includes("noise"), true);
assert.equal(Engine.evaluate(settings, nested, 1000).effects.includes("noise"), false);

let oscillator = Engine.createClip({ durationMs: 1000 });
oscillator = Engine.setOscillator(oscillator, "brightness", {
  wave: "sine", amount: 12, frequency: 1, phase: 0
});
assert.ok(Math.abs(Engine.evaluate(settings, oscillator, 250).brightness - 12) < 1e-8,
  "oscillator-only tracks should modulate a base value");
assert.equal(Engine.evaluate(settings, oscillator, 750).brightness, -12);

const normalised = Engine.normalise({
  durationMs: 999999, fps: 0, loop: false,
  tracks: {
    threshold: { keyframes: [
      { timeMs: 90000, value: 10, easing: "unknown" },
      { timeMs: 50, value: 20, easing: "easeOut" },
      { timeMs: 50, value: 30, easing: "linear" }
    ] },
    brightness: { keyframes: [], oscillator: { wave: "triangle", amount: 8, frequency: 2 } },
    "__proto__": { keyframes: [{ timeMs: 0, value: 100 }] }
  }
});
assert.equal(normalised.durationMs, 60000);
assert.equal(normalised.fps, 24);
assert.equal(normalised.loop, false);
assert.equal(normalised.tracks.threshold.keyframes.length, 2);
assert.equal(normalised.tracks.threshold.keyframes[0].value, 30);
assert.ok(normalised.tracks.brightness.oscillator);
assert.equal(Object.prototype.polluted, undefined);

const changed = Engine.evaluate(settings, normalised, 50);
assert.equal(changed.threshold, 30);
assert.equal(settings.threshold, 0, "evaluation must not mutate the source settings");
assert.equal(Engine.setPath(settings, "__proto__.polluted", true), false);
assert.equal(Engine.getPath(settings, "__proto__.polluted"), undefined);

const limited = Engine.normalise({
  durationMs: 1000,
  tracks: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [
    "track" + index, { keyframes: [{ timeMs: 0, value: index }] }
  ]))
});
assert.ok(Object.keys(limited.tracks).length <= 100);
assert.ok(Engine.listPaths(settings).includes("effectStrength.noise"));
assert.ok(Engine.listPaths(settings).includes("shapeBands.0.size"));
assert.ok(Engine.listPaths(settings).includes("shapeBands.0.color"));
assert.ok(Engine.listPaths(settings).includes("algorithmLayers.0.enabled"));
assert.ok(Engine.listPaths(settings).includes("effects.noise"));
assert.ok(Engine.listPaths(settings).includes("algorithmLayers.0.opacity"));


const beforeArrayLengths = {
  effects: settings.effects.length,
  shapeBands: settings.shapeBands.length,
  algorithmLayers: settings.algorithmLayers.length,
  customViewBox: settings.shapeBands[0].customViewBox.length
};
for (const path of [
  "effects.length",
  "shapeBands.length",
  "algorithmLayers.length",
  "shapeBands.0.customViewBox.0",
  "shapeBands.000.size",
  "algorithmLayers.0.constructor"
]) {
  assert.equal(Engine.setPath(settings, path, 1000000), false,
    "array structure and unsupported array paths must not be writable: " + path);
}
assert.deepEqual({
  effects: settings.effects.length,
  shapeBands: settings.shapeBands.length,
  algorithmLayers: settings.algorithmLayers.length,
  customViewBox: settings.shapeBands[0].customViewBox.length
}, beforeArrayLengths, "rejected animation paths must not mutate source array structure");

const hostileClipInput = JSON.parse(JSON.stringify({
  durationMs: 1000,
  tracks: {
    "shapeBands.length": { keyframes: [{ timeMs: 0, value: 1000000 }] },
    "algorithmLayers.length": { keyframes: [{ timeMs: 0, value: 1000000 }] },
    "effects.length": { keyframes: [{ timeMs: 0, value: 1000000 }] },
    "shapeBands.0.size": { keyframes: [{ timeMs: 0, value: 77 }] }
  }
}));
Object.defineProperty(hostileClipInput.tracks, "__proto__", {
  enumerable: true, configurable: true, writable: true,
  value: { keyframes: [{ timeMs: 0, value: 1 }] }
});
const hostileClip = Engine.normalise(hostileClipInput);
assert.equal(Object.getPrototypeOf(hostileClip.tracks), null,
  "normalized track maps should not inherit attacker-controlled properties");
assert.equal(Object.prototype.hasOwnProperty.call(hostileClip.tracks, "__proto__"), false,
  "reserved prototype paths must be discarded during import");
const hostileResult = Engine.evaluate(settings, hostileClip, 500);
assert.equal(hostileResult.shapeBands.length, beforeArrayLengths.shapeBands,
  "imported clips must not expand the Shape Lab array");
assert.equal(hostileResult.algorithmLayers.length, beforeArrayLengths.algorithmLayers,
  "imported clips must not expand the algorithm-layer array");
assert.equal(hostileResult.effects.length, beforeArrayLengths.effects,
  "imported clips must not change the effects array length");
assert.equal(hostileResult.shapeBands[0].size, 77,
  "valid nested animation paths must continue to work");
assert.equal(Object.prototype.polluted, undefined,
  "hostile imported tracks must not pollute Object.prototype");

console.log("Animation engine tests passed: interpolation, easing, discrete tracks, nested paths, oscillators, limits and unsafe-path rejection.");
