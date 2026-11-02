import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ACTOR = "a".repeat(64);

test("V2 quarantine survives a real two-process migration/restart boundary without becoming issuance", async () => {
	const root = await mkdtemp(join(tmpdir(), "plebeian-friday-v2-migration."));
	try {
		const fixture = join(root, "v2.json"), migrated = join(root, "migrated.json"), evidence = join(root, "restart.json");
		await writeFile(fixture, JSON.stringify({ schema: "PlebeianAuctionsPOCCoordinatorStateV2", faucetActors: [ACTOR],
			faucetGrants: { [ACTOR]: 50_000 }, funding: [] })+"\n", { mode: 0o600 });
		const first = Bun.spawn(["bun", "friday-funding-migration-process.ts", "--phase=migrate", `--input=${fixture}`, `--output=${migrated}`, `--actor=${ACTOR}`],
			{ cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
		expect(await first.exited).toBe(0);
		const second = Bun.spawn(["bun", "friday-funding-migration-process.ts", "--phase=restart", `--input=${migrated}`, `--output=${evidence}`, `--actor=${ACTOR}`],
			{ cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
		expect(await second.exited).toBe(0);
		const result = await Bun.file(evidence).json();
		expect(result).toEqual({ schema: "PlebeianFridayFundingMigrationRestartEvidenceV1", actor: ACTOR,
			quarantined: true, grant: 0, allocated: 50_000, available_backing: 0, persisted_quarantine_count: 1 });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
