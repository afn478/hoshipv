"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const {
  makeEnvelope,
  validateHostEvent,
  validateHostRequest,
} = require("../../src/bridge/protocol");

const root = path.resolve(__dirname, "../..");
const resultPath = String(
  process.argv.find((value) => value.startsWith("--result-file="))?.slice(14) || "",
);
const testSessionId = "browser-integration";
const initialGeneration = 3;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  throw new Error(
    `timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

function createFixtureResult() {
  const repeatedGlossaries = Array.from({ length: 11 }, (_, index) => ({
    dictionary: `Fixture dictionary ${index + 2}`,
    tags: [`tag-${index + 1}`],
    content: [
      {
        type: "section",
        title: `Example section ${index + 1}`,
        collapsed: index % 2 === 0,
        content: [
          {
            type: "paragraph",
            text: `A long representative entry paragraph ${index + 1}.`,
          },
          {
            type: "list",
            rows: [
              ["one", "two"],
              ["three", "four"],
            ],
          },
        ],
      },
    ],
  }));
  return {
    lookupString: "日本語",
    matched: "日本語",
    entries: [
      {
        id: "fixture-entry-1",
        headword: "日本語",
        reading: "にほんご",
        tags: ["noun"],
        frequency: ["common"],
        pitches: [
          {
            dictionary: "Fixture pitch",
            positions: [2],
            transcriptions: ["LHH"],
          },
        ],
        glossaries: [
          {
            dictionary: "Fixture dictionary 1",
            tags: ["N1"],
            content: [
              { type: "paragraph", text: "the Japanese language" },
              { type: "example", text: "日本語を勉強します。" },
              { type: "note", text: "Language name." },
              { type: "cross-reference", text: "言語", lookup: "言語" },
              { type: "link", text: "Source", href: "https://example.com/source" },
              {
                type: "audio",
                text: "native audio",
                url: "https://audio.example/native.mp3",
              },
              {
                type: "furigana",
                text: "日本",
                reading: "にほん",
              },
              {
                type: "table",
                rows: [
                  ["field", "value"],
                  ["language", "Japanese"],
                ],
              },
              {
                type: "structured-content",
                content: [
                  {
                    type: "structured-element",
                    tag: "ruby",
                    content: [
                      { type: "text", text: "語" },
                      {
                        type: "structured-element",
                        tag: "rt",
                        content: [{ type: "text", text: "ご" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "structured-content",
                content: [
                  {
                    type: "structured-element",
                    tag: "details",
                    data: { content: "details-entry-grammar" },
                    content: [
                      {
                        type: "structured-element",
                        tag: "summary",
                        content: [{ type: "text", text: "Grammar" }],
                      },
                      {
                        type: "structured-element",
                        tag: "p",
                        content: [{ type: "text", text: "past participle" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "structured-content",
                content: [
                  {
                    type: "structured-element",
                    tag: "details",
                    data: { content: "details-entry-etymology" },
                    open: true,
                    content: [
                      {
                        type: "structured-element",
                        tag: "summary",
                        content: [{ type: "text", text: "Etymology" }],
                      },
                      {
                        type: "structured-element",
                        tag: "p",
                        content: [{ type: "text", text: "origin" }],
                      },
                    ],
                  },
                ],
              },
              ...repeatedGlossaries[0].content,
            ],
          },
          ...repeatedGlossaries,
        ],
      },
      {
        id: "fixture-entry-2",
        headword: "日本",
        reading: "にほん",
        tags: ["proper noun"],
        frequency: ["common"],
        glossaries: [
          {
            dictionary: "Fixture compact dictionary",
            tags: ["N5"],
            content: [{ type: "paragraph", text: "Japan" }],
          },
        ],
      },
    ],
  };
}

function createSurface(surface) {
  return new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(root, "app", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    title: `iinatan browser integration ${surface}`,
  });
}

function sendEvent(window, type, payload, geometryGeneration = initialGeneration) {
  const envelope = makeEnvelope(type, payload, {
    sessionId: testSessionId,
    geometryGeneration,
  });
  validateHostEvent(envelope);
  window.webContents.send("host-event", envelope);
}

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function run() {
  if (!resultPath) throw new Error("--result-file is required");
  await app.whenReady();

  const messages = [];
  const surfaces = new Map();
  const onHostRequest = (event, raw) => {
    const message = {
      ...(raw && typeof raw === "object" ? raw : {}),
      sessionId: raw?.sessionId || testSessionId,
      geometryGeneration:
        raw?.geometryGeneration === undefined
          ? initialGeneration
          : raw.geometryGeneration,
    };
    validateHostRequest(message);
    const surface = [...surfaces.entries()].find(
      ([, window]) => window.webContents.id === event.sender.id,
    )?.[0];
    messages.push({ surface: surface || "unknown", message });
  };
  ipcMain.on("host-request", onHostRequest);

  const popup = createSurface("popup");
  const highlight = createSurface("highlight");
  surfaces.set("popup", popup);
  surfaces.set("highlight", highlight);
  try {
    await Promise.all([
      popup.loadFile(path.join(root, "app", "overlay.html"), {
        query: { surface: "popup" },
      }),
      highlight.loadFile(path.join(root, "app", "overlay.html"), {
        query: { surface: "highlight" },
      }),
    ]);
    await waitFor(
      () =>
        messages.some(
          (item) => item.surface === "popup" && item.message.type === "ready",
        ) &&
        messages.some(
          (item) => item.surface === "highlight" && item.message.type === "ready",
        ),
      "popup and highlight browser readiness",
    );

    sendEvent(
      highlight,
      "capabilities",
      {
        surface: "highlight",
        host: "electron-browser-window",
        transport: "dom",
        transparent: true,
        offscreen: false,
        bitmapTransport: false,
        inputMode: "passive-forwarded",
      },
      initialGeneration,
    );
    sendEvent(
      popup,
      "capabilities",
      {
        surface: "popup",
        host: "electron-browser-window",
        transport: "dom",
        transparent: true,
        offscreen: false,
        bitmapTransport: false,
        inputMode: "interactive-native",
      },
      initialGeneration,
    );
    await waitFor(
      async () =>
        (await evaluate(
          highlight,
          "document.getElementById('root').dataset.inputMode",
        )) === "passive-forwarded" &&
        (await evaluate(popup, "document.getElementById('root').dataset.inputMode")) ===
          "interactive-native",
      "browser capability handshake",
    );

    sendEvent(
      highlight,
      "geometry",
      { rects: [{ x: 12, y: 34, width: 56, height: 24 }], exact: true },
      initialGeneration,
    );
    await waitFor(
      async () =>
        (await evaluate(
          highlight,
          "document.querySelectorAll('.highlight').length",
        )) === 1,
      "highlight rendering",
    );
    const highlightState = await evaluate(
      highlight,
      `(() => {
        const item = document.querySelector('.highlight');
        return item && {
          left: item.style.left,
          top: item.style.top,
          width: item.style.width,
          height: item.style.height,
        };
      })()`,
    );
    assert.deepEqual(highlightState, {
      left: "12px",
      top: "34px",
      width: "56px",
      height: "24px",
    });
    sendEvent(highlight, "geometry", { rects: [] }, initialGeneration - 1);
    await delay(50);
    assert.equal(
      await evaluate(highlight, "document.querySelectorAll('.highlight').length"),
      1,
      "stale highlight geometry must be ignored",
    );

    const fixtureResult = createFixtureResult();
    sendEvent(
      popup,
      "popup-state",
      {
        visible: true,
        position: { x: 40, y: 60 },
        width: 640,
        maxHeight: 520,
        popupScale: 1,
        popupMinWidth: 280,
        popupMaxWidth: 640,
        fontScale: 1,
        theme: "light",
        customCss: "#popup .glossary { color: rgb(1, 2, 3); }",
        audioSources: ["https://audio.example/{term}.mp3"],
        audioAutoPlay: false,
        anki: { enabled: true, configured: true },
        result: fixtureResult,
      },
      initialGeneration,
    );
    await waitFor(
      async () =>
        (await evaluate(popup, "!document.getElementById('popup-panel').hidden")) ===
        true,
      "popup rendering",
    );
    const initialState = await evaluate(
      popup,
      `(() => {
        const panel = document.getElementById('popup-panel');
        return {
          hidden: panel.hidden,
          role: panel.getAttribute('role'),
          label: panel.getAttribute('aria-label'),
          tabIndex: panel.tabIndex,
          popupMinWidth: getComputedStyle(panel).getPropertyValue('--popup-min-width').trim(),
          popupMaxWidth: getComputedStyle(panel).getPropertyValue('--popup-max-width').trim(),
          headword: document.getElementById('popup-headword').textContent,
          entries: document.querySelectorAll('.entry').length,
          entryHeadwords: [...document.querySelectorAll('.entry-headword')].map(
            (item) => item.textContent,
          ),
          entryReadings: [...document.querySelectorAll('.entry-reading')].map(
            (item) => item.textContent,
          ),
          pitch: [...document.querySelectorAll('.entry-pitch')].map(
            (item) => item.textContent,
          ),
          examples: document.querySelectorAll('.example').length,
          notes: document.querySelectorAll('.note').length,
          glossaries: document.querySelectorAll('.glossary').length,
          details: document.querySelectorAll('details').length,
          grammarRows: document.querySelectorAll('.grammar-row').length,
          etymologyOpen: document.querySelector(
            'details[data-content="details-entry-etymology"]',
          )?.open,
          tables: document.querySelectorAll('table').length,
          nested: document.querySelectorAll('[data-action="nested-lookup"]').length,
          links: document.querySelectorAll('[data-href]').length,
          audio: document.querySelectorAll('[data-action="dictionary-audio"]').length,
          anki: document.querySelectorAll('[data-action="anki-add"]').length,
          customStyle: !!document.querySelector('style[data-source="user-custom-css"]'),
          customGlossaryColor: getComputedStyle(
            document.querySelector('.glossary'),
          ).color,
          csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '',
        };
      })()`,
    );
    assert.equal(initialState.hidden, false);
    assert.equal(initialState.role, "dialog");
    assert.equal(initialState.label, "Dictionary lookup");
    assert.equal(initialState.tabIndex, -1);
    assert.equal(initialState.popupMinWidth, "280px");
    assert.equal(initialState.popupMaxWidth, "640px");
    assert.equal(initialState.headword, "日本語");
    assert.equal(initialState.entries, 2);
    assert.deepEqual(initialState.entryHeadwords, ["日本語", "日本"]);
    assert.deepEqual(initialState.entryReadings, ["にほんご", "にほん"]);
    assert.equal(initialState.pitch.length, 1);
    assert.match(initialState.pitch[0], /Fixture pitch/);
    assert.match(initialState.pitch[0], /positions 2/);
    assert.match(initialState.pitch[0], /LHH/);
    assert.equal(initialState.examples, 1);
    assert.equal(initialState.notes, 1);
    assert.equal(initialState.glossaries, 13);
    assert.ok(initialState.details >= 12);
    assert.equal(initialState.grammarRows, 1);
    assert.equal(initialState.etymologyOpen, true);
    assert.equal(initialState.tables, 1);
    assert.equal(initialState.nested, 1);
    assert.equal(initialState.links, 1);
    assert.equal(initialState.audio, 1);
    assert.equal(initialState.anki, 2);
    assert.equal(initialState.customStyle, true);
    assert.equal(initialState.customGlossaryColor, "rgb(1, 2, 3)");
    assert.match(initialState.csp, /default-src 'self'/);
    assert.doesNotMatch(initialState.csp, /connect-src\s+\*/);
    const popupRegionNames = new Set(
      messages
        .filter(
          (item) => item.surface === "popup" && item.message.type === "popup-region",
        )
        .map((item) => item.message.payload.name),
    );
    for (const name of ["panel", "headword", "content"])
      assert.equal(popupRegionNames.has(name), true, `missing popup region: ${name}`);
    const latestPopupRegion = (name) =>
      messages
        .filter(
          (item) =>
            item.surface === "popup" &&
            item.message.type === "popup-region" &&
            item.message.payload.name === name,
        )
        .at(-1)?.message.payload;
    const visiblePopupBounds = await evaluate(
      popup,
      `(() => {
        const panel = document.getElementById('popup-panel').getBoundingClientRect();
        const header = document.getElementById('popup-header').getBoundingClientRect();
        const content = document.getElementById('popup-content').getBoundingClientRect();
        return {
          panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
          content: { left: content.left, top: Math.max(content.top, header.bottom), right: content.right, bottom: Math.min(content.bottom, panel.bottom) },
        };
      })()`,
    );
    const reportedContentRegion = latestPopupRegion("content");
    assert.ok(reportedContentRegion, "content region telemetry missing");
    assert.ok(
      reportedContentRegion.x >= visiblePopupBounds.panel.left - 0.5 &&
        reportedContentRegion.y >= visiblePopupBounds.content.top - 0.5 &&
        reportedContentRegion.x + reportedContentRegion.width <=
          visiblePopupBounds.panel.right + 0.5 &&
        reportedContentRegion.y + reportedContentRegion.height <=
          visiblePopupBounds.panel.bottom + 0.5,
      "content region telemetry must stay inside the visible popup viewport",
    );

    sendEvent(
      popup,
      "popup-layout",
      { position: { x: 72, y: 84 }, width: 320, maxHeight: 240, side: "below" },
      initialGeneration,
    );
    await waitFor(
      async () =>
        (
          await evaluate(
            popup,
            `(() => {
            const panel = document.getElementById('popup-panel');
            return [panel.style.left, panel.style.top, panel.style.width, panel.style.maxHeight];
          })()`,
          )
        ).join(",") === "72px,84px,320px,240px",
      "popup layout reflow",
    );
    assert.equal(
      await evaluate(popup, "document.activeElement?.id"),
      "popup-panel",
      "layout-only reflow must preserve popup focus",
    );

    const rightClickMessagesBefore = messages.filter(
      (item) =>
        item.message.type === "popup-action" &&
        ["selection-start", "selection-end"].includes(item.message.payload.action),
    ).length;
    const contextMenuState = await evaluate(
      popup,
      `(() => {
        const target = document.querySelector('.glossary');
        const contextMenu = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
        });
        const dispatched = target.dispatchEvent(contextMenu);
        for (const type of ['pointerdown', 'pointerup'])
          target.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 2,
            pointerId: 25,
            isPrimary: true,
          }));
        return { dispatched, defaultPrevented: contextMenu.defaultPrevented };
      })()`,
    );
    assert.deepEqual(contextMenuState, { dispatched: true, defaultPrevented: false });
    await waitFor(
      () =>
        messages.filter(
          (item) =>
            item.message.type === "popup-action" &&
            ["selection-start", "selection-end"].includes(item.message.payload.action),
        ).length === rightClickMessagesBefore,
      "right-click must not enter text selection",
    );
    assert.equal(
      await evaluate(popup, "document.activeElement?.id"),
      "popup-panel",
      "pointer motion and context-menu input must not remove focus",
    );

    const dismissalCancelBefore = messages.filter(
      (item) =>
        item.message.type === "popup-action" &&
        item.message.payload.action === "selection-cancel",
    ).length;
    await evaluate(
      popup,
      `document.querySelector('.glossary').dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 26,
        isPrimary: true,
      }))`,
    );
    sendEvent(popup, "popup-state", { visible: false }, initialGeneration);
    await waitFor(
      () =>
        messages.filter(
          (item) =>
            item.message.type === "popup-action" &&
            item.message.payload.action === "selection-cancel",
        ).length ===
        dismissalCancelBefore + 1,
      "selection cancellation on popup dismissal",
    );
    sendEvent(
      popup,
      "popup-state",
      {
        visible: true,
        position: { x: 40, y: 60 },
        width: 640,
        maxHeight: 520,
        popupScale: 1,
        popupMinWidth: 280,
        popupMaxWidth: 640,
        fontScale: 1,
        theme: "light",
        customCss: "outline: 2px solid rgb(1, 2, 3);",
        result: fixtureResult,
      },
      initialGeneration + 1,
    );
    await waitFor(
      async () =>
        (await evaluate(popup, "!document.getElementById('popup-panel').hidden")) ===
        true,
      "popup restoration after dismissal-cancel test",
    );

    const pointerMessagesBefore = messages.filter(
      (item) =>
        item.message.type === "popup-action" &&
        ["pointer-down", "pointer-up"].includes(item.message.payload.action),
    ).length;
    await evaluate(
      popup,
      `(() => {
        const button = document.querySelector('[data-action="audio-source"]');
        for (const type of ['pointerdown', 'pointerup'])
          button.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 17,
            isPrimary: true,
          }));
      })()`,
    );
    await waitFor(
      () =>
        messages.filter(
          (item) =>
            item.message.type === "popup-action" &&
            ["pointer-down", "pointer-up"].includes(item.message.payload.action),
        ).length >=
        pointerMessagesBefore + 2,
      "popup pointer down/up messages",
    );
    assert.deepEqual(
      messages
        .filter(
          (item) =>
            item.message.type === "popup-action" &&
            ["pointer-down", "pointer-up"].includes(item.message.payload.action),
        )
        .slice(-2)
        .map((item) => item.message.payload.action),
      ["pointer-down", "pointer-up"],
    );

    const selectionMessagesBefore = messages.filter(
      (item) =>
        item.message.type === "popup-action" &&
        ["selection-start", "selection-end"].includes(item.message.payload.action),
    ).length;
    await evaluate(
      popup,
      `(() => {
        const text = document.querySelector('.glossary');
        for (const [type, payload] of [
          ['pointerdown', { button: 0 }],
          ['pointerup', { button: 0 }],
        ])
          text.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 23,
            isPrimary: true,
            ...payload,
          }));
      })()`,
    );
    await waitFor(
      () =>
        messages.filter(
          (item) =>
            item.message.type === "popup-action" &&
            ["selection-start", "selection-end"].includes(item.message.payload.action),
        ).length >=
        selectionMessagesBefore + 2,
      "popup text-selection capture messages",
    );
    assert.deepEqual(
      messages
        .filter(
          (item) =>
            item.message.type === "popup-action" &&
            ["selection-start", "selection-end"].includes(item.message.payload.action),
        )
        .slice(-2)
        .map((item) => item.message.payload.action),
      ["selection-start", "selection-end"],
    );

    const cancelMessagesBefore = messages.filter(
      (item) =>
        item.message.type === "popup-action" &&
        item.message.payload.action === "selection-cancel",
    ).length;
    await evaluate(
      popup,
      `(() => {
        const text = document.querySelector('.glossary');
        text.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 24,
          isPrimary: true,
        }));
        window.dispatchEvent(new Event('blur'));
      })()`,
    );
    await waitFor(
      () =>
        messages.filter(
          (item) =>
            item.message.type === "popup-action" &&
            item.message.payload.action === "selection-cancel",
        ).length >=
        cancelMessagesBefore + 1,
      "popup selection cancellation on focus loss",
    );

    sendEvent(popup, "popup-state", { visible: false }, initialGeneration - 1);
    await delay(50);
    assert.equal(
      await evaluate(popup, "document.getElementById('popup-panel').hidden"),
      false,
      "stale popup state must be ignored",
    );

    await evaluate(
      popup,
      `(() => {
        const root = document.getElementById('popup-content');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let textNode = null;
        while (walker.nextNode()) {
          if (walker.currentNode.data.includes('language')) {
            textNode = walker.currentNode;
            break;
          }
        }
        if (!textNode) throw new Error('fixture text node missing');
        const start = textNode.data.indexOf('language');
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, start + 4);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
      })()`,
    );
    await waitFor(
      () =>
        messages.some(
          (item) =>
            item.message.type === "popup-action" &&
            item.message.payload.action === "selection-changed" &&
            item.message.payload.text === "lang",
        ),
      "text selection message",
    );

    await evaluate(
      popup,
      `document.querySelector('[data-action="nested-lookup"]').click()`,
    );
    await waitFor(
      () => messages.some((item) => item.message.type === "nested-lookup"),
      "nested lookup message",
    );

    await evaluate(
      popup,
      "document.querySelector('[data-action=audio-source]').click()",
    );
    await waitFor(
      () => messages.some((item) => item.message.type === "audio-source"),
      "audio source message",
    );
    sendEvent(
      popup,
      "audio-result",
      {
        candidates: [
          { name: "Primary", url: "https://audio.example/primary.mp3" },
          { name: "Fallback", url: "https://audio.example/fallback.mp3" },
        ],
      },
      initialGeneration + 1,
    );
    await waitFor(
      async () =>
        (await evaluate(
          popup,
          "document.querySelectorAll('.audio-candidate').length",
        )) === 2,
      "audio menu rendering",
    );
    sendEvent(
      popup,
      "controller-command",
      { command: "audio-down" },
      initialGeneration + 1,
    );
    assert.equal(
      await evaluate(
        popup,
        "document.querySelector('.audio-candidate[aria-selected=\"true\"]')?.textContent",
      ),
      "Fallback",
    );

    await evaluate(popup, "document.querySelector('[data-href]').click()");
    await waitFor(
      () => messages.some((item) => item.message.type === "external-link"),
      "external link message",
    );
    const wheelMessagesBefore = messages.filter(
      (item) =>
        item.message.type === "popup-action" && item.message.payload.action === "wheel",
    ).length;
    const wheelState = await evaluate(
      popup,
      `(() => {
        const panel = document.getElementById('popup-panel');
        const wheel = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
        });
        return {
          dispatched: panel.dispatchEvent(wheel),
          defaultPrevented: wheel.defaultPrevented,
          scrollable: panel.scrollHeight > panel.clientHeight,
        };
      })()`,
    );
    assert.deepEqual(wheelState, {
      dispatched: true,
      defaultPrevented: false,
      scrollable: true,
    });
    await delay(50);
    assert.equal(
      messages.filter(
        (item) =>
          item.message.type === "popup-action" &&
          item.message.payload.action === "wheel",
      ).length,
      wheelMessagesBefore,
      "native popup scrolling must not emit a duplicate host action",
    );
    const scrollTelemetryBefore = messages.filter(
      (item) => item.message.type === "popup-scroll",
    ).length;
    await evaluate(
      popup,
      `(() => {
        const panel = document.getElementById('popup-panel');
        panel.scrollTop = 180;
        panel.dispatchEvent(new Event('scroll'));
      })()`,
    );
    await waitFor(
      () =>
        messages.filter((item) => item.message.type === "popup-scroll").length >
        scrollTelemetryBefore,
      "popup scroll telemetry",
    );
    assert.equal(
      messages.filter((item) => item.message.type === "popup-scroll").at(-1)?.message
        .type,
      "popup-scroll",
      "scroll state telemetry must use its own non-command message",
    );
    await evaluate(
      popup,
      `document.getElementById('popup-panel').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))`,
    );
    await waitFor(
      () =>
        messages.some(
          (item) =>
            item.message.type === "popup-action" &&
            item.message.payload.action === "escape",
        ),
      "popup Escape message",
    );
    await evaluate(
      popup,
      `document.getElementById('root').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`,
    );
    await waitFor(
      () => messages.some((item) => item.message.type === "dismiss-popup"),
      "outside pointer dismissal",
    );

    sendEvent(
      popup,
      "popup-state",
      {
        visible: true,
        position: { x: 40, y: 60 },
        result: fixtureResult,
        customCss: "background-image: url(https://evil.example/x);",
      },
      initialGeneration + 2,
    );
    await waitFor(
      async () =>
        (await evaluate(
          popup,
          "document.querySelectorAll('style[data-source=\\\"user-custom-css\\\"]').length",
        )) === 0,
      "unsafe custom CSS rejection",
    );

    const messageTypes = messages.map((item) => item.message.type);
    const result = {
      ok: true,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      messageCount: messages.length,
      messageTypes: [...new Set(messageTypes)].sort(),
      popup: initialState,
      highlight: highlightState,
      mode: "real-electron-browser-integration",
    };
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    });
  } finally {
    ipcMain.removeListener("host-request", onHostRequest);
    for (const window of [popup, highlight]) {
      if (window && !window.isDestroyed()) window.close();
    }
    await app.quit();
  }
}

run().catch(async (error) => {
  const result = {
    ok: false,
    error: error.stack || error.message,
    mode: "real-electron-browser-integration",
  };
  if (resultPath) {
    await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  console.error(`[iinatan-browser-integration] ${error.stack || error.message}`);
  app.quit();
  process.exitCode = 1;
});
