"use client";

import Image from "next/image";
import { useState } from "react";

const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type LayerKey = "satellite" | "risk" | "ndvi" | "soil" | "moisture";

const layerMeta: Record<
  LayerKey,
  {
    label: string;
    short: string;
    value: string;
    delta: string;
    unit: string;
    scale: [string, string, string];
  }
> = {
  satellite: {
    label: "Спутник · Sentinel-2 RGB",
    short: "Спутник",
    value: "RGB",
    delta: "без API-ключа",
    unit: "естественные цвета",
    scale: ["вода", "суша", "облака"],
  },
  risk: {
    label: "Комплексный риск",
    short: "Риск",
    value: "27,4",
    delta: "+3,1 п.п.",
    unit: "% территории",
    scale: ["0% · низкий", "50%", "100% · высокий"],
  },
  ndvi: {
    label: "Растительность · NDVI",
    short: "NDVI",
    value: "0,31",
    delta: "−0,08",
    unit: "средний индекс",
    scale: ["−0,3 · мало", "0,25", "0,8 · много"],
  },
  soil: {
    label: "Оголённые почвы · BSI",
    short: "Почвы",
    value: "184",
    delta: "+14 тыс. га",
    unit: "тыс. гектаров",
    scale: ["−0,4 · мало", "0", "0,4 · много"],
  },
  moisture: {
    label: "Дефицит влаги · NDMI",
    short: "Влага",
    value: "−0,22",
    delta: "−0,05",
    unit: "средний индекс",
    scale: ["−0,5 · сухо", "0", "0,5 · влажно"],
  },
};

const districts = [
  {
    name: "Ногайский",
    risk: "Ожидает расчёта",
    area: "—",
    ndvi: "—",
    tone: "raised",
    marker: "marker-one",
  },
  {
    name: "Тарумовский",
    risk: "Ожидает расчёта",
    area: "—",
    ndvi: "—",
    tone: "raised",
    marker: "marker-two",
  },
  {
    name: "Кизлярский",
    risk: "Ожидает расчёта",
    area: "—",
    ndvi: "—",
    tone: "raised",
    marker: "marker-three",
  },
  {
    name: "Бабаюртовский",
    risk: "Ожидает расчёта",
    area: "—",
    ndvi: "—",
    tone: "raised",
    marker: "marker-four",
  },
  {
    name: "Хасавюртовский",
    risk: "Ожидает расчёта",
    area: "—",
    ndvi: "—",
    tone: "raised",
    marker: "marker-five",
  },
] as const;

const allTerritories = [
  "Агульский район",
  "Акушинский район",
  "Ахвахский район",
  "Ахтынский район",
  "Бабаюртовский район",
  "Ботлихский район",
  "Буйнакск",
  "Буйнакский район",
  "Гергебильский район",
  "Гунибский район",
  "Гумбетовский район",
  "Дагестанские Огни",
  "Дахадаевский район",
  "Дербент",
  "Дербентский район",
  "Докузпаринский район",
  "Избербаш",
  "Казбековский район",
  "Кайтагский район",
  "Карабудахкентский район",
  "Каспийск",
  "Каякентский район",
  "Кизилюрт",
  "Кизилюртовский район",
  "Кизляр",
  "Кизлярский район",
  "Кулинский район",
  "Кумторкалинский район",
  "Курахский район",
  "Лакский район",
  "Левашинский район",
  "Магарамкентский район",
  "Махачкала",
  "Ногайский район",
  "Новолакский район",
  "Рутульский район",
  "Сергокалинский район",
  "Сулейман-Стальский район",
  "Табасаранский район",
  "Тарумовский район",
  "Тляратинский район",
  "Унцукульский район",
  "Хасавюрт",
  "Хасавюртовский район",
  "Хивский район",
  "Хунзахский район",
  "Цумадинский район",
  "Цунтинский район",
  "Чародинский район",
  "Шамильский район",
  "Южно-Сухокумск",
] as const;

const trendBars = [45, 30, 25];

