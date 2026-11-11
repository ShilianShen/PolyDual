import type { Options } from "../src/config.ts";

// Fixed reference settings keep geometric accuracy tests independent of user edits.
export const referenceOptions: Options = {
  seconds: 5, hold: 0.8, samples: 60, size: 640,
  view: [4, 1.5, 2], light: [-3, 5, 6], strokeWidth: 1.25,
  colors: {
    mode: "auto",
    light: { fill: "#7db8e0", dualFill: "#eea771", stroke: "#243746" },
    dark: { fill: "#91cbf2", dualFill: "#ffc394", stroke: "#d6e8f5" },
  },
  rotation: { enabled: false, axis: [0, 1, 0], turns: 1 },
};

export function referenceConfig() {
  return {
    out: "output", defaults: structuredClone(referenceOptions),
    animations: {
      tetrahedron: { enabled: true },
      "cube-octahedron": { enabled: true },
      "dodecahedron-icosahedron": { enabled: true },
    },
  };
}
