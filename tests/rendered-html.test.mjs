import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the LandMonitor dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /LandMonitor/);
  assert.match(html, /Аналитическая панель мониторинга земель/);
  assert.match(html, /Республика Дагестан/);
  assert.match(html, /Реальные спутниковые данные/);
  assert.match(html, /Спутник · Sentinel-2 RGB/);
  assert.match(html, /satellite-data\.js/);
  assert.match(html, /territory-select/);
  assert.match(html, /timeline-range/);
  assert.match(html, /Ногайский район/);
  assert.match(html, /Google Earth/);
  assert.match(html, /download-earth-kml/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships project metadata and social preview", async () => {
  const [
    page,
    layout,
    globalsCss,
    satelliteData,
    districts,
    water,
    packageJson,
  ] = await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
      readFile(new URL("../public/satellite-data.js", import.meta.url), "utf8"),
      readFile(
        new URL("../public/dagestan-districts.geojson", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../public/dagestan-water.geojson", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      access(new URL("../public/og.png", import.meta.url)),
    ]);

  assert.match(page, /Sentinel-2 L2A/);
  assert.match(page, /Комплексный риск/);
  assert.match(page, /Planetary Computer/);
  assert.match(satelliteData, /runSelectedAnalysis/);
  assert.match(satelliteData, /pointInGeometry/);
  assert.match(satelliteData, /renderWaterBodies/);
  assert.match(satelliteData, /downloadGoogleEarthKml/);
  assert.match(satelliteData, /Gamma RGB 3\.2 Saturation 0\.8/);
  assert.match(satelliteData, /color_formula/);
  assert.match(satelliteData, /application\/vnd\.google-earth\.kml\+xml/);
  assert.match(satelliteData, /attributionControl\.setPrefix\(false\)/);
  assert.match(satelliteData, /interactive: false,\s+style: districtStyle/);
  assert.doesNotMatch(satelliteData, /state\.map\.on\("click"/);
  assert.doesNotMatch(satelliteData, /selectTerritory\(feature/);
  assert.doesNotMatch(satelliteData, /satellite-map-label/);
  assert.match(page, /defaultValue="100"/);
  assert.match(page, /Непрозрачность слоя/);
  assert.match(page, /−0,5 · сухо/);
  assert.match(globalsCss, /#a50026/);
  assert.match(globalsCss, /#006837/);
  assert.match(globalsCss, /#053061/);
  assert.equal(JSON.parse(districts).features.length, 51);
  assert.ok(Array.isArray(JSON.parse(water).features));
  assert.match(layout, /socialImage/);
  assert.match(layout, /summary_large_image/);
  assert.match(packageJson, /"name": "land-monitor-dagestan"/);
  assert.match(packageJson, /NEXT_PUBLIC_BASE_PATH=\/land-monitor-dagestan/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("selects satellite scenes by date and territory", async () => {
  const { mapScenes, pointInGeometry } = await import(
    new URL("../public/satellite-data.js", import.meta.url)
  );
  const boundary = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [44, 45],
          [46, 45],
          [46, 47],
          [44, 47],
          [44, 45],
        ],
      ],
    },
  };
  const scene = (id, tile, datetime, bbox) => ({
    id,
    bbox,
    properties: {
      datetime,
      "s2:mgrs_tile": tile,
      "eo:cloud_cover": 5,
    },
  });
  const scenes = [
    scene("may", "38TMS", "2026-05-10T08:00:00Z", [44, 45, 45, 46]),
    scene("july", "38TMS", "2026-07-10T08:00:00Z", [44, 45, 45, 46]),
    scene("outside", "39AAA", "2026-05-10T08:00:00Z", [50, 50, 51, 51]),
  ];

  assert.deepEqual(
    mapScenes(scenes, new Date("2026-06-01T00:00:00Z"), boundary).map(
      (item) => item.id,
    ),
    ["may"],
  );
  assert.equal(pointInGeometry([45, 46], boundary.geometry), true);
  assert.equal(pointInGeometry([50, 50], boundary.geometry), false);
});
