import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputFile = resolve(
  process.argv[2] ?? join(projectRoot, "github-pages", "index.html"),
);
const outputDirectory = dirname(outputFile);

const renderedHtml = await readFile(join(projectRoot, "out", "index.html"), "utf8");
const chunksDirectory = join(projectRoot, "out", "_next", "static", "chunks");
const cssFiles = (await readdir(chunksDirectory)).filter((file) =>
  file.endsWith(".css"),
);
const css = (
  await Promise.all(
    cssFiles.map((file) => readFile(join(chunksDirectory, file), "utf8")),
  )
).join("\n");
const main = renderedHtml.match(/<main class="app-shell">[\s\S]*?<\/main>/)?.[0];

if (!main) {
  throw new Error("Не удалось найти разметку LandMonitor в статической сборке.");
}

const fontFiles = {
  "/fonts/mts-text-regular.woff2": "mts-text-regular.woff2",
  "/fonts/mts-text-medium.woff2": "mts-text-medium.woff2",
  "/fonts/mts-text-bold.woff2": "mts-text-bold.woff2",
  "/fonts/mts-text-black.woff2": "mts-text-black.woff2",
};
let standaloneCss = css;

for (const [publicPath, fileName] of Object.entries(fontFiles)) {
  const font = await readFile(
    join(projectRoot, "public", "fonts", fileName),
    "base64",
  );
  standaloneCss = standaloneCss.replaceAll(
    `/land-monitor-dagestan${publicPath}`,
    `data:font/woff2;base64,${font}`,
  );
  standaloneCss = standaloneCss.replaceAll(
    publicPath,
    `data:font/woff2;base64,${font}`,
  );
}

const logo = await readFile(
  join(projectRoot, "public", "mts-eco-logo.svg"),
  "base64",
);
const satelliteScript = await readFile(
  join(projectRoot, "public", "satellite-data.js"),
  "utf8",
);
const dagestanBoundary = await readFile(
  join(projectRoot, "public", "dagestan.geojson"),
  "utf8",
);
const dagestanDistricts = await readFile(
  join(projectRoot, "public", "dagestan-districts.geojson"),
  "utf8",
);
const standaloneMain = main.replace(
  /src="(?:\/land-monitor-dagestan)?\/mts-eco-logo\.svg"/,
  `src="data:image/svg+xml;base64,${logo}"`,
);

const interactions = String.raw`
const layerData = [
  {value:"—", unit:"модельный индекс риска", label:"Комплексный риск", delta:"ожидаем сцену", scale:["0% · низкий","50%","100% · высокий"]},
  {value:"—", unit:"средний индекс", label:"Растительность · NDVI", delta:"ожидаем сцену", scale:["−0,3 · мало","0,25","0,8 · много"]},
  {value:"—", unit:"средний индекс", label:"Оголённые почвы · BSI", delta:"ожидаем сцену", scale:["−0,4 · мало","0","0,4 · много"]},
  {value:"—", unit:"средний индекс", label:"Дефицит влаги · NDMI", delta:"ожидаем сцену", scale:["−0,5 · сухо","0","0,5 · влажно"]}
];
const layerNames = ["risk", "ndvi", "soil", "moisture"];
const indexButtons = [...document.querySelectorAll(".index-options button")];
const layerButtons = [...document.querySelectorAll(".layer-tabs button")];
const mapCanvas = document.querySelector(".map-canvas");
const legend = document.querySelector(".legend-gradient");
const featured = document.querySelector(".metric-card.featured");

function selectLayer(index) {
  indexButtons.forEach((button, item) => {
    button.classList.toggle("selected", item === index);
    button.querySelector("i").textContent = item === index ? "✓" : "";
  });
  layerButtons.forEach((button, item) => button.classList.toggle("active", item === index));
  mapCanvas.className = "map-canvas layer-" + layerNames[index];
  legend.className = "legend-gradient " + layerNames[index];
  legend.previousElementSibling.textContent = layerData[index].label;
  [...legend.nextElementSibling.querySelectorAll("small")].forEach((label, item) => {
    label.textContent = layerData[index].scale[item];
  });
  featured.querySelector(".metric-label").textContent = layerData[index].label;
  featured.querySelector("strong").textContent = layerData[index].value;
  featured.querySelector("small").textContent = layerData[index].unit;
  featured.querySelector(".metric-delta").textContent = "↑ " + layerData[index].delta + " к 2025";
}
indexButtons.forEach((button, index) => button.addEventListener("click", () => selectLayer(index)));
layerButtons.forEach((button, index) => button.addEventListener("click", () => selectLayer(index)));

const territory = document.querySelector(".field select");
territory.addEventListener("change", () => {
  document.querySelector(".map-toolbar h2").textContent = territory.value;
});

const cloudRange = document.querySelector(".control-card input[type=range]");
cloudRange.addEventListener("input", () => {
  document.querySelector(".range-label b").textContent = "до " + cloudRange.value + "%";
});

document.querySelectorAll(".risk-table > button.table-row").forEach((row) => {
  row.addEventListener("click", () => {
    document.querySelector(".map-card").scrollIntoView({behavior:"smooth", block:"start"});
  });
});

document.querySelector(".export-button").addEventListener("click", () => {
  const report = "LandMonitor — Дагестан\nКомплексный риск: " +
    document.querySelector("#featured-value").textContent +
    "\nСредний BSI: " + document.querySelector("#bsi-value").textContent +
    "\nСредний NDVI: " + document.querySelector("#ndvi-value").textContent +
    "\n" + document.querySelector("#satellite-updated").textContent +
    "\n\nСпутниковые индексы рассчитаны по Sentinel-2 L2A. Риск — модельная оценка прототипа.";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([report], {type:"text/plain;charset=utf-8"}));
  link.download = "steppe-monitor-report.txt";
  link.click();
  URL.revokeObjectURL(link.href);
});
`;

const standaloneHtml = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>LandMonitor · Деградация земель Дагестана</title>
    <meta name="description" content="Спутниковый мониторинг деградации земель, дефицита влаги и оголения почв в Республике Дагестан.">
    <meta property="og:title" content="LandMonitor · Дагестан">
    <meta property="og:description" content="Интерактивная карта риска опустынивания и приоритетных зон наблюдения.">
    <meta property="og:image" content="https://ulaymi.github.io/land-monitor-dagestan/og.png">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
    <style>${standaloneCss}</style>
  </head>
  <body>
    ${standaloneMain}
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
    <script>${interactions}</script>
    <script>globalThis.__DAGESTAN_BOUNDARY__=${dagestanBoundary};</script>
    <script>globalThis.__DAGESTAN_DISTRICTS__=${dagestanDistricts};</script>
    <script type="module">${satelliteScript}</script>
  </body>
</html>
`;

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, standaloneHtml);
await copyFile(join(projectRoot, "public", "og.png"), join(outputDirectory, "og.png"));
await copyFile(
  join(projectRoot, "public", "dagestan-water.geojson"),
  join(outputDirectory, "dagestan-water.geojson"),
);
console.log(outputFile);
