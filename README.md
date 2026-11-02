# artifactbloat

Your CI artifacts quietly grow a few percent every week —
until a workflow that used to upload a slim bundle is
shipping something enormous and nobody can say when it
happened. artifactbloat takes dated snapshots of artifact
sizes, groups them per workflow, and shows the growth in
plain numbers:

- **Per-workflow totals** — snapshots ordered by date, with
  the first, last, and largest snapshot totals for every
  workflow
- **Growth deltas** — the change from first to last
  snapshot in bytes and as a percentage (rounded to four
  decimal places; `null` when the first total is zero, so a
  workflow that started empty is never divided by zero)
- **Bloat flags** — a workflow is flagged when its growth
  meets a threshold you choose (20 percent by default),
  boundary included; the flagged names are listed on their
  own and drive the verdict: `growth_flagged` when anything
  is flagged, `steady` otherwise
- **Per-artifact detail** — for every artifact name a
  workflow ever produced: its size in the first snapshot
  and in the last, with `null` on either side when the
  artifact did not exist there (a new artifact, a removed
  one, or one seen only in between), and the byte delta
  when both sides exist
- **Overall totals** — the summed first and last totals
  across all workflows

The computation is pure and local: no network, no
configuration, no files read beyond the snapshots you pass
in. Invalid input — a missing snapshot list, a snapshot
without a workflow, a negative size, the same workflow
captured twice on one date, or the same artifact twice in
one snapshot — is rejected with an error naming the
offending path, and no partial report is produced.

## CLI

```bash
npx @reneturcios/artifactbloat track --input args.json
npx @reneturcios/artifactbloat --version
```

`args.json` contains the full arguments object:

```json
{
  "snapshots": [
    {
      "workflow": "build",
      "date": "2026-01-01",
      "artifacts": [
        { "name": "app-bundle", "size_bytes": 1048576 },
        { "name": "source-maps", "size_bytes": 262144 }
      ]
    },
    {
      "workflow": "build",
      "date": "2026-02-01",
      "artifacts": [
        { "name": "app-bundle", "size_bytes": 1572864 },
        { "name": "source-maps", "size_bytes": 262144 }
      ]
    }
  ],
  "growth_threshold_percent": 20
}
```

`growth_threshold_percent` is optional and defaults to
20. The report is printed as JSON.

Exit codes: `0` on success, `1` on a runtime error
(including an unreadable or invalid input file, or invalid
input), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/artifactbloat mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "artifactbloat": {
      "command": "npx",
      "args": ["-y", "@reneturcios/artifactbloat", "mcp"]
    }
  }
}
```

### Tools

- `track_artifact_sizes` — Track Actions artifact sizes
  over time, per workflow.
  - `snapshots` (array, required, at least one) —
    snapshots as `{workflow, date, artifacts}` objects,
    where each artifact is `{name, size_bytes}` and
    `date` is the capture day, `YYYY-MM-DD`
  - `growth_threshold_percent` (number, optional, >= 0,
    default 20) — flag workflows whose total grew by at
    least this percent from first to last snapshot

  Returns `{workflow_count, total_first_bytes,
  total_last_bytes, workflows, flagged_workflows,
  verdict}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/artifactbloat
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/artifactbloat track --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
