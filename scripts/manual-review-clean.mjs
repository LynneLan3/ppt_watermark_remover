#!/usr/bin/env node

import { rm } from "node:fs/promises";
import path from "node:path";

const target = path.resolve(process.cwd(), process.env.MANUAL_REVIEW_TMP_DIR || "tmp/manual-review");

try {
  await rm(target, { recursive: true, force: true });
  console.log(`cleaned: ${target}`);
} catch (error) {
  console.error(`clean failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
