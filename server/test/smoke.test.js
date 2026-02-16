import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { createApp, createJsonStore } from "../index.js";

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { response, json };
}

test("health endpoint and item CRUD flow", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "xpire-server-test-"));
  const dataPath = path.join(tmpDir, "items.json");

  const store = createJsonStore(dataPath);
  await store.init();
  const app = createApp({ store });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const health = await requestJson(`${base}/health`);
  assert.equal(health.response.status, 200);
  assert.equal(health.json.status, "ok");

  const create = await requestJson(`${base}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Milk",
      category: "dairy",
      quantity: 2,
      expiresOn: "2030-01-01",
    }),
  });

  assert.equal(create.response.status, 201);
  assert.equal(create.json.item.name, "Milk");
  const id = create.json.item.id;

  const list = await requestJson(`${base}/api/items`);
  assert.equal(list.response.status, 200);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.items[0].id, id);

  const patch = await requestJson(`${base}/api/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 3 }),
  });

  assert.equal(patch.response.status, 200);
  assert.equal(patch.json.item.quantity, 3);

  const remove = await fetch(`${base}/api/items/${id}`, { method: "DELETE" });
  assert.equal(remove.status, 204);
});
