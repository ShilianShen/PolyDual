import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactName, initialSolids } from "../src/geometry.ts";

test("exports: filenames encode initial dimension, face count and vertex count", () => {
  assert.deepEqual(initialSolids().map(s => artifactName(s.solid)), ["D3_N4_M4", "D3_N6_M8", "D3_N12_M20"]);
});
