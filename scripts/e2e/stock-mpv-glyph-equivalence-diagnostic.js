"use strict";

process.env.IINATAN_STOCK_PIXEL_ORACLE_INCLUDE_PER_GLYPH = "1";
require("./stock-mpv-pixel-oracle")
  .main()
  .catch((error) => {
    console.error(`STOCK MPV GLYPH EQUIVALENCE DIAGNOSTIC: ${error.message}`);
    process.exitCode = 1;
  });