export default function Home() {
  const [activeLayer, setActiveLayer] = useState<LayerKey>("risk");
  const [selectedDistrict, setSelectedDistrict] = useState("Вся республика");
  const [cloud, setCloud] = useState(20);

  const current = layerMeta[activeLayer];
  const earthQuery =
    selectedDistrict === "Вся республика"
      ? "Республика Дагестан, Россия"
      : `${selectedDistrict}, Республика Дагестан, Россия`;
  const googleEarthUrl = `https://earth.google.com/web/search/${encodeURIComponent(earthQuery)}`;

  function chooseTerritory(name: string) {
    setSelectedDistrict(name);
    window.dispatchEvent(
      new CustomEvent("land:territory-select", { detail: { name } }),
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="LandMonitor — главная">
          <Image
            className="brand-logo"
            src={`${publicBasePath}/mts-eco-logo.svg`}
            alt="МТС Экосистема"
            height={40}
            priority
            width={40}
          />
          <span className="brand-divider" />
          <span className="brand-copy">
            <small>Geospatial analytics</small>
            <strong>LandMonitor</strong>
            <span>Деградация земель Дагестана</span>
          </span>
        </a>

        <nav className="main-nav" aria-label="Основная навигация">
          <a className="active" href="#overview">
            Обзор
          </a>
          <a href="#zones">Зоны риска</a>
          <a href="#method">Методика</a>
        </nav>

        <div className="system-state">
          <span className="pulse-dot" />
          <span>
            <b id="satellite-status">Подключаем спутник…</b>
            <small id="satellite-updated">Sentinel-2 L2A · поиск сцен</small>
          </span>
        </div>
      </header>

      <section className="page-intro" id="overview">
        <div>
          <span className="eyebrow">Республика Дагестан · сезон 2026</span>
          <h1>Аналитическая панель мониторинга земель</h1>
          <p>
            Спутниковая оценка деградации земель, дефицита влаги и оголения
            почв. От республиканской картины — до приоритетных участков.
          </p>
        </div>
        <div className="intro-actions">
          <span className="demo-badge live-data" id="data-mode">
            Реальные спутниковые данные
          </span>
          <a
            aria-label={`Открыть ${earthQuery} в Google Earth`}
            className="earth-button"
            href={googleEarthUrl}
            rel="noreferrer"
            target="_blank"
          >
            <span aria-hidden="true">◎</span> Google Earth
          </a>
          <button className="export-button" type="button">
            <span aria-hidden="true">↓</span> Экспорт отчёта
          </button>
        </div>
      </section>

      <section className="dashboard-grid">
        <aside className="control-card panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Параметры анализа</span>
              <h2>Срез территории</h2>
            </div>
            <span className="step-chip">01</span>
          </div>

          <label className="field">
            <span>Территория</span>
            <select
              id="territory-select"
              value={selectedDistrict}
              onChange={(event) => setSelectedDistrict(event.target.value)}
            >
              <option>Вся республика</option>
              {allTerritories.map((territory) => (
                <option key={territory}>{territory}</option>
              ))}
            </select>
            <small>Республика Дагестан · 50,3 тыс. км²</small>
          </label>

          <label className="field">
            <span>Период наблюдения</span>
            <div className="date-pair">
              <input
                aria-label="Начало периода"
                id="period-start"
                type="date"
                defaultValue="2026-04-01"
              />
              <span>—</span>
              <input
                aria-label="Конец периода"
                id="period-end"
                type="date"
                defaultValue="2026-07-30"
              />
            </div>
          </label>

          <fieldset className="field">
            <legend>Слой карты и анализа</legend>
            <div className="index-options">
              {(Object.keys(layerMeta) as LayerKey[]).map((key) => (
                <button
                  className={activeLayer === key ? "selected" : ""}
                  key={key}
                  onClick={() => setActiveLayer(key)}
                  type="button"
                >
                  <span className={`index-dot ${key}`} />
                  <span>
                    <b>{layerMeta[key].short}</b>
                    <small>{layerMeta[key].label}</small>
                  </span>
                  <i>{activeLayer === key ? "✓" : ""}</i>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span className="range-label">
              Допустимая облачность <b>до {cloud}%</b>
            </span>
            <input
              className="range"
              max="50"
              min="0"
              onChange={(event) => setCloud(Number(event.target.value))}
              type="range"
              value={cloud}
            />
            <span className="range-ticks">
              <small>0%</small>
              <small>25%</small>
              <small>50%</small>
            </span>
          </label>

          <div className="source-note">
            <span className="source-icon" aria-hidden="true">
              ◫
            </span>
            <span>
              <b>Источники</b>
              <small>Copernicus Sentinel-2 L2A · Planetary Computer</small>
            </span>
          </div>

          <div className="earth-integration">
            <div>
              <span className="earth-mark" aria-hidden="true">
                ◎
              </span>
              <span>
                <b>Google Earth</b>
                <small>Контур выбранной территории в формате KML</small>
              </span>
            </div>
            <button id="download-earth-kml" type="button">
              Скачать KML
            </button>
          </div>

          <button
            className="primary-button"
            id="refresh-satellite-data"
            type="button"
          >
            <span>↻</span>
            Обновить анализ
          </button>
        </aside>

        <section className="map-card panel" aria-label="Карта риска опустынивания">
          <div className="map-toolbar">
            <div>
              <span className="eyebrow">Интерактивная карта</span>
              <h2>{selectedDistrict}</h2>
            </div>
            <div className="layer-tabs" aria-label="Слой карты">
              {(Object.keys(layerMeta) as LayerKey[]).map((key) => (
                <button
                  className={activeLayer === key ? "active" : ""}
                  key={key}
                  onClick={() => setActiveLayer(key)}
                  type="button"
                >
                  {layerMeta[key].short}
                </button>
              ))}
            </div>
          </div>

          <div className={`map-canvas layer-${activeLayer}`}>
            <div
              aria-label="Интерактивная карта Дагестана"
              className="satellite-map"
              id="satellite-map"
            />

            <label className="analysis-opacity">
              <span>Непрозрачность слоя</span>
              <input
                aria-label="Непрозрачность результата"
                defaultValue="100"
                id="analysis-opacity"
                max="100"
                min="0"
                type="range"
              />
            </label>

            <div className="map-legend">
              <span>{current.label}</span>
              <div className={`legend-gradient ${activeLayer}`} />
              <div>
                {current.scale.map((label) => (
                  <small key={label}>{label}</small>
                ))}
              </div>
            </div>

            <div className="map-caption">
              <span>WGS 84 · EPSG:4326</span>
              <span id="scene-caption">Ожидаем сцену Sentinel-2</span>
            </div>
          </div>

          <div className="timeline">
            <div>
              <span>Апрель</span>
              <span>Май</span>
              <span>Июнь</span>
              <span>Июль</span>
            </div>
            <input
              aria-label="Дата отображения"
              defaultValue="100"
              id="timeline-range"
              max="100"
              min="0"
              type="range"
            />
            <strong id="timeline-date">30 июля 2026</strong>
          </div>
        </section>

        <section className="metrics-grid" aria-label="Ключевые показатели">
          <article className="metric-card featured">
            <span className="metric-number">01</span>
            <span className="metric-label">{current.label}</span>
            <div>
              <strong id="featured-value">—</strong>
              <small id="featured-unit">{current.unit}</small>
            </div>
            <span className="metric-delta neutral" id="featured-note">
              расчёт после загрузки сцены
            </span>
          </article>

          <article className="metric-card">
            <span className="metric-number">02</span>
            <span className="metric-label">Оголённые почвы</span>
            <div>
              <strong id="bsi-value">—</strong>
              <small>средний BSI</small>
            </div>
            <span className="metric-delta neutral" id="bsi-note">
              Sentinel-2 · B02/B04/B08/B11
            </span>
          </article>

          <article className="metric-card">
            <span className="metric-number">03</span>
            <span className="metric-label">Средний NDVI</span>
            <div>
              <strong id="ndvi-value">—</strong>
              <small>по республике</small>
            </div>
            <span className="metric-delta neutral" id="ndvi-note">
              Sentinel-2 · B04/B08
            </span>
          </article>

          <article className="metric-card">
            <span className="metric-number">04</span>
            <span className="metric-label">Сцены в расчёте</span>
            <div>
              <strong id="scene-count">—</strong>
              <small>сцен в расчёте</small>
            </div>
            <span className="metric-delta neutral" id="scene-note">
              поиск по контуру Дагестана
            </span>
          </article>
        </section>
      </section>

      <section className="lower-grid" id="zones">
        <article className="risk-table panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Районная детализация</span>
              <h2>Следующий уровень расчёта</h2>
            </div>
            <button
              className="text-button"
              onClick={() => chooseTerritory("Вся республика")}
              type="button"
            >
              Все районы <span>→</span>
            </button>
          </div>

          <div className="table-head table-row">
            <span>Район</span>
            <span>Уровень риска</span>
            <span>Площадь</span>
            <span>Δ NDVI</span>
            <span />
          </div>
          {districts.map((district, index) => (
            <button
              className="table-row"
              key={district.name}
              onClick={() => {
                chooseTerritory(`${district.name} район`);
                window.scrollTo({ top: 180, behavior: "smooth" });
              }}
              type="button"
            >
              <span>
                <i className={`rank ${district.tone}`}>{index + 1}</i>
                <b>{district.name}</b>
              </span>
              <span className={`risk-pill ${district.tone}`}>
                {district.risk}
              </span>
              <span>{district.area}</span>
              <span className="ndvi-value">{district.ndvi}</span>
              <span className="row-arrow">→</span>
            </button>
          ))}
        </article>

        <article className="trend-card panel" id="method">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Логика модели</span>
              <h2>Из чего складывается риск</h2>
            </div>
            <span className="trend-chip">3 индекса</span>
          </div>
          <p>
            В текущем прототипе: 45% — стресс растительности по NDVI, 30% —
            дефицит влаги по NDMI, 25% — сигнал оголения почв по BSI.
          </p>
          <div className="bar-chart" aria-label="Веса индексов в модели риска">
            {trendBars.map((height, index) => (
              <span
                className={index === 0 ? "hot" : ""}
                key={`${height}-${index}`}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className="chart-axis">
            <span>NDVI · 45%</span>
            <span>NDMI · 30%</span>
            <span>BSI · 25%</span>
          </div>
          <div className="method-note">
            <span>i</span>
            <p>
              Индексы NDVI, NDMI и BSI рассчитываются по пикселям Sentinel-2
              внутри административной границы. Комплексный риск — прозрачная
              эвристика прототипа, а не официальная экологическая оценка.
            </p>
          </div>
        </article>
      </section>

      <footer>
        <div>
          <b>LandMonitor</b>
          <span>Прототип системы спутникового мониторинга</span>
        </div>
        <p>
          Спутниковые сцены: Copernicus Sentinel-2 через Microsoft Planetary
          Computer. Контур региона: предоставленный GeoJSON, проверенный по
          официальной площади и географическому охвату. Муниципальные границы
          и водоёмы: участники OpenStreetMap, ODbL 1.0. Контур не заменяет
          юридически значимые сведения ЕГРН; риск является модельной оценкой.
        </p>
      </footer>
    </main>
  );
}
