// Self-check for the virtual-zone model (no DOM, no HA). Run: node test/zone-model.test.mjs
// Loads each card source with just enough stubs to reach the static helpers.
import { readFileSync } from "node:fs";
import assert from "node:assert";

class FakeEl { attachShadow() { return {}; } addEventListener() {} }
globalThis.HTMLElement = FakeEl;
globalThis.window = {};
globalThis.document = { createElement: () => new FakeEl() };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.customElements = { get: () => ({ define() {} }), define() {} };

function load(file, names) {
  const code = readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
  return new Function(code + "\nreturn {" + names.join(",") + "};")();
}

const { HierarchyEnergyCard } = load("hierarchy-energy-card.js", ["HierarchyEnergyCard"]);
const { HierarchyPowerCard } = load("hierarchy-power-card.js", ["HierarchyPowerCard"]);

for (const Card of [HierarchyEnergyCard, HierarchyPowerCard]) {
  const zones = Card._normalizeZones({
    virtual_energy_zones: [
      { name: "Ground", areas: ["kitchen", "living_room", "kitchen"] },
      { name: "Ground", id: "g2", areas: ["garage", 7, ""] },
      { name: "Annex", icon: "mdi:garage", areas: ["garage", "kitchen"] },
      { bogus: true },
      "nope",
    ],
  });
  assert.deepStrictEqual(zones.map((z) => z.id), ["ground", "g2", "annex"], "ids are unique slugs");
  assert.deepStrictEqual(zones[0].areas, ["kitchen", "living_room"], "areas deduped within a zone");
  assert.deepStrictEqual(zones[1].areas, ["garage"], "non-string areas dropped");
  assert.strictEqual(zones[2].icon, "mdi:garage");
  assert.strictEqual(zones[3], undefined, "objects without a name/area are skipped");

  // Uniqueness: first zone in config order keeps a contested area.
  const fake = { _zoneIndex: Card.prototype._zoneIndex };
  const { map, conflicts } = Card.prototype._zoneIndex.call(fake, zones);
  assert.strictEqual(map.get("kitchen").id, "ground");
  assert.strictEqual(map.get("garage").id, "g2");
  assert.strictEqual(conflicts.length, 2, "annex loses garage and kitchen");
  assert.deepStrictEqual(conflicts.map((c) => c.area).sort(), ["garage", "kitchen"]);
}
console.log("zone model self-check OK");
