const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend =
  process.env.IINATAN_BACKEND ||
  path.join(root, "build", "native", "release", "iinatan-backend");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-worker-"));
const pause = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    pause(10);
  }
  throw new Error(message);
}

execFileSync(backend, ["worker-prepare", temporary]);
fs.writeFileSync(path.join(temporary, "config.tsv"), "fingerprint\tfixture\n");
const worker = spawn(
  backend,
  ["worker", temporary, "--owner-pid", String(process.pid), "--sleep-ms", "1"],
  { stdio: "ignore" },
);
async function main() {
  try {
    waitFor(
      () => fs.existsSync(path.join(temporary, "state", "ready.json")),
      "worker did not publish readiness",
    );
    const ready = JSON.parse(
      fs.readFileSync(path.join(temporary, "state", "ready.json")),
    );
    assert.strictEqual(ready.ok, true);
    assert.strictEqual(ready.textLayout.available, true);

    const requestId = "layout-lifecycle";
    const body = {
      type: "text-layout",
      protocol: 1,
      requestId,
      text: "漢Á",
      font: { family: "sans-serif", size: 24 },
      wrapWidth: 200,
      osdScale: 1,
      fallbackFontPath: path.join(
        root,
        "assets",
        "fonts",
        "NotoSansCJKjp-Regular.otf",
      ),
    };
    fs.writeFileSync(
      path.join(temporary, "queue", `${requestId}.request`),
      JSON.stringify(body),
    );
    fs.writeFileSync(
      path.join(temporary, "queue", `${requestId}.json`),
      "commit\n",
    );
    const responsePath = path.join(temporary, "responses", `${requestId}.json`);
    waitFor(
      () => fs.existsSync(responsePath),
      "worker did not answer layout request",
    );
    assert.strictEqual(JSON.parse(fs.readFileSync(responsePath)).ok, true);
    execFileSync(backend, ["queue-clean", temporary, requestId]);
    assert.ok(
      fs.existsSync(path.join(temporary, "state", "acks", `${requestId}.ack`)),
    );
    assert.ok(!fs.existsSync(responsePath));

    const cancelledId = "cancelled-layout";
    execFileSync(backend, ["queue-cancel", temporary, cancelledId]);
    fs.writeFileSync(
      path.join(temporary, "queue", `${cancelledId}.request`),
      JSON.stringify({ ...body, requestId: cancelledId }),
    );
    fs.writeFileSync(
      path.join(temporary, "queue", `${cancelledId}.json`),
      "commit\n",
    );
    const cancelledPath = path.join(
      temporary,
      "responses",
      `${cancelledId}.json`,
    );
    waitFor(
      () => fs.existsSync(cancelledPath),
      "cancel marker was not consumed",
    );
    assert.strictEqual(
      JSON.parse(fs.readFileSync(cancelledPath)).reason,
      "cancelled",
    );

    fs.writeFileSync(path.join(temporary, "stop"), "stop\n");
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("worker did not honor stop marker")),
        5000,
      );
      worker.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    assert.strictEqual(exitCode, 0);
  } finally {
    if (worker.exitCode === null) worker.kill("SIGKILL");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main()
  .then(() =>
    console.log("native worker cancellation/ack/shutdown tests passed"),
  )
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
