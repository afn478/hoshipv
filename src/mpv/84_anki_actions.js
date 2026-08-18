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
IINATAN.addEntryToAnki = function (entry, document, addAnyway) {
  var profile = IINATAN.config.profiles[IINATAN.config.activeProfileId],
    options = profile.anki;
  if (!options.enabled) {
    IINATAN.showStatus("Anki is disabled in this profile", "error");
    return;
  }
  var context = IINATAN.ankiCardContext(entry, document),
    media = {},
    fields = IINATAN.renderAnkiFields(options.fields, context, media);
  IINATAN.checkAnkiDuplicate(fields, options, function (duplicateError, ids) {
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
            allowDuplicate: options.duplicateMode === "allow" || !!addAnyway,
            duplicateScope: options.duplicateScope,
          },
          tags: options.tags || ["iinatan"],
        },
      },
      function (error, noteId) {
        if (error)
          IINATAN.showStatus("Anki add failed: " + error.message, "error");
        else {
          IINATAN.showStatus("Added Anki note " + noteId, "info");
          IINATAN.state.lastNoteId = noteId;
        }
      },
    );
  });
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
