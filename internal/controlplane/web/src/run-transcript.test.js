import assert from "node:assert/strict";
import test from "node:test";
import { parseTranscript, parseUnifiedDiff } from "./run-transcript.js";

const lines = (...events) => events.map((event) => JSON.stringify(event)).join("\n");

test("claude tool calls pair with their results and failures", () => {
  const transcript = parseTranscript(lines(
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "go test ./...", description: "Run the tests" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }] }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "go.mod" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "no such file", is_error: true }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Bash", input: { command: "sleep 99" } }] } },
  ));

  assert.equal(transcript.format, "claude");
  assert.deepEqual(transcript.tools.map(({ title, kind, status, output }) => ({ title, kind, status, output })), [
    { title: "Run the tests", kind: "terminal", status: "success", output: "ok" },
    { title: "go.mod", kind: "custom", status: "error", output: "no such file" },
    { title: "sleep 99", kind: "terminal", status: "cancelled", output: "" },
  ]);
});

test("claude plans come from the latest TodoWrite and subagent traffic is ignored", () => {
  const transcript = parseTranscript(lines(
    { type: "assistant", message: { content: [{ type: "tool_use", id: "p1", name: "TodoWrite", input: { todos: [{ content: "Read", status: "pending" }] } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "p2", name: "TodoWrite", input: { todos: [{ content: "Read", status: "completed" }, { content: "Fix", status: "in_progress" }, { content: "Ship", status: "pending" }] } }] } },
    { type: "assistant", parent_tool_use_id: "agent", message: { content: [{ type: "tool_use", id: "s1", name: "Bash", input: { command: "ls" } }] } },
  ));

  assert.deepEqual(transcript.todos.map(({ title, status }) => [title, status]), [["Read", "completed"], ["Fix", "in-progress"], ["Ship", "pending"]]);
  assert.deepEqual(transcript.tools, []);
});

test("claude edits become removed and added lines for the file", () => {
  const transcript = parseTranscript(lines(
    { type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "main.go", old_string: "a\nb", new_string: "c\n" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "e2", name: "Write", input: { file_path: "new.txt", content: "hello" } }] } },
  ));

  assert.deepEqual(transcript.tools[0].edit, { file: "main.go", lines: [
    { id: "0", type: "removed", content: "a" },
    { id: "1", type: "removed", content: "b" },
    { id: "2", type: "added", content: "c" },
  ] });
  assert.deepEqual(transcript.tools[1].edit.lines, [{ id: "0", type: "added", content: "hello" }]);
});

test("codex commands and tool calls are read from item events", () => {
  const transcript = parseTranscript([
    lines(
      { type: "thread.started" },
      { type: "item.started", item: { id: "item_1", type: "command_execution", command: "/bin/bash -lc 'git status'", aggregated_output: "", exit_code: null, status: "in_progress" } },
      { type: "item.completed", item: { id: "item_1", type: "command_execution", command: "/bin/bash -lc 'git status'", aggregated_output: "clean\n", exit_code: 0, status: "completed" } },
      { type: "item.completed", item: { id: "item_2", type: "command_execution", command: "/bin/bash -lc 'echo '\\''hi'\\'' && false'", aggregated_output: "hi\n", exit_code: 1, status: "failed" } },
      { type: "item.completed", item: { id: "item_3", type: "mcp_tool_call", server: "apps", tool: "list_threads", arguments: { pr: 1 }, result: { content: [{ type: "text", text: "[]" }] }, error: null, status: "completed" } },
      { type: "item.started", item: { id: "item_4", type: "command_execution", command: "/bin/bash -lc 'sleep 1'", aggregated_output: "", exit_code: null, status: "in_progress" } },
    ),
    "not json",
    "{\"type\":",
  ].join("\n"));

  assert.equal(transcript.format, "codex");
  assert.deepEqual(transcript.tools.map(({ title, status, output, kind }) => ({ title, status, output, kind })), [
    { title: "git status", status: "success", output: "clean\n", kind: "terminal" },
    { title: "echo 'hi' && false", status: "error", output: "hi\n", kind: "terminal" },
    { title: "list_threads", status: "success", output: "[]", kind: "request" },
    { title: "sleep 1", status: "cancelled", output: "", kind: "terminal" },
  ]);
});

test("unrecognised output yields an empty transcript", () => {
  assert.deepEqual(parseTranscript("plain text output\n"), { format: "unknown", tools: [], todos: [] });
  assert.deepEqual(parseTranscript(undefined), { format: "unknown", tools: [], todos: [] });
});

test("pull request diffs split into files with line numbers", () => {
  const files = parseUnifiedDiff([
    "diff --git a/src/app.js b/src/app.js",
    "index 1111111..2222222 100644",
    "--- a/src/app.js",
    "+++ b/src/app.js",
    "@@ -10,3 +10,3 @@ export function run() {",
    " const a = 1;",
    "-const b = 2;",
    "--- not a header",
    "+const b = 3;",
    "diff --git a/old.txt b/new.txt",
    "similarity index 90%",
    "rename from old.txt",
    "rename to new.txt",
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
    "",
  ].join("\n"));

  assert.deepEqual(files.map(({ file, additions, deletions, binary }) => ({ file, additions, deletions, binary })), [
    { file: "src/app.js", additions: 1, deletions: 2, binary: false },
    { file: "new.txt", additions: 0, deletions: 0, binary: false },
    { file: "logo.png", additions: 0, deletions: 0, binary: true },
  ]);
  assert.deepEqual(files[0].lines.slice(1), [
    { id: "1", type: "context", oldLine: 10, newLine: 10, content: "const a = 1;" },
    { id: "2", type: "removed", oldLine: 11, content: "const b = 2;" },
    { id: "3", type: "removed", oldLine: 12, content: "-- not a header" },
    { id: "4", type: "added", newLine: 11, content: "const b = 3;" },
  ]);
});
