import test from "node:test";
import assert from "node:assert/strict";
import { filterPlaces, normalizeLocalQuery } from "../src/lib/discovery.js";
import { places } from "../src/data/places.js";

test("discovery hashtags retain their city and match the sourced field guide", () => {
  for (const query of [
    "#hiddenplacegokarna",
    "#hiddenPlacesGokarna",
    "#secretspotsgokarna",
    "hidden places in Gokarna",
  ]) {
    assert.equal(filterPlaces(places, { query }).length, 6, query);
  }
  assert.equal(filterPlaces(places, { query: "#hiddenplacescoorg" }).length, 2);
  assert.equal(filterPlaces(places, { query: "#offbeathampi" }).length, 2);
  assert.equal(normalizeLocalQuery("#hiddenplacegokarna"), "gokarna");
});

test("place detail search still finds that place without a live provider", () => {
  const results = filterPlaces(places, {
    query: "Paradise Beach Gokarna reviews tips",
  });
  assert.ok(results.some((place) => place.id === "paradise-beach"));
  assert.ok(results.every((place) => place.city === "Gokarna"));
});

test("unknown cities never silently return unrelated example places", () => {
  assert.equal(
    filterPlaces(places, { query: "#hiddenplacereykjavik" }).length,
    0,
  );
});

test("destination, category, and saved-place constraints compose", () => {
  const filters = {
    city: "Gokarna",
    category: "Beaches",
    savedIds: ["paradise-beach", "mirjan-fort", "badi-lake"],
  };
  assert.deepEqual(
    filterPlaces(places, filters).map((place) => place.id),
    ["paradise-beach"],
  );
  assert.equal(filterPlaces(places, { savedIds: [] }).length, 0);
});
