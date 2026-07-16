// Configuration file - DO NOT commit to GitHub
// Copy this file, fill in your values, and keep it local
// Remove the suffix _example from the filename to use this file.

// Trello API credentials and board configuration
const CONFIG = {
  TRELLO_KEY: "YOUR_TRELLO_API_KEY",
  TRELLO_TOKEN: "YOUR_TRELLO_TOKEN",
  BOARD_ID: "YOUR_BOARD_ID",

  // Show the top two cards from this Trello list above the weather section.
  KPI_LIST_NAME: "In Progress",

  // Dashboard refresh rate. Change this one value to update the timer and footer text.
  REFRESH_INTERVAL_MINUTES: 15,

  // Weather location for Open Meteo - change these three values for another place.
  WEATHER_LAT: 39.9526,
  WEATHER_LON: -75.1652,
  WEATHER_LABEL: "Philadelphia, PA",
  WEATHER_REFRESH_MINUTES: 30,

  // AirNow API key for current air quality and forecast data.
  AIRNOW_API_KEY: "YOUR_AIRNOW_API_KEY",
  AIR_QUALITY_REFRESH_MINUTES: 30,
  AIR_QUALITY_FORECAST_REFRESH_MINUTES: 360,

  // Lists that are considered "complete" to be shown in the completed section of the dashboard. Case insensitive.
  COMPLETE_LIST_NAMES: ["complete", "completed", "done"],

  // Lists that start with these words will be hidden from the dashboard. Case insensitive.
  HIDE_LISTS_STARTING_WITH: ["backlog"],
};
