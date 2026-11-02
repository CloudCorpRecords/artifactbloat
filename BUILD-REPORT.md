# artifactbloat — Build Report

MCP Rebuild 1000, Batch 13. Original program build from the
packages-100 plan (cluster B #25), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch13/artifactbloat.md`
(read first). There is no external original; the tool
surface is the program's defined spec. Local build only —
nothing pushed or published.

Identity: repo `artifactbloat`, npm
`@reneturcios/artifactbloat`, MCP name
`io.github.CloudCorpRecords/artifactbloat`, version
`0.1.0`, bin `artifactbloat` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Actions
  artifact size tracker over time, per workflow: growth
  deltas and bloat flags.", 85 chars ≤100; npm entry
  carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/artifactbloat:0.1.0` carries
  **no** `version` field), `Dockerfile` (node:20-alpine
  two-stage, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/artifactbloat"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright
  (c) 2026 Rene Turcios), `README.md` (fresh text),
  `CHANGELOG.md` (single 0.1.0 entry, 2026-10-27),
  `package-lock.json` (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`track --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/artifactbloat.ts` (core,
  `VERSION = "0.1.0"`)
- `test/artifactbloat.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/artifactbloat`)

## Tools implemented (1)

- `track_artifact_sizes` — arguments: `snapshots` (array,
  required, minItems 1) of `{workflow (string, required,
  non-empty), date (string, required, non-empty), artifacts
  (array, required, minItems 1) of {name (string, required,
  non-empty, unique within the snapshot), size_bytes
  (number, required, minimum 0)}}`, plus
  `growth_threshold_percent` (number, optional, minimum 0,
  default 20).

  Returns `{workflow_count, total_first_bytes,
  total_last_bytes, workflows, flagged_workflows,
  verdict}`: snapshots grouped by workflow and ordered by
  date ascending, each snapshot's total being the sum of
  its artifact sizes; per workflow `snapshot_count`,
  `first_date`, `last_date`, `first_total_bytes`,
  `last_total_bytes`, `delta_bytes` (last minus first),
  `delta_percent` (100 * delta / first total, rounded to
  4 decimal places, null when the first total is 0),
  `max_total_bytes` (the largest snapshot total), and
  `flagged` (delta_percent not null and >= the threshold);
  per-artifact entries sorted by name with
  `first_size_bytes` / `last_size_bytes` taken from the
  workflow's first / last snapshot (null when absent
  there) and `delta_bytes` null when either side is null;
  workflows sorted by name; `flagged_workflows` the
  flagged names sorted ascending; `verdict`
  "growth_flagged" when any workflow is flagged, else
  "steady".

  The fixture literal
  (`harness/fixtures/artifactbloat-tools-original.json`)
  and the `src/mcp.ts` literal are identical, with no
  `$schema` and no `additionalProperties`.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the
  fixture, per the standing fleet rule (no McpServer/zod
  schema conversion). Every `tools/call` is validated by
  the core itself, so the MCP and CLI paths share one
  validation implementation.
- Validation is path-naming and total: missing/empty
  `snapshots`, a snapshot missing `workflow`/`date`/
  `artifacts`, an empty workflow/date string, an empty
  `artifacts` array, an artifact missing
  `name`/`size_bytes`, a negative `size_bytes`, a
  duplicate artifact name within one snapshot, a
  duplicate (workflow, date) pair, or a negative
  `growth_threshold_percent` throws an Error naming the
  offending path (e.g.
  `snapshots[2].artifacts[0].size_bytes must be >= 0`) and
  produces no partial result (MCP: `isError`; CLI:
  exit 1).
- Local choices where the spec is silent (see also
  "Gaps"): `flagged` compares the rounded `delta_percent`
  that appears in the output against the threshold;
  totals and byte deltas are exact sums/differences and
  are not rounded (sizes are byte counts; only
  `delta_percent` has a specified rounding).

## Verification (foreground, this session)

- `npx tsc` exit 0 (`dist/cli.js` built)
- `npm test` (`tsx --test test/*.test.ts`): **31 tests,
  31 pass, 0 fail** — grouping with date ordering and
  same-date-across-workflows, single-snapshot zero delta,
  per-workflow totals/delta/delta_percent with 4-dp
  rounding, negative growth, first_total 0 →
  delta_percent null (never flagged, even at threshold
  0), max_total_bytes from a middle peak, cross-workflow
  totals, flagged boundary at the default 20 percent
  (>=) and just below it, custom-threshold boundary,
  threshold-0 zero-growth flagging, flagged_workflows
  ordering, verdict both ways, per-artifact first/last
  sizes with absent-side nulls (removed, new, and
  middle-only artifacts) and date-ordered (not
  input-ordered) first/last selection, duplicate
  (workflow, date) and duplicate artifact name errors,
  and the validation/error paths (missing/empty/non-array
  snapshots, non-object snapshot/artifact, missing
  workflow/date/artifacts naming the path, empty
  workflow/date, empty artifacts array, missing artifact
  name/size_bytes naming the path, empty artifact name,
  wrongly typed size_bytes, negative size_bytes at the
  spec's example path, negative/wrongly typed threshold)
- `dist/cli.js --version` → `0.1.0`; unknown command exits
  2 with usage; `track` with no `--input` exits 2;
  `track --input <missing file>` exits 1 naming the file;
  `track --input <invalid file>` exits 1 with
  `snapshots[0].artifacts[0].size_bytes must be >= 0`;
  `track --input <valid file>` exits 0 and prints the
  report JSON (hand-verified: 2 workflows, totals
  first 110 / last 210, build delta 100 bytes at
  100 percent and flagged, docs artifact null on the
  first side, verdict `growth_flagged`)
- Parity: `harness/parity.py` vs
  `harness/fixtures/artifactbloat-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1**

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy
without `node_modules`/`dist`/`package-lock.json`, offline
`npm install --package-lock-only --ignore-scripts
--offline`), verified: parses, name
`@reneturcios/artifactbloat`, **128 package entries**.
Local `node_modules` was installed via `npm install
--ignore-scripts --offline` for build/test; gitignored.

## Gaps / honest notes

- **flagged comparison:** the threshold is compared
  against the rounded `delta_percent` that appears in the
  output, keeping the flag consistent with the reported
  number; the spec defines `delta_percent` as the rounded
  value and the flag in terms of `delta_percent`, so this
  follows the spec's own wording.
- **date format:** the spec describes `date` as the
  capture day "YYYY-MM-DD" with lexicographic ordering;
  validation requires a non-empty string only and does not
  enforce the calendar format, matching the spec's
  validation list (which names empty date, not malformed
  date, as an error).
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.
