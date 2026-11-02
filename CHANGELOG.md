# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `track_artifact_sizes` MCP tool and
  `track` CLI command tracking Actions artifact sizes over
  time, per workflow.
- Snapshots grouped by workflow and ordered by date;
  per-workflow first, last, and maximum totals with growth
  deltas in bytes and percent (percent rounded to 4
  decimal places, null when the first total is 0);
  threshold flagging (default 20 percent) with a
  `growth_flagged` / `steady` verdict; per-artifact first
  and last sizes with nulls for absent artifacts; strict
  path-naming validation including duplicate
  (workflow, date) pairs and duplicate artifact names.
