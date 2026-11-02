#!/usr/bin/env bun
/** Bearer-free child process used only by the V2 migration restart regression. */
import { open } from "node:fs/promises";

import { FridayFundingJournal } from "./friday-funding";
import { migrateFridayFundingCheckpoint } from "./friday-funding-migration";

const argument = (name: string): string => {
	const value = process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length+1);
	if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
	return value;
};
const phase = argument("--phase");
const inputPath = argument("--input");
const outputPath = argument("--output");
const actor = argument("--actor");
if (!/^[0-9a-f]{64}$/.test(actor) || !["migrate", "restart"].includes(phase)) throw new Error("invalid migration process arguments");

const input = await Bun.file(inputPath).json() as any;
let output: unknown;
if (phase === "migrate") {
	const migrated = migrateFridayFundingCheckpoint(input, 10_000);
	output = { schema: "PlebeianFridayFundingMigrationV1", grants: migrated.grants, quarantinedActors: migrated.quarantinedActors };
} else {
	if (input?.schema !== "PlebeianFridayFundingMigrationV1") throw new Error("restart input schema is invalid");
	const journal = new FridayFundingJournal(10_000, 50_000, [], input.grants, input.quarantinedActors);
	const snapshot = journal.snapshot();
	if (!journal.isQuarantined(actor) || journal.grant(actor) !== 0 || journal.allocated(actor) !== 50_000
		|| journal.availableBacking(actor, 0) !== 0 || snapshot.quarantinedActors.length !== 1) {
		throw new Error("V2 quarantine did not survive the process restart");
	}
	output = { schema: "PlebeianFridayFundingMigrationRestartEvidenceV1", actor,
		quarantined: true, grant: 0, allocated: journal.allocated(actor), available_backing: journal.availableBacking(actor, 0),
		persisted_quarantine_count: snapshot.quarantinedActors.length };
}
const file = await open(outputPath, "wx", 0o600);
try { await file.writeFile(JSON.stringify(output, null, 2)+"\n"); } finally { await file.close(); }
