# Language lookup and deinflection

The subtitle hit layer identifies a source span first. The host then creates a
bounded, ordered candidate list for the selected language and asks the
dictionary worker for each candidate when exact lookup is required. Results are
deduplicated before the popup is shown; the surface candidate remains first so
an actual surface entry is not displaced by a later lemma.

Japanese and Chinese retain rightward character-prefix lookup. Korean uses a
contiguous Hangul word span. English, German, and French use exact candidate
lookup with bounded deinflection. German also handles common irregular
participles and a bounded right-context separable-verb candidate such as
`stehe ... auf` → `aufstehen`; French preserves the original apostrophe form,
normalizes common apostrophe variants, and tries known elision tails.

The transform tables are derived from the [Yomitan English transforms](https://github.com/yomidevs/yomitan/blob/master/ext/js/language/en/english-transforms.js),
[German transforms](https://github.com/yomidevs/yomitan/blob/master/ext/js/language/de/german-transforms.js),
and [French transforms](https://github.com/yomidevs/yomitan/blob/master/ext/js/language/fr/french-transforms.js),
and are kept under `src/services/language-rules/` with attribution headers.
They are intentionally bounded by transform depth, candidate count, request
count, and worker response limits. A candidate is a lookup hint, not proof that
the dictionary contains that lemma; the worker's actual entries remain the
authority. When a dictionary returns only entries tagged `non-lemma`, the host
follows the bounded lemma references encoded in the dictionary glossary JSON
before retaining the tagged form as a fallback. It does not infer a lemma from
free-form definition text.

Coverage is split by evidence level:

- `tests/core.test.js` covers all six language routes, candidate generation,
  furigana skipping, German split verbs, host-side candidate merging, and
  bounded non-lemma reference fallback.
- `npm run test:hoshi` and `npm run test:hoshi:portable` exercise real worker
  import/readiness/lookup boundaries when dictionaries are supplied.
- Language candidate tests do not claim full dictionary coverage, grammar
  completeness, or native subtitle geometry. Those require real dictionaries
  and platform desktop acceptance runs.
