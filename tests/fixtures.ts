import type { Options } from "../src/config.ts";

// Fixed reference settings keep geometric accuracy tests independent of user edits.
export const referenceOptions: Options = {
  seconds: 5, hold: 0.8, samples: 60, size: 640,
  view: [4, 1.5, 2], light: [-3, 5, 6], hue: 209, saturation: 58,
  background: "#f5f8fb", stroke: "#142c3a", strokeWidth: 1.25,
  rotation: { enabled: false, axis: [0, 1, 0], turns: 1 },
};

export function referenceConfig() {
  return {
    out: "output", defaults: structuredClone(referenceOptions),
    animations: {
      tetrahedron: { enabled: true, hue: 163 },
      "cube-octahedron": { enabled: true, hue: 209 },
      "dodecahedron-icosahedron": { enabled: true, hue: 33 },
    },
  };
}
