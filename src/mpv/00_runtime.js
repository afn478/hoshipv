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
    if (typeof value === "string") {
      var characters = [];
      for (var index = 0; index < value.length; index++) {
        var first = value.charCodeAt(index);
        if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
          var second = value.charCodeAt(index + 1);
          if (second >= 0xdc00 && second <= 0xdfff) {
            characters.push(value.substring(index, index + 2));
            index++;
            continue;
          }
        }
        characters.push(value.charAt(index));
      }
      return characters;
    }
    return Array.prototype.slice.call(value);
  };
if (!String.prototype.codePointAt)
  String.prototype.codePointAt = function (position) {
    var text = String(this),
      index = Number(position) || 0;
    if (index < 0 || index >= text.length) return undefined;
    index = Math.floor(index);
    var first = text.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < text.length) {
      var second = text.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff)
        return 0x10000 + (first - 0xd800) * 0x400 + second - 0xdc00;
    }
    return first;
  };
if (!String.fromCodePoint)
  String.fromCodePoint = function () {
    var output = "";
    for (var index = 0; index < arguments.length; index++) {
      var codePoint = Number(arguments[index]);
      if (
        !isFinite(codePoint) ||
        Math.floor(codePoint) !== codePoint ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      )
        throw new RangeError("invalid code point");
      if (codePoint <= 0xffff) output += String.fromCharCode(codePoint);
      else {
        codePoint -= 0x10000;
        output += String.fromCharCode(
          0xd800 + Math.floor(codePoint / 0x400),
          0xdc00 + (codePoint % 0x400),
        );
      }
    }
    return output;
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
  version: "3.0.0",
  protocol: { lookup: 1, geometry: 1, textLayout: 1 },
  generation: 0,
  state: {
    properties: Object.create(null),
    fileLoaded: false,
    popup: null,
    settingsOpen: false,
    interactive: false,
    lookupEnabled: true,
  },
  timers: Object.create(null),
  processes: Object.create(null),
  processSerial: 0,
  listeners: Object.create(null),
};

IINATAN.validateRuntimeCompatibility = function () {
  var supplementary = "\ud83d\ude00";
  if (
    supplementary.codePointAt(0) !== 0x1f600 ||
    String.fromCodePoint(0x1f600) !== supplementary ||
    Array.from(supplementary).length !== 1
  )
    throw new Error("Unicode compatibility layer is unavailable");
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
  var entry = IINATAN.processes[id];
  if (!entry) return;
  try {
    mp.abort_async_command(entry.handle);
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
  IINATAN.processes[id] = {
    handle: handle,
    playbackOnly: command.playback_only,
  };
  return id;
};

IINATAN.path = function (value) {
  return mp.utils.get_user_path(value);
};
IINATAN.fallbackFontPath = function () {
  return (
    mp.get_opt("fallback-font") ||
    IINATAN.path("~~/scripts/iinatan/fonts/NotoSansCJKjp-Regular.otf")
  );
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
