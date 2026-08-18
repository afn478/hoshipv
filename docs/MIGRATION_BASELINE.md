# Version 2 migration

Version 3 replaces the former host-specific plugin with a native mpv 0.41+ application. The final legacy implementation is retained on `archive/iina-v2.1.4`; the primary branch contains no legacy runtime or package artifacts.

On first load, the config service reads prior flat preferences/profile data when available and normalizes it into schema version 2. Missing dictionary references are retained in `pendingDictionaries` and reconciled after installation. Existing source order, active profile, lookup language, result limits, subtitle/pause behavior, audio sources, OCR preferences, and Anki configuration are preserved where they have native equivalents.

The native ASS geometry path is now mandatory, observer-driven worker IPC replaces polling/bridges, and mpv remains responsible for visible subtitles. Obsolete renderer selection and hidden-native-subtitle settings are discarded. Arbitrary custom CSS is preserved only as inert text in `migration.archivedCustomCss`; validated theme tokens replace executable styling.

Writes use `.next`, schema validation, atomic replacement, read-back verification, and `.backup`. A malformed input is copied to a timestamped corrupt file before defaults are recovered. Migration never overwrites the source before a verified replacement exists.
