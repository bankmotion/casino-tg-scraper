import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

export class Queue {
  private dir: string;

  constructor(dir: string = config.queue.dir) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async enqueue(payload: unknown, key: string): Promise<void> {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${Date.now()}_${safeKey}.json`;
    const fullPath = path.join(this.dir, filename);
    await fs.writeFile(fullPath, JSON.stringify(payload), "utf8");
    logger.debug({ filename }, "Enqueued");
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dir);
      return files.filter((f) => f.endsWith(".json")).sort();
    } catch {
      return [];
    }
  }

  async read(filename: string): Promise<unknown> {
    const fullPath = path.join(this.dir, filename);
    const data = await fs.readFile(fullPath, "utf8");
    return JSON.parse(data);
  }

  async remove(filename: string): Promise<void> {
    const fullPath = path.join(this.dir, filename);
    await fs.unlink(fullPath);
  }

  async size(): Promise<number> {
    return (await this.list()).length;
  }
}
