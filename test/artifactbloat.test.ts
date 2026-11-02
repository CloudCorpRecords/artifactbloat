import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trackArtifactSizes } from "../src/artifactbloat.js";

/**
 * All tests are pure local computation over inline snapshot
 * histories: no filesystem, no network. Each behaviour in
 * the spec is pinned by its own case, including the null
 * paths and the duplicate-pair errors.
 */

const snap = (
  workflow: string,
  date: string,
  artifacts: Array<[string, number]>,
) => ({
  workflow,
  date,
  artifacts: artifacts.map(([name, size_bytes]) => ({ name, size_bytes })),
});

describe("trackArtifactSizes — grouping and ordering", () => {
  it("groups snapshots by workflow and orders each group by date ascending", () => {
    const out = trackArtifactSizes([
      snap("test", "2026-01-03", [["results", 30]]),
      snap("build", "2026-01-02", [["app", 200]]),
      snap("test", "2026-01-01", [["results", 10]]),
      snap("build", "2026-01-01", [["app", 100]]),
      snap("test", "2026-01-02", [["results", 20]]),
    ]);
    assert.equal(out.workflow_count, 2);
    // Workflows sorted by name ascending.
    assert.deepEqual(
      out.workflows.map((w) => w.workflow),
      ["build", "test"],
    );
    const test = out.workflows[1];
    assert.equal(test.snapshot_count, 3);
    assert.equal(test.first_date, "2026-01-01");
    assert.equal(test.last_date, "2026-01-03");
    assert.equal(test.first_total_bytes, 10);
    assert.equal(test.last_total_bytes, 30);
    const build = out.workflows[0];
    assert.equal(build.snapshot_count, 2);
    assert.equal(build.first_date, "2026-01-01");
    assert.equal(build.last_date, "2026-01-02");
  });

  it("allows the same date in different workflows", () => {
    const out = trackArtifactSizes([
      snap("a", "2026-01-01", [["x", 5]]),
      snap("b", "2026-01-01", [["y", 7]]),
    ]);
    assert.equal(out.workflow_count, 2);
  });

  it("handles a single snapshot: first equals last and delta is zero", () => {
    const out = trackArtifactSizes([snap("only", "2026-03-01", [["a", 42]])]);
    const w = out.workflows[0];
    assert.equal(w.snapshot_count, 1);
    assert.equal(w.first_date, "2026-03-01");
    assert.equal(w.last_date, "2026-03-01");
    assert.equal(w.first_total_bytes, 42);
    assert.equal(w.last_total_bytes, 42);
    assert.equal(w.delta_bytes, 0);
    assert.equal(w.delta_percent, 0);
    assert.equal(w.max_total_bytes, 42);
    assert.equal(w.flagged, false);
  });
});

