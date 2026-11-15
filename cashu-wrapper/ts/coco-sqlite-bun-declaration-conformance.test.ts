import { Database } from "bun:sqlite";

import { describe, expect, test } from "bun:test";
import type { Repositories } from "@cashu/coco-core/adapter";
import {
	SqliteRepositories,
	type SqliteRepositoriesOptions,
} from "@cashu/coco-sqlite-bun";

function acceptsRepositories(_repositories: Repositories): void {}

describe("reviewed SQLite-Bun declaration metadata", () => {
	test("matches the installed runtime constructor and public repository surface", () => {
		const database = new Database(":memory:", { strict: true });
		try {
			const options: SqliteRepositoriesOptions = { database };
			const repositories = new SqliteRepositories(options);
			acceptsRepositories(repositories);

			for (const method of [
				"init",
				"claimSessionAttachment",
				"releaseSessionAttachment",
				"acquireAuthority",
				"releaseAuthority",
				"getAuthority",
				"getAuthorityState",
				"withTransaction",
			] as const) {
				expect(typeof repositories[method]).toBe("function");
			}

			for (const repository of [
				"mintRepository",
				"keyRingRepository",
				"counterRepository",
				"keysetRepository",
				"proofRepository",
				"meltQuoteRepository",
				"mintQuoteRepository",
				"legacyMintQuoteRepository",
				"historyRepository",
				"sendOperationRepository",
				"meltOperationRepository",
				"authSessionRepository",
				"mintOperationRepository",
				"receiveOperationRepository",
				"paymentRequestReceiveOperationRepository",
				"paymentRequestReceiveAttemptRepository",
			] as const) {
				expect(repositories[repository]).toBeDefined();
			}
		} finally {
			database.close();
		}
	});
});
