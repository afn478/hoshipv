const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend = path.join(root, "build/native/release/iinatan-backend");
function assert(value, message) {
  if (!value) throw new Error(message);
}
assert(
  fs.existsSync(backend),
  "native backend must be built before text-layout protocol tests",
);

const direct = spawnSync(
  backend,
  [
    "text-layout",
    path.join(root, "tests/fixtures/protocol/text-layout-request.json"),
  ],
  { encoding: "utf8" },
);
assert(direct.status === 0, direct.stderr || direct.stdout);
const response = JSON.parse(direct.stdout.trim().split(/\n/).pop());
assert(response.ok && response.protocol === 1, "text-layout request failed");
assert(
  response.clusters.length === 4,
  "combining mark and variation selector must share grapheme boxes",
);
assert(
  JSON.stringify(response.clusters.map((cluster) => cluster.utf16Range)) ===
    JSON.stringify([
      [0, 2],
      [2, 3],
      [3, 6],
      [6, 7],
    ]),
  "UTF-16 ranges must preserve surrogate and combining sequences",
);
assert(
  response.clusters.every((cluster) => cluster.width > 0 && cluster.height > 0),
  "every shaped cluster needs a measured box",
);

const multilineRequest = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/protocol/text-layout-request.json"),
    "utf8",
  ),
);
multilineRequest.requestId = "fixture-layout-multiline";
multilineRequest.text = "日本語\n辞書";
const multilineTemp = fs.mkdtempSync(
  path.join(os.tmpdir(), "iinatan-text-layout-"),
);
try {
  const multilineFile = path.join(multilineTemp, "request.json");
  fs.writeFileSync(multilineFile, JSON.stringify(multilineRequest));
  const multiline = spawnSync(backend, ["text-layout", multilineFile], {
    encoding: "utf8",
  });
  assert(multiline.status === 0, multiline.stderr || multiline.stdout);
  const multilineResponse = JSON.parse(
    multiline.stdout.trim().split(/\n/).pop(),
  );
  assert(
    multilineResponse.ok && multilineResponse.clusters.length === 6,
    "multiline text layout must preserve the newline cluster",
  );
  assert(
    multilineResponse.clusters.some(
      (cluster) => cluster.text === "\n" && cluster.width === 0,
    ),
    "newline clusters must remain non-hit-testable",
  );
} finally {
  fs.rmSync(multilineTemp, { recursive: true, force: true });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-worker-test-"));
fs.mkdirSync(path.join(temp, "queue"), { recursive: true });
fs.writeFileSync(path.join(temp, "config.tsv"), "fingerprint\tfixture\n");
const worker = spawn(backend, ["worker", temp, "--sleep-ms", "1"], {
  stdio: ["ignore", "ignore", "ignore"],
});
const id = "layout-worker-fixture";
const payload = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/protocol/text-layout-request.json"),
  ),
);
payload.requestId = id;

function waitFor(file, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(file)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  throw new Error("timed out waiting for " + file);
}

try {
  waitFor(path.join(temp, "state/ready.json"), 5000);
  fs.writeFileSync(
    path.join(temp, "queue", id + ".request"),
    JSON.stringify(payload),
  );
  fs.writeFileSync(path.join(temp, "queue", id + ".json"), "committed\n");
  const responsePath = path.join(temp, "responses", id + ".json");
  waitFor(responsePath, 5000);
  assert(
    JSON.parse(fs.readFileSync(responsePath, "utf8")).ok,
    "persistent worker text layout failed",
  );
  const clean = spawnSync(backend, ["queue-clean", temp, id], {
    encoding: "utf8",
  });
  assert(
    clean.status === 0 &&
      fs.existsSync(path.join(temp, "state/acks", id + ".ack")),
    "response acknowledgement was not recorded",
  );
} finally {
  fs.writeFileSync(path.join(temp, "stop"), "stop\n");
  worker.kill("SIGTERM");
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("native text-layout protocol tests passed");
