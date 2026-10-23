import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workers show connected and disconnected poll status", async () => {
  const catalog = await readFile(new URL("./catalog.jsx", import.meta.url), "utf8");
  const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");

  assert.match(catalog, /worker\.connected \? "Connected" : "Disconnected"/);
  // The palette is monochrome, so connected/disconnected are distinguished by
  // form: a filled, pulsing dot against a dashed hollow one.
  assert.match(catalog, /worker\.connected \? "[^"]*text-foreground" : "[^"]*border-dashed[^"]*"/);
  assert.match(catalog, /worker\.connected \? "[^"]*bg-current pulse-dot" : "[^"]*border border-current"/);
  assert.match(catalog, /Last seen \{relativeTime\(worker\.last_seen_at\)\}/);
  assert.match(main, /status\.workers\.filter\(\(worker\) => worker\.connected\)\.length/);
  assert.match(main, /worker\$\{connectedWorkers === 1 \? "" : "s"\} online/);
  assert.match(main, /truncate whitespace-nowrap/);
  assert.match(main, /title=\{`\$\{connectedWorkers\} connected · \$\{status\.workers\.length\} registered`\}/);
});
