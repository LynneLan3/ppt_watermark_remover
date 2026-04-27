import "server-only";

export type StorageAdapter = {
  writeJson(path: string, data: unknown): Promise<void>;
  readJson<T>(path: string): Promise<T>;
  writeBytes(path: string, payload: Buffer | Uint8Array): Promise<void>;
  readBytes(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
};
