# OCR limitation

The migrated profile retains the reference OCR preference keys so importing a
profile does not silently discard user intent. This repository does not claim
OCR support and does not use OCR as a substitute for native ASS/SRT geometry.

An eventual OCR implementation must be a separate, platform-labelled service
with explicit capture permissions and confidence/error reporting. In
particular, macOS Vision availability would not imply Windows or Linux parity,
and an OCR box would not be promoted to exact subtitle glyph geometry.
