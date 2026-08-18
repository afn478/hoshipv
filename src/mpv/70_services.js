IINATAN.openUrl = function (value) {
  var url = IINATAN.safeExternalUrl(value);
  if (!url) {
    IINATAN.showStatus("Blocked unsafe URL", "error");
    return;
  }
  var platform = IINATAN.platform;
  var args =
    platform === "windows"
      ? ["cmd", "/d", "/c", "start", "", url]
      : platform === "macos"
        ? ["/usr/bin/open", url]
        : ["xdg-open", url];
  IINATAN.subprocess(args, { playbackOnly: false }, function (error) {
    if (error)
      IINATAN.showStatus("Could not open URL: " + error.message, "error");
  });
};

IINATAN.http = function (request, callback) {
  var id = IINATAN.requestId(),
    output = "~~cache/iinatan/http-" + id + ".json";
  var args = [
    "http",
    "--method",
    request.method || "GET",
    "--url",
    request.url,
    "--output",
    IINATAN.path(output),
    "--timeout-ms",
    String(request.timeoutMs || 8000),
    "--max-bytes",
    String(request.maxBytes || 4 * 1024 * 1024),
  ];
  (request.headers || []).forEach(function (header) {
    args.push("--header", header);
  });
  if (request.body !== undefined) {
    var bodyPath = "~~cache/iinatan/http-body-" + id;
    IINATAN.writeText(bodyPath, request.body);
    args.push("--body-file", IINATAN.path(bodyPath));
  }
  IINATAN.backendCommand(
    args,
    function (error) {
      var result = error ? null : IINATAN.readJson(output, null);
      IINATAN.backendCommand(
        [
          "safe-clean",
          IINATAN.path("~~cache/iinatan"),
          "http-" + id + ".json",
          "http-body-" + id,
        ],
        function () {},
      );
      callback(
        error || (!result ? new Error("invalid HTTP response") : null),
        result,
      );
    },
    { playbackOnly: false },
  );
};

IINATAN.audioPreviewId = null;
IINATAN.cancelAudioPreview = function () {
  if (IINATAN.audioPreviewId) IINATAN.abortProcess(IINATAN.audioPreviewId);
  IINATAN.audioPreviewId = null;
};
IINATAN.previewEntryAudio = function (entry, context) {
  IINATAN.cancelAudioPreview();
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    sources = (profile.audio && profile.audio.sources) || [];
  if (!sources.length) {
    IINATAN.showStatus("No word-audio sources configured", "error");
    return;
  }
  var template = String(sources[0].url || ""),
    url = template
      .replace(/\{term\}/g, encodeURIComponent(entry.headword))
      .replace(/\{reading\}/g, encodeURIComponent(entry.reading));
  if (!IINATAN.safeExternalUrl(url)) {
    IINATAN.showStatus("Invalid audio-source URL", "error");
    return;
  }
  IINATAN.backendCommand(
    [
      "audio-preview",
      "--source-list",
      url,
      "--term",
      entry.headword,
      "--reading",
      entry.reading,
      "--cache",
      IINATAN.path("~~cache/iinatan/audio"),
    ],
    function (error, result) {
      IINATAN.audioPreviewId = null;
      if (error)
        IINATAN.showStatus("Audio preview failed: " + error.message, "error");
      else if (context && result && result.stdout) {
        try {
          context.wordAudio = JSON.parse(result.stdout);
        } catch (_) {}
      }
    },
    { playbackOnly: true, captureSize: 1024 * 1024 },
  );
};

IINATAN.exportSentenceAudio = function (context, callback) {
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    anki = profile.anki,
    window = IINATAN.sentenceAudioWindow(context, anki.sentenceAudioPaddingMs),
    ext = anki.audioFormat === "opus" ? "opus" : "mp3";
  var temp = IINATAN.path(
      "~~cache/iinatan/export-" + IINATAN.requestId() + "." + ext,
    ),
    source = context.source.audio || context.source.primary;
  var args = [
    String(
      mp.get_opt("ffmpeg") || IINATAN.config.global.ffmpegPath || "ffmpeg",
    ),
    "-nostdin",
    "-v",
    "error",
    "-ss",
    String(window.start),
    "-t",
    String(window.duration),
    "-i",
    source,
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-c:a",
    ext === "opus" ? "libopus" : "libmp3lame",
    "-b:a",
    anki.audioBitrateKbps + "k",
    "-y",
    temp,
  ];
  IINATAN.subprocess(
    args,
    { playbackOnly: true, captureSize: 1024 * 1024 },
    function (error) {
      if (error) {
        IINATAN.backendCommand(
          ["safe-clean", IINATAN.path("~~cache/iinatan"), temp],
          function () {},
        );
        callback(error);
        return;
      }
      IINATAN.backendCommand(
        [
          "hash-media",
          temp,
          IINATAN.path("~~state/iinatan/anki-media"),
          context.source.title || "video",
          ext,
        ],
        function (hashError, result) {
          if (hashError) {
            callback(hashError);
            return;
          }
          try {
            callback(null, JSON.parse(result.stdout));
          } catch (_) {
            callback(new Error("invalid media hash response"));
          }
        },
      );
    },
  );
};

