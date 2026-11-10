// Runs before first paint so the page never flashes the wrong theme.
// A saved choice wins; otherwise the device setting decides.
(function () {
  var theme = "dark";
  try {
    var stored = localStorage.getItem("threadsium-theme");
    if (stored === "light" || stored === "dark") theme = stored;
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) theme = "light";
  } catch (_) {}
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  var meta = document.getElementById("meta-theme-color");
  if (meta) meta.setAttribute("content", theme === "light" ? "#E9ECEF" : "#212529");
  var icon = document.getElementById("app-favicon");
  if (icon) icon.setAttribute("href", theme === "light" ? "/favicon-light.svg" : "/favicon-dark.svg");
})();
