import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { initializeCoco } from "@cashu/coco-core";

import { FridaySqliteRepositories } from "./friday-sqlite";

describe("Friday persistent Coco repository", () => {
	test("reconstructs a manager over the same SQLite data with a newer authority generation", async () => {
		const directory = await mkdtemp(join(tmpdir(), "plebeian-friday-sqlite-"));
		const path = join(directory, "wallet.sqlite");
		const seed = new Uint8Array(64).fill(17);
		try {
			let database = new Database(path, { create: true, strict: true });
			let repositories = new FridaySqliteRepositories(database);
			let manager = await initializeCoco({ repo: repositories, seedGetter: async () => seed,
				authority: { namespace: "friday-test", ownerId: "first-process" } });
			database.exec("PRAGMA synchronous=FULL;");
			expect(database.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous).toBe(2);
			await repositories.mintRepository.addNewMint({ mintUrl: "https://mint.invalid", name: "Friday fixture", mintInfo: {},
				trusted: true, createdAt: 1, updatedAt: 1 } as never);
			const firstGeneration = repositories.getAuthority()?.generation;
			expect(firstGeneration).toBe(1);
			await manager.dispose();
			database.close();

			database = new Database(path, { create: false, strict: true });
			repositories = new FridaySqliteRepositories(database);
			manager = await initializeCoco({ repo: repositories, seedGetter: async () => seed,
				authority: { namespace: "friday-test", ownerId: "second-process" } });
			database.exec("PRAGMA synchronous=FULL;");
			expect(database.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous).toBe(2);
			expect(repositories.getAuthority()?.generation).toBe(2);
			expect((await repositories.mintRepository.getMintByUrl("https://mint.invalid")).trusted).toBeTrue();
			await manager.dispose();
			database.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
