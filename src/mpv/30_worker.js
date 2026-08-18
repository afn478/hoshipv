IINATAN.worker = {
  root: "~~state/iinatan/worker",
  serial: 0,
  generation: 0,
  active: null,
  pending: null,
  auxiliary: [],
  processId: null,
  poll: null,
};
IINATAN.backendPath = function () {
  return (
    mp.get_opt("backend") ||
    (IINATAN.config && IINATAN.config.global.backendPath) ||
    IINATAN.DEFAULT_CONFIG.global.backendPath
  );
};
IINATAN.backendCommand = function (args, callback, options) {
  IINATAN.subprocess(
    [IINATAN.path(IINATAN.backendPath())].concat(args),
    options || {},
    callback,
  );
};

IINATAN.workerPath = function (part) {
  return IINATAN.path(IINATAN.worker.root + (part ? "/" + part : ""));
};
IINATAN.requestId = function () {
  return "m" + Date.now() + "-" + ++IINATAN.worker.serial;
};

IINATAN.publishRequest = function (id, payload) {
  var queue = IINATAN.worker.root + "/queue/";
  IINATAN.writeText(queue + id + ".request", JSON.stringify(payload) + "\n");
  IINATAN.writeText(queue + id + ".json", "committed\n");
};

IINATAN.cleanupRequest = function (id) {
  IINATAN.backendCommand(
    ["queue-clean", IINATAN.workerPath(""), id],
    function () {},
    { playbackOnly: false },
  );
};

IINATAN.startWorker = function (callback) {
  if (IINATAN.worker.processId) {
    callback(null);
    return;
  }
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId];
  var registry = {};
  IINATAN.config.dictionaries.forEach(function (item) {
    registry[item.id] = item;
  });
  var dictionaries = (profile.dictionaries || [])
    .filter(function (id) {
      return registry[id] && registry[id].enabled !== false;
    })
    .map(function (id) {
      return registry[id].path;
    });
  var config =
    ["fingerprint\t" + profile.lookupLanguage]
      .concat(
        dictionaries.map(function (path) {
          return "dict\t" + path;
        }),
      )
      .join("\n") + "\n";
  IINATAN.writeText(IINATAN.worker.root + "/config.tsv", config);
  IINATAN.backendCommand(
    ["worker-prepare", IINATAN.workerPath("")],
    function (prepareError) {
      if (prepareError) {
        callback(prepareError);
        return;
      }
      IINATAN.worker.processId = IINATAN.subprocess(
        [
          IINATAN.path(IINATAN.backendPath()),
          "worker",
          IINATAN.workerPath(""),
          "--owner-pid",
          String(mp.utils.getpid()),
        ],
        { playbackOnly: false },
        function (error) {
          IINATAN.worker.processId = null;
          if (error && IINATAN.state.shuttingDown !== true)
            IINATAN.log("error", "backend worker stopped: " + error.message);
        },
      );
      setTimeout(function () {
        callback(null);
      }, 80);
    },
  );
};

IINATAN.stopWorker = function (callback) {
  try {
    IINATAN.writeText(IINATAN.worker.root + "/stop", "stop\n");
  } catch (_) {}
  setTimeout(function () {
    if (IINATAN.worker.processId)
      IINATAN.abortProcess(IINATAN.worker.processId);
    IINATAN.worker.processId = null;
    if (callback) callback();
  }, 150);
};

IINATAN.pollResponse = function (job) {
  if (!job || job.generation !== IINATAN.worker.generation) return;
  var path = IINATAN.worker.root + "/responses/" + job.id + ".json";
  var response = IINATAN.readJson(path, null);
  if (response) {
    IINATAN.cleanupRequest(job.id);
    IINATAN.worker.active = null;
    job.callback(
      response.ok === false
        ? new Error(
            response.error || response.reason || "worker request failed",
          )
        : null,
      response,
    );
    IINATAN.runPendingLookup();
    return;
  }
  if (Date.now() >= job.deadline) {
    IINATAN.cleanupRequest(job.id);
    IINATAN.worker.active = null;
    job.callback(new Error("worker request timed out"));
    IINATAN.runPendingLookup();
    return;
  }
  IINATAN.worker.poll = setTimeout(function () {
    IINATAN.pollResponse(job);
  }, 3);
};

IINATAN.runPendingLookup = function () {
  if (IINATAN.worker.active) return;
  var job = IINATAN.worker.pending || IINATAN.worker.auxiliary.shift();
  if (!job) return;
  if (job === IINATAN.worker.pending) IINATAN.worker.pending = null;
  IINATAN.worker.active = job;
  IINATAN.startWorker(function (error) {
    if (error) {
      IINATAN.worker.active = null;
      job.callback(error);
      IINATAN.runPendingLookup();
      return;
    }
    try {
      IINATAN.publishRequest(job.id, job.payload);
      IINATAN.pollResponse(job);
    } catch (publishError) {
      IINATAN.worker.active = null;
      job.callback(publishError);
      IINATAN.runPendingLookup();
    }
  });
};

IINATAN.lookup = function (payload, callback) {
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId];
  if (!(profile.dictionaries || []).length) {
    setTimeout(function () {
      callback(
        new Error(
          "No enabled dictionaries. Open the iinatan settings panel to import one.",
        ),
      );
    }, 0);
    return null;
  }
  var id = IINATAN.requestId();
  var request = {
    requestId: id,
    text: payload.text,
    scanLength: payload.scanLength,
    maxResults: payload.maxResults,
    maxGlossaries: payload.maxGlossaries,
    mode: payload.mode,
  };
  if (IINATAN.worker.pending)
    IINATAN.worker.pending.callback(new Error("lookup superseded"));
  IINATAN.worker.pending = {
    id: id,
    payload: request,
    callback: callback,
    generation: IINATAN.worker.generation,
    deadline: Date.now() + profile.lookupTimeoutMs,
  };
  IINATAN.runPendingLookup();
  return id;
};

IINATAN.workerRequest = function (payload, callback, timeout) {
  var id = IINATAN.requestId();
  payload.requestId = id;
  var job = {
    id: id,
    payload: payload,
    callback: callback,
    generation: IINATAN.worker.generation,
    deadline: Date.now() + (timeout || 10000),
  };
  IINATAN.worker.auxiliary.push(job);
  IINATAN.runPendingLookup();
};
