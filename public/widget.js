/*!
 * Threadsium room widget. One script tag puts a token's live Threadsium room on any page.
 *
 *   <div data-threadsium-room="0xTOKEN" data-theme="auto" data-height="560"></div>
 *   <script src="https://threadsium.app/widget.js" async></script>
 *
 * Options (data-* attributes on the element):
 *   data-threadsium-room  token contract (0x…, 99901-0x… or 99901:0x…)       required
 *   data-theme            dark | light | auto (follows the host page's colour scheme)   default auto
 *   data-height           CSS height of the room                                 default 560px
 *   data-compact          "1" for the smaller header
 *   data-market           "0" hides the price and market cap line
 *   data-platform         your project's name, shown as "via <name>" in the room
 *
 * Events: the element dispatches threadsium:ready, threadsium:post and threadsium:vote (CustomEvent, bubbling; the
 * message from the room is in event.detail). Rooms added later: call Threadsium.scan(), or Threadsium.mount(element).
 * Docs: https://threadsium.app/docs#integrate
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var ORIGIN = "https://threadsium.app";
  try {
    if (script && script.src) ORIGIN = new URL(script.src).origin;
  } catch (e) {
    /* keep the default */
  }
  var ADDRESS = /^(?:99901[-:])?(0x[0-9a-fA-F]{40})$/;
  var dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function hostTheme() {
    return dark && !dark.matches ? "light" : "dark";
  }

  function mount(el, opts) {
    if (!el || el.__threadsium) return el && el.__threadsium;
    opts = opts || {};
    var read = function (name) {
      return opts[name] != null ? String(opts[name]) : el.getAttribute("data-" + name);
    };
    var raw = (opts.room || el.getAttribute("data-threadsium-room") || "").trim();
    var m = raw.match(ADDRESS);
    if (!m) {
      if (window.console) console.warn("[threadsium] data-threadsium-room needs a token contract address (0x + 40 hex characters).");
      return null;
    }
    var address = m[1].toLowerCase();
    var themeOpt = (read("theme") || "auto").toLowerCase();
    var q = new URLSearchParams();
    q.set("theme", themeOpt === "light" || themeOpt === "dark" ? themeOpt : hostTheme());
    if (read("compact") === "1") q.set("compact", "1");
    if (read("market") === "0") q.set("market", "0");
    var platform = read("platform") || location.hostname;
    if (platform) q.set("platform", platform.slice(0, 40));

    var frame = document.createElement("iframe");
    frame.src = ORIGIN + "/embed/room/" + address + "?" + q.toString();
    frame.title = "Threadsium room for " + address;
    frame.loading = "lazy";
    frame.allow = "clipboard-write";
    frame.style.cssText = "display:block;width:100%;border:0;border-radius:16px;overflow:hidden;color-scheme:normal;height:" + (read("height") || "560px").replace(/^(\d+)$/, "$1px");
    el.appendChild(frame);

    var onMessage = function (ev) {
      if (ev.origin !== ORIGIN || ev.source !== frame.contentWindow) return;
      var d = ev.data;
      if (!d || d.source !== "threadsium-room" || typeof d.type !== "string") return;
      el.dispatchEvent(new CustomEvent("threadsium:" + d.type, { detail: d, bubbles: true }));
    };
    window.addEventListener("message", onMessage);

    var onScheme = function () {
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: "threadsium:theme", theme: hostTheme() }, ORIGIN);
    };
    if (themeOpt === "auto" && dark && dark.addEventListener) dark.addEventListener("change", onScheme);

    var handle = {
      frame: frame,
      address: address,
      setTheme: function (theme) {
        if (frame.contentWindow) frame.contentWindow.postMessage({ type: "threadsium:theme", theme: theme === "light" ? "light" : "dark" }, ORIGIN);
      },
      destroy: function () {
        window.removeEventListener("message", onMessage);
        if (dark && dark.removeEventListener) dark.removeEventListener("change", onScheme);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        el.__threadsium = null;
      },
    };
    el.__threadsium = handle;
    return handle;
  }

  function scan(root) {
    var list = (root || document).querySelectorAll("[data-threadsium-room]");
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }

  window.Threadsium = { mount: mount, scan: scan, origin: ORIGIN };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(); });
  else scan();
})();
