"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { AnkiConnectClient } = require("../../src/services/anki-connect");
const { storeRemoteMedia } = require("../../src/services/anki-media");
const { buildAnkiNote } = require("../../src/services/anki-card");

const MAX_REQUEST_BYTES = 512 * 1024;

function readRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("mock AnkiConnect request exceeds the size limit"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function json(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function run() {
  const calls = [];
  const storedMedia = [];
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/word.mp3") {
        const body = Buffer.from("mock-word-audio");
        response.writeHead(200, {
          "content-type": "audio/mpeg",
          "content-length": body.length,
        });
        response.end(body);
        return;
      }
      if (request.method !== "POST" || request.url !== "/anki") {
        response.writeHead(404);
        response.end();
        return;
      }
      const payload = JSON.parse(await readRequest(request));
      calls.push(payload);
      const params = payload.params || {};
      let result = null;
      switch (payload.action) {
        case "version":
          result = 6;
          break;
        case "deckNames":
          result = ["Study"];
          break;
        case "modelNames":
          result = ["Basic"];
          break;
        case "modelFieldNames":
          assert.equal(params.modelName, "Basic");
          result = ["Front", "Back"];
          break;
        case "findNotes":
          result = params.query.includes('deck:"Study"') ? [42] : [];
          break;
        case "findCards":
          result = [99];
          break;
        case "guiBrowse":
          result = [42];
          break;
        case "storeMediaFile":
          storedMedia.push({
            filename: String(params.filename || ""),
            bytes: Buffer.from(String(params.data || ""), "base64").length,
          });
          break;
        case "addNote":
          assert.equal(params.note.deckName, "Study");
          assert.equal(params.note.modelName, "Basic");
          assert.deepEqual(params.note.tags, ["iinatan", "japanese"]);
          assert.equal(params.note.options.allowDuplicate, false);
          result = 123;
          break;
        default:
          json(response, { result: null, error: `unknown action ${payload.action}` });
          return;
      }
      json(response, { result, error: null });
    } catch (error) {
      json(response, { result: null, error: error.message }, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const client = new AnkiConnectClient({
      url: `${baseUrl}/anki`,
      timeoutMs: 2000,
    });
    assert.equal(await client.versionInfo(), 6);
    assert.deepEqual(await client.deckNames(), ["Study"]);
    assert.deepEqual(await client.modelNames(), ["Basic"]);
    assert.deepEqual(await client.modelFieldNames("Basic"), ["Front", "Back"]);
    assert.deepEqual(await client.findNotes('deck:"Study" "猫"'), [42]);
    assert.deepEqual(await client.findCards('deck:"Study" "猫"'), [99]);
    assert.deepEqual(await client.guiBrowse("nid:42"), [42]);

    const wordAudio = await storeRemoteMedia(client, `${baseUrl}/word.mp3`, {
      prefix: "e2e-word",
    });
    assert.match(wordAudio, /^e2e-word-[a-f0-9]{20}\.mp3$/);
    assert.deepEqual(storedMedia, [{ filename: wordAudio, bytes: 15 }]);

    const note = buildAnkiNote(
      {
        deckName: "Study",
        modelName: "Basic",
        fieldTemplatesJson: JSON.stringify({
          Front: "{expression} / {reading}",
          Back: "{glossary-first} {audio}",
        }),
        tags: "iinatan japanese",
        duplicateCheck: true,
        duplicateMode: "prevent",
        duplicateScope: "deck",
      },
      {
        entry: {
          headword: "猫",
          reading: "ねこ",
          glossaries: [
            { dictionary: "Fixture", content: [{ type: "paragraph", text: "cat" }] },
          ],
        },
      },
      { wordAudio },
    );
    assert.equal(note.fields.Front, "猫 / ねこ");
    assert.equal(note.fields.Back, `cat [sound:${wordAudio}]`);
    assert.equal(await client.addNote(note), 123);

    const actions = calls.map((call) => call.action);
    for (const action of [
      "version",
      "deckNames",
      "modelNames",
      "modelFieldNames",
      "findNotes",
      "findCards",
      "guiBrowse",
      "storeMediaFile",
      "addNote",
    ])
      assert.ok(actions.includes(action), `mock AnkiConnect action missing: ${action}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          actions,
          storedMedia,
          noteId: 123,
          mode: "loopback-mock-ankiconnect-smoke",
        },
        null,
        2,
      ),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(`[iinatan-anki-smoke] ${error.stack || error.message}`);
  process.exitCode = 1;
});
