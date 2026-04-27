import "server-only";

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StorageAdapter } from "@/lib/storage/adapter";

export const localStorageAdapter: StorageAdapter = {
  async writeJson(targetPath: string, data: unknown) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify(data, null, 2), "utf-8");
  },
  async readJson<T>(targetPath: string) {
    const raw = await readFile(targetPath, "utf-8");
    return JSON.parse(raw) as T;
  },
  async writeBytes(targetPath: string, payload: Buffer | Uint8Array) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, payload);
  },
  async readBytes(targetPath: string) {
    return readFile(targetPath);
  },
  async exists(targetPath: string) {
    try {
      const info = await stat(targetPath);
      return info.isFile();
    } catch {
      return false;
    }
  },
};

// Reserved for future Vercel private Blob migration.
export function getStorageAdapter() {
  return localStorageAdapter;
}
