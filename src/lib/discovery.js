export const categories = [
  "All discoveries",
  "Beaches",
  "Nature",
  "Trails",
  "Culture",
];

export function normalizeLocalQuery(value) {
  return value
    .trim()
    .replace(/#/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(
      /hidden\s*places?|hidden\s*gems?|secret\s*spots?|slow\s*days|beyond|offbeat|explore|discover|things\s*to\s*do/gi,
      " ",
    )
    .replace(/\b(?:reviews?|tips?|suggestions?|recommendations?)\b/gi, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function filterPlaces(
  places,
  {
    query = "",
    category = "All discoveries",
    city = "All destinations",
    savedIds = null,
  } = {},
) {
  const words = normalizeLocalQuery(query)
    .split(" ")
    .filter(
      (word) =>
        word.length > 1 &&
        !["in", "near", "the", "and", "to", "of", "a"].includes(word),
    );
  return places.filter((place) => {
    const haystack = [
      place.name,
      place.city,
      place.region,
      place.category,
      place.description,
      ...place.tags,
    ]
      .join(" ")
      .toLowerCase();
    return (
      (category === "All discoveries" || place.category === category) &&
      (city === "All destinations" || place.city === city) &&
      (!savedIds || savedIds.includes(place.id)) &&
      words.every((word) => haystack.includes(word))
    );
  });
}

export function loadSavedPlaces() {
  try {
    const saved = JSON.parse(localStorage.getItem("elsewhere:saved") || "[]");
    return Array.isArray(saved)
      ? saved.filter((id) => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}
