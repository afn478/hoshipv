# Bitmap subtitle OCR boundary

The macOS arm64 package now wires the bundled HoshiDicts helper's Apple Vision
OCR capability into the stock-mpv host. It is a separate, platform-labelled
service: the host asks the helper to decode the selected bitmap subtitle stream
or, when explicitly enabled and paused, to recognize a bounded screenshot diff.
The Electron renderer never receives subtitle pixels.

The helper reports its Vision revision and supported language identifiers through
`version`. The host maps the profile languages to `ja-JP`, `en-US`, `de-DE`,
`fr-FR`, `ko-KR`, or the appropriate Chinese identifiers, validates the returned
renderer dimensions and unit boxes, and drops stale or cancelled requests.
Apple documents `VNRecognizeTextRequest` as an on-device image text-recognition
API; see [Recognizing Text in Images](https://developer.apple.com/documentation/vision/recognizing-text-in-images).

OCR boxes are intentionally marked `exact: false` with `lookupAllowed: true`.
They are usable for dictionary lookup, but they are not a claim of exact
stock-mpv per-glyph registration and do not promote the ASS/libass geometry
oracle. Confidence, recognition mode, and failure reasons stay in the host
diagnostic boundary.

The macOS arm64 native desktop path was accepted with a real PGS track on
2026-09-07. Vision returned a word-level box, so the host subdivides repeated
word boxes across grapheme units to keep neighboring pointer targets distinct;
that subdivision is a stable lookup approximation, not a renderer-equivalence
claim.

The screenshot-diff fallback is limited to the primary subtitle surface while
mpv is paused. It requires mpv's two explicit screenshot targets and is disabled
by default. Direct decoded-subtitle OCR is preferred because it avoids a browser
or desktop pixel transport path. Windows and Linux remain explicitly unverified
for OCR until their native systems receive their own implementation and tests.