describe("trackArtifactSizes — totals, deltas, and max", () => {
  it("sums artifact sizes per snapshot and computes delta bytes and percent", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["app", 60], ["docs", 40]]),
      snap("build", "2026-01-02", [["app", 90], ["docs", 60]]),
      snap("build", "2026-01-03", [["app", 120], ["docs", 80]]),
    ]);
    const w = out.workflows[0];
    assert.equal(w.first_total_bytes, 100);
    assert.equal(w.last_total_bytes, 200);
    assert.equal(w.delta_bytes, 100);
    assert.equal(w.delta_percent, 100);
    assert.equal(w.max_total_bytes, 200);
  });

  it("rounds delta_percent to 4 decimal places", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["app", 300]]),
      snap("build", "2026-01-02", [["app", 400]]),
    ]);
    assert.equal(out.workflows[0].delta_percent, 33.3333);
  });

  it("reports a negative delta_percent when a workflow shrinks", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["app", 200]]),
      snap("build", "2026-01-02", [["app", 150]]),
    ]);
    const w = out.workflows[0];
    assert.equal(w.delta_bytes, -50);
    assert.equal(w.delta_percent, -25);
    assert.equal(w.flagged, false);
  });

  it("returns delta_percent null when the first total is 0", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["app", 0]]),
      snap("build", "2026-01-02", [["app", 50]]),
    ]);
    const w = out.workflows[0];
    assert.equal(w.first_total_bytes, 0);
    assert.equal(w.last_total_bytes, 50);
    assert.equal(w.delta_bytes, 50);
    assert.equal(w.delta_percent, null);
    // A null delta_percent is never flagged, even at threshold 0.
    assert.equal(w.flagged, false);
    const atZero = trackArtifactSizes(
      [
        snap("build", "2026-01-01", [["app", 0]]),
        snap("build", "2026-01-02", [["app", 50]]),
      ],
      0,
    );
    assert.equal(atZero.workflows[0].flagged, false);
    assert.equal(atZero.verdict, "steady");
  });

  it("takes max_total_bytes from the largest snapshot, not the last", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["app", 100]]),
      snap("build", "2026-01-02", [["app", 500]]),
      snap("build", "2026-01-03", [["app", 200]]),
    ]);
    const w = out.workflows[0];
    assert.equal(w.max_total_bytes, 500);
    assert.equal(w.first_total_bytes, 100);
    assert.equal(w.last_total_bytes, 200);
    assert.equal(w.delta_percent, 100);
  });

  it("sums first and last totals across workflows", () => {
    const out = trackArtifactSizes([
      snap("a", "2026-01-01", [["x", 100]]),
      snap("a", "2026-01-02", [["x", 130]]),
      snap("b", "2026-01-01", [["y", 50]]),
      snap("b", "2026-01-02", [["y", 40]]),
    ]);
    assert.equal(out.workflow_count, 2);
    assert.equal(out.total_first_bytes, 150);
    assert.equal(out.total_last_bytes, 170);
  });
});

describe("trackArtifactSizes — flagging and verdict", () => {
  const growing = (first: number, last: number) => [
    snap("build", "2026-01-01", [["app", first]]),
    snap("build", "2026-01-02", [["app", last]]),
  ];

  it("flags growth of exactly the default 20 percent threshold (>= boundary)", () => {
    const out = trackArtifactSizes(growing(100, 120));
    assert.equal(out.workflows[0].delta_percent, 20);
    assert.equal(out.workflows[0].flagged, true);
    assert.deepEqual(out.flagged_workflows, ["build"]);
    assert.equal(out.verdict, "growth_flagged");
  });

  it("does not flag growth just below the default threshold", () => {
    const out = trackArtifactSizes(growing(10000, 11999));
    assert.equal(out.workflows[0].delta_percent, 19.99);
    assert.equal(out.workflows[0].flagged, false);
    assert.deepEqual(out.flagged_workflows, []);
    assert.equal(out.verdict, "steady");
  });

  it("honours a custom threshold, boundary included", () => {
    const at = trackArtifactSizes(growing(100, 150), 50);
    assert.equal(at.workflows[0].flagged, true);
    const below = trackArtifactSizes(growing(100, 149), 50);
    assert.equal(below.workflows[0].flagged, false);
    assert.equal(below.verdict, "steady");
  });

  it("flags zero growth when the threshold is 0", () => {
    const out = trackArtifactSizes(growing(100, 100), 0);
    assert.equal(out.workflows[0].delta_percent, 0);
    assert.equal(out.workflows[0].flagged, true);
    assert.equal(out.verdict, "growth_flagged");
  });

  it("lists only the flagged workflows, sorted ascending", () => {
    const out = trackArtifactSizes([
      snap("zeta", "2026-01-01", [["a", 100]]),
      snap("zeta", "2026-01-02", [["a", 200]]),
      snap("mid", "2026-01-01", [["a", 100]]),
      snap("mid", "2026-01-02", [["a", 105]]),
      snap("alpha", "2026-01-01", [["a", 100]]),
      snap("alpha", "2026-01-02", [["a", 130]]),
    ]);
    assert.deepEqual(out.flagged_workflows, ["alpha", "zeta"]);
    assert.equal(out.verdict, "growth_flagged");
  });

  it("returns verdict steady when nothing is flagged", () => {
    const out = trackArtifactSizes([
      snap("a", "2026-01-01", [["x", 100]]),
      snap("a", "2026-01-02", [["x", 110]]),
    ]);
    assert.deepEqual(out.flagged_workflows, []);
    assert.equal(out.verdict, "steady");
  });
});

