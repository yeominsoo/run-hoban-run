#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const imageGenCli = path.join(
  codexHome,
  "skills/.system/imagegen/scripts/image_gen.py",
);
const repoPython = path.join(repoRoot, ".venv/bin/python");
const imageGenPython =
  process.env.PYTHON || (existsSync(repoPython) ? repoPython : "python3");

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(envFile) {
  if (!envFile) {
    return;
  }

  const resolvedEnvFile = path.isAbsolute(envFile)
    ? envFile
    : path.join(repoRoot, envFile);
  if (!existsSync(resolvedEnvFile)) {
    return;
  }

  const text = readFileSync(resolvedEnvFile, "utf-8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex < 1) {
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    const value = unquoteEnvValue(normalized.slice(equalsIndex + 1));
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadImageGenEnv() {
  const envFiles = [
    process.env.RUN_HOBAN_IMAGE_GEN_ENV_FILE,
    process.env.HOBAN_IMAGE_GEN_ENV_FILE,
    ".env",
    "/home/msyeo/workspace/hoban-lakepark-adventure/.env",
  ].filter(Boolean);

  for (const envFile of [...new Set(envFiles)]) {
    try {
      loadEnvFile(envFile);
    } catch (error) {
      console.error(`Skipping unreadable env file ${envFile}: ${error.message}`);
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY =
      process.env.OPENAI_API || process.env.OPENAPI || process.env.APIKEY || "";
  }
}

loadImageGenEnv();

function resolveRepoPath(candidate, fallback) {
  const value = candidate || fallback;
  const resolved = path.resolve(repoRoot, value);
  const repoRootWithSep = `${repoRoot}${path.sep}`;

  if (resolved !== repoRoot && !resolved.startsWith(repoRootWithSep)) {
    throw new Error(`Output path must stay inside the repository: ${value}`);
  }

  return resolved;
}

function resolveExistingRepoPath(candidate, label) {
  if (!candidate) {
    throw new Error(`${label} is required.`);
  }

  const resolved = path.resolve(repoRoot, candidate);
  const repoRootWithSep = `${repoRoot}${path.sep}`;
  if (resolved !== repoRoot && !resolved.startsWith(repoRootWithSep)) {
    throw new Error(`${label} must stay inside the repository: ${candidate}`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${candidate}`);
  }

  return resolved;
}

function relativeRepoPath(absolutePath) {
  return path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/");
}

function runImageGenCli(args) {
  return new Promise((resolve) => {
    const child = spawn(imageGenPython, [imageGenCli, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function textContent(text) {
  return [{ type: "text", text }];
}

function setupText() {
  return [
    "Image generation MCP wrapper is configured.",
    `Repository: ${repoRoot}`,
    `Imagegen CLI: ${imageGenCli} (${existsSync(imageGenCli) ? "found" : "missing"})`,
    `Imagegen Python: ${imageGenPython}`,
    `OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set" : "missing"}`,
    "Set OPENAI_API_KEY, OPENAI_API, or APIKEY in .env for real image generation.",
  ].join("\n");
}

async function generateImage(input) {
  const dryRun = input.dry_run ?? true;
  if (!dryRun && !process.env.OPENAI_API_KEY) {
    return {
      isError: true,
      content: textContent(
        "OPENAI_API_KEY is not set. Re-run with dry_run=true or configure OPENAI_API_KEY before real image generation.",
      ),
    };
  }

  const resolvedOutput = resolveRepoPath(
    input.output_path,
    "output/imagegen/mcp-output.png",
  );
  await mkdir(path.dirname(resolvedOutput), { recursive: true });

  const args = [
    "generate",
    "--prompt",
    input.prompt,
    "--model",
    input.model || "gpt-image-2",
    "--size",
    input.size || "1024x1024",
    "--quality",
    input.quality || "medium",
    "--background",
    input.background || "opaque",
    "--output-format",
    input.output_format || "png",
    "--n",
    String(input.n || 1),
    "--out",
    resolvedOutput,
  ];

  if (input.force) {
    args.push("--force");
  }
  if (dryRun) {
    args.push("--dry-run");
  }

  const result = await runImageGenCli(args);
  const text = [
    `exit_code: ${result.code}`,
    `output_path: ${relativeRepoPath(resolvedOutput)}`,
    result.stdout ? `stdout:\n${result.stdout.trim()}` : null,
    result.stderr ? `stderr:\n${result.stderr.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { isError: result.code !== 0, content: textContent(text) };
}

async function editImage(input) {
  const dryRun = input.dry_run ?? true;
  if (!dryRun && !process.env.OPENAI_API_KEY) {
    return {
      isError: true,
      content: textContent(
        "OPENAI_API_KEY is not set. Re-run with dry_run=true or configure OPENAI_API_KEY before real image editing.",
      ),
    };
  }

  const resolvedOutput = resolveRepoPath(
    input.output_path,
    "output/imagegen/mcp-edit-output.png",
  );
  const resolvedImage = resolveExistingRepoPath(input.image_path, "image_path");
  const resolvedReferences = (input.reference_image_paths || []).map((candidate, index) =>
    resolveExistingRepoPath(candidate, `reference_image_paths[${index}]`),
  );
  const resolvedMask = input.mask_path
    ? resolveExistingRepoPath(input.mask_path, "mask_path")
    : null;
  await mkdir(path.dirname(resolvedOutput), { recursive: true });

  const args = [
    "edit",
    "--prompt",
    input.prompt,
    "--image",
    resolvedImage,
    "--model",
    input.model || "gpt-image-2",
    "--size",
    input.size || "auto",
    "--quality",
    input.quality || "medium",
    "--background",
    input.background || "opaque",
    "--output-format",
    input.output_format || "png",
    "--n",
    String(input.n || 1),
    "--out",
    resolvedOutput,
  ];

  for (const referenceImage of resolvedReferences) {
    args.push("--image", referenceImage);
  }
  if (resolvedMask) {
    args.push("--mask", resolvedMask);
  }
  if (input.input_fidelity) {
    args.push("--input-fidelity", input.input_fidelity);
  }
  if (input.force) {
    args.push("--force");
  }
  if (dryRun) {
    args.push("--dry-run");
  }

  const result = await runImageGenCli(args);
  const text = [
    `exit_code: ${result.code}`,
    `image_path: ${relativeRepoPath(resolvedImage)}`,
    resolvedReferences.length > 0
      ? `reference_image_paths: ${resolvedReferences.map(relativeRepoPath).join(", ")}`
      : null,
    resolvedMask ? `mask_path: ${relativeRepoPath(resolvedMask)}` : null,
    `output_path: ${relativeRepoPath(resolvedOutput)}`,
    result.stdout ? `stdout:\n${result.stdout.trim()}` : null,
    result.stderr ? `stderr:\n${result.stderr.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { isError: result.code !== 0, content: textContent(text) };
}

const generateInputSchema = {
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string", minLength: 1 },
    output_path: { type: "string" },
    model: { type: "string", default: "gpt-image-2" },
    size: { type: "string", default: "1024x1024" },
    quality: { type: "string", enum: ["low", "medium", "high", "auto"], default: "medium" },
    background: { type: "string", enum: ["auto", "opaque", "transparent"], default: "opaque" },
    output_format: { type: "string", enum: ["png", "jpeg", "webp"], default: "png" },
    n: { type: "integer", minimum: 1, maximum: 4, default: 1 },
    force: { type: "boolean", default: false },
    dry_run: { type: "boolean", default: true },
  },
};

const editInputSchema = {
  type: "object",
  required: ["prompt", "image_path"],
  properties: {
    prompt: { type: "string", minLength: 1 },
    image_path: { type: "string", minLength: 1 },
    reference_image_paths: { type: "array", items: { type: "string" } },
    mask_path: { type: "string" },
    output_path: { type: "string" },
    model: { type: "string", default: "gpt-image-2" },
    size: { type: "string", default: "auto" },
    quality: { type: "string", enum: ["low", "medium", "high", "auto"], default: "medium" },
    background: { type: "string", enum: ["auto", "opaque", "transparent"], default: "opaque" },
    output_format: { type: "string", enum: ["png", "jpeg", "webp"], default: "png" },
    input_fidelity: { type: "string" },
    n: { type: "integer", minimum: 1, maximum: 4, default: 1 },
    force: { type: "boolean", default: false },
    dry_run: { type: "boolean", default: true },
  },
};

function listTools() {
  return {
    tools: [
      {
        name: "check_image_gen_setup",
        title: "Check Image Generation Setup",
        description:
          "Check whether the project-local image generation MCP wrapper can reach the Codex imagegen CLI and whether OPENAI_API_KEY is available.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "generate_image",
        title: "Generate Image",
        description:
          "Generate an image through the Codex imagegen CLI. Uses dry_run by default.",
        inputSchema: generateInputSchema,
      },
      {
        name: "edit_image",
        title: "Edit Image",
        description:
          "Edit a repository image through the Codex imagegen CLI. Uses dry_run by default.",
        inputSchema: editInputSchema,
      },
    ],
  };
}

async function callTool(name, args) {
  if (name === "check_image_gen_setup") {
    return { content: textContent(setupText()) };
  }
  if (name === "generate_image") {
    return await generateImage(args || {});
  }
  if (name === "edit_image") {
    return await editImage(args || {});
  }
  throw new Error(`Unknown tool: ${name}`);
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleRequest(request) {
  if (!request || request.jsonrpc !== "2.0") {
    return;
  }

  const { id, method, params } = request;
  if (id === undefined || id === null) {
    return;
  }

  try {
    if (method === "initialize") {
      writeResult(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "run-hoban-image-gen", version: "1.0.0" },
      });
      return;
    }

    if (method === "tools/list") {
      writeResult(id, listTools());
      return;
    }

    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments || {});
      writeResult(id, result);
      return;
    }

    writeError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    writeError(id, -32000, error.message);
  }
}

const rl = createInterface({ input: process.stdin });
console.error("run-hoban-image-gen MCP server is running");
rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    writeError(null, -32700, `Parse error: ${error.message}`);
    return;
  }

  void handleRequest(request);
});
