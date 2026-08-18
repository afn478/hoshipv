// MuJS is ES5. These small, deterministic shims cover the shared language
// modules without importing a browser-oriented runtime.
if (!Object.assign)
  Object.assign = function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i] || {};
      Object.keys(source).forEach(function (key) {
        target[key] = source[key];
      });
    }
    return target;
  };
if (!Array.from)
  Array.from = function (value) {
    return Array.prototype.slice.call(value);
  };
if (!Number.isInteger)
  Number.isInteger = function (value) {
    return (
      typeof value === "number" &&
      isFinite(value) &&
      Math.floor(value) === value
    );
  };
if (!String.prototype.startsWith)
  String.prototype.startsWith = function (value, position) {
    position = position || 0;
    return this.substring(position, position + value.length) === value;
  };
if (!String.prototype.endsWith)
  String.prototype.endsWith = function (value) {
    return this.substring(this.length - value.length) === value;
  };
if (!String.prototype.includes)
  String.prototype.includes = function (value, position) {
    return this.indexOf(value, position || 0) >= 0;
  };

var IINATAN = {
  version: "3.0.0-dev",
  protocol: { lookup: 1, geometry: 1, textLayout: 1 },
  generation: 0,
  state: {
    properties: Object.create(null),
    fileLoaded: false,
    popup: null,
    settingsOpen: false,
    interactive: false,
  },
  timers: Object.create(null),
  processes: Object.create(null),
  processSerial: 0,
  listeners: Object.create(null),
};

function pref(key, fallback) {
  var profile =
    IINATAN.config && IINATAN.config.profiles[IINATAN.config.activeProfileId];
  if (profile && profile[key] !== undefined) return profile[key];
  return fallback;
}

IINATAN.log = function (level, message) {
  var text = "[iinatan] " + String(message || "");
  if (mp.msg && typeof mp.msg[level] === "function") mp.msg[level](text);
  else mp.msg.info(text);
};

IINATAN.on = function (name, callback) {
  if (!IINATAN.listeners[name]) IINATAN.listeners[name] = [];
  IINATAN.listeners[name].push(callback);
};

IINATAN.emit = function (name, value) {
  var callbacks = IINATAN.listeners[name] || [];
  callbacks.slice().forEach(function (callback) {
    try {
      callback(value);
    } catch (error) {
      IINATAN.log("error", error.stack || error);
    }
  });
};

IINATAN.debounce = function (name, callback) {
  if (IINATAN.timers[name]) return;
  IINATAN.timers[name] = setTimeout(function () {
    delete IINATAN.timers[name];
    callback();
  }, 0);
};

IINATAN.abortProcess = function (id) {
  var handle = IINATAN.processes[id];
  if (!handle) return;
  try {
    mp.abort_async_command(handle);
  } catch (_) {}
  delete IINATAN.processes[id];
};

IINATAN.abortProcesses = function (playbackOnly) {
  Object.keys(IINATAN.processes).forEach(function (id) {
    var entry = IINATAN.processes[id];
    if (!playbackOnly || entry.playbackOnly) IINATAN.abortProcess(id);
  });
};

IINATAN.subprocess = function (args, options, callback) {
  options = options || {};
  var id = "p" + ++IINATAN.processSerial;
  var command = {
    name: "subprocess",
    args: args,
    playback_only: options.playbackOnly === true,
    capture_stdout: options.captureStdout !== false,
    capture_stderr: options.captureStderr !== false,
    capture_size: options.captureSize || 4 * 1024 * 1024,
  };
  var handle = mp.command_native_async(
    command,
    function (success, result, error) {
      delete IINATAN.processes[id];
      result = result || {};
      var status = Number(result.status);
      var failed = !success || error || !isFinite(status) || status !== 0;
      callback(
        failed
          ? new Error(
              error || result.error || result.stderr || "subprocess failed",
            )
          : null,
        result,
      );
    },
  );
  if (!handle) {
    setTimeout(function () {
      callback(new Error(mp.last_error() || "subprocess did not start"));
    }, 0);
    return null;
  }
  IINATAN.processes[id] = handle;
  IINATAN.processes[id].playbackOnly = command.playback_only;
  return id;
};

IINATAN.path = function (value) {
  return mp.utils.get_user_path(value);
};
IINATAN.readJson = function (path, fallback) {
  try {
    return JSON.parse(mp.utils.read_file(path, 8 * 1024 * 1024));
  } catch (_) {
    return fallback;
  }
};
IINATAN.writeText = function (path, value) {
  mp.utils.write_file("file://" + IINATAN.path(path), String(value));
};

IINATAN.boundedPut = function (cache, order, key, value, limit) {
  if (!Object.prototype.hasOwnProperty.call(cache, key)) order.push(key);
  cache[key] = value;
  while (order.length > limit) delete cache[order.shift()];
};