describe("trackArtifactSizes — per-artifact tracking", () => {
  it("reports first and last sizes per artifact, sorted by name", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["zlib", 10], ["app", 100]]),
      snap("build", "2026-01-02", [["zlib", 15], ["app", 80]]),
    ]);
    assert.deepEqual(out.workflows[0].artifacts, [
      { name: "app", first_size_bytes: 100, last_size_bytes: 80, delta_bytes: -20 },
      { name: "zlib", first_size_bytes: 10, last_size_bytes: 15, delta_bytes: 5 },
    ]);
  });

  it("uses null for an artifact absent from the first or last snapshot", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["gone", 10], ["kept", 100]]),
      snap("build", "2026-01-02", [["kept", 110], ["mid-only", 5]]),
      snap("build", "2026-01-03", [["kept", 120], ["new", 30]]),
    ]);
    assert.deepEqual(out.workflows[0].artifacts, [
      { name: "gone", first_size_bytes: 10, last_size_bytes: null, delta_bytes: null },
      { name: "kept", first_size_bytes: 100, last_size_bytes: 120, delta_bytes: 20 },
      { name: "mid-only", first_size_bytes: null, last_size_bytes: null, delta_bytes: null },
      { name: "new", first_size_bytes: null, last_size_bytes: 30, delta_bytes: null },
    ]);
  });

  it("compares against the date-ordered first and last snapshots, not input order", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-03", [["app", 300]]),
      snap("build", "2026-01-01", [["app", 100]]),
    ]);
    assert.deepEqual(out.workflows[0].artifacts, [
      { name: "app", first_size_bytes: 100, last_size_bytes: 300, delta_bytes: 200 },
    ]);
  });
});

describe("trackArtifactSizes — duplicates", () => {
  it("rejects a duplicate (workflow, date) pair, naming the path", () => {
    assert.throws(
      () =>
        trackArtifactSizes([
          snap("build", "2026-01-01", [["app", 100]]),
          snap("build", "2026-01-01", [["app", 110]]),
        ]),
      /snapshots\[1\]\.date duplicates \(workflow, date\) pair for workflow "build" on "2026-01-01"/,
    );
  });

  it("rejects a duplicate artifact name within one snapshot, naming the path", () => {
    assert.throws(
      () =>
        trackArtifactSizes([
          {
            workflow: "build",
            date: "2026-01-01",
            artifacts: [
              { name: "app", size_bytes: 10 },
              { name: "app", size_bytes: 20 },
            ],
          },
        ]),
      /snapshots\[0\]\.artifacts\[1\]\.name duplicates artifact name "app"/,
    );
  });

  it("allows the same artifact name across different snapshots", () => {
    const out = trackArtifactSizes([
      snap("build", "2026-01-01", [["app", 10]]),
      snap("build", "2026-01-02", [["app", 20]]),
    ]);
    assert.equal(out.workflow_count, 1);
  });
});

