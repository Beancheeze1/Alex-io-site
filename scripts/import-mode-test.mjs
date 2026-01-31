import assert from "node:assert/strict";

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function applyImport(layout, seed, mode) {
  const next = clone(layout);
  const seedLayer = seed.stack?.[0] ?? { cavities: [] };
  const seedCavs = seedLayer.cavities ?? seed.cavities ?? [];

  if (mode === "append") {
    const idx = next.stack.length + 1;
    next.stack.push({
      id: `layer-${idx}`,
      label: `Layer ${idx}`,
      thicknessIn: seedLayer.thicknessIn ?? next.block.thicknessIn,
      cavities: seedCavs,
    });
    next.cavities = seedCavs;
    return next;
  }

  next.stack = next.stack.map((l, i) =>
    i === 0 ? { ...l, thicknessIn: seedLayer.thicknessIn ?? l.thicknessIn, cavities: seedCavs } : l,
  );
  next.cavities = seedCavs;
  return next;
}

const base = {
  block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 },
  stack: [
    { id: "layer-1", label: "Layer 1", thicknessIn: 2, cavities: [{ id: "cav-1", x: 0.1, y: 0.1 }] },
  ],
  cavities: [{ id: "cav-1", x: 0.1, y: 0.1 }],
};

const seed = {
  block: { lengthIn: 8, widthIn: 8, thicknessIn: 2 },
  stack: [
    { id: "seed-layer-1", label: "Layer 1", thicknessIn: 2, cavities: [{ id: "seed-cav-1", x: 0.2, y: 0.2 }] },
  ],
  cavities: [{ id: "seed-cav-1", x: 0.2, y: 0.2 }],
};

const appended = applyImport(base, seed, "append");
assert.equal(appended.stack.length, 2);
assert.equal(appended.stack[0].cavities.length, 1);
assert.equal(appended.stack[1].cavities.length, 1);

const replaced = applyImport(base, seed, "replace");
assert.equal(replaced.stack.length, 1);
assert.equal(replaced.stack[0].cavities.length, 1);

console.log("import-mode-test: OK");
