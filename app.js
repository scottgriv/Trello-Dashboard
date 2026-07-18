/*
  LOCAL TRELLO DASHBOARD - polished one-screen version

  What you need to edit:
  - Edit setup/config.js with your Trello token, API key, and board ID
  - CONFIG is loaded from setup/config.js which is not committed to GitHub

  Token URL:
  https://trello.com/1/authorize?expiration=never&scope=read&response_type=token&name=LocalTrelloDashboard&key=397f772a07b02dddaa02413fba874810
*/

// CONFIG is loaded from config.js
// LABEL_COLORS and LIST_COLORS are loaded from colors.js

const state = {
  charts: {},
  lastWeatherFetch: 0,
  lastAirQualityNowFetch: 0,
  lastAirQualityForecastFetch: 0,
  lastData: null,
  toastTimer: null,
};

const $ = (id) => document.getElementById(id);

let scrollTimer;

window.addEventListener("scroll", () => {
  document.documentElement.classList.add("is-scrolling");
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    document.documentElement.classList.remove("is-scrolling");
  }, 700);
}, { passive: true });

function isConfigured() {
  return CONFIG.TRELLO_KEY && CONFIG.TRELLO_TOKEN && CONFIG.BOARD_ID &&
    !CONFIG.TRELLO_TOKEN.startsWith("PASTE_");
}

function setStatus(text) {
  $("statusText").textContent = text;
}

function showToast(message, type = "success") {
  const toast = $("toast");
  const toastMessage = $("toastMessage");
  if (!toast || !toastMessage) return;

  toastMessage.textContent = message;
  toast.classList.remove("success", "error", "visible");
  toast.classList.add(type === "error" ? "error" : "success", "visible");

  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 4000);
}

function formatTime(date) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(date);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isCompleteListName(name) {
  return CONFIG.COMPLETE_LIST_NAMES.includes(String(name || "").trim().toLowerCase());
}

function shouldHideListFromChart(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return CONFIG.HIDE_LISTS_STARTING_WITH.some(prefix => normalized.startsWith(prefix));
}

function isAirQualityConfigured() {
  return Boolean(CONFIG.AIRNOW_API_KEY && !CONFIG.AIRNOW_API_KEY.startsWith("YOUR_"));
}

function formatAirNowDetails(entry) {
  if (!entry || entry.AQI == null) return "Air quality data unavailable.";
  const parameter = String(entry.ParameterName || "").toUpperCase();
  const concentration = entry.Concentration;
  if (parameter === "PM2.5" && typeof concentration === "number") {
    return `PM2.5 ${Math.round(concentration)} μg/m³`;
  }
  if (parameter === "O3" && typeof concentration === "number") {
    return `O₃ ${concentration.toFixed(2)} ppm`;
  }
  return `${parameter || "Pollutant"} AQI ${Math.round(entry.AQI)}`;
}

function renderKpiList(cards, listMap) {
  const configuredName = String(CONFIG.KPI_LIST_NAME || "In Progress").trim();
  const normalizedName = configuredName.toLowerCase();
  const matchingCards = cards
    .filter(card => String(listMap[card.idList] || "").trim().toLowerCase() === normalizedName)
    .sort((a, b) => Number(a.pos) - Number(b.pos))
    .slice(0, 2);
  const listElement = $("kpiListCards");

  $("kpiListTitle").textContent = configuredName;
  listElement.replaceChildren();

  if (!matchingCards.length) {
    const item = document.createElement("li");
    item.textContent = "No cards";
    listElement.append(item);
    return;
  }

  matchingCards.forEach(card => {
    const item = document.createElement("li");
    item.textContent = card.name;
    item.title = card.name;
    listElement.append(item);
  });
}

