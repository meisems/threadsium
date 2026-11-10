(function () {
  var KEY = "threadsium-theme";
  try {
    var stored = localStorage.getItem(KEY);
    var theme = stored === "light" || stored === "dark" ? stored : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    var meta = document.getElementById("meta-theme-color");
    if (meta) {
      meta.setAttribute("content", theme === "light" ? "#F7F4EC" : "#0A0D0C");
    }
    var icon = document.getElementById("app-favicon");
    if (icon) {
      icon.setAttribute("href", theme === "light" ? "/favicon-light.svg" : "/favicon-dark.svg");
    }
  } catch (_) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
