import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const outputFile = resolve(
  process.argv[2] ??
    fileURLToPath(new URL("../public/dagestan-water.geojson", import.meta.url)),
);
const query = `
[out:json][timeout:180];
area["ISO3166-2"="RU-DA"][admin_level=4]->.dagestan;
(
  way["natural"="water"]["name"](area.dagestan);
  relation["natural"="water"]["name"](area.dagestan);
  way["waterway"="riverbank"]["name"](area.dagestan);
  relation["waterway"="riverbank"]["name"](area.dagestan);
  way["landuse"~"^(reservoir|basin)$"](area.dagestan);
  relation["landuse"~"^(reservoir|basin)$"](area.dagestan);
);
out body geom;
`;
const endpoints = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

let payload;
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "LandMonitor/1.0 (Dagestan water boundaries)",
      },
      body: new URLSearchParams({ data: query }),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    payload = await response.json();
    break;
  } catch (error) {
    if (endpoint === endpoints.at(-1)) throw error;
  }
}

function coordinate(point) {
  return [
    Number(point.lon.toFixed(4)),
    Number(point.lat.toFixed(4)),
  ];
}

function sameCoordinate(first, second) {
  return first?.[0] === second?.[0] && first?.[1] === second?.[1];
}

function simplifyRing(ring, tolerance = 0.0005) {
  if (ring.length <= 6) return ring;
  const simplified = [ring[0]];
  const squaredTolerance = tolerance ** 2;
  for (const point of ring.slice(1, -1)) {
    const previous = simplified.at(-1);
    const distance =
      (point[0] - previous[0]) ** 2 + (point[1] - previous[1]) ** 2;
    if (distance >= squaredTolerance) simplified.push(point);
  }
  simplified.push(simplified[0]);
  return simplified.length >= 4 ? simplified : ring;
}

function assembleRings(members, role) {
  const segments = members
    .filter(
      (member) =>
        member.type === "way" &&
        member.role === role &&
        member.geometry?.length >= 2,
    )
    .map((member) => member.geometry.map(coordinate));
  const rings = [];

  while (segments.length) {
    const ring = segments.shift();
    while (!sameCoordinate(ring[0], ring.at(-1))) {
      const tail = ring.at(-1);
      const index = segments.findIndex(
        (segment) =>
          sameCoordinate(segment[0], tail) ||
          sameCoordinate(segment.at(-1), tail),
      );
      if (index < 0) break;
      const [segment] = segments.splice(index, 1);
      if (sameCoordinate(segment.at(-1), tail)) segment.reverse();
      ring.push(...segment.slice(1));
    }
    if (ring.length >= 4 && sameCoordinate(ring[0], ring.at(-1))) {
      rings.push(simplifyRing(ring));
    }
  }
  return rings;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function waterType(tags) {
  return (
    tags.water ??
    (tags.waterway === "riverbank" ? "river" : null) ??
    tags.landuse ??
    "water"
  );
}

function properties(element) {
  return {
    osmType: element.type,
    osmId: element.id,
    name: element.tags?.name ?? null,
    water: waterType(element.tags ?? {}),
    intermittent: element.tags?.intermittent === "yes",
  };
}

const features = [];
for (const element of payload.elements ?? []) {
  if (element.type === "way" && element.geometry?.length >= 4) {
    const ring = simplifyRing(element.geometry.map(coordinate));
    if (!sameCoordinate(ring[0], ring.at(-1))) continue;
    features.push({
      type: "Feature",
      properties: properties(element),
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  if (element.type === "relation") {
    const outerRings = assembleRings(element.members ?? [], "outer");
    const innerRings = assembleRings(element.members ?? [], "inner");
    const polygons = outerRings.map((outer) => [
      outer,
      ...innerRings.filter((inner) => pointInRing(inner[0], outer)),
    ]);
    if (!polygons.length) continue;
    features.push({
      type: "Feature",
      properties: properties(element),
      geometry:
        polygons.length === 1
          ? { type: "Polygon", coordinates: polygons[0] }
          : { type: "MultiPolygon", coordinates: polygons },
    });
  }
}

if (!features.length) {
  throw new Error("Overpass не вернул полигональные водоёмы Дагестана.");
}

await writeFile(
  outputFile,
  `${JSON.stringify({
    type: "FeatureCollection",
    name: "Водоёмы Республики Дагестан",
    source: "OpenStreetMap contributors via Overpass API",
    license: "ODbL 1.0",
    generatedAt: new Date().toISOString(),
    features,
  })}\n`,
);

console.log(`${features.length} водных объектов → ${outputFile}`);