function trelloUrl(path, params = {}) {
  const url = new URL(`https://api.trello.com/1/${path}`);
  url.searchParams.set("key", CONFIG.TRELLO_KEY);
  url.searchParams.set("token", CONFIG.TRELLO_TOKEN);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${text ? " - " + text.slice(0, 120) : ""}`);
  }
  return response.json();
}

async function loadTrello() {
  if (!isConfigured()) {
    $("setupWarning").classList.remove("hidden");
    setStatus("Waiting for Trello token in setup/config.js");
    return;
  }

  $("setupWarning").classList.add("hidden");
  setStatus("Refreshing…");

  const [board, lists, cards, members] = await Promise.all([
    getJson(trelloUrl(`boards/${CONFIG.BOARD_ID}`, { fields: "name" })),
    getJson(trelloUrl(`boards/${CONFIG.BOARD_ID}/lists`, { fields: "name", filter: "open" })),
    getJson(trelloUrl(`boards/${CONFIG.BOARD_ID}/cards`, {
      fields: "name,idList,pos,due,dueComplete,idMembers,labels,closed,dateLastActivity",
      filter: "open",
    })),
    getJson(trelloUrl(`boards/${CONFIG.BOARD_ID}/members`, { fields: "fullName,username,initials" })),
  ]);

  $("boardTitle").textContent = board.name || "Trello";
  document.title = (board.name || "Trello") + " Dashboard";
  state.lastData = { board, lists, cards, members };
  renderTrello(cards, lists, members);
  updateRefreshTimes();
  setStatus("Dashboard ready");
}

function renderTrello(cards, lists, members) {
  const now = new Date();
  const weekCutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const listMap = Object.fromEntries(lists.map(list => [list.id, list.name]));
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.fullName || m.username || "Unknown"]));

  const completedCards = cards.filter(card => card.dueComplete || isCompleteListName(listMap[card.idList]));
  const activeCards = cards.filter(card =>
    !card.closed &&
    !card.dueComplete &&
    !isCompleteListName(listMap[card.idList])
  );

  const dueToday = activeCards.filter(card => card.due && sameDay(new Date(card.due), now)).length;
  const dueThisWeek = activeCards.filter(card => {
    if (!card.due) return false;
    const due = new Date(card.due);
    return due >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && due <= weekCutoff;
  }).length;

  $("totalOpenCards").textContent = activeCards.length;
  $("completedCards").textContent = completedCards.length;
  $("totalLoadedCards").textContent = cards.length;
  $("dueTodayCards").textContent = dueToday;
  $("dueThisWeekCards").textContent = dueThisWeek;
  renderKpiList(cards, listMap);

  const cardsByList = Object.fromEntries(
    Object.keys(LIST_COLORS)
      .filter(name => !shouldHideListFromChart(name))
      .map(name => [name, 0])
  );
  cards
    .filter(card => !shouldHideListFromChart(listMap[card.idList] || "Unknown"))
    .forEach(card => {
      const name = listMap[card.idList] || "Unknown";
      cardsByList[name] = (cardsByList[name] || 0) + 1;
    });
  const labelCounts = countLabels(activeCards);
  const memberCounts = countMembers(activeCards, memberMap);
  const dueCounts = countDueDates(activeCards, now, weekCutoff);

  drawBar("cardsByList", cardsByList, name => LIST_COLORS[name] || "#73BDFF");
  drawPie("cardsByLabel", labelCounts);
  drawHorizontalBar("cardsByMember", memberCounts);
  drawBar("cardsByDueDate", dueCounts, name => ({
    "Overdue": "#FF4757",
    "Today": "#FFAB00",
    "This Week": "#FFC400",
    "This Month": "#2D8CFF",
    "No Due Date": "#62C747",
  }[name] || "#73BDFF"));

  renderLabelLegend(labelCounts);
  renderUpcoming(activeCards);
  renderRecentCompleted(completedCards);
}

function countLabels(cards) {
  const counts = {};
  cards.forEach(card => {
    if (!card.labels || card.labels.length === 0) {
      counts["No label"] = (counts["No label"] || 0) + 1;
      return;
    }
    card.labels.forEach(label => {
      const name = label.name || label.color || "Other";
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  return counts;
}

function countMembers(cards, memberMap) {
  const counts = {};
  cards.forEach(card => {
    if (!card.idMembers || card.idMembers.length === 0) {
      counts["Unassigned"] = (counts["Unassigned"] || 0) + 1;
      return;
    }
    card.idMembers.forEach(id => {
      const name = memberMap[id] || "Unknown";
      counts[name] = (counts[name] || 0) + 1;
    });
  });
  return counts;
}

function countDueDates(cards, now, weekCutoff) {
  const monthCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const counts = { "Overdue": 0, "Today": 0, "This Week": 0, "This Month": 0, "No Due Date": 0 };

  cards.forEach(card => {
    if (!card.due) {
      counts["No Due Date"]++;
      return;
    }

    const due = new Date(card.due);
    if (due < now && !sameDay(due, now)) counts["Overdue"]++;
    else if (sameDay(due, now)) counts["Today"]++;
    else if (due <= weekCutoff) counts["This Week"]++;
    else if (due <= monthCutoff) counts["This Month"]++;
    else counts["This Month"]++;
  });

  return counts;
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

function colorForLabel(name) {
  return LABEL_COLORS[name] || LABEL_COLORS.Other;
}

function textColorForBackground(hex) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? "#061019" : "#FFFFFF";
}

function drawBar(canvasId, counts, colorFn = () => "#2D8CFF") {
  const entries = sortedEntries(counts);
  const showZeroBars = canvasId === "cardsByList";
  const options = baseOptions(false);

  if (showZeroBars) {
    options.plugins.tooltip.callbacks = {
      label: context => `${context.label}: ${entries[context.dataIndex][1]}`,
    };
  }

  drawChart(canvasId, {
    type: "bar",
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        // Shift list bars up one visual unit so zero counts remain visible.
        // The tooltip above preserves each list's real count.
        data: entries.map(e => showZeroBars ? e[1] + 1 : e[1]),
        backgroundColor: entries.map(e => colorFn(e[0])),
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options,
  });
}

function drawHorizontalBar(canvasId, counts) {
  const entries = sortedEntries(counts).slice(0, 8);
  drawChart(canvasId, {
    type: "bar",
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: ["#2D8CFF", "#62C747", "#FFC400", "#C86BFF", "#FF4757", "#4DD39A", "#69C7E2", "#FF7A00"],
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      ...baseOptions(false),
      indexAxis: "y",
    },
  });
}

function drawPie(canvasId, counts) {
  const entries = sortedEntries(counts);
  drawChart(canvasId, {
    type: "pie",
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: entries.map(e => colorForLabel(e[0])),
        borderColor: "rgba(255,255,255,.72)",
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      layout: { padding: 2 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${ctx.parsed}`,
          },
        },
      },
    },
  });
}

