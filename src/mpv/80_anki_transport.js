IINATAN.ankiCache = Object.create(null);
IINATAN.ankiPending = Object.create(null);
IINATAN.ankiInvoke = function (action, params, callback, attempt) {
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    options = profile.anki,
    body = JSON.stringify({ action: action, version: 6, params: params || {} });
  IINATAN.http(
    {
      method: "POST",
      url: options.connectUrl,
      body: body,
      headers: ["Content-Type: application/json"],
      timeoutMs: options.timeoutSeconds * 1000,
      maxBytes: 16 * 1024 * 1024,
    },
    function (error, response) {
      if (error && (attempt || 0) < 1) {
        setTimeout(function () {
          IINATAN.ankiInvoke(action, params, callback, (attempt || 0) + 1);
        }, 120);
        return;
      }
      if (error) {
        callback(error);
        return;
      }
      var payload;
      try {
        payload =
          typeof response.body === "string"
            ? JSON.parse(response.body)
            : response.body;
      } catch (_) {
        callback(new Error("AnkiConnect returned invalid JSON"));
        return;
      }
      if (
        !payload ||
        !Object.prototype.hasOwnProperty.call(payload, "error") ||
        !Object.prototype.hasOwnProperty.call(payload, "result")
      ) {
        callback(new Error("Unsupported AnkiConnect response"));
        return;
      }
      callback(
        payload.error ? new Error(String(payload.error)) : null,
        payload.result,
      );
    },
  );
};
IINATAN.ankiDiscover = function (callback) {
  IINATAN.ankiInvoke("version", {}, function (error, version) {
    if (error || Number(version) < 6) {
      callback(error || new Error("AnkiConnect 6+ is required"));
      return;
    }
    IINATAN.ankiInvoke(
      "multi",
      {
        actions: [
          { action: "deckNames", params: {} },
          { action: "modelNames", params: {} },
        ],
      },
      function (multiError, result) {
        callback(
          multiError,
          multiError
            ? null
            : { version: version, decks: result[0], models: result[1] },
        );
      },
    );
  });
};
