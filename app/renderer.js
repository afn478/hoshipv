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
  let bootstrapFailed = false;

  function reportBootstrapFailure(scriptName, error) {
    if (bootstrapFailed) return;
    bootstrapFailed = true;
    const script = String(scriptName || "unknown renderer asset").slice(0, 160);
    const detail = String(error?.message || "asset load failed").slice(0, 180);
    const message = `Overlay failed to load ${script}. Restart the application or reinstall it.`;
    const root = document.getElementById("root");
    const status = document.getElementById("status");
    if (root) {
      root.dataset.bootstrapState = "failed";
      root.dataset.bootstrapSurface = surface;
      root.style.pointerEvents = "none";
    }
    document.documentElement.dataset.bootstrapState = "failed";
    document.body.style.pointerEvents = "none";
    if (status) {
      status.className = "error";
      status.textContent = message;
    }
    try {
      window.iinatanHost?.send("diagnostic", {
        code: "surface-bootstrap-failed",
        surface,
        script,
        message: `${message} (${detail})`.slice(0, 480),
      });
    } catch (_) {
      // The host may already be shutting down; the local passive state still
      // prevents a partially initialized surface from retaining input.
    }
  }

  function loadNext(index) {
    if (bootstrapFailed || index >= scripts.length) return;
    const script = document.createElement("script");
    script.src = scripts[index];
    script.onload = () => {
      if (!bootstrapFailed) loadNext(index + 1);
    };
    script.onerror = (event) =>
      reportBootstrapFailure(scripts[index], event?.error || event);
    document.head.appendChild(script);
  }

  loadNext(0);
})();