function drawChart(canvasId, config) {
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  const ctx = $(canvasId);
  state.charts[canvasId] = new Chart(ctx, config);
}

function baseOptions(showLegend) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    plugins: {
      legend: { display: showLegend, labels: { color: "#dce7f4" } },
      tooltip: { displayColors: true },
    },
    scales: showLegend ? {} : {
      x: {
        ticks: { color: "#c3cfdd", precision: 0 },
        grid: { color: "rgba(129,161,193,.11)" },
        border: { color: "rgba(129,161,193,.35)" },
      },
      y: {
        beginAtZero: true,
        ticks: { color: "#c3cfdd", precision: 0 },
        grid: { color: "rgba(129,161,193,.11)" },
        border: { color: "rgba(129,161,193,.35)" },
      },
    },
  };
}

function renderLabelLegend(labelCounts) {
  const legend = $("labelLegend");
  const entries = sortedEntries(labelCounts);
  legend.innerHTML = entries.map(([name, count]) => {
    const color = colorForLabel(name);
    return `
      <li>
        <span class="swatch" style="background:${color}; color:${color}"></span>
        <span>${escapeHtml(name)}</span>
        <strong>${count}</strong>
      </li>`;
  }).join("");
}

function renderTag(label) {
  const name = label?.name || label?.color || "Other";
  const bg = colorForLabel(name);
  return `<span class="tag" style="background:${bg}; color:${textColorForBackground(bg)}">${escapeHtml(name)}</span>`;
}

function renderUpcoming(cards) {
  const list = $("upcomingList");
  const now = new Date();
  const upcoming = cards
    .filter(c => c.due && !c.dueComplete)
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .slice(0, 6);

  list.innerHTML = upcoming.length ? upcoming.map(card => {
    const due = new Date(card.due);
    const cls = due < now && !sameDay(due, now) ? "due-overdue" : sameDay(due, now) ? "due-today" : "due-soon";
    const label = card.labels?.[0] ? renderTag(card.labels[0]) : "";
    const dateText = sameDay(due, now) ? "Today" : formatDate(due);
    return `
      <li>
        <span class="name">○ ${escapeHtml(card.name)}</span>
        <span class="${cls}">${dateText}</span>
        ${label}
      </li>`;
  }).join("") : `<li><span class="name">No upcoming due cards.</span><span class="meta">Nice.</span></li>`;
}

