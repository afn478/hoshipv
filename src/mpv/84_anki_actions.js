IINATAN.storeAnkiMedia = function (file, callback) {
  if (!file || !file.path || !file.name) {
    callback(null, "");
    return;
  }
  IINATAN.ankiInvoke(
    "storeMediaFile",
    { filename: file.name, path: file.path },
    function (error, result) {
      callback(error, result || file.name);
    },
  );
};
IINATAN.captureAnkiMedia = function (templates, context, callback) {
  var serialized = JSON.stringify(templates || {}),
    nested = IINATAN.popupStack.length > 1;
  var needs = {
    screenshot: !nested && serialized.indexOf("{screenshot}") >= 0,
    sentenceAudio: !nested && serialized.indexOf("{sentence-audio}") >= 0,
    wordAudio: !nested && serialized.indexOf("{word-audio}") >= 0,
  };
  var tasks = [],
    captured = {};
  function add(name, task) {
    tasks.push(function (done) {
      task(function (error, file) {
        if (error) {
          done(error);
          return;
        }
        IINATAN.storeAnkiMedia(file, function (storeError, stored) {
          if (!storeError) captured[name] = stored;
          done(storeError);
        });
      });
    });
  }
  if (needs.screenshot)
    add("screenshot", function (done) {
      IINATAN.captureScreenshot(context.mediaContext, done);
    });
  if (needs.sentenceAudio)
    add("sentenceAudio", function (done) {
      IINATAN.exportSentenceAudio(context.mediaContext, done);
    });
  if (needs.wordAudio && context.wordAudio && context.wordAudio.path) {
    add("wordAudio", function (done) {
      IINATAN.backendCommand(
        [
          "hash-media",
          context.wordAudio.path,
          IINATAN.path("~~state/iinatan/anki-media"),
          context.expression,
          String(context.wordAudio.path).split(".").pop() || "audio",
        ],
        function (error, result) {
          if (error) {
            done(error);
            return;
          }
          try {
            done(null, JSON.parse(result.stdout));
          } catch (_) {
            done(new Error("invalid word-audio media result"));
          }
        },
      );
    });
  }
  var index = 0;
  function next(error) {
    if (error || index >= tasks.length) {
      callback(error, captured);
      return;
    }
    tasks[index++](next);
  }
  next(null);
};
IINATAN.addEntryToAnki = function (entry, document, addAnyway) {
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    options = profile.anki;
  if (!options.enabled) {
    IINATAN.showStatus("Anki is disabled in this profile", "error");
    return;
  }
  var context = IINATAN.ankiCardContext(entry, document);
  IINATAN.captureAnkiMedia(
    options.fields,
    context,
    function (mediaError, media) {
      if (mediaError) {
        IINATAN.showStatus("Anki media failed: " + mediaError.message, "error");
        return;
      }
      var fields = IINATAN.renderAnkiFields(options.fields, context, media);
      IINATAN.checkAnkiDuplicate(
        fields,
        options,
        function (duplicateError, ids) {
          if (duplicateError) {
            IINATAN.showStatus(duplicateError.message, "error");
            return;
          }
          if (ids.length && options.duplicateMode === "prevent" && !addAnyway) {
            IINATAN.showStatus(
              "Duplicate note exists (" +
                ids[0] +
                "). Use script-message iinatan-add-anyway to override.",
              "warn",
            );
            IINATAN.state.pendingDuplicate = {
              entry: entry,
              document: document,
              ids: ids,
            };
            return;
          }
          IINATAN.ankiInvoke(
            "addNote",
            {
              note: {
                deckName: options.deck,
                modelName: options.model,
                fields: fields,
                options: {
                  allowDuplicate:
                    options.duplicateMode === "allow" || !!addAnyway,
                  duplicateScope: options.duplicateScope,
                },
                tags: options.tags || ["iinatan"],
              },
            },
            function (error, noteId) {
              if (error)
                IINATAN.showStatus(
                  "Anki add failed: " + error.message,
                  "error",
                );
              else {
                IINATAN.showStatus("Added Anki note " + noteId, "info");
                IINATAN.state.lastNoteId = noteId;
              }
            },
          );
        },
      );
    },
  );
};
IINATAN.openAnkiNote = function (noteId) {
  var id = Number(noteId);
  if (!isFinite(id) || id <= 0 || Math.floor(id) !== id) {
    IINATAN.showStatus("Invalid Anki note ID", "error");
    return;
  }
  IINATAN.ankiInvoke("guiBrowse", { query: "nid:" + id }, function (error) {
    if (error) IINATAN.showStatus(error.message, "error");
  });
};
