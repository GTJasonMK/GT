import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { GRAPH_WORKSPACE_MCP_CONTRACT } from "../../src/agent/contract.ts";
import { resolveManifestPath } from "./manifestPath.ts";
import type {
  AgentToolSchema,
  GraphWorkspaceBridgeManifest,
  GraphWorkspaceMcpContract,
} from "../../src/agent/types.ts";

type JsonSchemaLike = {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
};

const BRIDGE_TIMEOUT_MS = 5000;
const DEFAULT_CONTRACT = GRAPH_WORKSPACE_MCP_CONTRACT;

async function readBridgeManifest(): Promise<GraphWorkspaceBridgeManifest> {
  const manifestPath = resolveManifestPath();
  const contents = await readFile(manifestPath, "utf8");
  return JSON.parse(contents) as GraphWorkspaceBridgeManifest;
}

async function callBridge(
  endpoint: "query" | "action" | "approval",
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let manifest: GraphWorkspaceBridgeManifest;
  try {
    manifest = await readBridgeManifest();
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "APP_UNAVAILABLE",
        message: `未找到 bridge manifest：${resolveManifestPath()}`,
        retryable: true,
        details: {
          reason: error instanceof Error ? error.message : "manifest_unavailable",
        },
      },
    };
  }

  const url = `${manifest.baseUrl}/v1/${endpoint}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, input }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: "APP_UNAVAILABLE",
          message: `bridge 请求失败：HTTP ${response.status}`,
          retryable: true,
          details: {
            url,
            status: response.status,
          },
        },
      };
    }

    const payload = await response.json();
    if (payload && typeof payload === "object") {
      return payload as Record<string, unknown>;
    }

    return {
      ok: false,
      error: {
        code: "APP_UNAVAILABLE",
        message: "bridge 返回了非对象响应。",
        retryable: true,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "APP_UNAVAILABLE",
        message: error instanceof Error ? error.message : "bridge 请求失败。",
        retryable: true,
        details: {
          url,
        },
      },
    };
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatToolResult(response: Record<string, unknown>): CallToolResult {
  const isError = response.ok === false;
  const text = JSON.stringify(response, null, 2);
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent: response,
    isError,
  };
}

function jsonSchemaToZod(schema: JsonSchemaLike | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.any();
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map((value) => z.literal(value));
    if (literals.length === 1) {
      return literals[0]!;
    }
    return z.union(literals as [z.ZodLiteral<unknown>, z.ZodLiteral<unknown>, ...z.ZodLiteral<unknown>[]]);
  }

  switch (schema.type) {
    case "object": {
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, propertySchema] of Object.entries(properties)) {
        const property = jsonSchemaToZod(propertySchema);
        shape[key] = required.has(key) ? property : property.optional();
      }

      const objectSchema = z.object(shape);
      return schema.additionalProperties === false ? objectSchema : objectSchema.passthrough();
    }
    case "array":
      return z.array(jsonSchemaToZod(schema.items));
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    default:
      return z.any();
  }
}

async function loadRuntimeContract(): Promise<GraphWorkspaceMcpContract> {
  try {
    const manifest = await readBridgeManifest();
    const response = await fetch(manifest.contractUrl, {
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return DEFAULT_CONTRACT;
    }
    const payload = await response.json();
    if (payload && typeof payload === "object" && Array.isArray((payload as { tools?: unknown[] }).tools)) {
      return payload as GraphWorkspaceMcpContract;
    }
  } catch (_error) {
    // 应用未启动时回退到本地 contract，tool 调用阶段再返回 APP_UNAVAILABLE。
  }
  return DEFAULT_CONTRACT;
}

function endpointForTool(tool: AgentToolSchema): "query" | "action" | "approval" {
  if (tool.kind === "query") return "query";
  if (tool.kind === "approval") return "approval";
  return "action";
}

async function main() {
  if (process.argv.includes("--help")) {
    console.error("GraphAndTable MCP server");
    console.error(`manifest: ${resolveManifestPath()}`);
    process.exit(0);
  }

  const contract = await loadRuntimeContract();
  const server = new McpServer({
    name: "graph-and-table-mcp",
    version: contract.version,
  });

  for (const tool of contract.tools) {
    const inputSchema = jsonSchemaToZod(tool.inputSchema as JsonSchemaLike | undefined);
    const outputSchema = z.object({}).passthrough();

    server.registerTool(
      tool.name,
      {
        title: tool.goal,
        description: tool.description,
        inputSchema,
        outputSchema,
      },
      async (args): Promise<CallToolResult> => {
        const payload = await callBridge(
          endpointForTool(tool),
          tool.name,
          asObject(args),
        );
        return formatToolResult(payload);
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`graph-and-table-mcp: ready (${contract.tools.length} tools)`);
}

main().catch((error) => {
  console.error("graph-and-table-mcp: fatal");
  console.error(error);
  process.exit(1);
});