describe("trackArtifactSizes — validation", () => {
  it("rejects missing, empty, or non-array snapshots", () => {
    assert.throws(() => trackArtifactSizes(undefined), /snapshots is required/);
    assert.throws(() => trackArtifactSizes([]), /snapshots must be a non-empty array/);
    assert.throws(() => trackArtifactSizes("nope"), /snapshots must be a non-empty array/);
  });

  it("rejects a snapshot that is not an object", () => {
    assert.throws(() => trackArtifactSizes([42]), /snapshots\[0\] must be an object/);
  });

  it("rejects a snapshot missing workflow, date, or artifacts, naming the path", () => {
    assert.throws(
      () => trackArtifactSizes([{ date: "2026-01-01", artifacts: [{ name: "a", size_bytes: 1 }] }]),
      /snapshots\[0\]\.workflow is required/,
    );
    assert.throws(
      () => trackArtifactSizes([{ workflow: "build", artifacts: [{ name: "a", size_bytes: 1 }] }]),
      /snapshots\[0\]\.date is required/,
    );
    assert.throws(
      () => trackArtifactSizes([{ workflow: "build", date: "2026-01-01" }]),
      /snapshots\[0\]\.artifacts is required/,
    );
    assert.throws(
      () =>
        trackArtifactSizes([
          snap("a", "2026-01-01", [["x", 1]]),
          { workflow: "b", date: "2026-01-01" },
        ]),
      /snapshots\[1\]\.artifacts is required/,
    );
  });

  it("rejects an empty workflow or date string", () => {
    assert.throws(
      () => trackArtifactSizes([snap("", "2026-01-01", [["a", 1]])]),
      /snapshots\[0\]\.workflow must be a non-empty string/,
    );
    assert.throws(
      () => trackArtifactSizes([snap("build", "", [["a", 1]])]),
      /snapshots\[0\]\.date must be a non-empty string/,
    );
  });

  it("rejects an empty artifacts array", () => {
    assert.throws(
      () => trackArtifactSizes([{ workflow: "build", date: "2026-01-01", artifacts: [] }]),
      /snapshots\[0\]\.artifacts must be a non-empty array/,
    );
  });

  it("rejects an artifact that is not an object", () => {
    assert.throws(
      () =>
        trackArtifactSizes([
          { workflow: "build", date: "2026-01-01", artifacts: ["app"] },
        ]),
      /snapshots\[0\]\.artifacts\[0\] must be an object/,
    );
  });

  it("rejects an artifact missing name or size_bytes, naming the path", () => {
    assert.throws(
      () =>
        trackArtifactSizes([
          { workflow: "build", date: "2026-01-01", artifacts: [{ size_bytes: 1 }] },
        ]),
      /snapshots\[0\]\.artifacts\[0\]\.name is required/,
    );
    assert.throws(
      () =>
        trackArtifactSizes([
          snap("a", "2026-01-01", [["x", 1]]),
          { workflow: "b", date: "2026-01-01", artifacts: [{ name: "y" }] },
        ]),
      /snapshots\[1\]\.artifacts\[0\]\.size_bytes is required/,
    );
  });

  it("rejects an empty artifact name and a wrongly typed size_bytes", () => {
    assert.throws(
      () => trackArtifactSizes([snap("build", "2026-01-01", [["", 1]])]),
      /snapshots\[0\]\.artifacts\[0\]\.name must be a non-empty string/,
    );
    assert.throws(
      () =>
        trackArtifactSizes([
          {
            workflow: "build",
            date: "2026-01-01",
            artifacts: [{ name: "a", size_bytes: "10" }],
          },
        ]),
      /snapshots\[0\]\.artifacts\[0\]\.size_bytes must be a number/,
    );
  });

  it("rejects a negative size_bytes, naming the exact path", () => {
    assert.throws(
      () =>
        trackArtifactSizes([
          snap("a", "2026-01-01", [["x", 1]]),
          snap("b", "2026-01-01", [["y", 1]]),
          snap("c", "2026-01-01", [["z", -5]]),
        ]),
      /snapshots\[2\]\.artifacts\[0\]\.size_bytes must be >= 0/,
    );
  });

  it("rejects a negative or wrongly typed growth threshold", () => {
    assert.throws(
      () => trackArtifactSizes([snap("a", "2026-01-01", [["x", 1]])], -1),
      /growth_threshold_percent must be >= 0/,
    );
    assert.throws(
      () => trackArtifactSizes([snap("a", "2026-01-01", [["x", 1]])], "20"),
      /growth_threshold_percent must be a number/,
    );
  });
});
