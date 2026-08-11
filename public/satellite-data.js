const STAC_SEARCH =
  "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const ITEM_STATISTICS =
  "https://planetarycomputer.microsoft.com/api/data/v1/item/statistics";
const ITEM_PREVIEW =
  "https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png";
const COLLECTION = "sentinel-2-l2a";
const MAX_STATISTIC_SCENES = 12;
const MAX_MAP_SCENES = 16;
const MAX_SEARCH_SCENES = 1000;

const INDEXES = {
  ndvi: {
    assets: ["B04", "B08"],
    expression: "(B08-B04)/(B08+B04)",
  },
  ndmi: {
    assets: ["B08", "B11"],
    expression: "(B08-B11)/(B08+B11)",
  },
  bsi: {
    assets: ["B02", "B04", "B08", "B11"],
    expression: "((B11+B04)-(B08+B02))/((B11+B04)+(B08+B02))",
  },
};

const RISK_EXPRESSION =
  "0.45*((0.45-((B08-B04)/(B08+B04)))/0.6)" +
  "+0.30*((0.25-((B08-B11)/(B08+B11)))/0.7)" +
  "+0.25*((((B11+B04)-(B08+B02))/((B11+B04)+(B08+B02))+0.2)/0.7)";

const MAP_LAYERS = {
  risk: {
    assets: ["B02", "B04", "B08", "B11"],
    expression: RISK_EXPRESSION,
    rescale: "0,1",
    colormap: "rdylgn_r",
    label: "Модельный риск · Sentinel-2",
  },
  ndvi: {
    ...INDEXES.ndvi,
    rescale: "-0.3,0.8",
    colormap: "rdylgn",
    label: "Растительность · NDVI",
  },
  bsi: {
    ...INDEXES.bsi,
    rescale: "-0.4,0.4",
    colormap: "rdylgn_r",
    label: "Оголение почв · BSI",
  },
  ndmi: {
    ...INDEXES.ndmi,
    rescale: "-0.5,0.5",
    colormap: "rdbu",
    label: "Влажность · NDMI",
  },
};

const state = {
  metrics: null,
  searchController: null,
  analysisController: null,
  boundary: null,
  districts: null,
  waterBodies: null,
  selectedDistrict: null,
  selectedDate: null,
  scenes: [],
  map: null,
  baseLayer: null,
  boundaryLayer: null,
  districtLayer: null,
  waterLayer: null,
  waterRenderer: null,
  sceneOutline: null,
  analysisLayers: [],
  resizeObserver: null,
  timelineTimer: null,
  syncingTerritory: false,
};

function element(id) {
  return document.getElementById(id);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatIndex(value) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function setCurrentPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 120);
  element("period-start").value = toIsoDate(start);
  element("period-end").value = toIsoDate(end);
}

async function loadBoundary() {
  if (globalThis.__DAGESTAN_BOUNDARY__) {
    return globalThis.__DAGESTAN_BOUNDARY__.features[0];
  }

  const response = await fetch(new URL("dagestan.geojson", import.meta.url));
  if (!response.ok) {
    throw new Error("Не удалось загрузить административную границу.");
  }
  const collection = await response.json();
  return collection.features[0];
}

async function loadDistricts() {
  if (globalThis.__DAGESTAN_DISTRICTS__) {
    return globalThis.__DAGESTAN_DISTRICTS__;
  }

  const response = await fetch(
    new URL("dagestan-districts.geojson", import.meta.url),
  );
  if (!response.ok) {
    throw new Error("Не удалось загрузить границы районов.");
  }
  return response.json();
}

async function loadWaterBodies() {
  const response = await fetch(
    new URL("dagestan-water.geojson", import.meta.url),
  );
  if (!response.ok) {
    throw new Error("Не удалось загрузить границы водоёмов.");
  }
  return response.json();
}

function mgrsTile(scene) {
  return (
    scene.properties?.["s2:mgrs_tile"] ??
    scene.id.match(/_T(\d{2}[A-Z]{3})_/)?.[1] ??
    scene.id
  );
}

