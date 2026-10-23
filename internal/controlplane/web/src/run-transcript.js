// A run's transcript is the executor's structured stdout, recorded by the
// worker and returned by the control plane after the run completes. Claude
// writes stream-json and Codex writes exec --json; both are read here into the
// three things the task page shows: what the agent ran, what it planned, and
// what it edited. Anything unrecognised is skipped rather than guessed at.

const maxOutputCharacters = 20000;

export function parseTranscript(stdout) {
  const transcript = { format: "unknown", tools: [], todos: [] };
  const byID = new Map();
  for (const line of String(stdout || "").split("\n")) {
    const event = parseLine(line);
    if (!event) continue;
    if (event.type === "assistant" || event.type === "user") {
      transcript.format = "claude";
      readClaudeMessage(event, transcript, byID);
    } else if (event.type?.startsWith("item.") && event.item) {
      transcript.format = "codex";
      readCodexItem(event, transcript, byID);
    }
  }
  return transcript;
}

function parseLine(line) {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// Subagent traffic carries a parent_tool_use_id; the parent's Agent call
// already stands for it, so only the top-level conversation is read.
function readClaudeMessage(event, transcript, byID) {
  if (event.parent_tool_use_id) return;
  const content = Array.isArray(event.message?.content) ? event.message.content : [];
  for (const block of content) {
    if (event.type === "assistant" && block.type === "tool_use") {
      if (block.name === "TodoWrite" && Array.isArray(block.input?.todos)) {
        transcript.todos = block.input.todos.map((todo, index) => ({
          id: `todo-${index}`,
          title: String(todo.content || todo.activeForm || ""),
          status: todoStatus(todo.status),
        }));
        continue;
      }
      const tool = claudeTool(block);
      byID.set(tool.id, tool);
      transcript.tools.push(tool);
    } else if (event.type === "user" && block.type === "tool_result") {
      const tool = byID.get(block.tool_use_id);
      if (!tool) continue;
      tool.status = block.is_error ? "error" : "success";
      tool.output = clip(resultText(block.content));
    }
  }
}

function claudeTool(block) {
  const input = block.input || {};
  const tool = { id: String(block.id), name: String(block.name), kind: "custom", title: String(block.name), input: "", output: "", status: "cancelled", edit: null };
  if (block.name === "Bash") {
    tool.kind = "terminal";
    tool.title = String(input.description || input.command || "Shell command");
    tool.input = String(input.command || "");
  } else if (block.name === "Edit" || block.name === "Write" || block.name === "MultiEdit") {
    tool.title = String(input.file_path || block.name);
    tool.edit = claudeEdit(block.name, input);
  } else if (block.name === "Read") {
    tool.title = String(input.file_path || "Read");
  } else {
    tool.kind = block.name.startsWith("mcp__") ? "request" : "custom";
    tool.title = String(input.description || input.query || block.name);
    tool.input = clip(JSON.stringify(input, null, 2));
  }
  return tool;
}

// An Edit carries only the replaced text, not its position in the file, so the
// lines are shown as a removal and an addition without line numbers.
function claudeEdit(name, input) {
  const pairs = name === "Write" ? [{ old_string: "", new_string: input.content }]
    : name === "MultiEdit" ? (Array.isArray(input.edits) ? input.edits : [])
      : [input];
  const lines = [];
  for (const pair of pairs) {
    for (const content of splitLines(pair.old_string)) lines.push({ id: `${lines.length}`, type: "removed", content });
    for (const content of splitLines(pair.new_string)) lines.push({ id: `${lines.length}`, type: "added", content });
  }
  return { file: String(input.file_path || ""), lines };
}

function readCodexItem(event, transcript, byID) {
  const item = event.item;
  if (item.type !== "command_execution" && item.type !== "mcp_tool_call") return;
  const id = String(item.id);
  let tool = byID.get(id);
  if (!tool) {
    tool = { id, name: "", kind: "terminal", title: "", input: "", output: "", status: "cancelled", edit: null };
    byID.set(id, tool);
    transcript.tools.push(tool);
  }
  if (item.type === "command_execution") {
    tool.name = "shell";
    tool.title = unwrapShell(String(item.command || ""));
    tool.input = tool.title;
    tool.output = clip(String(item.aggregated_output || ""));
    if (event.type === "item.completed") tool.status = item.exit_code === 0 && item.status !== "failed" ? "success" : "error";
    tool.exitCode = item.exit_code;
  } else {
    tool.kind = "request";
    tool.name = [item.server, item.tool].filter(Boolean).join(".");
    tool.title = String(item.tool || "Tool call");
    tool.input = clip(JSON.stringify(item.arguments ?? {}, null, 2));
    if (event.type === "item.completed") {
      tool.status = item.error ? "error" : "success";
      tool.output = clip(item.error ? String(item.error.message || JSON.stringify(item.error)) : resultText(item.result?.content));
    }
  }
}

// Codex runs every command through `bash -lc '<command>'`; the wrapper is
// noise in a list of what the agent did.
function unwrapShell(command) {
  const match = command.match(/^\/bin\/(?:ba)?sh -lc '([\s\S]*)'$/);
  return match ? match[1].replaceAll("'\\''", "'") : command;
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n");
}

function todoStatus(status) {
  if (status === "in_progress") return "in-progress";
  if (status === "completed" || status === "cancelled") return status;
  return "pending";
}

function splitLines(value) {
  if (typeof value !== "string" || value === "") return [];
  return value.replace(/\n$/, "").split("\n");
}

function clip(value) {
  return value.length > maxOutputCharacters ? `${value.slice(0, maxOutputCharacters)}\n… output clipped at ${maxOutputCharacters} characters` : value;
}

// parseUnifiedDiff reads `gh pr diff` output into one entry per file, in the
// shape the file diff component renders.
export function parseUnifiedDiff(text) {
  const files = [];
  let file = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = { file: match ? match[2] : line.slice(11), additions: 0, deletions: 0, lines: [], binary: false };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (line.startsWith("rename to ")) file.file = line.slice(10);
    else if (line.startsWith("Binary files ")) file.binary = true;
    else if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) continue;
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      file.lines.push({ id: `${file.lines.length}`, type: "context", content: line });
    } else if (!file.lines.length) {
      continue; // index, mode and ---/+++ headers precede the first hunk
    } else if (line.startsWith("+")) {
      file.additions++;
      file.lines.push({ id: `${file.lines.length}`, type: "added", newLine: newLine++, content: line.slice(1) });
    } else if (line.startsWith("-")) {
      file.deletions++;
      file.lines.push({ id: `${file.lines.length}`, type: "removed", oldLine: oldLine++, content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      file.lines.push({ id: `${file.lines.length}`, type: "context", oldLine: oldLine++, newLine: newLine++, content: line.slice(1) });
    }
  }
  return files;
}
