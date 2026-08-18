const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const backend =
  process.env.IINATAN_BACKEND ||
  path.join(root, "build", "native", "release", "iinatan-backend");
const version = JSON.parse(
  execFileSync(backend, ["version"], { encoding: "utf8" }).trim(),
);

if (!version.target.startsWith("macos-")) {
  assert.strictEqual(version.bitmapOcr.available, false);
  assert.match(version.bitmapOcr.provider, /^unavailable/);
  console.log("native OCR unavailable stub tests passed");
} else {
  assert.strictEqual(version.bitmapOcr.available, true);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-ocr-"));
  try {
    const video = path.join(temporary, "video.png");
    const subtitles = path.join(temporary, "subtitles.png");
    const renderer = [
      "import AppKit",
      "let output = CommandLine.arguments[1]",
      'let includeText = CommandLine.arguments[2] == "text"',
      "let image = NSImage(size: NSSize(width: 1280, height: 720))",
      "image.lockFocus()",
      "NSColor.black.setFill()",
      "NSRect(x: 0, y: 0, width: 1280, height: 720).fill()",
      "if includeText {",
      '  let font = NSFont(name: "Hiragino Sans W6", size: 96) ?? NSFont.systemFont(ofSize: 96, weight: .bold)',
      "  let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]",
      '  let text = "日本語 字幕" as NSString',
      "  let size = text.size(withAttributes: attributes)",
      "  text.draw(at: NSPoint(x: (1280 - size.width) / 2, y: 100), withAttributes: attributes)",
      "}",
      "image.unlockFocus()",
      "let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!",
      "let png = bitmap.representation(using: .png, properties: [:])!",
      "try png.write(to: URL(fileURLWithPath: output))",
    ].join("\n");
    execFileSync("/usr/bin/swift", ["-e", renderer, video, "blank"]);
    execFileSync("/usr/bin/swift", ["-e", renderer, subtitles, "text"]);
    const request = path.join(temporary, "request.json");
    fs.writeFileSync(
      request,
      JSON.stringify({
        type: "bitmap-subtitle-ocr",
        protocol: 1,
        requestId: "vision-smoke",
        mode: "screenshot-diff",
        languages: ["ja-JP"],
        images: { video, subtitles },
        renderer: {
          width: 1280,
          height: 720,
          storageWidth: 1280,
          storageHeight: 720,
          marginLeft: 0,
          marginRight: 0,
          marginTop: 0,
          marginBottom: 0,
        },
      }),
    );
    const response = JSON.parse(
      execFileSync(backend, ["bitmap-subtitle-ocr", request], {
        encoding: "utf8",
      }).trim(),
    );
    assert.strictEqual(
      response.ok,
      true,
      `Apple Vision OCR failed: ${JSON.stringify(response)}`,
    );
    assert.match(
      response.text.replace(/\s/g, ""),
      /[\u3400-\u9fff]{2}/,
      "Vision should recognize CJK text from the rendered subtitle pixels",
    );
    assert.ok(response.units.length >= 2);
    assert.ok(
      response.units.every((unit) =>
        unit.rects.every(
          (rect) =>
            rect.w > 0 &&
            rect.h > 0 &&
            rect.x >= 0 &&
            rect.y >= 0 &&
            rect.x + rect.w <= 1280 &&
            rect.y + rect.h <= 720,
        ),
      ),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log("Apple Vision OCR smoke tests passed");
}
