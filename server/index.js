import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "items.json");

function startOfDay(dateLike) {
  const date = new Date(dateLike);
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysUntil(expiryDate, now = new Date()) {
  const today = startOfDay(now).getTime();
  const expiry = startOfDay(expiryDate).getTime();
  return Math.round((expiry - today) / (24 * 60 * 60 * 1000));
}

export function itemStatus(expiryDate, now = new Date()) {
  const daysLeft = daysUntil(expiryDate, now);
  if (daysLeft < 0) {
    return "expired";
  }
  if (daysLeft <= 7) {
    return "expiring";
  }
  return "fresh";
}

function normalizeItem(input, now = new Date()) {
  const expiresOn = new Date(input.expiresOn);
  if (Number.isNaN(expiresOn.getTime())) {
    throw new Error("expiresOn must be a valid ISO date value");
  }

  if (!input.name || typeof input.name !== "string") {
    throw new Error("name is required");
  }

  const quantity = Number.isFinite(Number(input.quantity))
    ? Number(input.quantity)
    : 1;

  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim(),
    category: (input.category ?? "general").toString().trim().toLowerCase(),
    quantity: quantity > 0 ? quantity : 1,
    expiresOn: startOfDay(expiresOn).toISOString(),
    notes: (input.notes ?? "").toString().trim(),
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function createJsonStore(filePath = DEFAULT_DATA_FILE) {
  let items = [];

  async function ensureLoaded() {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      items = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") {
        items = [];
        await persist();
        return;
      }
      throw error;
    }
  }

  async function persist() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(items, null, 2));
  }

  return {
    async init() {
      await ensureLoaded();
    },
    list() {
      return items.slice();
    },
    async create(rawItem, now = new Date()) {
      const item = normalizeItem(rawItem, now);
      items.push(item);
      await persist();
      return item;
    },
    async update(id, patch, now = new Date()) {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) {
        return null;
      }

      const merged = normalizeItem(
        {
          ...items[index],
          ...patch,
          id,
          createdAt: items[index].createdAt,
        },
        now
      );

      items[index] = merged;
      await persist();
      return merged;
    },
    async remove(id) {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) {
        return false;
      }
      items.splice(index, 1);
      await persist();
      return true;
    },
  };
}

function toApiItem(item, now = new Date()) {
  const daysLeft = daysUntil(item.expiresOn, now);
  return {
    ...item,
    daysLeft,
    status: itemStatus(item.expiresOn, now),
  };
}

export function createApp({ store, now = () => new Date() }) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "xpire-server",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: now().toISOString(),
    });
  });

  app.get("/api/items", (req, res) => {
    const statusFilter = (req.query.status ?? "all").toString().toLowerCase();
    const allItems = store
      .list()
      .map((item) => toApiItem(item, now()))
      .sort((a, b) => new Date(a.expiresOn) - new Date(b.expiresOn));

    const filtered =
      statusFilter === "all"
        ? allItems
        : allItems.filter((item) => item.status === statusFilter);

    res.json({ items: filtered, total: filtered.length });
  });

  app.post("/api/items", async (req, res) => {
    try {
      const created = await store.create(req.body, now());
      res.status(201).json({ item: toApiItem(created, now()) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/items/:id", async (req, res) => {
    try {
      const updated = await store.update(req.params.id, req.body, now());
      if (!updated) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      res.json({ item: toApiItem(updated, now()) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/items/:id", async (req, res) => {
    const removed = await store.remove(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.status(204).end();
  });

  return app;
}

export async function startServer() {
  const port = Number(process.env.PORT ?? 4000);
  const dataFile = process.env.XPIRE_DATA_FILE ?? DEFAULT_DATA_FILE;
  const store = createJsonStore(dataFile);
  await store.init();

  const app = createApp({ store });
  app.listen(port, () => {
    console.log(`Xpire API listening on http://localhost:${port}`);
  });
}

if (process.argv[1] === __filename) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
