IINATAN.openUrl = function (value) {
  var url = IINATAN.safeExternalUrl(value);
  if (!url) {
    IINATAN.showStatus("Blocked unsafe URL", "error");
    return;
  }
  IINATAN.backendCommand(
    ["open-url", url],
    function (error) {
      if (error)
        IINATAN.showStatus("Could not open URL: " + error.message, "error");
    },
    { playbackOnly: false },
  );
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
  var previewId = IINATAN.backendCommand(
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
      if (IINATAN.audioPreviewId === previewId) IINATAN.audioPreviewId = null;
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
  IINATAN.audioPreviewId = previewId;
};

IINATAN.exportSentenceAudio = function (context, callback) {
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    anki = profile.anki,
    window = IINATAN.sentenceAudioWindow(context, anki.sentenceAudioPaddingMs),
    ext = anki.audioFormat === "opus" ? "opus" : "mp3";
  var exportId = IINATAN.requestId(),
    temp = IINATAN.path("~~cache/iinatan/export-" + exportId + "." + ext),
    cacheExcerpt = IINATAN.path("~~cache/iinatan/export-" + exportId + ".mkv"),
    source = context.source.audio || context.source.primary,
    exportGeneration = context.generation;
  if (!source) {
    callback(new Error("sentence audio has no media source"));
    return;
  }
  function encode(input, seek, done) {
    var args = [
      String(
        mp.get_opt("ffmpeg") || IINATAN.config.global.ffmpegPath || "ffmpeg",
      ),
      "-nostdin",
      "-v",
      "error",
      "-ss",
      String(seek),
      "-t",
      String(window.duration),
      "-i",
      input,
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
      done,
    );
  }
  function finish(error) {
    if (error) {
      IINATAN.backendCommand(
        ["safe-clean", IINATAN.path("~~cache/iinatan"), temp, cacheExcerpt],
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
        IINATAN.backendCommand(
          ["safe-clean", IINATAN.path("~~cache/iinatan"), cacheExcerpt],
          function () {},
        );
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
  }
  function fallback() {
    encode(source, window.start, finish);
  }
  if (context.source.audio !== context.source.primary) {
    fallback();
    return;
  }
  var dumpProcessId = "p" + ++IINATAN.processSerial,
    dumpHandle = mp.command_native_async(
      {
        name: "dump-cache",
        start: window.start,
        end: window.end,
        filename: cacheExcerpt,
      },
      function (success, result, error) {
        delete IINATAN.processes[dumpProcessId];
        if (exportGeneration !== IINATAN.mediaGeneration) {
          IINATAN.backendCommand(
            ["safe-clean", IINATAN.path("~~cache/iinatan"), temp, cacheExcerpt],
            function () {},
          );
          callback(new Error("sentence audio cancelled by media change"));
          return;
        }
        if (!success || error || !mp.utils.file_info(cacheExcerpt)) {
          fallback();
          return;
        }
        // dump-cache preserves source timestamps; seek to the immutable subtitle
        // start so keyframe-aligned preroll never shifts the exported sentence.
        encode(cacheExcerpt, window.start, function (encodeError) {
          if (encodeError) fallback();
          else finish(null);
        });
      },
    );
  if (dumpHandle) {
    IINATAN.processes[dumpProcessId] = {
      handle: dumpHandle,
      playbackOnly: true,
    };
  }
};

IINATAN.captureScreenshot = function (context, callback) {
  var processId = "p" + ++IINATAN.processSerial,
    output = IINATAN.path(
      "~~cache/iinatan/screenshot-" + IINATAN.requestId() + ".jpg",
    );
  var handle = mp.command_native_async(
    { name: "screenshot-to-file", filename: output, flags: "video" },
    function (success, result, error) {
      delete IINATAN.processes[processId];
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
    IINATAN.processes[processId] = { handle: handle, playbackOnly: true };
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

IINATAN.ocrCache = { values: Object.create(null), order: [] };
IINATAN.bitmapSubtitleTrack = function () {
  var track = IINATAN.subtitleTrack("primary");
  if (!track) return null;
  var codec = String(track.codec || track["codec-name"] || "").toLowerCase();
  return /pgs|hdmv|dvd|vobsub|dvb|xsub/.test(codec) ? track : null;
};

IINATAN.applyBitmapOcr = function (key, response) {
  if (!response || !response.ok || !response.text) return;
  var text = String(response.text),
    sub = {
      surface: "primary",
      text: text,
      ass: "",
      extradata: "",
      start: Number(response.cueStartMs) / 1000,
      end: Number(response.cueEndMs) / 1000,
      delay: Number(IINATAN.state.properties["sub-delay"] || 0),
      ocr: true,
    };
  IINATAN.state.subtitle = sub;
  IINATAN.state.subtitles = [sub];
  IINATAN.state.subtitleUnits = (response.units || []).map(
    function (unit, index) {
      return {
        position: index,
        surface: "primary",
        text: text,
        displayStartUtf16: unit.displayStartUtf16,
        displayEndUtf16: unit.displayEndUtf16,
        confidence: unit.confidence,
        rects: unit.rects || [],
      };
    },
  );
  var rects = [];
  IINATAN.state.subtitleUnits.forEach(function (unit) {
    rects = rects.concat(unit.rects);
  });
  IINATAN.state.subtitleRect = IINATAN.unionRects(rects);
  IINATAN.state.ocrAppliedKey = key;
  IINATAN.handleHover();
};

IINATAN.cacheBitmapOcr = function (key, response) {
  if (!IINATAN.ocrCache.values[key]) IINATAN.ocrCache.order.push(key);
  IINATAN.ocrCache.values[key] = response;
  while (IINATAN.ocrCache.order.length > 32)
    delete IINATAN.ocrCache.values[IINATAN.ocrCache.order.shift()];
};

IINATAN.ocrScreenshot = function (flags, path, callback) {
  var processId = "p" + ++IINATAN.processSerial;
  var handle = mp.command_native_async(
    { name: "screenshot-to-file", filename: path, flags: flags },
    function (success, result, error) {
      delete IINATAN.processes[processId];
      callback(
        !success || error ? new Error(error || "OCR screenshot failed") : null,
      );
    },
  );
  if (handle)
    IINATAN.processes[processId] = { handle: handle, playbackOnly: true };
  else callback(new Error(mp.last_error() || "OCR screenshot did not start"));
};

IINATAN.requestScreenshotOcr = function (base, callback) {
  var cacheRoot = IINATAN.path("~~cache/iinatan"),
    id = IINATAN.requestId(),
    video = cacheRoot + "/ocr-video-" + id + ".png",
    subtitles = cacheRoot + "/ocr-subtitles-" + id + ".png";
  function cleanup() {
    IINATAN.backendCommand(
      ["safe-clean", cacheRoot, video, subtitles],
      function () {},
      { playbackOnly: true },
    );
  }
  IINATAN.ocrScreenshot("video", video, function (videoError) {
    if (videoError) {
      cleanup();
      callback(videoError);
      return;
    }
    IINATAN.ocrScreenshot("subtitles", subtitles, function (subtitleError) {
      if (subtitleError) {
        cleanup();
        callback(subtitleError);
        return;
      }
      var request = Object.assign({}, base, {
        mode: "screenshot-diff",
        images: { video: video, subtitles: subtitles },
      });
      delete request.source;
      delete request.timeMs;
      delete request.cueStartMs;
      delete request.cueEndMs;
      IINATAN.workerRequest(request, function (error, response) {
        cleanup();
        callback(error, response);
      });
    });
  });
};

IINATAN.requestBitmapSubtitleOcr = function () {
  if (
    IINATAN.platform !== "macos" ||
    !IINATAN.state.fileLoaded ||
    (IINATAN.state.subtitles || []).length
  )
    return;
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    ocr = profile.ocr || {},
    props = IINATAN.state.properties,
    osd = IINATAN.state.osd || {},
    track = IINATAN.bitmapSubtitleTrack();
  if (
    !ocr.enabled ||
    !track ||
    !osd.w ||
    !osd.h ||
    (!props.pause && !ocr.prefetch && !(IINATAN.state.mouse || {}).hover)
  )
    return;
  var source = IINATAN.mediaSource(),
    external = track["external-filename"] || track.externalFilename,
    sourcePath = external || source.primary,
    ffIndex = Number(track["ff-index"]),
    timeMs = Math.round(Number(props["time-pos"] || 0) * 1000),
    startMs = isFinite(Number(props["sub-start"]))
      ? Math.round(Number(props["sub-start"]) * 1000)
      : timeMs - 1000,
    endMs = isFinite(Number(props["sub-end"]))
      ? Math.round(Number(props["sub-end"]) * 1000)
      : timeMs + 1000,
    key = JSON.stringify([
      IINATAN.mediaGeneration,
      sourcePath,
      track.id,
      startMs,
      endMs,
      profile.lookupLanguage,
      osd,
    ]);
  if (!sourcePath) return;
  if (IINATAN.ocrCache.values[key]) {
    IINATAN.applyBitmapOcr(key, IINATAN.ocrCache.values[key]);
    return;
  }
  if (IINATAN.state.ocrRequestKey === key) return;
  IINATAN.state.ocrRequestKey = key;
  var languages = {
      ja: "ja-JP",
      en: "en-US",
      de: "de-DE",
      fr: "fr-FR",
      ko: "ko-KR",
      zh: "zh-Hans",
    },
    generation = IINATAN.generation,
    request = {
      type: "bitmap-subtitle-ocr",
      protocol: 1,
      mode: "decoded-subtitle",
      languages: [languages[profile.lookupLanguage] || "en-US"],
      source: {
        path: sourcePath,
        ffIndex: isFinite(ffIndex) ? ffIndex : -1,
        autoBitmapStream: !isFinite(ffIndex),
        cacheExcerpt: !external && /^https?:\/\//.test(sourcePath),
      },
      timeMs: timeMs,
      cueStartMs: startMs,
      cueEndMs: endMs,
      renderer: {
        width: osd.w,
        height: osd.h,
        storageWidth: (props["video-out-params"] || {}).w || osd.w,
        storageHeight: (props["video-out-params"] || {}).h || osd.h,
        marginLeft: osd.ml || 0,
        marginRight: osd.mr || 0,
        marginTop: osd.mt || 0,
        marginBottom: osd.mb || 0,
      },
    };
  function finish(error, response) {
    if (generation !== IINATAN.generation) return;
    IINATAN.state.ocrRequestKey = "";
    if (error || !response || !response.ok) return;
    IINATAN.cacheBitmapOcr(key, response);
    IINATAN.applyBitmapOcr(key, response);
  }
  IINATAN.workerRequest(request, function (error, response) {
    if (error && ocr.screenshotFallback)
      IINATAN.requestScreenshotOcr(request, finish);
    else finish(error, response);
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

IINATAN.subtitleTrack = function (surface) {
  var props = IINATAN.state.properties,
    selected = props[surface === "secondary" ? "secondary-sid" : "sid"],
    tracks = Array.isArray(props["track-list"]) ? props["track-list"] : [];
  for (var index = 0; index < tracks.length; index++) {
    var track = tracks[index];
    if (track && track.type === "sub" && String(track.id) === String(selected))
      return track;
  }
  return null;
};

IINATAN.geometryRequestForSubtitle = function (sub) {
  var props = IINATAN.state.properties,
    osd = IINATAN.state.osd || {},
    map = IINATAN.unicodeMap(sub.text),
    track = IINATAN.subtitleTrack(sub.surface),
    external = track && (track["external-filename"] || track.externalFilename),
    sourcePath = external || IINATAN.mediaSource().primary,
    ffIndex = track && Number(track["ff-index"]);
  var units = map.scalars.map(function (scalar, position) {
    return {
      position: position,
      displayStartUtf16: scalar.utf16Start,
      displayEndUtf16: scalar.utf16End,
    };
  });
  if (sub.ass && sub.extradata && sourcePath) {
    return {
      type: "ass-geometry",
      protocol: 1,
      source: {
        path: sourcePath,
        ffIndex: isFinite(ffIndex) ? ffIndex : -1,
        external: !!external,
        autoAssStream: !isFinite(ffIndex),
        cacheExcerpt: !external && /^https?:\/\//.test(sourcePath),
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
  }
  return {
    type: "text-layout",
    protocol: 1,
    text: sub.text,
    font: {
      family: String(props["sub-font"] || "sans-serif"),
      size:
        Number(props["sub-font-size"] || 55) * Number(props["sub-scale"] || 1),
      weight: props["sub-bold"] ? 700 : 400,
      italic: !!props["sub-italic"],
      spacing: Number(props["sub-spacing"] || 0),
    },
    wrapWidth: Math.max(1, osd.w - 2 * Number(props["sub-margin-x"] || 20)),
    osdScale: 1,
    fallbackFontPath: IINATAN.fallbackFontPath(),
  };
};

IINATAN.updateSubtitleGeometry = function () {
  var subtitles = IINATAN.state.subtitles || [],
    osd = IINATAN.state.osd || {};
  if (!subtitles.length || !osd.w || !osd.h) {
    IINATAN.state.subtitleUnits = [];
    IINATAN.state.geometryKey = "";
    return;
  }
  var key = JSON.stringify([
    subtitles,
    IINATAN.state.properties["sid"],
    IINATAN.state.properties["secondary-sid"],
    IINATAN.state.properties["track-list"],
    osd,
    IINATAN.state.properties["video-out-params"],
    IINATAN.state.properties["sub-font"],
    IINATAN.state.properties["sub-font-size"],
    IINATAN.state.properties["sub-pos"],
    IINATAN.state.properties["sub-scale"],
  ]);
  if (key === IINATAN.state.geometryKey) return;
  IINATAN.state.geometryKey = key;
  var generation = IINATAN.generation,
    geometryGeneration = (IINATAN.state.geometryGeneration || 0) + 1,
    surfaces = Object.create(null);
  IINATAN.state.geometryGeneration = geometryGeneration;
  IINATAN.state.subtitleUnits = [];
  subtitles.forEach(function (sub, surfaceIndex) {
    IINATAN.workerRequest(
      IINATAN.geometryRequestForSubtitle(sub),
      function (error, response) {
        if (
          error ||
          generation !== IINATAN.generation ||
          geometryGeneration !== IINATAN.state.geometryGeneration
        )
          return;
        var units = [],
          allRects = [];
        if (response.units) units = response.units;
        else if (response.clusters) {
          var x = (osd.w - response.width) / 2,
            margin = Number(IINATAN.state.properties["sub-margin-y"] || 22),
            lineOffset = surfaceIndex * (response.height + 8),
            y = osd.h - margin - response.height - lineOffset;
          units = response.clusters.map(function (cluster, index) {
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
          });
        }
        units.forEach(function (unit) {
          unit.surface = sub.surface;
          unit.text = sub.text;
          (unit.rects || []).forEach(function (rect) {
            allRects.push(rect);
          });
        });
        surfaces[sub.surface] = { units: units, rects: allRects };
        var combined = [],
          rects = [];
        ["primary", "secondary"].forEach(function (surface) {
          if (!surfaces[surface]) return;
          combined = combined.concat(surfaces[surface].units);
          rects = rects.concat(surfaces[surface].rects);
        });
        IINATAN.state.subtitleUnits = combined;
        IINATAN.state.subtitleRect = IINATAN.unionRects(rects);
        IINATAN.handleHover();
      },
      10000,
    );
  });
};
