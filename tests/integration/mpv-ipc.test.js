"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { MpvJsonIpc } = require("../../src/player/mpv-ipc");

test("mpv JSON IPC correlates responses and emits property changes", async () => {
  class FakeSocket extends EventEmitter {
    setEncoding() {}
    write(line) {
      const request = JSON.parse(line);
      queueMicrotask(() => {
        this.emit(
          "data",
          JSON.stringify({
            request_id: request.request_id,
            error: "success",
            data: request.command[1] === "pid" ? 42 : "ok",
          }) + "\n",
        );
        if (request.command[0] === "observe_property")
          this.emit(
            "data",
            JSON.stringify({
              event: "property-change",
              name: request.command[2],
              data: "changed",
            }) + "\n",
          );
      });
    }
    destroy() {
      queueMicrotask(() => this.emit("close"));
    }
  }
  const ipc = new MpvJsonIpc("fake", {
    createConnection: () => {
      const socket = new FakeSocket();
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
  });
  const changes = [];
  ipc.on("property-change", (name, value) => changes.push([name, value]));
  assert.equal(await ipc.getProperty("pid"), 42);
  await ipc.observeProperty("pause");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(changes, [["pause", "changed"]]);
  ipc.close();
});

test("mpv JSON IPC bounds connection establishment", async () => {
  class HangingSocket extends EventEmitter {
    destroy() {}
  }
  const ipc = new MpvJsonIpc("hanging", {
    timeoutMs: 20,
    createConnection: () => new HangingSocket(),
  });
  await assert.rejects(() => ipc.connect(), {
    code: "MPV_IPC_TIMEOUT",
    message: "mpv IPC connection timed out",
  });
});

test("mpv JSON IPC rejects an unbounded response line", async () => {
  class OversizedSocket extends EventEmitter {
    setEncoding() {}
    destroy() {}
  }
  let socket;
  const ipc = new MpvJsonIpc("oversized", {
    createConnection: () => {
      socket = new OversizedSocket();
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
  });
  const closed = new Promise((resolve) => ipc.once("closed", resolve));
  await ipc.connect();
  socket.emit("data", "x".repeat(8 * 1024 * 1024 + 1));
  const error = await closed;
  assert.equal(error.code, "MPV_IPC_MESSAGE_TOO_LARGE");
});
