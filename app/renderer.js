"use strict";

(() => {
  const surface =
    new URLSearchParams(window.location.search).get("surface") || "highlight";
  const scripts =
    surface === "popup"
      ? [
          "./host-overlay-adapter.js",
          "./iina-popup-renderer.js",
          "./mpv-popup-integration.js",
        ]
      : ["./highlight-renderer.js"];

  function loadNext(index) {
    if (index >= scripts.length) return;
    const script = document.createElement("script");
    script.src = scripts[index];
    script.onload = () => loadNext(index + 1);
    document.head.appendChild(script);
  }

  loadNext(0);
})();