function renderRecentCompleted(cards) {
  const list = $("recentCompletedList");
  const recent = cards
    .slice()
    .sort((a, b) => new Date(b.dateLastActivity || 0) - new Date(a.dateLastActivity || 0))
    .slice(0, 6);

  list.innerHTML = recent.length ? recent.map(card => {
    const label = card.labels?.[0] ? renderTag(card.labels[0]) : "";
    const date = card.dateLastActivity ? formatDate(new Date(card.dateLastActivity)) : "";
    return `
      <li>
        <span class="name"><span class="complete-check">✓</span>${escapeHtml(card.name)}</span>
        ${label}
        <span class="meta">${date}</span>
      </li>`;
  }).join("") : `<li><span class="name">No completed cards yet.</span><span class="meta">—</span></li>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[s]));
}

async function loadWeather(force = false) {
  const now = Date.now();
  const weatherNeedsRefresh = force || now - state.lastWeatherFetch >= CONFIG.WEATHER_REFRESH_MINUTES * 60 * 1000;
  const airQualityNeedsRefresh = force || now - state.lastAirQualityNowFetch >= (CONFIG.AIR_QUALITY_REFRESH_MINUTES ?? 30) * 60 * 1000 || now - state.lastAirQualityForecastFetch >= (CONFIG.AIR_QUALITY_FORECAST_REFRESH_MINUTES ?? 360) * 60 * 1000;

  if (!weatherNeedsRefresh && !airQualityNeedsRefresh) {
    return {
      weatherSuccess: true,
      airQualitySuccess: true,
      weatherError: null,
      airQualityError: null,
    };
  }

  let weatherSuccess = false;
  let airQualitySuccess = false;
  let weatherError = null;
  let airQualityError = null;

  if (weatherNeedsRefresh) {
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", CONFIG.WEATHER_LAT);
      url.searchParams.set("longitude", CONFIG.WEATHER_LON);
      url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m");
      url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
      url.searchParams.set("temperature_unit", "fahrenheit");
      url.searchParams.set("wind_speed_unit", "mph");
      url.searchParams.set("timezone", "auto");
      url.searchParams.set("forecast_days", "4");

      const data = await getJson(url.toString());
      $("weatherLocation").textContent = CONFIG.WEATHER_LABEL;
      $("weatherTemp").textContent = `${Math.round(data.current.temperature_2m)}°F`;
      const apparentTemperature = Number(data.current.apparent_temperature);
      const feelsLikeText = Number.isFinite(apparentTemperature)
        ? ` · Feels like ${Math.round(apparentTemperature)}°F`
        : "";
      $("weatherDesc").textContent = `${weatherCodeText(data.current.weather_code)}${feelsLikeText}`;
      $("weatherIcon").textContent = weatherIcon(data.current.weather_code);
      $("weatherHighLow").textContent = `${Math.round(data.daily.temperature_2m_max[0])}° / ${Math.round(data.daily.temperature_2m_min[0])}°`;
      $("weatherRain").textContent = `${data.daily.precipitation_probability_max[0] ?? 0}%`;
      $("weatherWind").textContent = `${Math.round(data.current.wind_speed_10m ?? 0)} mph`;

      renderForecast(data.daily);
      weatherSuccess = true;
      state.lastWeatherFetch = now;
    } catch (err) {
      weatherError = err instanceof Error ? err : new Error(String(err));
      $("weatherTemp").textContent = "—";
      $("weatherDesc").textContent = "Weather unavailable";
      $("forecastList").innerHTML = `<div class="forecast-day"><div class="icon">⚠️</div><div><strong>Forecast unavailable</strong><p>Check internet connection.</p></div></div>`;
      console.error(err);
    }
  }

  try {
    await loadAirQuality(force);
    airQualitySuccess = true;
  } catch (err) {
    airQualityError = err instanceof Error ? err : new Error(String(err));
    const message = airQualityError.message || "Air quality data unavailable.";
    $("aqNowValue").textContent = "—";
    $("aqNowCategory").textContent = "Unavailable";
    $("aqNowCategory").className = "aq-circle-category aq-badge aq-badge-neutral";
    $("aqNowDetails").textContent = message;
    $("aqTomorrowValue").textContent = "—";
    $("aqTomorrowCategory").textContent = "Unavailable";
    $("aqTomorrowCategory").className = "aq-circle-category aq-badge aq-badge-neutral";
    $("aqTomorrowDetails").textContent = message;
    console.error(err);
  }

  return {
    weatherSuccess,
    airQualitySuccess,
    weatherError,
    airQualityError,
  };
}

function getAqiCategory(aqi) {
  if (typeof aqi !== "number" || Number.isNaN(aqi)) {
    return { label: "Unavailable", shortLabel: "Unavailable", className: "aq-badge-neutral" };
  }

  if (aqi <= 50) return { label: "Good", shortLabel: "Good", className: "aq-badge-good" };
  if (aqi <= 100) return { label: "Moderate", shortLabel: "Moderate", className: "aq-badge-moderate" };
  if (aqi <= 150) return {
    label: "Unhealthy for Sensitive Groups",
    shortLabel: "Sensitive",
    className: "aq-badge-unhealthy-sensitive"
  };
  if (aqi <= 200) return { label: "Unhealthy", shortLabel: "Unhealthy", className: "aq-badge-unhealthy" };
  if (aqi <= 300) return {
    label: "Very Unhealthy",
    shortLabel: "Very Unhealthy",
    className: "aq-badge-very-unhealthy"
  };
  return { label: "Hazardous", shortLabel: "Hazardous", className: "aq-badge-hazardous" };
}

async function loadAirQuality(force = false) {
  if (!isAirQualityConfigured()) {
    throw new Error("Missing AirNow API key in setup/config.js");
  }

  const now = Date.now();
  const nowRefreshMs = (CONFIG.AIR_QUALITY_REFRESH_MINUTES ?? 30) * 60 * 1000;
  const forecastRefreshMs = (CONFIG.AIR_QUALITY_FORECAST_REFRESH_MINUTES ?? 360) * 60 * 1000;
  const tasks = [];

  if (force || now - state.lastAirQualityNowFetch >= nowRefreshMs) {
    tasks.push(loadAirQualityNow(now));
  }

  if (force || now - state.lastAirQualityForecastFetch >= forecastRefreshMs) {
    tasks.push(loadAirQualityForecast(now));
  }

  if (!tasks.length) return;

  const results = await Promise.allSettled(tasks);
  const failures = results.filter(result => result.status === "rejected");
  if (failures.length === results.length) {
    throw failures[0].reason;
  }
}

async function fetchAirNowData(path, params, distances = [25, 50, 100]) {
  for (const distance of distances) {
    const url = new URL(`https://www.airnowapi.org${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("distance", String(distance));
    url.searchParams.set("API_KEY", CONFIG.AIRNOW_API_KEY);

    const data = await getJson(url.toString());
    if (Array.isArray(data) && data.length) {
      return data;
    }
  }
  return [];
}