function bboxArea(bbox = []) {
  if (bbox.length < 4) return 0;
  return Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
}

async function searchScenes(boundary, start, end, cloud, signal) {
  const response = await fetch(STAC_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: [COLLECTION],
      intersects: boundary.geometry,
      datetime: `${start}T00:00:00Z/${end}T23:59:59Z`,
      limit: MAX_SEARCH_SCENES,
      sortby: [{ field: "datetime", direction: "desc" }],
      query: { "eo:cloud_cover": { lt: Number(cloud) } },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Каталог Sentinel-2 недоступен (${response.status}).`);
  }

  const { features = [] } = await response.json();
  if (!features.length) {
    throw new Error("За выбранный период подходящих сцен не найдено.");
  }

  return features
    .filter((scene) => bboxArea(scene.bbox) >= 0.03)
    .sort(
      (first, second) =>
        new Date(second.properties.datetime) -
        new Date(first.properties.datetime),
    )
    .slice(0, MAX_SEARCH_SCENES);
}

async function sceneStatistic(scene, boundary, index, signal) {
  const definition = INDEXES[index];
  const url = new URL(ITEM_STATISTICS);
  url.searchParams.set("collection", COLLECTION);
  url.searchParams.set("item", scene.id);
  definition.assets.forEach((asset) => url.searchParams.append("assets", asset));
  url.searchParams.set("expression", definition.expression);
  url.searchParams.set("asset_as_band", "true");
  url.searchParams.set("max_size", "96");
  url.searchParams.set("nodata", "0");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(boundary),
    signal,
  });

  if (!response.ok) return null;
  const feature = await response.json();
  const statistics = feature.properties?.statistics ?? {};
  const values =
    statistics[definition.expression] ?? Object.values(statistics)[0];
  if (!values || !Number.isFinite(values.mean)) return null;
  return { mean: values.mean, count: values.count ?? 1 };
}

async function calculateIndexes(scenes, boundary, signal) {
  const uniqueTiles = new Map();
  for (const scene of scenes) {
    const tile = mgrsTile(scene);
    if (!uniqueTiles.has(tile)) uniqueTiles.set(tile, scene);
  }
  const statisticScenes = [...uniqueTiles.values()].slice(
    0,
    MAX_STATISTIC_SCENES,
  );
  const entries = await Promise.all(
    statisticScenes.flatMap((scene) =>
      Object.keys(INDEXES).map(async (index) => ({
        index,
        value: await sceneStatistic(scene, boundary, index, signal),
      })),
    ),
  );

  const result = {};
  for (const index of Object.keys(INDEXES)) {
    const valid = entries.filter(
      (entry) => entry.index === index && entry.value,
    );
    const pixels = valid.reduce((sum, entry) => sum + entry.value.count, 0);
    if (!pixels) throw new Error(`Не удалось рассчитать ${index.toUpperCase()}.`);
    result[index] =
      valid.reduce(
        (sum, entry) => sum + entry.value.mean * entry.value.count,
        0,
      ) / pixels;
  }
  return result;
}

function calculateRisk({ ndvi, ndmi, bsi }) {
  const vegetationStress = clamp((0.45 - ndvi) / 0.6);
  const moistureStress = clamp((0.25 - ndmi) / 0.7);
  const bareSoilSignal = clamp((bsi + 0.2) / 0.7);
  return (
    100 *
    (0.45 * vegetationStress +
      0.3 * moistureStress +
      0.25 * bareSoilSignal)
  );
}

function activeLayer() {
  const buttons = [...document.querySelectorAll(".layer-tabs button")];
  const index = Math.max(
    0,
    buttons.findIndex((button) => button.classList.contains("active")),
  );
  return ["risk", "ndvi", "bsi", "ndmi"][index];
}

function previewUrl(scene, layer) {
  const definition = MAP_LAYERS[layer];
  const url = new URL(ITEM_PREVIEW);
  url.searchParams.set("collection", COLLECTION);
  url.searchParams.set("item", scene.id);
  definition.assets.forEach((asset) =>
    url.searchParams.append("assets", asset),
  );
  url.searchParams.set("expression", definition.expression);
  url.searchParams.set("asset_as_band", "true");
  url.searchParams.set("rescale", definition.rescale);
  url.searchParams.set("colormap_name", definition.colormap);
  url.searchParams.set("nodata", "0");
  url.searchParams.set("format", "png");
  url.searchParams.set("max_size", "512");
  return url.href;
}

function flattenCoordinates(coordinates, result = []) {
  if (typeof coordinates?.[0] === "number") {
    result.push(coordinates);
  } else {
    coordinates?.forEach((coordinate) =>
      flattenCoordinates(coordinate, result),
    );
  }
  return result;
}

function geometryBbox(feature) {
  const coordinates = flattenCoordinates(feature.geometry.coordinates);
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function bboxIntersects(first, second) {
  return !(
    first[2] < second[0] ||
    first[0] > second[2] ||
    first[3] < second[1] ||
    first[1] > second[3]
  );
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function pointInGeometry(point, geometry) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

function timelineDate() {
  const start = new Date(`${element("period-start").value}T00:00:00Z`);
  const end = new Date(`${element("period-end").value}T23:59:59Z`);
  const progress = Number(element("timeline-range").value) / 100;
  return new Date(start.getTime() + (end.getTime() - start.getTime()) * progress);
}

function updateTimelineLabels() {
  const start = new Date(`${element("period-start").value}T00:00:00Z`);
  const end = new Date(`${element("period-end").value}T23:59:59Z`);
  const labels = document.querySelectorAll(".timeline > div span");
  const formatter = new Intl.DateTimeFormat("ru-RU", { month: "long" });
  labels.forEach((label, index) => {
    const progress = index / Math.max(1, labels.length - 1);
    const date = new Date(
      start.getTime() + (end.getTime() - start.getTime()) * progress,
    );
    label.textContent = formatter.format(date);
  });
  state.selectedDate = timelineDate();
  element("timeline-date").textContent = formatDate(state.selectedDate);
}

function mapScenes(scenes, targetDate = state.selectedDate, boundary = state.boundary) {
  const boundaryBox = boundary ? geometryBbox(boundary) : null;
  const targetTime = new Date(targetDate ?? Date.now()).getTime();
  const futurePenalty = 365 * 24 * 60 * 60 * 1000;
  const bestByTile = new Map();
  for (const scene of scenes.filter(
    ({ bbox }) => !boundaryBox || bboxIntersects(bbox, boundaryBox),
  )) {
    const tile = mgrsTile(scene);
    const current = bestByTile.get(tile);
    const sceneTime = new Date(scene.properties.datetime).getTime();
    const currentTime = current
      ? new Date(current.properties.datetime).getTime()
      : 0;
    const distance =
      sceneTime <= targetTime
        ? targetTime - sceneTime
        : sceneTime - targetTime + futurePenalty;
    const currentDistance = current
      ? currentTime <= targetTime
        ? targetTime - currentTime
        : currentTime - targetTime + futurePenalty
      : Number.POSITIVE_INFINITY;
    if (
      !current ||
      distance < currentDistance ||
      (distance === currentDistance &&
        Number(scene.properties["eo:cloud_cover"] ?? 100) <
          Number(current.properties["eo:cloud_cover"] ?? 100))
    ) {
      bestByTile.set(tile, scene);
    }
  }
  return [...bestByTile.values()]
    .sort(
      (first, second) =>
        new Date(second.properties.datetime) -
        new Date(first.properties.datetime),
    )
    .slice(0, MAX_MAP_SCENES);
}

function displayScene(scenes) {
  const republicCenter = [44.5, 46.3];
  const centralScenes = scenes.filter(
    ({ bbox = [] }) =>
      bbox.length >= 4 &&
      bbox[0] <= republicCenter[0] &&
      bbox[2] >= republicCenter[0] &&
      bbox[1] <= republicCenter[1] &&
      bbox[3] >= republicCenter[1],
  );
  const candidates = centralScenes.length ? centralScenes : scenes;

  return [...candidates].sort((first, second) => {
    const areaDifference = bboxArea(second.bbox) - bboxArea(first.bbox);
    if (Math.abs(areaDifference) > 0.01) return areaDifference;
    const cloudDifference =
      Number(first.properties["eo:cloud_cover"] ?? 0) -
      Number(second.properties["eo:cloud_cover"] ?? 0);
    if (cloudDifference) return cloudDifference;
    return (
      new Date(second.properties.datetime) -
      new Date(first.properties.datetime)
    );
  })[0];
}

function initialiseMap() {
  if (state.map) return state.map;
  if (!globalThis.L) {
    throw new Error("Не удалось загрузить интерактивную карту.");
  }

  const mapElement = element("satellite-map");
  if (!mapElement) {
    throw new Error("Контейнер интерактивной карты не найден.");
  }

  const L = globalThis.L;
  state.map = L.map(mapElement, {
    center: [46.3, 44.5],
    zoom: 6,
    minZoom: 4,
    maxZoom: 16,
    zoomControl: false,
  });
  state.map.attributionControl.setPrefix(false);
  L.control.zoom({ position: "topright" }).addTo(state.map);

  state.map.createPane("analysisPane");
  state.map.getPane("analysisPane").style.zIndex = "450";
  state.map.getPane("analysisPane").style.pointerEvents = "none";
  state.map.createPane("scenePane");
  state.map.getPane("scenePane").style.zIndex = "480";
  state.map.createPane("waterPane");
  state.map.getPane("waterPane").style.zIndex = "500";
  state.map.createPane("districtPane");
  state.map.getPane("districtPane").style.zIndex = "510";
  state.map.createPane("boundaryPane");
  state.map.getPane("boundaryPane").style.zIndex = "520";

  state.baseLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    },
  ).addTo(state.map);

  state.resizeObserver = new ResizeObserver(() => {
    state.map?.invalidateSize({ pan: false });
  });
  state.resizeObserver.observe(mapElement);
  mapElement.closest(".map-canvas")?.classList.add("real-map");
  return state.map;
}

async function ensureMap() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (globalThis.L) return initialiseMap();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error("Не удалось загрузить библиотеку интерактивной карты.");
}

function renderBoundary(boundary, { fit = false } = {}) {
  const map = initialiseMap();
  const L = globalThis.L;

  state.boundaryLayer?.remove();
  state.boundaryLayer = L.geoJSON(boundary, {
    pane: "boundaryPane",
    interactive: false,
    style: {
      color: "#ff0032",
      weight: 3,
      opacity: 1,
      fillColor: "#ff0032",
      fillOpacity: 0.035,
    },
  }).addTo(map);

  if (fit && state.boundaryLayer.getBounds().isValid()) {
    map.fitBounds(state.boundaryLayer.getBounds(), {
      padding: [24, 24],
      maxZoom: 8,
    });
  }
  state.boundaryLayer.bringToFront();
}

function territoryName(feature = state.selectedDistrict) {
  return feature?.properties?.name ?? "Вся республика";
}

function updateTerritoryUi(name) {
  const select = element("territory-select");
  document.querySelector(".map-toolbar h2").textContent = name;
  if (!select || select.value === name) return;

  state.syncingTerritory = true;
  select.value = name;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  state.syncingTerritory = false;
}

function districtStyle(feature) {
  const selected =
    state.selectedDistrict?.properties?.shapeID === feature.properties.shapeID;
  return {
    color: selected ? "#ff0032" : "rgba(255, 255, 255, 0.92)",
    weight: selected ? 3 : 1.35,
    opacity: 1,
    fillColor: selected ? "#ff0032" : "#ffffff",
    fillOpacity: selected ? 0.16 : 0.025,
  };
}

function refreshDistrictStyles() {
  state.districtLayer?.eachLayer((layer) => {
    if (layer.feature) layer.setStyle(districtStyle(layer.feature));
  });
  state.boundaryLayer?.bringToFront();
}

function renderDistricts(districts) {
  const map = initialiseMap();
  const L = globalThis.L;
  state.districtLayer?.remove();
  state.districtLayer = L.geoJSON(districts, {
    pane: "districtPane",
    interactive: false,
    style: districtStyle,
  }).addTo(map);
  state.boundaryLayer?.bringToFront();
}

function renderWaterBodies(waterBodies) {
  const map = initialiseMap();
  const L = globalThis.L;
  state.waterLayer?.remove();
  state.waterRenderer ??= L.canvas({ pane: "waterPane", padding: 0.4 });
  state.waterLayer = L.geoJSON(waterBodies, {
    pane: "waterPane",
    renderer: state.waterRenderer,
    interactive: false,
    style: (feature) => ({
      color: feature.properties.intermittent ? "#4aabc8" : "#148fbd",
      weight: feature.properties.water === "river" ? 1.3 : 1,
      opacity: 0.92,
      fillColor: "#63c9e6",
      fillOpacity: feature.properties.intermittent ? 0.07 : 0.13,
      dashArray: feature.properties.intermittent ? "3 3" : null,
    }),
  }).addTo(map);
  state.boundaryLayer?.bringToFront();
}

function findDistrict(name) {
  return state.districts?.features.find(
    (feature) => feature.properties.name === name,
  );
}

async function selectTerritory(
  feature,
  { fit = true, analyze = true } = {},
) {
  state.selectedDistrict = feature;
  const name = territoryName(feature);
  updateTerritoryUi(name);
  refreshDistrictStyles();

  if (fit) {
    const layer = feature
      ? state.districtLayer
          ?.getLayers()
          .find(
            (item) =>
              item.feature?.properties?.shapeID === feature.properties.shapeID,
          )
      : state.boundaryLayer;
    if (layer?.getBounds().isValid()) {
      state.map.fitBounds(layer.getBounds(), {
        padding: [36, 36],
        maxZoom: feature ? 9 : 8,
      });
    }
  }

  if (analyze && state.scenes.length) {
    try {
      await runSelectedAnalysis();
    } catch (error) {
      if (error.name !== "AbortError") {
        setStatus(
          "Не удалось рассчитать территорию",
          error.message || "Повторите запрос позже",
          "error",
        );
      }
    }
  }
}

function renderSatelliteMap(
  scenes,
  boundary,
  layer = activeLayer(),
  targetDate = state.selectedDate,
) {
  const map = initialiseMap();
  if (!scenes.length) return;

  const L = globalThis.L;
  const mosaic = mapScenes(scenes, targetDate, boundary);
  if (!mosaic.length) return;
  displayScene(mosaic);

  state.analysisLayers.forEach((analysisLayer) => analysisLayer.remove());
  state.analysisLayers = [];
  state.sceneOutline?.remove();
  const outlines = [];

  for (const mapScene of mosaic) {
    const [west, south, east, north] = mapScene.bbox;
    const bounds = [
      [south, west],
      [north, east],
    ];
    state.analysisLayers.push(
      L.imageOverlay(previewUrl(mapScene, layer), bounds, {
        pane: "analysisPane",
        opacity: Number(element("analysis-opacity")?.value ?? 100) / 100,
        interactive: false,
        crossOrigin: true,
      }).addTo(map),
    );

    if (mapScene.geometry) {
      outlines.push(
        L.geoJSON(
          {
            type: "Feature",
            geometry: mapScene.geometry,
            properties: mapScene.properties,
          },
          {
            pane: "scenePane",
            style: {
              color: "#20201e",
              weight: 1.2,
              opacity: 0.58,
              dashArray: "6 5",
              fill: false,
            },
          },
        ).bindPopup(
          `<b>Сцена ${mgrsTile(mapScene)}</b><br>` +
            `${formatDate(mapScene.properties.datetime)}<br>` +
            `Облачность ${formatIndex(
              Number(mapScene.properties["eo:cloud_cover"] ?? 0),
            )}%`,
        ),
      );
    }
  }
  state.sceneOutline = L.featureGroup(outlines).addTo(map);

  if (!state.boundaryLayer && boundary) {
    renderBoundary(boundary, { fit: true });
  }
  state.boundaryLayer?.bringToFront();
  element("satellite-map").closest(".map-canvas")?.classList.add("real-map");
  map.invalidateSize({ pan: false });
}

function setStatus(title, details, mode = "ready") {
  element("satellite-status").textContent = title;
  element("satellite-updated").textContent = details;
  element("data-mode").dataset.state = mode;
}

function setLoading(loading) {
  const button = element("refresh-satellite-data");
  button.disabled = loading;
  button.innerHTML = loading
    ? '<span class="button-spinner"></span> Запрашиваем Sentinel-2…'
    : "<span>↻</span> Обновить анализ";
}

function updateFeatured() {
  if (!state.metrics) return;
  const layer = activeLayer();
  const display = {
    risk: {
      value: `${Math.round(state.metrics.risk)}%`,
      unit: "модельный индекс риска",
      note: "Эвристика NDVI · NDMI · BSI",
    },
    ndvi: {
      value: formatIndex(state.metrics.ndvi),
      unit: "средний индекс",
      note: "Реальные пиксели Sentinel-2",
    },
    bsi: {
      value: formatIndex(state.metrics.bsi),
      unit: "средний индекс",
      note: "Реальные пиксели Sentinel-2",
    },
    ndmi: {
      value: formatIndex(state.metrics.ndmi),
      unit: "средний индекс",
      note: "Реальные пиксели Sentinel-2",
    },
  }[layer];

  element("featured-value").textContent = display.value;
  element("featured-unit").textContent = display.unit;
  element("featured-note").textContent = display.note;
}

function renderResult(scenes, indexes, selectedDate = state.selectedDate) {
  const newest = scenes.reduce(
    (latest, scene) =>
      new Date(scene.properties.datetime) > new Date(latest)
        ? scene.properties.datetime
        : latest,
    scenes[0].properties.datetime,
  );
  const averageCloud =
    scenes.reduce(
      (sum, scene) => sum + Number(scene.properties["eo:cloud_cover"] ?? 0),
      0,
    ) / scenes.length;
  const risk = calculateRisk(indexes);
  state.metrics = { ...indexes, risk };
  globalThis.__STEPPE_REAL_METRICS__ = state.metrics;

  element("ndvi-value").textContent = formatIndex(indexes.ndvi);
  element("bsi-value").textContent = formatIndex(indexes.bsi);
  element("scene-count").textContent = String(scenes.length);
  element("ndvi-note").textContent =
    `Агрегировано до ${formatDate(newest)}`;
  element("bsi-note").textContent = `NDMI: ${formatIndex(indexes.ndmi)}`;
  element("scene-note").textContent =
    `Облачность ${formatIndex(averageCloud)}%`;
  element("scene-caption").textContent =
    `${territoryName()} · ${scenes.length} тайлов · ` +
    `срез ${formatDate(selectedDate)}`;
  element("timeline-date").textContent = formatDate(selectedDate);

  setStatus(
    "Срез рассчитан",
    `${territoryName()} · ${formatDate(selectedDate)}`,
  );
  updateFeatured();
}

async function runSelectedAnalysis() {
  state.analysisController?.abort();
  state.analysisController = new AbortController();
  const boundary = state.selectedDistrict ?? state.boundary;
  const selectedScenes = mapScenes(state.scenes, state.selectedDate, boundary);
  if (!selectedScenes.length) {
    throw new Error("Для выбранной территории и даты сцены не найдены.");
  }

  renderSatelliteMap(
    state.scenes,
    boundary,
    activeLayer(),
    state.selectedDate,
  );
  setStatus(
    "Считаем выбранный срез…",
    `${territoryName()} · ${formatDate(state.selectedDate)}`,
    "loading",
  );
  const indexes = await calculateIndexes(
    selectedScenes,
    boundary,
    state.analysisController.signal,
  );
  renderResult(selectedScenes, indexes, state.selectedDate);
}

async function refresh() {
  state.searchController?.abort();
  state.analysisController?.abort();
  state.searchController = new AbortController();
  setLoading(true);
  setStatus("Ищем покрытие Дагестана…", "Planetary Computer · STAC", "loading");

  try {
    await ensureMap();
    const [boundary, districts, waterBodies] = await Promise.all([
      loadBoundary(),
      loadDistricts(),
      loadWaterBodies(),
    ]);
    state.boundary = boundary;
    state.districts = districts;
    state.waterBodies = waterBodies;
    renderBoundary(boundary, { fit: true });
    renderWaterBodies(waterBodies);
    renderDistricts(districts);
    const requestedTerritory = element("territory-select")?.value;
    state.selectedDistrict =
      requestedTerritory && requestedTerritory !== "Вся республика"
        ? findDistrict(requestedTerritory)
        : null;
    refreshDistrictStyles();
    if (state.selectedDistrict) {
      await selectTerritory(state.selectedDistrict, {
        fit: true,
        analyze: false,
      });
    }
    const scenes = await searchScenes(
      boundary,
      element("period-start").value,
      element("period-end").value,
      document.querySelector(".control-card input[type=range]").value,
      state.searchController.signal,
    );
    state.scenes = scenes;
    state.selectedDate = timelineDate();
    await runSelectedAnalysis();
  } catch (error) {
    if (error.name === "AbortError") return;
    setStatus(
      "Не удалось обновить данные",
      error.message || "Повторите запрос позже",
      "error",
    );
    element("scene-caption").textContent = "Нет данных для выбранного периода";
  } finally {
    setLoading(false);
  }
}

function bindInterface() {
  setCurrentPeriod();
  updateTimelineLabels();
  element("refresh-satellite-data").addEventListener("click", refresh);

  document
    .querySelectorAll(".index-options button, .layer-tabs button")
    .forEach((button) =>
      button.addEventListener("click", () =>
        setTimeout(() => {
          updateFeatured();
          if (state.scenes.length) {
            renderSatelliteMap(
              state.scenes,
              state.selectedDistrict ?? state.boundary,
              activeLayer(),
              state.selectedDate,
            );
          }
        }),
      ),
    );

  element("analysis-opacity")?.addEventListener("input", (event) => {
    state.analysisLayers.forEach((analysisLayer) =>
      analysisLayer.setOpacity(Number(event.currentTarget.value) / 100),
    );
  });

  element("territory-select")?.addEventListener("change", (event) => {
    if (state.syncingTerritory) return;
    const name = event.currentTarget.value;
    selectTerritory(
      name === "Вся республика" ? null : findDistrict(name),
      { fit: true, analyze: true },
    );
  });

  window.addEventListener("land:territory-select", (event) => {
    const name = event.detail?.name;
    selectTerritory(
      name === "Вся республика" ? null : findDistrict(name),
      { fit: true, analyze: true },
    );
  });

  element("timeline-range")?.addEventListener("input", () => {
    state.selectedDate = timelineDate();
    element("timeline-date").textContent = formatDate(state.selectedDate);
    window.clearTimeout(state.timelineTimer);
    state.timelineTimer = window.setTimeout(() => {
      if (state.scenes.length) {
        renderSatelliteMap(
          state.scenes,
          state.selectedDistrict ?? state.boundary,
          activeLayer(),
          state.selectedDate,
        );
      }
    }, 180);
  });

  element("timeline-range")?.addEventListener("change", () => {
    if (state.scenes.length) {
      runSelectedAnalysis().catch((error) => {
        if (error.name !== "AbortError") {
          setStatus(
            "Не удалось рассчитать дату",
            error.message || "Повторите запрос позже",
            "error",
          );
        }
      });
    }
  });

  [element("period-start"), element("period-end")].forEach((input) =>
    input?.addEventListener("change", () => {
      element("timeline-range").value = "100";
      updateTimelineLabels();
    }),
  );

  refresh();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindInterface, { once: true });
  } else {
    bindInterface();
  }
}

export {
  calculateRisk,
  calculateIndexes,
  mapScenes,
  pointInGeometry,
  renderSatelliteMap,
  searchScenes,
};
