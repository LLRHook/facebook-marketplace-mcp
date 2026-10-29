import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { z } from "zod";
import type { SavedMonitor, SearchParams } from "../facebook/types.js";

const STORAGE_DIR = path.join(os.homedir(), ".fb-marketplace");
const MONITORS_FILE = path.join(STORAGE_DIR, "monitors.json");

const monitorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  params: z.object({
    query: z.string().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    radiusKm: z.number().finite().positive(),
    minPrice: z.number().finite().nonnegative().optional(),
    maxPrice: z.number().finite().nonnegative().optional(),
    category: z.string().optional(),
    limit: z.number().int().min(1).max(100),
    delivery: z.enum(["all", "local_pickup", "shipping"]).optional(),
  }).refine(params => params.minPrice === undefined || params.maxPrice === undefined ||
    params.minPrice <= params.maxPrice),
  seenIds: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
  lastChecked: z.string().datetime().nullable(),
});

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

export function loadMonitors(): SavedMonitor[] {
  try {
    const data = fs.readFileSync(MONITORS_FILE, "utf-8");
    const parsed: unknown = JSON.parse(data);
    if (!z.array(monitorSchema).safeParse(parsed).success) {
      throw new Error("Invalid monitor data");
    }
    return parsed as SavedMonitor[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Could not read saved monitors. Check the monitor file and restore a valid backup before retrying; existing data has not been changed.");
  }
}

export function saveMonitors(monitors: SavedMonitor[]) {
  ensureStorageDir();
  const temporary = `${MONITORS_FILE}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(monitors, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, MONITORS_FILE);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function addMonitor(
  name: string,
  params: Omit<SearchParams, "cursor">
): SavedMonitor {
  const monitors = loadMonitors();

  // Check for duplicate name
  const existing = monitors.find((m) => m.name === name);
  if (existing) {
    throw new Error(`Monitor "${name}" already exists. Choose a different name.`);
  }

  const monitor: SavedMonitor = {
    id: crypto.randomUUID(),
    name,
    params,
    seenIds: [],
    createdAt: new Date().toISOString(),
    lastChecked: null,
  };

  monitors.push(monitor);
  saveMonitors(monitors);
  return monitor;
}

export function getMonitor(name: string): SavedMonitor | undefined {
  return loadMonitors().find((m) => m.name === name);
}

export function updateMonitorSeenIds(
  name: string,
  newIds: string[]
): void {
  const monitors = loadMonitors();
  const monitor = monitors.find((m) => m.name === name);
  if (!monitor) return;

  // Keep last 500 seen IDs to prevent unbounded growth
  const combined = [...new Set([...monitor.seenIds, ...newIds])];
  monitor.seenIds = combined.slice(-500);
  monitor.lastChecked = new Date().toISOString();
  saveMonitors(monitors);
}

export function deleteMonitor(name: string): boolean {
  const monitors = loadMonitors();
  const idx = monitors.findIndex((m) => m.name === name);
  if (idx === -1) return false;
  monitors.splice(idx, 1);
  saveMonitors(monitors);
  return true;
}
