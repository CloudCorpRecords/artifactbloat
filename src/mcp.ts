/**
 * artifactbloat MCP server. Tools: track_artifact_sizes.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The tracking is pure local computation: no upstream API,
 * no authentication, no configuration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { formatPayload, trackArtifactSizes, VERSION } from "./artifactbloat.js";

const TOOLS = [
  {
    name: "track_artifact_sizes",
    description:
      "Track Actions artifact sizes over time per workflow: snapshot totals, first-to-last growth in bytes and percent, the largest snapshot total, per-artifact first and last sizes, and workflows flagged when growth meets a threshold.",
    inputSchema: {
      type: "object" as const,
      properties: {
        snapshots: {
          type: "array",
          description: "Artifact snapshots to track (at least one)",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              workflow: { type: "string", description: "Workflow name" },
              date: {
                type: "string",
                description: "Capture day, YYYY-MM-DD",
              },
              artifacts: {
                type: "array",
                description: "Artifacts in the snapshot (at least one)",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Artifact name" },
                    size_bytes: {
                      type: "number",
                      description: "Artifact size in bytes",
                      minimum: 0,
                    },
                  },
                  required: ["name", "size_bytes"],
                },
              },
            },
            required: ["workflow", "date", "artifacts"],
          },
        },
        growth_threshold_percent: {
          type: "number",
          description:
            "Growth threshold in percent for flagging a workflow (optional, default 20)",
          minimum: 0,
        },
      },
      required: ["snapshots"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "artifactbloat", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "track_artifact_sizes") {
      const raw = (args ?? {}) as Record<string, unknown>;
      out = trackArtifactSizes(raw.snapshots, raw.growth_threshold_percent);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
