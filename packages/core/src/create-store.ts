import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IStore } from "./store-interface";

export type StoreType = "sqlite" | "memory";

export interface CreateStoreOptions {
	type?: StoreType;
	dbPath?: string;
}

/**
 * Factory function that creates a store based on type.
 * Defaults to SQLite if available, falls back to in-memory.
 *
 * Store type resolution order:
 * 1. Explicit `type` option
 * 2. `AGENTATION_MOBILE_STORE` env var
 * 3. "sqlite" (with graceful fallback to "memory" if better-sqlite3 is unavailable)
 */
export function createStore(options?: CreateStoreOptions): IStore {
	const envType = process.env.AGENTATION_MOBILE_STORE as StoreType | undefined;
	const storeType = options?.type ?? envType ?? "sqlite";

	if (storeType === "sqlite") {
		try {
			// Dynamic import to allow graceful fallback
			const { SqliteStore } = require("./sqlite-store");
			const dbPath = options?.dbPath ?? getDefaultDbPath();
			return new SqliteStore({ dbPath }) as IStore;
		} catch {
			console.warn(
				"[agentation-mobile] SQLite unavailable (better-sqlite3 not installed), falling back to in-memory store",
			);
			const { Store } = require("./store");
			return new Store() as IStore;
		}
	}

	const { Store } = require("./store");
	return new Store() as IStore;
}

function getDefaultDbPath(): string {
	const dir = join(homedir(), ".agentation-mobile");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return join(dir, "store.db");
}
