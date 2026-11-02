/**
 * artifactbloat core: Actions artifact size tracking over
 * time, per workflow.
 *
 *   trackArtifactSizes(snapshots, growthThresholdPercent) -> report
 *
 * Behaviour:
 * - Snapshots are grouped by workflow. Within a workflow
 *   they are ordered by date ascending (lexicographic on
 *   the "YYYY-MM-DD" string); two snapshots for the same
 *   workflow and date are a validation error. Each
 *   snapshot's total is the sum of its artifact sizes.
 * - Per workflow, delta_bytes is the last total minus the
 *   first total, delta_percent is that delta as a
 *   percentage of the first total rounded to 4 decimal
 *   places (null when the first total is 0), and
 *   max_total_bytes is the largest snapshot total.
 * - A workflow is flagged when its delta_percent is not
 *   null and meets the growth threshold (default 20).
 * - Per artifact name seen in a workflow, the report
 *   carries the size in the workflow's first snapshot and
 *   in its last snapshot — null on a side where the
 *   artifact is absent — and the delta between them, null
 *   when either side is null.
 * - Workflows and flagged workflow names are sorted by
 *   name ascending; the verdict is "growth_flagged" when
 *   any workflow is flagged, else "steady".
 *
 * Validation is strict and path-naming: any malformed
 * input throws an Error naming the offending path (for
 * example "snapshots[2].artifacts[0].size_bytes must be
 * >= 0") and no partial result is produced.
 */
import type {
  ArtifactBloatResult,
  ArtifactEntry,
  ArtifactSnapshot,
  ArtifactTrack,
  WorkflowTrack,
} from "./types.js";

export const VERSION = "0.1.0";

const DEFAULT_GROWTH_THRESHOLD_PERCENT = 20;

function round4(value: number): number {
  const rounded = Math.round(value * 10000) / 10000;
  return rounded === 0 ? 0 : rounded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateArtifact(raw: unknown, path: string): ArtifactEntry {
  if (!isRecord(raw)) throw new Error(`${path} must be an object`);
  if (raw.name === undefined) throw new Error(`${path}.name is required`);
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    throw new Error(`${path}.name must be a non-empty string`);
  }
  if (raw.size_bytes === undefined) {
    throw new Error(`${path}.size_bytes is required`);
  }
  if (typeof raw.size_bytes !== "number" || !Number.isFinite(raw.size_bytes)) {
    throw new Error(`${path}.size_bytes must be a number`);
  }
  if (raw.size_bytes < 0) {
    throw new Error(`${path}.size_bytes must be >= 0`);
  }
  return { name: raw.name, size_bytes: raw.size_bytes };
}

function validateSnapshot(raw: unknown, index: number): ArtifactSnapshot {
  const path = `snapshots[${index}]`;
  if (!isRecord(raw)) throw new Error(`${path} must be an object`);
  if (raw.workflow === undefined) throw new Error(`${path}.workflow is required`);
  if (typeof raw.workflow !== "string" || raw.workflow.length === 0) {
    throw new Error(`${path}.workflow must be a non-empty string`);
  }
  if (raw.date === undefined) throw new Error(`${path}.date is required`);
  if (typeof raw.date !== "string" || raw.date.length === 0) {
    throw new Error(`${path}.date must be a non-empty string`);
  }
  if (raw.artifacts === undefined) throw new Error(`${path}.artifacts is required`);
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) {
    throw new Error(`${path}.artifacts must be a non-empty array`);
  }
  const artifacts = raw.artifacts.map((a, j) =>
    validateArtifact(a, `${path}.artifacts[${j}]`),
  );
  const seenNames = new Set<string>();
  artifacts.forEach((artifact, j) => {
    if (seenNames.has(artifact.name)) {
      throw new Error(
        `${path}.artifacts[${j}].name duplicates artifact name "${artifact.name}"`,
      );
    }
    seenNames.add(artifact.name);
  });
  return { workflow: raw.workflow, date: raw.date, artifacts };
}

