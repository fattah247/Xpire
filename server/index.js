import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "runtime", "items.json");
const DEFAULT_SEED_FILE = path.join(__dirname, "data", "seed-items.json");
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function startOfDay(dateLike) {
  const date = new Date(dateLike);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeString(input, { fallback = "", maxLength = 120, lowercase = false } = {}) {
  const value = (input ?? fallback).toString().trim();
  const limited = value.slice(0, maxLength);
  return lowercase ? limited.toLowerCase() : limited;
}

function parseAllowedOrigins(raw) {
  if (!raw) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createRateLimiter({
  windowMs = 60_000,
  maxRequests = 180,
} = {}) {
  const buckets = new Map();
  return (ip, nowMs = Date.now()) => {
    const current = buckets.get(ip);
    if (!current || nowMs - current.windowStartMs >= windowMs) {
      buckets.set(ip, { windowStartMs: nowMs, count: 1 });
      return { allowed: true, remaining: maxRequests - 1 };
    }
    if (current.count >= maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    current.count += 1;
    return { allowed: true, remaining: maxRequests - current.count };
  };
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
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("item payload must be a JSON object");
  }

  const expiresOn = new Date(input.expiresOn);
  if (Number.isNaN(expiresOn.getTime())) {
    throw new Error("expiresOn must be a valid ISO date value");
  }

  const name = normalizeString(input.name, { fallback: "", maxLength: 80 });
  if (!name) {
    throw new Error("name is required");
  }

  const quantityInput = Number(input.quantity);
  const quantity = Number.isFinite(quantityInput)
    ? Math.max(1, Math.min(999, Math.round(quantityInput)))
    : 1;

  return {
    id: input.id ?? crypto.randomUUID(),
    name,
    category: normalizeString(input.category, { fallback: "general", maxLength: 40, lowercase: true }),
    quantity,
    expiresOn: startOfDay(expiresOn).toISOString(),
    notes: normalizeString(input.notes, { fallback: "", maxLength: 240 }),
    createdAt: input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function loadSeedItems(seedFile) {
  try {
    const content = await fs.readFile(seedFile, "utf8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => normalizeItem(item, new Date(item.createdAt ?? Date.now())));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function createJsonStore(filePath = DEFAULT_DATA_FILE, options = {}) {
  const seedFile = options.seedFile ?? DEFAULT_SEED_FILE;
  let items = [];

  async function ensureLoaded() {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      items = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") {
        items = await loadSeedItems(seedFile);
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

export function createApp({
  store,
  now = () => new Date(),
  allowedOrigins = parseAllowedOrigins(process.env.XPIRE_ALLOWED_ORIGINS),
  rateLimitWindowMs = parsePositiveInt(process.env.XPIRE_RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMax = parsePositiveInt(process.env.XPIRE_RATE_LIMIT_MAX_REQUESTS, 180),
} = {}) {
  const app = express();
  const limiter = createRateLimiter({ windowMs: rateLimitWindowMs, maxRequests: rateLimitMax });

  app.disable("x-powered-by");
  app.use(express.json({ limit: "25kb" }));
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.use((req, res, next) => {
    const identifier = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const result = limiter(identifier);
    res.setHeader("X-RateLimit-Limit", String(rateLimitMax));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = allowedOrigins.includes(origin);
      if (!allowed) {
        res.status(403).json({ error: "Origin is not allowed" });
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
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
    const allowedStatuses = new Set(["all", "fresh", "expiring", "expired"]);
    if (!allowedStatuses.has(statusFilter)) {
      res.status(400).json({ error: "status must be one of: all, fresh, expiring, expired" });
      return;
    }

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

  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Malformed JSON body" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export async function startServer() {
  const port = Number(process.env.PORT ?? 4000);
  const dataFile = process.env.XPIRE_DATA_FILE ?? DEFAULT_DATA_FILE;
  const seedFile = process.env.XPIRE_SEED_FILE ?? DEFAULT_SEED_FILE;
  const store = createJsonStore(dataFile, { seedFile });
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
