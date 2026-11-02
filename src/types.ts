/**
 * artifactbloat types.
 *
 * artifactbloat tracks GitHub Actions artifact sizes over
 * time, per workflow. The caller supplies dated snapshots —
 * each one naming a workflow, a capture day, and the sizes
 * of the artifacts that workflow produced — and
 * artifactbloat reports, as pure local computation:
 *
 *   - snapshots grouped by workflow and ordered by date
 *   - per-workflow first, last, and maximum snapshot totals
 *   - the growth between the first and last snapshot, in
 *     bytes and as a percentage (null when the first total
 *     is zero)
 *   - a flag on each workflow whose growth meets a
 *     caller-supplied threshold (20 percent by default)
 *   - per-artifact first and last sizes inside each
 *     workflow, with nulls where an artifact is absent from
 *     the first or last snapshot
 *   - overall first and last totals, the flagged workflow
 *     names, and a verdict
 *
 * Nothing is fetched or read from disk: the numbers come
 * only from the snapshots supplied.
 */

/** One artifact inside one snapshot, as supplied by the caller. */
export interface ArtifactEntry {
  /** Artifact name; unique within its snapshot. */
  name: string;
  /** Artifact size in bytes; must be >= 0. */
  size_bytes: number;
}

/** One dated snapshot of one workflow's artifacts, as supplied. */
export interface ArtifactSnapshot {
  /** Workflow the snapshot belongs to. */
  workflow: string;
  /** Capture day, "YYYY-MM-DD"; ordering is lexicographic. */
  date: string;
  /** Artifacts captured in this snapshot; at least one. */
  artifacts: ArtifactEntry[];
}

/** First/last sizes for one artifact name within one workflow. */
export interface ArtifactTrack {
  name: string;
  /** Size in the workflow's first snapshot; null when absent there. */
  first_size_bytes: number | null;
  /** Size in the workflow's last snapshot; null when absent there. */
  last_size_bytes: number | null;
  /** last_size_bytes - first_size_bytes; null when either side is null. */
  delta_bytes: number | null;
}

/** Growth summary for one workflow across its snapshots. */
export interface WorkflowTrack {
  workflow: string;
  snapshot_count: number;
  /** Date of the workflow's earliest snapshot. */
  first_date: string;
  /** Date of the workflow's latest snapshot. */
  last_date: string;
  /** Sum of artifact sizes in the earliest snapshot. */
  first_total_bytes: number;
  /** Sum of artifact sizes in the latest snapshot. */
  last_total_bytes: number;
  /** last_total_bytes - first_total_bytes. */
  delta_bytes: number;
  /** 100 * delta_bytes / first_total_bytes, rounded to 4 dp; null when first_total_bytes is 0. */
  delta_percent: number | null;
  /** Largest single snapshot total for this workflow. */
  max_total_bytes: number;
  /** True when delta_percent is not null and >= the growth threshold. */
  flagged: boolean;
  /** One entry per artifact name seen in this workflow, sorted by name. */
  artifacts: ArtifactTrack[];
}

/** The artifact size tracking report. */
export interface ArtifactBloatResult {
  workflow_count: number;
  /** Sum of first_total_bytes over all workflows. */
  total_first_bytes: number;
  /** Sum of last_total_bytes over all workflows. */
  total_last_bytes: number;
  /** Per-workflow summaries, sorted by workflow name ascending. */
  workflows: WorkflowTrack[];
  /** Names of the flagged workflows, sorted ascending. */
  flagged_workflows: string[];
  /** "growth_flagged" when any workflow is flagged, else "steady". */
  verdict: "growth_flagged" | "steady";
}