IINATAN.captureScreenshot = function (context, callback) {
  var output = IINATAN.path(
    "~~cache/iinatan/screenshot-" + IINATAN.requestId() + ".jpg",
  );
  var handle = mp.command_native_async(
    { name: "screenshot-to-file", filename: output, flags: "video" },
    function (success, result, error) {
      if (!success || error) {
        callback(new Error(error || "screenshot failed"));
        return;
      }
      IINATAN.backendCommand(
        [
          "hash-media",
          output,
          IINATAN.path("~~state/iinatan/anki-media"),
          context.source.title || "video",
          "jpg",
        ],
        function (hashError, hashResult) {
          if (hashError) callback(hashError);
          else {
            try {
              callback(null, JSON.parse(hashResult.stdout));
            } catch (_) {
              callback(new Error("invalid screenshot hash response"));
            }
          }
        },
      );
    },
  );
  if (handle) {
    var id = "p" + ++IINATAN.processSerial;
    IINATAN.processes[id] = handle;
    IINATAN.processes[id].playbackOnly = true;
  }
};

IINATAN.showStatus = function (message, level) {
  IINATAN.state.status = {
    message: String(message || ""),
    level: level || "info",
    expires: Date.now() + 5000,
  };
  mp.osd_message("iinatan: " + message, 5);
};

IINATAN.updateSubtitleGeometry = function () {
  var sub = IINATAN.state.subtitle || {},
    text = sub.text,
    osd = IINATAN.state.osd || {};
  if (!text || !osd.w || !osd.h) {
    IINATAN.state.subtitleUnits = [];
    IINATAN.state.geometryKey = "";
    return;
  }
  var map = IINATAN.unicodeMap(text),
    units = map.scalars.map(function (scalar, position) {
      return {
        position: position,
        displayStartUtf16: scalar.utf16Start,
        displayEndUtf16: scalar.utf16End,
      };
    });
  var props = IINATAN.state.properties,
    source = IINATAN.mediaSource(),
    isAss = !!(sub.ass && sub.extradata),
    request;
  if (isAss && source.primary) {
    request = {
      type: "ass-geometry",
      protocol: 1,
      source: {
        path: source.primary,
        ffIndex: 0,
        external: false,
        autoAssStream: true,
      },
      cue: {
        timeMs: Math.round(Number(props["time-pos"] || 0) * 1000),
        startMs: Math.round(Number(sub.start || 0) * 1000),
        endMs: Math.round(Number(sub.end || 0) * 1000),
        assFull: sub.ass,
        assExtradata: sub.extradata,
        observedAss: sub.ass,
      },
      units: units,
      renderer: {
        width: osd.w,
        height: osd.h,
        storageWidth: (props["video-out-params"] || {}).w || osd.w,
        storageHeight: (props["video-out-params"] || {}).h || osd.h,
        marginLeft: osd.ml || 0,
        marginRight: osd.mr || 0,
        marginTop: osd.mt || 0,
        marginBottom: osd.mb || 0,
        pixelAspect: osd.par || 1,
        fontScale: Number(props["sub-scale"] || 1),
        lineSpacing: 0,
        forceMargins: false,
        embeddedFonts: true,
        useStorageSize: true,
        overrideMode: String(props["sub-ass-override"] || "yes"),
        defaultFamily: String(props["sub-font"] || "sans-serif"),
        fontProvider: "auto",
        assJustify: false,
        linePosition: Number(props["sub-pos"] || 100),
        hinting: "none",
        shaper: "complex",
      },
    };
  } else
    request = {
      type: "text-layout",
      protocol: 1,
      text: text,
      font: {
        family: String(props["sub-font"] || "sans-serif"),
        size:
          Number(props["sub-font-size"] || 55) *
          Number(props["sub-scale"] || 1),
        weight: props["sub-bold"] ? 700 : 400,
        italic: !!props["sub-italic"],
        spacing: Number(props["sub-spacing"] || 0),
      },
      wrapWidth: Math.max(1, osd.w - 2 * Number(props["sub-margin-x"] || 20)),
      osdScale: 1,
    };
  var geometryKey = JSON.stringify([
    text,
    sub.ass,
    sub.extradata,
    sub.start,
    sub.end,
    props["sid"],
    props["secondary-sid"],
    osd,
    props["video-out-params"],
    props["sub-font"],
    props["sub-font-size"],
    props["sub-bold"],
    props["sub-italic"],
    props["sub-spacing"],
    props["sub-margin-x"],
    props["sub-margin-y"],
    props["sub-pos"],
    props["sub-scale"],
    props["sub-ass-override"],
  ]);
  if (IINATAN.state.geometryKey === geometryKey) return;
  IINATAN.state.geometryKey = geometryKey;
  var generation = IINATAN.generation;
  IINATAN.workerRequest(request, function (error, response) {
    if (error || generation !== IINATAN.generation) return;
    if (response.units) {
      IINATAN.state.subtitleUnits = response.units;
      var rects = [];
      response.units.forEach(function (unit) {
        (unit.rects || []).forEach(function (rect) {
          rects.push(rect);
        });
      });
      IINATAN.state.subtitleRect = IINATAN.unionRects(rects);
    } else if (response.clusters) {
      var x = (osd.w - response.width) / 2,
        y = osd.h - Number(props["sub-margin-y"] || 22) - response.height;
      IINATAN.state.subtitleUnits = response.clusters.map(
        function (cluster, index) {
          return {
            position: index,
            rects: [
              {
                x: x + cluster.x,
                y: y + cluster.y,
                w: cluster.width,
                h: cluster.height,
              },
            ],
          };
        },
      );
      IINATAN.state.subtitleRect = {
        x: x,
        y: y,
        w: response.width,
        h: response.height,
      };
    }
  });
};
IINATAN.unionRects = function (rects) {
  if (!rects.length) return null;
  var x1 = rects[0].x,
    y1 = rects[0].y,
    x2 = x1 + rects[0].w,
    y2 = y1 + rects[0].h;
  rects.forEach(function (r) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};