function validateArgs(
  snapshots: unknown,
  growthThresholdPercent: unknown,
): { snapshots: ArtifactSnapshot[]; threshold: number } {
  if (snapshots === undefined) throw new Error("snapshots is required");
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error("snapshots must be a non-empty array");
  }
  const validated = snapshots.map((s, i) => validateSnapshot(s, i));

  // A (workflow, date) pair may appear only once: two captures
  // of the same workflow on the same day cannot be ordered.
  const seenPairs = new Set<string>();
  validated.forEach((snapshot, i) => {
    const key = JSON.stringify([snapshot.workflow, snapshot.date]);
    if (seenPairs.has(key)) {
      throw new Error(
        `snapshots[${i}].date duplicates (workflow, date) pair for workflow "${snapshot.workflow}" on "${snapshot.date}"`,
      );
    }
    seenPairs.add(key);
  });

  let threshold = DEFAULT_GROWTH_THRESHOLD_PERCENT;
  if (growthThresholdPercent !== undefined) {
    if (
      typeof growthThresholdPercent !== "number" ||
      !Number.isFinite(growthThresholdPercent)
    ) {
      throw new Error("growth_threshold_percent must be a number");
    }
    if (growthThresholdPercent < 0) {
      throw new Error("growth_threshold_percent must be >= 0");
    }
    threshold = growthThresholdPercent;
  }
  return { snapshots: validated, threshold };
}

function snapshotTotal(snapshot: ArtifactSnapshot): number {
  return snapshot.artifacts.reduce((sum, a) => sum + a.size_bytes, 0);
}

function sizeIn(snapshot: ArtifactSnapshot, name: string): number | null {
  const found = snapshot.artifacts.find((a) => a.name === name);
  return found === undefined ? null : found.size_bytes;
}

/** Track artifact sizes over time, per workflow. */
export function trackArtifactSizes(
  snapshots: unknown,
  growthThresholdPercent?: unknown,
): ArtifactBloatResult {
  const { snapshots: valid, threshold } = validateArgs(
    snapshots,
    growthThresholdPercent,
  );

  // Group by workflow, preserving nothing about input order
  // beyond what the date ordering below establishes.
  const byWorkflow = new Map<string, ArtifactSnapshot[]>();
  for (const snapshot of valid) {
    const group = byWorkflow.get(snapshot.workflow);
    if (group) {
      group.push(snapshot);
    } else {
      byWorkflow.set(snapshot.workflow, [snapshot]);
    }
  }

  const workflows: WorkflowTrack[] = [...byWorkflow.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([workflow, group]) => {
      const ordered = [...group].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      );
      const totals = ordered.map(snapshotTotal);
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const firstTotal = totals[0];
      const lastTotal = totals[totals.length - 1];
      const deltaBytes = lastTotal - firstTotal;
      const deltaPercent =
        firstTotal === 0 ? null : round4((100 * deltaBytes) / firstTotal);

      const names = new Set<string>();
      for (const snapshot of ordered) {
        for (const artifact of snapshot.artifacts) names.add(artifact.name);
      }
      const artifacts: ArtifactTrack[] = [...names]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((name) => {
          const firstSize = sizeIn(first, name);
          const lastSize = sizeIn(last, name);
          return {
            name,
            first_size_bytes: firstSize,
            last_size_bytes: lastSize,
            delta_bytes:
              firstSize === null || lastSize === null
                ? null
                : lastSize - firstSize,
          };
        });

      return {
        workflow,
        snapshot_count: ordered.length,
        first_date: first.date,
        last_date: last.date,
        first_total_bytes: firstTotal,
        last_total_bytes: lastTotal,
        delta_bytes: deltaBytes,
        delta_percent: deltaPercent,
        max_total_bytes: Math.max(...totals),
        flagged: deltaPercent !== null && deltaPercent >= threshold,
        artifacts,
      };
    });

  const flaggedWorkflows = workflows
    .filter((w) => w.flagged)
    .map((w) => w.workflow)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    workflow_count: workflows.length,
    total_first_bytes: workflows.reduce((sum, w) => sum + w.first_total_bytes, 0),
    total_last_bytes: workflows.reduce((sum, w) => sum + w.last_total_bytes, 0),
    workflows,
    flagged_workflows: flaggedWorkflows,
    verdict: flaggedWorkflows.length > 0 ? "growth_flagged" : "steady",
  };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