async function loadAirQualityNow(now) {
  const params = {
    format: "application/json",
    latitude: CONFIG.WEATHER_LAT,
    longitude: CONFIG.WEATHER_LON,
  };
  const data = await fetchAirNowData("/aq/observation/latLong/current/", params);
  if (!data.length) {
    throw new Error("No nearby AirNow monitors found for current air quality.");
  }

  const best = data.reduce((winner, item) => {
    if (!winner || Number(item.AQI) > Number(winner.AQI)) return item;
    return winner;
  }, null);

  const aqi = Number(best.AQI);
  const category = getAqiCategory(aqi);
  $("aqNowValue").textContent = Number.isFinite(aqi) ? `${Math.round(aqi)}` : "—";
  $("aqNowCategory").textContent = category.shortLabel;
  $("aqNowCategory").className = "aq-circle-category";
  $("aqNowCircle").className = `aq-circle ${category.className}`;
  $("aqNowDetails").textContent = formatAirNowDetails(best);
  state.lastAirQualityNowFetch = now;
}

async function loadAirQualityForecast(now) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const forecastDate = date.toISOString().slice(0, 10);

  const params = {
    format: "application/json",
    latitude: CONFIG.WEATHER_LAT,
    longitude: CONFIG.WEATHER_LON,
    date: forecastDate,
  };
  const data = await fetchAirNowData("/aq/forecast/latLong/", params);
  if (!data.length) {
    throw new Error("No nearby AirNow forecast monitors found for tomorrow.");
  }

  const tomorrowEntries = data.filter(entry => String(entry.DateForecast || "").startsWith(forecastDate));
  if (!tomorrowEntries.length) {
    throw new Error("AirNow forecast data didn't include tomorrow's date.");
  }

  const best = tomorrowEntries.reduce((winner, item) => {
    if (!winner || Number(item.AQI) > Number(winner.AQI)) return item;
    return winner;
  }, null);

  const aqi = Number(best.AQI);
  const category = getAqiCategory(aqi);
  $("aqTomorrowValue").textContent = Number.isFinite(aqi) ? `${Math.round(aqi)}` : "—";
  $("aqTomorrowCategory").textContent = category.shortLabel;
  $("aqTomorrowCategory").className = "aq-circle-category";
  $("aqTomorrowCircle").className = `aq-circle ${category.className}`;
  $("aqTomorrowDetails").textContent = formatAirNowDetails(best);
  state.lastAirQualityForecastFetch = now;
}

