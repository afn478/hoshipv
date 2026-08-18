IINATAN.unicodeMap = function (text) {
  var scalars = [],
    utf8 = 0,
    scalar = 0,
    i = 0;
  while (i < text.length) {
    var start = i,
      high = text.charCodeAt(i++),
      code = high;
    if (high >= 0xd800 && high <= 0xdbff && i < text.length) {
      var low = text.charCodeAt(i);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + (high - 0xd800) * 0x400 + low - 0xdc00;
        i++;
      }
    }
    var bytes = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    scalars.push({
      text: text.substring(start, i),
      codePoint: code,
      utf16Start: start,
      utf16End: i,
      scalarStart: scalar,
      scalarEnd: scalar + 1,
      utf8Start: utf8,
      utf8End: utf8 + bytes,
    });
    scalar++;
    utf8 += bytes;
  }
  return {
    text: text,
    scalars: scalars,
    utf8Length: utf8,
    scalarLength: scalar,
    utf16Length: text.length,
  };
};

IINATAN.lookupRequestFor = function (languageId, text, utf16Position, profile) {
  var language = IINATAN_LANGUAGE_REGISTRY.get(languageId);
  var map = IINATAN.unicodeMap(text);
  var scalarPosition = 0;
  map.scalars.some(function (item, index) {
    if (utf16Position < item.utf16End) {
      scalarPosition = index;
      return true;
    }
    return false;
  });
  var selected = language.lookupRequest(
    text,
    scalarPosition,
    profile.scanLength,
  );
  return {
    requestId: "",
    text: selected.lookupText,
    scanLength: profile.scanLength,
    maxResults: profile.maxEntries,
    maxGlossaries: profile.maxGlossesPerEntry,
    mode: selected.backendMode || language.lookupMode,
    mapping: map,
    selection: selected,
  };
};
