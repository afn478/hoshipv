IINATAN.ankiDuplicateQuery = function (firstField, value, deck, scope) {
  function quote(text) {
    return '"' + String(text || "").replace(/(["\\])/g, "\\$1") + '"';
  }
  var query = firstField + ":" + quote(value);
  if (scope === "deck" && deck) query = "deck:" + quote(deck) + " " + query;
  return query;
};
IINATAN.checkAnkiDuplicate = function (fields, options, callback) {
  var names = Object.keys(fields),
    first = names[0];
  if (!first) {
    callback(new Error("No Anki field templates configured"));
    return;
  }
  var key = [options.deck, options.duplicateScope, first, fields[first]].join(
      "\u0000",
    ),
    cached = IINATAN.ankiCache[key];
  if (cached && Date.now() - cached.time < 5000) {
    callback(null, cached.ids);
    return;
  }
  if (IINATAN.ankiPending[key]) {
    IINATAN.ankiPending[key].push(callback);
    return;
  }
  IINATAN.ankiPending[key] = [callback];
  IINATAN.ankiInvoke(
    "findNotes",
    {
      query: IINATAN.ankiDuplicateQuery(
        first,
        fields[first],
        options.deck,
        options.duplicateScope,
      ),
    },
    function (error, ids) {
      if (!error) IINATAN.ankiCache[key] = { time: Date.now(), ids: ids || [] };
      var callbacks = IINATAN.ankiPending[key] || [];
      delete IINATAN.ankiPending[key];
      callbacks.forEach(function (pendingCallback) {
        pendingCallback(error, ids || []);
      });
    },
  );
};