function renderForecast(daily) {
  const list = $("forecastList");
  const days = daily.time.slice(1, 4);

  list.innerHTML = days.map((dateString, i) => {
    const index = i + 1;
    const date = new Date(`${dateString}T12:00:00`);
    const dayName = new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" }).format(date);
    const code = daily.weather_code[index];
    const high = Math.round(daily.temperature_2m_max[index]);
    const low = Math.round(daily.temperature_2m_min[index]);
    const rain = daily.precipitation_probability_max[index] ?? 0;

    return `
      <div class="forecast-day">
        <div class="icon">${weatherIcon(code)}</div>
        <div>
          <strong>${dayName}</strong>
          <p>${weatherCodeText(code)}</p>
        </div>
        <div class="temps">
          <span class="high">${high}°F</span>
          <span class="low">${low}°F</span>
          <span class="rain">${rain}% 💧</span>
        </div>
      </div>`;
  }).join("");
}

function weatherCodeText(code) {
  const map = {
    0: "Clear",
    1: "Mainly Clear",
    2: "Partly Cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    51: "Light Drizzle",
    53: "Drizzle",
    55: "Heavy Drizzle",
    56: "Freezing Drizzle",
    57: "Freezing Drizzle",
    61: "Light Rain",
    63: "Rain",
    65: "Heavy Rain",
    66: "Freezing Rain",
    67: "Freezing Rain",
    71: "Light Snow",
    73: "Snow",
    75: "Heavy Snow",
    77: "Snow Grains",
    80: "Rain Showers",
    81: "Rain Showers",
    82: "Heavy Showers",
    85: "Snow Showers",
    86: "Snow Showers",
    95: "Thunderstorm",
    96: "Thunderstorm",
    99: "Thunderstorm",
  };
  return map[code] || "Weather";
}

function weatherIcon(code) {
  if ([0, 1].includes(code)) return "☀️";
  if ([2].includes(code)) return "⛅";
  if ([3, 45, 48].includes(code)) return "☁️";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "⛅";
}

async function loadDashboard(forceWeather = false) {
  const trelloResult = await Promise.allSettled([loadTrello(), loadWeather(forceWeather)]);
  const trelloSettled = trelloResult[0];
  const weatherSettled = trelloResult[1];

  const trelloSuccess = trelloSettled.status === "fulfilled";
  const trelloError = trelloSuccess ? null : (trelloSettled.reason instanceof Error ? trelloSettled.reason : new Error(String(trelloSettled.reason)));

  let weatherSuccess = false;
  let airQualitySuccess = false;
  let weatherError = null;
  let airQualityError = null;

  if (weatherSettled.status === "fulfilled") {
    weatherSuccess = Boolean(weatherSettled.value.weatherSuccess);
    airQualitySuccess = Boolean(weatherSettled.value.airQualitySuccess);
    weatherError = weatherSettled.value.weatherError;
    airQualityError = weatherSettled.value.airQualityError;
  } else {
    const err = weatherSettled.reason instanceof Error ? weatherSettled.reason : new Error(String(weatherSettled.reason));
    weatherError = err;
    airQualityError = err;
  }

  if (!trelloSuccess || !weatherSuccess || !airQualitySuccess) {
    const errorParts = [];
    if (!trelloSuccess) errorParts.push(`Trello: ${trelloError?.message || "Unknown error"}`);
    if (!weatherSuccess) errorParts.push(`Weather: ${weatherError?.message || "Unknown error"}`);
    if (!airQualitySuccess) errorParts.push(`AirNow: ${airQualityError?.message || "Unknown error"}`);
    setStatus(`Refresh completed with issues. Check console for details.`);
    return { trelloSuccess, weatherSuccess, airQualitySuccess, trelloError, weatherError, airQualityError, errorParts };
  }

  setStatus("Dashboard ready");
  return { trelloSuccess, weatherSuccess, airQualitySuccess, trelloError, weatherError, airQualityError, errorParts: [] };
}

