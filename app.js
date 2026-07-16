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
  lastAirQualityFetch: 0,
  lastData: null,
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
  if (!force && now - state.lastWeatherFetch < CONFIG.WEATHER_REFRESH_MINUTES * 60 * 1000) return;
  state.lastWeatherFetch = now;

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
  } catch (err) {
    $("weatherTemp").textContent = "—";
    $("weatherDesc").textContent = "Weather unavailable";
    $("forecastList").innerHTML = `<div class="forecast-day"><div class="icon">⚠️</div><div><strong>Forecast unavailable</strong><p>Check internet connection.</p></div></div>`;
    console.error(err);
  }

  try {
    await loadAirQuality(force);
  } catch (err) {
    $("aqNowValue").textContent = "—";
    $("aqNowCategory").textContent = "Unavailable";
    $("aqNowCategory").className = "aq-badge aq-badge-neutral";
    $("aqNowDetails").textContent = "Air quality data unavailable.";
    $("aqTomorrowValue").textContent = "—";
    $("aqTomorrowCategory").textContent = "Unavailable";
    $("aqTomorrowCategory").className = "aq-badge aq-badge-neutral";
    $("aqTomorrowDetails").textContent = "Air quality forecast unavailable.";
    console.error(err);
  }
}

function getAqiCategory(aqi) {
  if (typeof aqi !== "number" || Number.isNaN(aqi)) {
    return { label: "Unavailable", className: "aq-badge-neutral" };
  }

  if (aqi <= 50) return { label: "Good", className: "aq-badge-good" };
  if (aqi <= 100) return { label: "Moderate", className: "aq-badge-moderate" };
  if (aqi <= 150) return { label: "Unhealthy", className: "aq-badge-unhealthy" };
  if (aqi <= 200) return { label: "Very Unhealthy", className: "aq-badge-very-unhealthy" };
  return { label: "Hazardous", className: "aq-badge-hazardous" };
}

function nearestHourIndex(times) {
  const now = new Date();
  const currentHour = now.toISOString().slice(0, 13);
  const index = times.findIndex(time => time.slice(0, 13) === currentHour);
  return index >= 0 ? index : 0;
}

function renderAirQuality(data) {
  if (!data?.hourly?.time || !data?.hourly?.us_aqi) {
    throw new Error("Invalid air quality response");
  }

  const times = data.hourly.time;
  const aqi = data.hourly.us_aqi;
  const pm25 = data.hourly.pm2_5 || [];
  const nowIndex = nearestHourIndex(times);
  const nowAqi = aqi[nowIndex];
  const nowPm25 = pm25[nowIndex];
  const nowCategory = getAqiCategory(nowAqi);

  $("aqNowValue").textContent = typeof nowAqi === "number" ? `${Math.round(nowAqi)}` : "—";
  $("aqNowCategory").textContent = nowCategory.label;
  $("aqNowCircle").className = `aq-circle ${nowCategory.className}`;
  $("aqNowDetails").textContent = typeof nowPm25 === "number"
    ? `PM2.5 ${Math.round(nowPm25)} μg/m³` : "Hourly PM2.5 unavailable.";

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowEntries = times.reduce((acc, timeString, index) => {
    const date = new Date(timeString);
    if (sameDay(date, tomorrowDate) && typeof aqi[index] === "number") {
      acc.push({ aqi: aqi[index], pm25: pm25[index] });
    }
    return acc;
  }, []);

  if (tomorrowEntries.length) {
    const avgAqi = Math.round(tomorrowEntries.reduce((sum, item) => sum + item.aqi, 0) / tomorrowEntries.length);
    const avgPm25 = tomorrowEntries.every(item => typeof item.pm25 === "number")
      ? Math.round(tomorrowEntries.reduce((sum, item) => sum + item.pm25, 0) / tomorrowEntries.length)
      : null;
    const tomorrowCategory = getAqiCategory(avgAqi);

    $("aqTomorrowValue").textContent = `${avgAqi}`;
    $("aqTomorrowCategory").textContent = tomorrowCategory.label;
    $("aqTomorrowCircle").className = `aq-circle ${tomorrowCategory.className}`;
    $("aqTomorrowDetails").textContent = avgPm25 !== null
      ? `PM2.5 ${avgPm25} μg/m³` : `Tomorrow AQI ${avgAqi}`;
  } else {
    $("aqTomorrowValue").textContent = "—";
    $("aqTomorrowCategory").textContent = "Unavailable";
    $("aqTomorrowCategory").className = "aq-badge aq-badge-neutral";
    $("aqTomorrowDetails").textContent = "No tomorrow forecast available.";
  }
}

async function loadAirQuality(force = false) {
  const now = Date.now();
  if (!force && now - state.lastAirQualityFetch < CONFIG.WEATHER_REFRESH_MINUTES * 60 * 1000) return;
  state.lastAirQualityFetch = now;

  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", CONFIG.WEATHER_LAT);
  url.searchParams.set("longitude", CONFIG.WEATHER_LON);
  url.searchParams.set("hourly", "us_aqi,pm2_5");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");

  const data = await getJson(url.toString());
  renderAirQuality(data);
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
  try {
    await Promise.all([loadTrello(), loadWeather(forceWeather)]);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}. Check app.js values and the browser console.`);
  }
}

async function refreshWeatherWithAnimation() {
  const icon = $("weatherIcon");
  icon.classList.remove("weather-refreshed");
  icon.classList.add("weather-refreshing");

  try {
    await loadWeather(true);
  } finally {
    icon.classList.remove("weather-refreshing");
    // Restart the completion animation even when refresh is clicked repeatedly.
    void icon.offsetWidth;
    icon.classList.add("weather-refreshed");
    setTimeout(() => icon.classList.remove("weather-refreshed"), 650);
  }
}

function updateRefreshTimes() {
  const now = new Date();
  const next = new Date(now.getTime() + CONFIG.REFRESH_INTERVAL_MINUTES * 60 * 1000);
  $("lastUpdated").textContent = formatTime(now);
  const nextRefreshEl = $("nextRefresh");
  if (nextRefreshEl) nextRefreshEl.textContent = formatTime(next);
}

$("refreshNow").addEventListener("click", () => loadDashboard(true));
$("refreshWeather").addEventListener("click", refreshWeatherWithAnimation);
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

window.addEventListener('resize', moveAirQualityForMobile);
moveAirQualityForMobile();
