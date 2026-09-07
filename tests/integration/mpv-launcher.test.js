"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createMpvLaunchPlan, launchMpv } = require("../../src/player/mpv-launcher");

test("mpv launch plan uses the session script and platform IPC endpoint", () => {
  const plan = createMpvLaunchPlan({
    platform: "darwin",
    executable: "/opt/homebrew/bin/mpv",
    mediaPath: "/media/episode.mkv",
    nativeShimPath: "/Applications/iinatan.app/Contents/Resources/bin/shim.so",
    resourceRoot: "/Applications/iinatan.app/Contents/Resources",
    sessionDirectory: "/Users/test/Library/Application Support/iinatan/sessions",
    temporaryDirectory: "/var/folders/test",
    token: "fixture-token",
  });

  assert.deepEqual(plan.args, [
    "--script=/Applications/iinatan.app/Contents/Resources/mpv/iinatan-session.lua",
    "--input-ipc-server=/var/folders/test/i-fixture-token.sock",
    "--",
    "/media/episode.mkv",
  ]);
  assert.equal(
    plan.nativeShimPath,
    "/Applications/iinatan.app/Contents/Resources/bin/shim.so",
  );
  assert.equal(plan.spawnOptions.stdio, "ignore");
  assert.equal(plan.spawnOptions.windowsHide, true);
  assert.equal(plan.spawnOptions.shell, false);

  const windows = createMpvLaunchPlan({
    platform: "win32",
    mediaPath: "/tmp/episode.mkv",
    resourceRoot: "/tmp/resources",
    sessionDirectory: "/tmp/sessions",
    temporaryDirectory: "/tmp",
    token: "win-fixture",
  });
  assert.equal(windows.ipcEndpoint, "\\\\.\\pipe\\iinatan-win-fixture");
  assert.equal(windows.args[1], "--input-ipc-server=\\\\.\\pipe\\iinatan-win-fixture");
});

test("mpv launcher starts without a shell and cleans only its own artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-mpv-launcher-"));
  const resourceRoot = path.join(root, "resources");
  const sessionDirectory = path.join(root, "sessions");
  const mediaPath = path.join(root, "episode.mkv");
  await fs.mkdir(path.join(resourceRoot, "mpv"), { recursive: true });
  await fs.writeFile(
    path.join(resourceRoot, "mpv", "iinatan-session.lua"),
    "-- fixture\n",
  );
  await fs.writeFile(mediaPath, "fixture\n");

  let invocation = null;
  const child = new EventEmitter();
  child.pid = 43210;
  try {
    const launch = await launchMpv({
      executable: "mpv-fixture",
      mediaPath,
      resourceRoot,
      sessionDirectory,
      temporaryDirectory: path.join(root, "tmp"),
      token: "launch-fixture",
      spawnProcess(executable, args, options) {
        invocation = { executable, args, options };
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    });

    assert.equal(launch.child, child);
    assert.equal(invocation.executable, "mpv-fixture");
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.stdio, "ignore");
    assert.equal(invocation.options.windowsHide, true);
    assert.equal(invocation.options.cwd, undefined);
    assert.equal(invocation.options.env.IINATAN_SESSION_DIR, sessionDirectory);
    assert.equal(invocation.args.at(-1), mediaPath);

    child.emit("close", 0, null);
    assert.deepEqual(await launch.closePromise, { code: 0, signal: null });
    await assert.doesNotReject(() => fs.stat(sessionDirectory));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("mpv launcher rejects non-files before starting a process", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "iinatan-mpv-launcher-"));
  const resourceRoot = path.join(root, "resources");
  await fs.mkdir(path.join(resourceRoot, "mpv"), { recursive: true });
  await fs.writeFile(
    path.join(resourceRoot, "mpv", "iinatan-session.lua"),
    "-- fixture\n",
  );
  try {
    await assert.rejects(
      () =>
        launchMpv({
          executable: "mpv-fixture",
          mediaPath: path.join(root, "missing.mkv"),
          resourceRoot,
          sessionDirectory: path.join(root, "sessions"),
          temporaryDirectory: path.join(root, "tmp"),
          spawnProcess: () => {
            throw new Error("must not be called");
          },
        }),
      /ENOENT/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
