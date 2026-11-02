#!/usr/bin/env bun
/** Read-only, bearer-safe audit of one recovered Friday payout lineage. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

import { hashToCurve } from "./nut-client";
import { createBoundedMintFetch } from "./friday-mint-transport";

const argument = (name: string): string => {
	const value = process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length+1);
	if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
	return value;
};
const senderPath = argument("--sender-db");
const recipientPath = argument("--recipient-db");
const sendID = argument("--send-id");
const receiveID = argument("--receive-id");
const expectedMint = argument("--mint").replace(/\/$/, "");
const expectedAmount = Number(argument("--amount"));
const evidencePath = argument("--evidence");
if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0) throw new Error("--amount must be a positive integer");

type SendRow = { id: string; mintUrl: string; amount: string; unit: string; state: string; needsSwap: number; inputProofSecretsJson: string | null; outputDataJson: string | null; tokenJson: string | null };
type ReceiveRow = { id: string; mintUrl: string; amount: string; unit: string; state: string; inputProofsJson: string; outputDataJson: string | null };
type Aggregate = { state: string; count: number; amount: number };
type ProofRow = { secret: string; state: string; amount: number; usedByOperationId: string | null; createdByOperationId: string | null };
type MintProofState = { Y: string; state: "UNSPENT" | "PENDING" | "SPENT"; witness?: string | null };
type StoredProof = { id?: unknown; amount?: unknown; secret?: unknown; C?: unknown; witness?: unknown };

function parseArray(value: string | null, label: string): unknown[] {
	if (value === null) throw new Error(`${label} is absent`);
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`${label} is not a nonempty array`);
	return parsed;
}
function parseOutputData(value: string | null, required: boolean): { keep: unknown[]; send: unknown[] } | null {
	if (value === null) {
		if (required) throw new Error("send swap output reconstruction data is absent");
		return null;
	}
	const parsed = JSON.parse(value) as unknown;
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("send output reconstruction data is malformed");
	const output = parsed as { keep?: unknown; send?: unknown };
	if (!Array.isArray(output.keep) || !Array.isArray(output.send) || output.keep.length+output.send.length === 0) {
		throw new Error("send output reconstruction data has no deterministic outputs");
	}
	return { keep: output.keep, send: output.send };
}
function aggregate(database: Database, column: "usedByOperationId" | "createdByOperationId", operationID: string): Aggregate[] {
	return database.query<Aggregate, [string]>(`SELECT state, COUNT(*) AS count, COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS amount FROM coco_cashu_proofs WHERE ${column} = ? GROUP BY state ORDER BY state`).all(operationID);
}
function exactProofRows(database: Database, secrets: readonly string[]): ProofRow[] {
	const placeholders = secrets.map(() => "?").join(",");
	return database.query<ProofRow, string[]>(`SELECT secret,state,CAST(amount AS INTEGER) AS amount,usedByOperationId,createdByOperationId FROM coco_cashu_proofs WHERE secret IN (${placeholders}) ORDER BY secret`).all(...secrets);
}
function total(rows: readonly Aggregate[], field: "count" | "amount"): number { return rows.reduce((sum, row) => sum+Number(row[field]), 0); }
function proofLineage(values: readonly unknown[], label: string): { canonical: string; digest: string; count: number; amount: number } {
	const tuples = values.map((value, index) => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} proof ${index} is malformed`);
		const proof = value as StoredProof;
		const amount = Number(proof.amount);
		if (typeof proof.id !== "string" || proof.id.length === 0 || !Number.isSafeInteger(amount) || amount <= 0
			|| typeof proof.secret !== "string" || proof.secret.length === 0 || typeof proof.C !== "string" || proof.C.length === 0
			|| proof.witness !== undefined && proof.witness !== null && typeof proof.witness !== "string") {
			throw new Error(`${label} proof ${index} has an invalid immutable tuple`);
		}
		return { Y: Buffer.from(hashToCurve(proof.secret).toBytes(true)).toString("hex"), id: proof.id, amount,
			C: proof.C, witness: proof.witness ?? null };
	}).sort((left, right) => left.Y.localeCompare(right.Y));
	if (new Set(tuples.map((tuple) => tuple.Y)).size !== tuples.length) throw new Error(`${label} proof Ys are not unique`);
	const canonical = JSON.stringify(tuples);
	return { canonical, digest: createHash("sha256").update(canonical).digest("hex"), count: tuples.length,
		amount: tuples.reduce((sum, tuple) => sum+tuple.amount, 0) };
}
async function mintProofStates(secrets: readonly string[]): Promise<MintProofState[]> {
	const Ys = secrets.map((secret) => Buffer.from(hashToCurve(secret).toBytes(true)).toString("hex"));
	if (new Set(Ys).size !== Ys.length) throw new Error("proof state identities are not unique");
	const request = createBoundedMintFetch(5_000);
	const response = await request(`${expectedMint}/v1/checkstate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Ys }) });
	if (!response.ok) throw new Error(`NUT-07 checkstate returned HTTP ${response.status}`);
	const payload = await response.json() as { states?: unknown };
	if (!Array.isArray(payload.states) || payload.states.length !== Ys.length) throw new Error("NUT-07 returned the wrong proof-state count");
	const byY = new Map<string, MintProofState>();
	for (const value of payload.states) {
		if (value === null || typeof value !== "object") throw new Error("NUT-07 returned a malformed state");
		const state = value as Partial<MintProofState>;
		if (typeof state.Y !== "string" || !Ys.includes(state.Y) || !["UNSPENT", "PENDING", "SPENT"].includes(state.state ?? "") || byY.has(state.Y)) {
			throw new Error("NUT-07 returned an unknown, duplicate, or invalid state");
		}
		byY.set(state.Y, state as MintProofState);
	}
	return Ys.map((Y) => byY.get(Y)!);
}

const sender = new Database(senderPath, { readonly: true, strict: true });
const recipient = new Database(recipientPath, { readonly: true, strict: true });
try {
	const sendRows = sender.query<SendRow, [string]>("SELECT id,mintUrl,amount,unit,state,needsSwap,inputProofSecretsJson,outputDataJson,tokenJson FROM coco_cashu_send_operations WHERE id = ?").all(sendID);
	if (sendRows.length !== 1) throw new Error(`expected one send row, got ${sendRows.length}`);
	const send = sendRows[0]!;
	if (send.mintUrl.replace(/\/$/, "") !== expectedMint || send.unit !== "sat" || Number(send.amount) !== expectedAmount
		|| !["pending", "finalized"].includes(send.state)) throw new Error("send operation immutable intent or state mismatch");
	const inputSecrets = parseArray(send.inputProofSecretsJson, "send input proof identities");
	if (!inputSecrets.every((value): value is string => typeof value === "string" && value.length > 0)) throw new Error("send input proof identities are malformed");
	const outputData = parseOutputData(send.outputDataJson, send.needsSwap === 1);
	if (send.tokenJson === null || send.tokenJson.length < 16) throw new Error("send token is not durably recoverable");
	const storedToken = JSON.parse(send.tokenJson) as { mint?: unknown; unit?: unknown; proofs?: unknown };
	if (storedToken === null || typeof storedToken !== "object" || String(storedToken.mint).replace(/\/$/, "") !== expectedMint
		|| (storedToken.unit ?? "sat") !== "sat" || !Array.isArray(storedToken.proofs)) throw new Error("stored send token envelope is malformed");
	const sendLineage = proofLineage(storedToken.proofs, "send token");
	if (sendLineage.amount !== expectedAmount) throw new Error("stored send token amount differs from immutable intent");
	const inputRows = exactProofRows(sender, inputSecrets);
	if (inputRows.length !== inputSecrets.length || new Set(inputRows.map((row) => row.secret)).size !== inputSecrets.length
		|| inputRows.some((row) => row.state !== "spent" || row.usedByOperationId !== null && row.usedByOperationId !== sendID)) {
		throw new Error("send input proof identities are not uniquely persisted and spent");
	}
	const inputMintStates = await mintProofStates(inputSecrets);
	if (inputMintStates.some((state) => state.state !== "SPENT")) throw new Error("NUT-07 does not report every exact send input spent");
	const senderOutputs = aggregate(sender, "createdByOperationId", sendID);
	if (total(senderOutputs, "count") === 0) throw new Error("send outputs are not linked to the operation");
	if (send.needsSwap === 1 && total(senderOutputs, "amount") !== inputRows.reduce((sum, row) => sum+Number(row.amount), 0)) {
		throw new Error("zero-fee send outputs do not preserve the exact selected input amount");
	}
	const sendOwnerRows = sender.query<{ ownerType: string }, [string]>("SELECT ownerType FROM coco_cashu_operation_ids WHERE id = ?").all(sendID);
	if (sendOwnerRows.length !== 1 || sendOwnerRows[0]!.ownerType !== "send") throw new Error("send operation ID ownership is not unique");

	const receiveRows = recipient.query<ReceiveRow, [string]>("SELECT id,mintUrl,amount,unit,state,inputProofsJson,outputDataJson FROM coco_cashu_receive_operations WHERE id = ?").all(receiveID);
	if (receiveRows.length !== 1) throw new Error(`expected one receive row, got ${receiveRows.length}`);
	const receive = receiveRows[0]!;
	if (receive.mintUrl.replace(/\/$/, "") !== expectedMint || receive.unit !== "sat" || Number(receive.amount) !== expectedAmount || receive.state !== "finalized") {
		throw new Error("receive operation immutable intent or state mismatch");
	}
	const receiveInputs = parseArray(receive.inputProofsJson, "receive input proofs");
	const receiveLineage = proofLineage(receiveInputs, "receive input");
	if (receiveLineage.amount !== expectedAmount || receiveLineage.canonical !== sendLineage.canonical) {
		throw new Error("send token and receive input proofs do not have identical canonical lineage");
	}
	const receiveOutputData = parseOutputData(receive.outputDataJson, true)!;
	if (receiveOutputData.keep.length === 0 || receiveOutputData.send.length !== 0) throw new Error("receive output reconstruction plan is not keep-only");
	const recipientOutputs = aggregate(recipient, "createdByOperationId", receiveID);
	if (recipientOutputs.some((row) => row.state !== "ready") || total(recipientOutputs, "amount") !== expectedAmount
		|| total(recipientOutputs, "count") !== receiveOutputData.keep.length) {
		throw new Error("recipient output proofs are not exactly the ready payout amount");
	}
	const recipientOutputSecrets = recipient.query<{ secret: string }, [string]>("SELECT secret FROM coco_cashu_proofs WHERE createdByOperationId = ? ORDER BY secret").all(receiveID).map((row) => row.secret);
	if (recipientOutputSecrets.length !== total(recipientOutputs, "count") || recipientOutputSecrets.some((secret) => typeof secret !== "string" || secret.length === 0)) {
		throw new Error("recipient output proof identities are incomplete");
	}
	const recipientMintStates = await mintProofStates(recipientOutputSecrets);
	if (recipientMintStates.some((state) => state.state !== "UNSPENT")) throw new Error("NUT-07 does not report every exact recipient output unspent");
	const receiveOwnerRows = recipient.query<{ ownerType: string }, [string]>("SELECT ownerType FROM coco_cashu_operation_ids WHERE id = ?").all(receiveID);
	if (receiveOwnerRows.length !== 1 || receiveOwnerRows[0]!.ownerType !== "receive") throw new Error("receive operation ID ownership is not unique");

	const evidence = {
		schema: "PlebeianFridayOperationAuditV1",
		observed_at: new Date().toISOString(), mint_url: expectedMint, amount: expectedAmount,
		send: { operation_id: send.id, rows: sendRows.length, state: send.state, input_identity_count: inputSecrets.length,
			input_proofs: { count: inputRows.length, amount: inputRows.reduce((sum, row) => sum+Number(row.amount), 0),
				states: { spent: inputRows.filter((row) => row.state === "spent").length },
				operation_links_retained: inputRows.filter((row) => row.usedByOperationId === sendID).length,
				operation_links_released_after_finalization: inputRows.filter((row) => row.usedByOperationId === null).length },
			created_outputs: senderOutputs, durable_token_present: true, owner_rows: sendOwnerRows.length,
			duplicate_operation_rows: sendRows.length-1, mint_input_states: { SPENT: inputMintStates.length },
			stored_swap_reconstruction_outputs: outputData === null ? 0 : outputData.keep.length+outputData.send.length,
			bearer_safe_token_sha256: createHash("sha256").update(send.tokenJson).digest("hex") },
		receive: { operation_id: receive.id, rows: receiveRows.length, state: receive.state,
			created_outputs: recipientOutputs, reconstruction_outputs: receiveOutputData.keep.length,
			owner_rows: receiveOwnerRows.length, duplicate_operation_rows: receiveRows.length-1,
			mint_output_states: { UNSPENT: recipientMintStates.length } },
		assertions: { immutable_identity: true, inputs_spent_in_coco_and_mint: true, outputs_linked_and_unspent_at_mint: true,
			recipient_owns_exact_amount: true, no_duplicate_operation_rows: true,
			send_receive_proof_lineage_equal: true, proof_lineage_sha256: sendLineage.digest, proof_lineage_count: sendLineage.count },
	};
	const file = await open(evidencePath, "wx", 0o600);
	try { await file.writeFile(JSON.stringify(evidence, null, 2)+"\n"); } finally { await file.close(); }
	console.log(`friday-operation-audit: PASS; evidence ${evidencePath}`);
} finally {
	sender.close(); recipient.close();
}