async function refreshAllDataWithAnimation() {
  const weatherIcon = $("weatherIcon");
  const aqNowCircle = $("aqNowCircle");
  const aqTomorrowCircle = $("aqTomorrowCircle");

  const enableRefreshAnimation = (el, refreshClass) => {
    if (!el) return;
    el.classList.remove("refreshing", "refreshed", "weather-refreshing", "weather-refreshed");
    el.classList.add(refreshClass);
  };

  enableRefreshAnimation(weatherIcon, "weather-refreshing");
  enableRefreshAnimation(aqNowCircle, "refreshing");
  enableRefreshAnimation(aqTomorrowCircle, "refreshing");

  const result = await loadDashboard(true);

  if (!result || !result.trelloSuccess || !result.weatherSuccess || !result.airQualitySuccess) {
    const messages = [];
    if (!result || !result.trelloSuccess) {
      const message = result?.trelloError?.message || "Trello refresh failed.";
      messages.push(`Trello failed: ${message}`);
    }
    if (!result || !result.weatherSuccess) {
      const message = result?.weatherError?.message || "Weather refresh failed.";
      messages.push(`Weather failed: ${message}`);
    }
    if (!result || !result.airQualitySuccess) {
      const message = result?.airQualityError?.message || "AirNow refresh failed.";
      messages.push(`AirNow failed: ${message}`);
    }
    showToast(messages.join(" • "), "error");
  } else {
    showToast("Refresh complete: Trello, Weather, and AirNow all updated.");
  }

  if (weatherIcon) {
    weatherIcon.classList.remove("weather-refreshing");
    void weatherIcon.offsetWidth;
    weatherIcon.classList.add("weather-refreshed");
    setTimeout(() => weatherIcon.classList.remove("weather-refreshed"), 650);
  }

  [aqNowCircle, aqTomorrowCircle].forEach(circle => {
    if (!circle) return;
    circle.classList.remove("refreshing");
    void circle.offsetWidth;
    circle.classList.add("refreshed");
    setTimeout(() => circle.classList.remove("refreshed"), 650);
  });
}

function updateRefreshTimes() {
  const now = new Date();
  const next = new Date(now.getTime() + CONFIG.REFRESH_INTERVAL_MINUTES * 60 * 1000);
  $("lastUpdated").textContent = formatTime(now);
  const nextRefreshEl = $("nextRefresh");
  if (nextRefreshEl) nextRefreshEl.textContent = formatTime(next);
}

$("refreshNow").addEventListener("click", () => refreshAllDataWithAnimation());
$("refreshMinutes").textContent = CONFIG.REFRESH_INTERVAL_MINUTES;

loadDashboard(true);
setInterval(() => loadDashboard(false), CONFIG.REFRESH_INTERVAL_MINUTES * 60 * 1000);

function moveAirQualityForMobile() {
  const airQualityPanel = document.querySelector('.panel-air-quality');
  const mobileSlot = $('mobileAirQualitySlot');
  if (!airQualityPanel || !mobileSlot) return;

  if (window.innerWidth <= 900) {
    if (!mobileSlot.contains(airQualityPanel)) {
      mobileSlot.appendChild(airQualityPanel);
    }
  } else {
    const rightStack = document.querySelector('.panel-right-stack');
    if (rightStack && !rightStack.contains(airQualityPanel)) {
      rightStack.appendChild(airQualityPanel);
    }
  }
}

function setupAirQualityTooltip() {
  const trigger = document.querySelector('.aq-info-trigger');
  if (!trigger) return;

  const toggleTooltip = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = trigger.classList.toggle('is-tooltip-open');
    if (!isOpen) {
      trigger.blur();
    }
  };

  const closeTooltip = (event) => {
    if (!event.target.closest('.aq-info-trigger')) {
      trigger.classList.remove('is-tooltip-open');
      trigger.blur();
    }
  };

  trigger.addEventListener('click', toggleTooltip);
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      toggleTooltip(event);
    }
  });

  document.addEventListener('click', closeTooltip);
}

window.addEventListener('resize', moveAirQualityForMobile);
moveAirQualityForMobile();
setupAirQualityTooltip();
