#!/usr/bin/env bun
/** Bearer-safe read-only audit of a Coco send stopped after durable prepare. */
import { Database } from "bun:sqlite";
import { open } from "node:fs/promises";

import { createBoundedMintFetch } from "./friday-mint-transport";
import { hashToCurve } from "./nut-client";

const argument = (name: string): string => {
	const value = process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length+1);
	if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
	return value;
};
const databasePath = argument("--sender-db");
const operationID = argument("--send-id");
const mint = argument("--mint").replace(/\/$/, "");
const expectedAmount = Number(argument("--amount"));
const expectedIssued = Number(argument("--issued"));
const evidencePath = argument("--evidence");
if (![expectedAmount, expectedIssued].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("amounts must be positive integers");

type SendRow = { id: string; mintUrl: string; amount: string; unit: string; state: string; needsSwap: number; inputProofSecretsJson: string | null; tokenJson: string | null };
type Aggregate = { state: string; count: number; amount: number };
type MintProofState = { Y: string; state: "UNSPENT" | "PENDING" | "SPENT" };
const total = (rows: readonly Aggregate[], field: "count" | "amount"): number => rows.reduce((sum, row) => sum+Number(row[field]), 0);

async function mintStates(secrets: readonly string[]): Promise<MintProofState[]> {
	const Ys = secrets.map((secret) => Buffer.from(hashToCurve(secret).toBytes(true)).toString("hex"));
	if (new Set(Ys).size !== Ys.length) throw new Error("prepared input proof identities are not unique");
	const response = await createBoundedMintFetch(5_000)(`${mint}/v1/checkstate`, {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys }),
	});
	if (!response.ok) throw new Error(`NUT-07 checkstate returned HTTP ${response.status}`);
	const body = await response.json() as { states?: unknown };
	if (!Array.isArray(body.states) || body.states.length !== Ys.length) throw new Error("NUT-07 returned the wrong proof-state count");
	const byY = new Map<string, MintProofState>();
	for (const item of body.states) {
		if (item === null || typeof item !== "object") throw new Error("NUT-07 returned a malformed state");
		const state = item as Partial<MintProofState>;
		if (typeof state.Y !== "string" || !Ys.includes(state.Y) || !["UNSPENT", "PENDING", "SPENT"].includes(state.state ?? "") || byY.has(state.Y)) {
			throw new Error("NUT-07 returned an unknown, duplicate or invalid state");
		}
		byY.set(state.Y, state as MintProofState);
	}
	return Ys.map((Y) => byY.get(Y)!);
}

const database = new Database(databasePath, { readonly: true, strict: true });
try {
	const rows = database.query<SendRow, [string]>("SELECT id,mintUrl,amount,unit,state,needsSwap,inputProofSecretsJson,tokenJson FROM coco_cashu_send_operations WHERE id = ?").all(operationID);
	if (rows.length !== 1) throw new Error(`expected one prepared send row, got ${rows.length}`);
	const send = rows[0]!;
	if (send.id !== operationID || send.mintUrl.replace(/\/$/, "") !== mint || send.unit !== "sat" || Number(send.amount) !== expectedAmount || send.state !== "prepared") {
		throw new Error("prepared send immutable intent or state mismatch");
	}
	const parsed = send.inputProofSecretsJson === null ? null : JSON.parse(send.inputProofSecretsJson) as unknown;
	if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((value): value is string => typeof value === "string" && value.length > 0)) {
		throw new Error("prepared input proof identities are unavailable");
	}
	const inputSecrets = parsed;
	const selected = database.query<Aggregate, [string]>("SELECT state,COUNT(*) AS count,COALESCE(SUM(CAST(amount AS INTEGER)),0) AS amount FROM coco_cashu_proofs WHERE usedByOperationId = ? GROUP BY state ORDER BY state").all(operationID);
	if (total(selected, "count") !== inputSecrets.length) throw new Error("prepared inputs are not linked exactly once to the operation");
	const otherReady = database.query<{ count: number; amount: number }, [string]>("SELECT COUNT(*) AS count,COALESCE(SUM(CAST(amount AS INTEGER)),0) AS amount FROM coco_cashu_proofs WHERE state = 'ready' AND (usedByOperationId IS NULL OR usedByOperationId != ?)").get(operationID) ?? { count: 0, amount: 0 };
	const ownerRows = database.query<{ ownerType: string }, [string]>("SELECT ownerType FROM coco_cashu_operation_ids WHERE id = ?").all(operationID);
	if (ownerRows.length !== 1 || ownerRows[0]!.ownerType !== "send") throw new Error("prepared operation ID ownership is not unique");
	const proofStates = await mintStates(inputSecrets);
	if (proofStates.some((state) => state.state !== "UNSPENT")) throw new Error("a prepared-only input is not unspent at the mint");
	const selectedInputAmount = total(selected, "amount");
	const otherReadyAmount = Number(otherReady.amount);
	if (selectedInputAmount+otherReadyAmount !== expectedIssued) throw new Error("local prepared inputs plus other ready proofs do not equal issued value");
	if (send.tokenJson !== null) throw new Error("prepared-only send unexpectedly has a bearer token");
	const evidence = {
		schema: "PlebeianFridayPreparedOperationAuditV1", observed_at: new Date().toISOString(), operation_id: operationID,
		intent: { amount: expectedAmount, unit: send.unit, state: send.state, needs_swap: send.needsSwap === 1 },
		selected_inputs: { identities: inputSecrets.length, aggregates: selected, total_amount: selectedInputAmount,
			mint_states: { UNSPENT: proofStates.length } },
		other_ready: { count: Number(otherReady.count), amount: otherReadyAmount },
		issued: expectedIssued, durable_token_present: false, owner_rows: ownerRows.length, duplicate_operation_rows: rows.length-1,
		assertions: { immutable_intent: true, unique_operation_owner: true, unique_selected_inputs: true,
			all_selected_inputs_unspent_at_mint: true, locally_accounted_value_equals_issued: true, no_bearer_output_yet: true },
	};
	const file = await open(evidencePath, "wx", 0o600);
	try { await file.writeFile(JSON.stringify(evidence, null, 2)+"\n"); } finally { await file.close(); }
	console.log(`friday-prepared-operation-audit: PASS; evidence ${evidencePath}`);
} finally {
	database.close();
}
