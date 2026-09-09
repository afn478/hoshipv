"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "app", "renderer.js"),
  "utf8",
);

function createRenderer(search = "?surface=popup") {
  const scripts = [];
  const messages = [];
  const status = { className: "hidden", textContent: "" };
  const root = { dataset: {}, style: {} };
  const document = {
    body: { style: {} },
    documentElement: { dataset: {} },
    head: {
      appendChild(script) {
        scripts.push(script);
      },
    },
    createElement() {
      return { onerror: null, onload: null, src: "" };
    },
    getElementById(id) {
      return id === "root" ? root : id === "status" ? status : null;
    },
  };
  const context = {
    document,
    URLSearchParams,
    window: {
      location: { search },
      iinatanHost: {
        send(type, payload) {
          messages.push({ type, payload });
        },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: "app/renderer.js" });
  return { messages, root, scripts, status, document };
}

test("renderer bootstrap reports a failed asset and stops the loading chain", () => {
  const renderer = createRenderer();
  assert.equal(renderer.scripts.length, 1);
  assert.equal(renderer.scripts[0].src, "./host-overlay-adapter.js");

  renderer.scripts[0].onload();
  assert.equal(renderer.scripts.length, 2);
  assert.equal(renderer.scripts[1].src, "./iina-popup-renderer.js");

  renderer.scripts[1].onerror({ error: new Error("missing asset") });
  assert.equal(renderer.scripts.length, 2);
  assert.equal(renderer.messages.length, 1);
  assert.equal(renderer.messages[0].type, "diagnostic");
  assert.deepEqual(JSON.parse(JSON.stringify(renderer.messages[0].payload)), {
    code: "surface-bootstrap-failed",
    surface: "popup",
    script: "./iina-popup-renderer.js",
    message:
      "Overlay failed to load ./iina-popup-renderer.js. Restart the application or reinstall it. (missing asset)",
  });
  assert.equal(renderer.root.dataset.bootstrapState, "failed");
  assert.equal(renderer.root.dataset.bootstrapSurface, "popup");
  assert.equal(renderer.root.style.pointerEvents, "none");
  assert.equal(renderer.document.body.style.pointerEvents, "none");
  assert.equal(renderer.status.className, "error");
});
