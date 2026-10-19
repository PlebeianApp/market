import type { WalletCommandRunner } from "../../ts/wallet-command.ts";
import {
  DEMO_AUTH_BID_KIND, DEMO_AUTH_MAX_INTEGER, DEMO_AUTH_PROFILE, DemoFreshBidGuard,
  TEST_ONLY_LABEL, TEST_UNIT_LABEL, canonicalBidCommand, canonicalIntentV1,
  demoIntentIdentifiers, parseBidAmount, parseCanonicalBidInteger, parseDemoAuthUiConfig, parseStrictJSON,
  validateProofProjection, verifySignedBidTemplate,
  type DemoAuthUiConfig, type DemoFundingApproval, type DemoProofProjection,
  type DemoSignedEvent, type DemoUnsignedEvent,
} from "../../ts/demo-auth-bid.ts";
import { DemoAuthBidStore, type DemoBidIntentRecord, type DemoBidPublicRecord } from "../../plugins/demo-auth-bid-store.ts";
import { createDemoPaymentApproval, type DemoPaymentBatchResult, type DemoPaymentPersistence } from "../../plugins/demo-payment-coordinator.ts";
import {
	computeCommittedAuctionBatchHistorySha256,
  decodeCommittedBidBatch,
  type CommittedAuctionBatchV2, type CommittedBidBatch, type CommittedBidConsumerPorts,
  type DurableWalletBidJoinStore, type WalletBidJoinV1,
} from "../../plugins/committed-bid-consumer.ts";
import type { DemoAuthenticatedPaymentCommitmentsV1, VerifiedDemoAuthenticatedHandoff } from "../../plugins/demo-certified-closure.ts";

export interface DemoBridgeStatus {
  readonly profile: "DEMO_AUTH_V1"; readonly network_id: string; readonly chain_id: string;
  readonly auction_id: string; readonly base_end: number; readonly latest_committed_height: number;
  readonly latest_app_hash: string; readonly latest_committed_pbts_seconds: number;
  readonly fresh_slots_used: number; readonly session_submission_cap: number;
  readonly accepted_bid_count: number; readonly committed_leader_amount: number;
}
export interface BidSlotReservationV1 {
  readonly schema: "BidSlotReservationV1"; readonly slot: number; readonly reservation_id: string;
  readonly profile: "DEMO_AUTH_V1"; readonly actor_pubkey: string; readonly auction_id: string;
  readonly operation_id: string; readonly bid_id: string; readonly amount: number; readonly intent_digest: string;
}
export interface DemoAuthBridge {
  status(): Promise<DemoBridgeStatus>;
  reserve(input: Omit<BidSlotReservationV1, "schema" | "slot" | "reservation_id">): Promise<BidSlotReservationV1>;
  submit(event: DemoSignedEvent): Promise<void>;
  batches(afterHeight: number, limit: number): Promise<readonly CommittedBidBatch[]>;
}
export interface DemoSigner { signEvent(event: DemoUnsignedEvent): Promise<DemoSignedEvent>; }
export interface DemoBidProjection { readonly proofs: readonly DemoProofProjection[]; readonly projectedLockFee: number; readonly projectedRefundFee: number; }
export interface DemoAuthenticatedPaymentHandoffPort {
  verifyExact(batches: readonly CommittedAuctionBatchV2[]): Promise<VerifiedDemoAuthenticatedHandoff>;
}
export interface DemoAuthenticatedPaymentCoordinatorPort {
  processVerifiedBatches(
    batches: readonly CommittedAuctionBatchV2[],
    expected: DemoAuthenticatedPaymentCommitmentsV1,
  ): Promise<DemoPaymentBatchResult>;
}
export interface DemoProfilePorts {
  readonly runner: WalletCommandRunner; readonly signer: DemoSigner; readonly store: DemoAuthBidStore;
  readonly bridge: DemoAuthBridge; readonly joins: DurableWalletBidJoinStore;
  readonly consumer: CommittedBidConsumerPorts;
  readonly project: (amount: number) => Promise<DemoBidProjection>;
  readonly newLockTarget: () => Promise<{ readonly path: string; readonly childPubkey: string }>;
  readonly fundOnce?: (explicitAmount: number) => Promise<void>;
  readonly payments?: Pick<DemoPaymentPersistence, "saveApproval" | "readApproval">;
  readonly paymentCoordinator?: DemoAuthenticatedPaymentCoordinatorPort;
  readonly authenticatedPaymentHandoff?: DemoAuthenticatedPaymentHandoffPort;
}

export interface DemoAuthRuntimeBindings {
  readonly fundingApproval?: DemoFundingApproval;
  readonly profiles: Readonly<Record<string, DemoProfilePorts>>;
}

let runtimeBindings: DemoAuthRuntimeBindings | undefined;
export function bindDemoAuthRuntimeBindings(bindings: DemoAuthRuntimeBindings): void {
  if (runtimeBindings !== undefined && runtimeBindings !== bindings) throw new Error("demo-auth-runtime-already-bound");
  runtimeBindings = bindings;
}
export function getDemoAuthRuntimeBindings(): DemoAuthRuntimeBindings | undefined { return runtimeBindings; }

const HEX_64 = /^[0-9a-f]{64}$/;
const eventFor = (config: DemoAuthUiConfig, actor: string, createdAt: number, validUntil: number, content: string): DemoUnsignedEvent => ({
  pubkey: actor, created_at: createdAt, kind: DEMO_AUTH_BID_KIND,
  tags: [["protocol", "plebeian-auction-auth-demo"], ["version", "1"], ["environment", config.authNetworkId], ["valid_until", String(validUntil)]],
  content,
});

export function createFetchDemoBridge(basePath: string, options: { readonly fetchImpl: typeof fetch; readonly pageUrl: string }): DemoAuthBridge {
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(basePath) || basePath.slice(1).split("/").some((segment) => segment === "." || segment === "..")) throw new Error("demo-auth-bridge-base");
  let page: URL;
  try { page = new URL(options.pageUrl); } catch { throw new Error("demo-auth-bridge-page-origin"); }
  if (!(["http:", "https:"] as const).includes(page.protocol as "http:" | "https:") || page.username !== "" || page.password !== "") throw new Error("demo-auth-bridge-page-origin");
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    if (!/^\/(?:status|bid-slots|bids|batches(?:\?after_height=[0-9]+&limit=[0-9]+)?)$/.test(path)) throw new Error("demo-auth-bridge-path");
    const target = new URL(`${basePath}${path}`, page.origin);
    if (target.origin !== page.origin || !target.pathname.startsWith(`${basePath}/`) || target.hash !== "") throw new Error("demo-auth-bridge-origin");
    const response = await options.fetchImpl(target.href, { ...init, redirect: "error" });
    if (response.status >= 300 && response.status < 400 || response.type === "opaqueredirect" || response.redirected) throw new Error("demo-auth-bridge-redirect");
    if (response.url === "") throw new Error("demo-auth-bridge-final-url");
    let finalUrl: URL;
    try { finalUrl = new URL(response.url); } catch { throw new Error("demo-auth-bridge-final-url"); }
    if (finalUrl.href !== target.href || finalUrl.origin !== page.origin || finalUrl.username !== "" || finalUrl.password !== "") throw new Error("demo-auth-bridge-origin");
    if (!response.ok) throw new Error(`demo-auth-bridge-${response.status}`);
    try { return parseStrictJSON(await response.text()) as T; } catch { throw new Error("demo-auth-bridge-json"); }
  };
  return {
    status: () => call("/status"),
    reserve: (input) => call("/bid-slots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
    async submit(event) { await call("/bids", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) }); },
    async batches(afterHeight, limit) {
      const value = await call<{ readonly batches?: readonly unknown[] }>(`/batches?after_height=${afterHeight}&limit=${limit}`);
      if (!Array.isArray(value.batches)) throw new Error("demo-auth-batches-shape");
      return value.batches.map((batch) => decodeCommittedBidBatch(JSON.stringify(batch)));
    },
  };
}

export function refundEligibility(input: { readonly committedEligible: boolean; readonly pbtsSeconds: number; readonly locktime: number; readonly finalLeader: boolean }): { readonly allowed: boolean; readonly state: "leading" | "outbid_refundable_at" | "cleanup_pending" } {
  if (input.finalLeader) return { allowed: false, state: input.pbtsSeconds >= input.locktime + 30 ? "cleanup_pending" : "leading" };
  if (!input.committedEligible) return { allowed: false, state: "leading" };
  return { allowed: input.pbtsSeconds >= input.locktime + 30, state: "outbid_refundable_at" };
}

export async function processAuthenticatedPaymentBatches(input: {
  readonly config: Pick<DemoAuthUiConfig, "authNetworkId" | "chainId" | "auctionId" | "sellerP2pkXpub">;
  readonly batches: readonly CommittedAuctionBatchV2[];
  readonly handoff?: DemoAuthenticatedPaymentHandoffPort;
  readonly coordinator: DemoAuthenticatedPaymentCoordinatorPort;
}): Promise<void> {
  const closures = input.batches.flatMap((batch) => batch.closures).filter((closure) => closure.auction_id === input.config.auctionId);
  if (closures.length === 0) return;
  if (closures.length !== 1) throw new Error("demo-auth-authenticated-handoff-closure-conflict");
  if (input.handoff === undefined) throw new Error("demo-auth-authenticated-handoff-unavailable");
  const verified = await input.handoff.verifyExact(input.batches);
  const canonicalBatchHistorySha256 = await computeCommittedAuctionBatchHistorySha256(input.batches);
  const closure = closures[0]!; const certificate = verified.closure.certificate; const agreement = verified.agreement;
  const bids = input.batches.flatMap((batch) => batch.bids).filter((bid) => bid.auction_id === input.config.auctionId);
  const bidCount = bids.length;
  const winningBids = closure.close_outcome === "winner" ? bids.filter((bid) => bid.bid_id === closure.winner_bid_id && bid.operation_id === closure.winner_operation_id && bid.actor_id === closure.winner_actor_id && bid.amount === closure.amount) : [];
  if (verified.paymentExecutionVerified !== false || verified.settlementVerified !== false || verified.approvalLifetimePolicyVerified !== true
    || verified.rawSignedEventsVerified !== bidCount || verified.bidderPaymentApprovalsVerified !== bidCount
    || verified.paymentCommitments.schema !== "DemoAuthenticatedPaymentCommitmentsV1"
    || verified.paymentCommitments.canonicalBatchHistorySha256 !== canonicalBatchHistorySha256
    || !HEX_64.test(verified.paymentCommitments.verifiedApprovalSetSha256)
    || JSON.stringify(agreement.claimed_slots) !== "[1,2,3,4]"
    || agreement.agreement !== true || agreement.authenticated_run_verified !== true || agreement.nostr_signatures_verified !== true || agreement.collector_provenance_verified !== false
    || agreement.auth_network_id !== input.config.authNetworkId || agreement.chain_id !== input.config.chainId || agreement.auction_id !== input.config.auctionId
    || certificate.auth_network_id !== input.config.authNetworkId || certificate.chain_id !== input.config.chainId || certificate.auction_id !== input.config.auctionId
    || certificate.seller_p2pk_xpub !== input.config.sellerP2pkXpub
    || agreement.target_height !== closure.height || agreement.target_app_hash !== closure.app_hash
    || certificate.close_height !== closure.height || certificate.close_time !== closure.pbts_seconds || certificate.app_hash !== closure.app_hash
    || certificate.outcome !== closure.close_outcome
    || certificate.winner_bid_id !== (closure.winner_bid_id || null)
    || certificate.winner_operation_id !== (closure.winner_operation_id || null)
    || certificate.winner_actor_id !== (closure.winner_actor_id || null)
    || certificate.winner_amount !== (closure.amount || null)
    || (closure.close_outcome === "winner" && (winningBids.length !== 1 || certificate.winner_event_id !== winningBids[0]!.event_id))
    || (closure.close_outcome === "no_bids" && bidCount !== 0)
    || (closure.close_outcome === "reserve_not_met" && bidCount === 0)) throw new Error("demo-auth-authenticated-handoff-conflict");
  await input.coordinator.processVerifiedBatches(input.batches, verified.paymentCommitments);
}

function exactBalance(value: Awaited<ReturnType<WalletCommandRunner["balance"]>>): void {
  for (const field of [value.available, value.reserved, value.locked, value.pending, value.unresolved, value.total]) if (!Number.isSafeInteger(field) || field < 0) throw new Error("demo-auth-wallet-balance-invalid");
  if (value.available + value.reserved + value.locked + value.pending + value.unresolved !== value.total) throw new Error("demo-auth-wallet-balance-inconsistent");
}

function projectionIdentity(proofs: readonly DemoProofProjection[]): string {
  const amount = proofs.reduce((sum, proof) => sum + proof.amount, 0);
  return JSON.stringify(validateProofProjection(amount, proofs).map(({ amount: value, keysetId, inputFeePpk, reservationId }) => ({ amount: value, keysetId, inputFeePpk, reservationId })));
}

export class DemoAuthBidController {
  private mutating = false;
  private readonly profile: DemoAuthUiConfig["profiles"][number];
  constructor(readonly config: DemoAuthUiConfig, readonly profileId: string, private readonly ports: DemoProfilePorts, private readonly guard = new DemoFreshBidGuard()) {
    const profile = config.profiles.find((entry) => entry.profileId === profileId);
    if (profile === undefined || ports.runner.applicationId !== "plebeian-market" || ports.runner.account.accountId !== profile.accountId || ports.store.namespace !== profile.storageNamespace) throw new Error("demo-auth-profile-binding-mismatch");
    this.profile = profile;
  }
  private assertStatus(status: DemoBridgeStatus): void {
    if (status.profile !== DEMO_AUTH_PROFILE || status.network_id !== this.config.authNetworkId || status.chain_id !== this.config.chainId || status.auction_id !== this.config.auctionId || status.base_end !== this.config.baseEnd || status.session_submission_cap !== this.config.sessionSubmissionCap || !Number.isSafeInteger(status.latest_committed_height) || status.latest_committed_height < 1 || !HEX_64.test(status.latest_app_hash) || !Number.isSafeInteger(status.latest_committed_pbts_seconds) || status.latest_committed_pbts_seconds < 1 || status.latest_committed_pbts_seconds > DEMO_AUTH_MAX_INTEGER || !Number.isSafeInteger(status.committed_leader_amount) || status.committed_leader_amount < 0 || !Number.isSafeInteger(status.fresh_slots_used) || status.fresh_slots_used < 0 || status.fresh_slots_used > status.session_submission_cap || !Number.isSafeInteger(status.accepted_bid_count) || status.accepted_bid_count < 0 || status.accepted_bid_count > 64 || status.accepted_bid_count > status.fresh_slots_used) throw new Error("demo-auth-bridge-domain-drift");
  }
  private async status(): Promise<DemoBridgeStatus> { const status = await this.ports.bridge.status(); this.assertStatus(status); return status; }
  async publicRecords(): Promise<readonly DemoBidPublicRecord[]> { return this.ports.store.listPublic(); }
  async displayBalances(): Promise<{ available: number; locked: number; refund_eligible_locked: number; refunded: number }> {
    const [balance, records] = await Promise.all([this.ports.runner.balance(), this.ports.store.listPublic()]); exactBalance(balance);
    const mine = records.filter((record) => record.profileId === this.profileId);
    const eligible = mine.filter((record) => record.state === "outbid_refundable_at" || record.state === "recovering_refund").reduce((sum, record) => sum + record.amount, 0);
    const refunded = mine.filter((record) => record.state === "rolled_back").reduce((sum, record) => sum + record.amount, 0);
    if (!Number.isSafeInteger(eligible) || !Number.isSafeInteger(refunded) || eligible > balance.locked) throw new Error("demo-auth-wallet-balance-inconsistent");
    return { available: balance.available, locked: balance.locked - eligible, refund_eligible_locked: eligible, refunded };
  }
  async pendingOperations(): Promise<readonly string[]> {
    return (await this.ports.store.listPublic()).filter((record) => record.profileId === this.profileId && ["locking", "lock_verified", "awaiting_signature"].includes(record.state)).map((record) => record.operationId);
  }
  async fundOnce(rawAmount: string): Promise<void> {
    const fundOnce = this.ports.fundOnce;
    if (!this.config.funding.usable || fundOnce === undefined) throw new Error("demo-auth-funding-disabled");
    if (this.mutating) throw new Error("demo-auth-wallet-mutation-in-flight"); this.mutating = true;
    try { await this.ports.store.withProfileMutation(async () => {
      const approved = this.config.funding.profiles.find((entry) => entry.profileId === this.profileId); if (approved === undefined) throw new Error("demo-auth-funding-disabled");
      const explicitAmount = parseCanonicalBidInteger(rawAmount); if (!approved.approvedAmounts.includes(explicitAmount)) throw new Error("demo-auth-funding-amount-not-approved");
      const before = await this.ports.runner.balance(); exactBalance(before); if (before.reserved !== 0 || before.locked !== 0 || before.pending !== 0 || before.unresolved !== 0 || before.total !== before.available) throw new Error("demo-auth-funding-existing-balance");
      await fundOnce(explicitAmount);
      const after = await this.ports.runner.balance(); exactBalance(after);
      if (!Number.isSafeInteger(before.available + explicitAmount) || after.available !== before.available + explicitAmount || after.total !== before.total + explicitAmount || after.reserved !== 0 || after.locked !== 0 || after.pending !== 0 || after.unresolved !== 0) throw new Error("demo-auth-funding-readback");
    }); } finally { this.mutating = false; }
  }
  async synchronize(): Promise<readonly DemoBidIntentRecord[]> {
    if (this.mutating) throw new Error("demo-auth-wallet-mutation-in-flight"); this.mutating = true;
    try { const status = await this.status(); return await this.synchronizeHeld(status); } finally { this.mutating = false; }
  }
  async refundOutbid(operationId: string): Promise<DemoBidIntentRecord> {
	void operationId;
	throw new Error("demo-auth-refund-owned-by-automatic-payment");
  }
  async placeBid(rawAmount: string, confirmFresh: boolean, retryOperationId?: string): Promise<DemoBidIntentRecord> {
    if (this.mutating) throw new Error("demo-auth-wallet-mutation-in-flight"); this.mutating = true;
    try { return await this.ports.store.withProfileMutation(async () => {
      const status = await this.status();
      if (retryOperationId !== undefined) {
        await this.synchronizeHeld(status);
        const prior = await this.ports.store.readLocal(retryOperationId); if (prior === null || prior.profileId !== this.profileId) throw new Error("demo-auth-retry-missing");
        if (["committed", "leading", "outbid_refundable_at", "recovering_refund", "rolled_back", "cleanup_pending", "attention_required", "submitted"].includes(prior.state)) return prior;
        return this.resume(prior, status);
      }
      if (!confirmFresh) throw new Error("demo-auth-fresh-confirmation-required");
      const parsed = parseCanonicalBidInteger(rawAmount);
      const [balance, projection, records] = await Promise.all([this.ports.runner.balance(), this.ports.project(parsed), this.ports.store.listLocal()]); exactBalance(balance);
      const amount = parseBidAmount(rawAmount, this.config.startingBid, status.committed_leader_amount, balance.available, projection.projectedLockFee, projection.projectedRefundFee);
      validateProofProjection(amount, projection.proofs);
      if (records.some((record) => record.profileId === this.profileId && record.observedHeight === status.latest_committed_height)) throw new Error("demo-auth-profile-height-cap");
      const release = this.guard.begin(this.profileId, status.latest_committed_height);
      try {
        const target = await this.ports.newLockTarget();
        const canonical = canonicalIntentV1({ authNetworkId: this.config.authNetworkId, actorPubkey: this.profile.signerPubkey, auctionId: this.config.auctionId, amount, mintUrl: this.config.mintUrl, sellerP2pkXpub: this.config.sellerP2pkXpub, locktime: this.config.locktime, childPubkey: target.childPubkey });
        const ids = await demoIntentIdentifiers(canonical);
        const stored = await this.ports.store.createOrGet({ schema: "DemoAuthBidIntentV1", profileId: this.profileId, auctionId: this.config.auctionId, operationId: ids.operationId, bidId: ids.bidId, intentDigest: ids.intentDigest, canonicalIntent: canonical, amount, observedHeight: status.latest_committed_height, childPubkey: target.childPubkey, path: target.path });
        return await this.resume(stored.record, status, projection.proofs);
      } finally { release(); }
    }); } finally { this.mutating = false; }
  }
  private assertReservation(input: Omit<BidSlotReservationV1, "schema" | "slot" | "reservation_id">, output: BidSlotReservationV1): void {
    if (output.schema !== "BidSlotReservationV1" || !Number.isSafeInteger(output.slot) || output.slot < 1 || output.slot > this.config.sessionSubmissionCap || !HEX_64.test(output.reservation_id) || output.profile !== input.profile || output.actor_pubkey !== input.actor_pubkey || output.auction_id !== input.auction_id || output.operation_id !== input.operation_id || output.bid_id !== input.bid_id || output.amount !== input.amount || output.intent_digest !== input.intent_digest) throw new Error("demo-auth-slot-response-conflict");
  }
  private async resume(record: DemoBidIntentRecord, status: DemoBridgeStatus, preflight?: readonly DemoProofProjection[]): Promise<DemoBidIntentRecord> {
    const slotInput = { profile: DEMO_AUTH_PROFILE, actor_pubkey: this.profile.signerPubkey, auction_id: record.auctionId, operation_id: record.operationId, bid_id: record.bidId, amount: record.amount, intent_digest: record.intentDigest } as const;
    this.assertReservation(slotInput, await this.ports.bridge.reserve(slotInput));
    let current = record;
    if (current.state === "locking") {
      await this.ports.runner.run({ commandId: current.operationId, applicationId: this.ports.runner.applicationId, operationKind: "auctions.bid-lock", account: this.ports.runner.account, money: { mintUrl: this.config.mintUrl, unit: "sat", amount: current.amount }, intentFingerprint: current.intentDigest });
      const evidence = await this.lockEvidence(current); const actual = this.evidenceProjection(evidence);
      if (preflight !== undefined && projectionIdentity(preflight) !== projectionIdentity(actual)) throw new Error("demo-auth-projection-drift");
      current = await this.ports.store.transition(current.operationId, current.revision, "lock_verified");
    }
    if (current.unsignedEvent === undefined) {
      const evidence = await this.lockEvidence(current); const content = canonicalBidCommand(current.operationId, current.auctionId, current.bidId, current.amount, this.evidenceProjection(evidence));
      const createdAt = status.latest_committed_pbts_seconds; if (createdAt > DEMO_AUTH_MAX_INTEGER - 300) throw new Error("demo-auth-pbts-overflow");
      current = await this.ports.store.transition(current.operationId, current.revision, "awaiting_signature", { unsignedEvent: eventFor(this.config, this.profile.signerPubkey, createdAt, createdAt + 300, content) });
    }
    if (current.signedEvent === undefined) {
      const signed = await this.ports.signer.signEvent(current.unsignedEvent!); await verifySignedBidTemplate(current.unsignedEvent!, signed);
      current = await this.ports.store.transition(current.operationId, current.revision, "awaiting_signature", { signedEvent: signed });
    }
    const evidence = await this.lockEvidence(current);
    if (this.ports.payments !== undefined) {
      const prior = await this.ports.payments.readApproval({ authNetworkId: this.config.authNetworkId, chainId: this.config.chainId, auctionId: this.config.auctionId, operationId: current.operationId });
      if (prior === null) await this.ports.payments.saveApproval(await createDemoPaymentApproval({ config: this.config, record: current, conditionFingerprint: evidence.conditionFingerprint, signer: this.ports.signer }));
      else if (prior.operationId !== current.operationId || prior.bidId !== current.bidId || prior.bidEventId !== current.signedEvent!.id || prior.bidderActorId !== current.signedEvent!.pubkey || prior.amount !== current.amount || prior.conditionFingerprint !== evidence.conditionFingerprint || prior.sellerRecipient !== current.childPubkey) throw new Error("demo-payment-approval-conflict");
    }
    await this.ports.joins.save(this.walletJoin(current, evidence));
    if (!current.submissionAttempted) current = await this.ports.store.transition(current.operationId, current.revision, current.state, { submissionAttempted: true });
    await this.ports.bridge.submit(current.signedEvent!);
    return this.ports.store.transition(current.operationId, current.revision, "submitted");
  }
  private async lockEvidence(record: DemoBidIntentRecord) {
    const evidence = await this.ports.runner.demoLockEvidence(record.operationId);
    if (evidence === null || evidence.mintUrl !== this.config.mintUrl || evidence.unit !== "sat" || evidence.locktime !== this.config.locktime || evidence.totalAmount !== record.amount || !HEX_64.test(evidence.conditionFingerprint) || !Number.isSafeInteger(evidence.authorityGeneration) || evidence.authorityGeneration < 0) throw new Error("demo-auth-lock-evidence-missing");
    return evidence;
  }
  private evidenceProjection(evidence: NonNullable<Awaited<ReturnType<WalletCommandRunner["demoLockEvidence"]>>>): readonly DemoProofProjection[] {
    return validateProofProjection(evidence.totalAmount, evidence.proofs.map((proof) => ({ amount: proof.amount, keysetId: proof.keysetId, amountKey: "dleq-verified-active-key", inputFeePpk: proof.inputFeePpk, reservationId: proof.reservationId, active: true })));
  }
  private walletJoin(record: DemoBidIntentRecord, evidence: NonNullable<Awaited<ReturnType<WalletCommandRunner["demoLockEvidence"]>>>): WalletBidJoinV1 {
    if (record.signedEvent === undefined) throw new Error("demo-auth-signed-event-missing");
    return { authNetworkId: this.config.authNetworkId, actorId: this.profile.signerPubkey, operationId: record.operationId, auctionId: record.auctionId, bidId: record.bidId, eventId: record.signedEvent.id, originalSendOperationId: record.operationId, mintUrl: evidence.mintUrl, unit: "sat", testAmount: record.amount, publicCommitments: evidence.proofs.map((proof) => proof.reservationId), conditionFingerprint: evidence.conditionFingerprint, locktime: evidence.locktime, authorityGeneration: evidence.authorityGeneration };
  }
  private async readBatches(afterHeight: number): Promise<readonly CommittedBidBatch[]> {
    const batches: CommittedBidBatch[] = []; let cursor = Math.max(0, afterHeight);
    const pageLimit = 16; const maxPages = Math.ceil(this.config.sessionSubmissionCap / pageLimit) + 1;
    for (let page = 0; page < maxPages; page += 1) {
      const next = await this.ports.bridge.batches(cursor, pageLimit);
      for (const batch of next) {
        if (batch.auth_network_id !== this.config.authNetworkId || (batch.schema === "CommittedAuctionBatchV2" && batch.chain_id !== this.config.chainId) || batch.height <= cursor) throw new Error("demo-auth-committed-batch-domain-drift");
        cursor = batch.height; batches.push(batch);
      }
      if (next.length < pageLimit) return batches;
    }
    throw new Error("demo-auth-committed-batch-page-limit");
  }
  private exactEntry(record: DemoBidIntentRecord, entry: CommittedBidBatch["bids"][number]): boolean {
    if (entry.operation_id !== record.operationId) return false;
    if (record.signedEvent === undefined || entry.actor_id !== this.profile.signerPubkey || entry.auction_id !== record.auctionId || entry.bid_id !== record.bidId || entry.event_id !== record.signedEvent.id || entry.amount !== record.amount) throw new Error("demo-auth-committed-bid-conflict");
    return true;
  }
  private isExactDisplacement(record: DemoBidIntentRecord, entry: CommittedBidBatch["bids"][number]): boolean {
    const mentions = entry.displaced_operation_id === record.operationId || entry.displaced_bid_id === record.bidId || entry.displaced_event_id === record.signedEvent?.id;
    if (!mentions) return false;
    if (!entry.displaced_refund_eligible || entry.displaced_actor_id !== this.profile.signerPubkey || entry.displaced_operation_id !== record.operationId || entry.displaced_bid_id !== record.bidId || entry.displaced_event_id !== record.signedEvent?.id || entry.auction_id !== record.auctionId) throw new Error("demo-auth-displacement-conflict");
    return true;
  }
  private async synchronizeHeld(status: DemoBridgeStatus): Promise<readonly DemoBidIntentRecord[]> {
    const initial = (await this.ports.store.listLocal()).filter((record) => record.profileId === this.profileId);
    if (initial.length === 0) return [];
    const batches = await this.readBatches(Math.min(...initial.map((record) => record.observedHeight)) - 1);
    for (const original of initial) {
      let record = await this.ports.store.readLocal(original.operationId); if (record === null || record.signedEvent === undefined) continue;
      for (const batch of batches) {
        if (batch.bids.some((entry) => this.exactEntry(record!, entry)) && record.committedHeight === undefined) {
          if (["awaiting_signature", "submitted", "attention_required"].includes(record.state)) record = await this.ports.store.transition(record.operationId, record.revision, "committed", { committedHeight: batch.height, committedAppHash: batch.app_hash });
          if (record.state === "committed") record = await this.ports.store.transition(record.operationId, record.revision, "leading");
        }
        if (batch.bids.some((entry) => this.isExactDisplacement(record!, entry)) && !["rolled_back", "recovering_refund", "outbid_refundable_at"].includes(record.state)) {
          if (record.committedHeight === undefined) throw new Error("demo-auth-acceptance-batch-missing");
          if (record.state === "committed") record = await this.ports.store.transition(record.operationId, record.revision, "leading");
          if (record.state === "leading") record = await this.ports.store.transition(record.operationId, record.revision, "outbid_refundable_at", { refundEligibleAt: this.config.locktime + 30 });
        }
      }
      if (record.state === "leading" && status.latest_committed_pbts_seconds >= this.config.locktime + 30) record = await this.ports.store.transition(record.operationId, record.revision, "cleanup_pending");
      const validUntil = Number(record.unsignedEvent?.tags[3]?.[1]);
      if (record.state === "awaiting_signature" && record.submissionAttempted && Number.isSafeInteger(validUntil) && status.latest_committed_pbts_seconds >= validUntil) await this.ports.store.transition(record.operationId, record.revision, "attention_required");
    }
    if (this.ports.paymentCoordinator !== undefined) {
      const paymentHistory = await this.readBatches(0);
      const automatic = paymentHistory.filter((batch): batch is CommittedAuctionBatchV2 => batch.schema === "CommittedAuctionBatchV2");
      if (automatic.length > 0) await processAuthenticatedPaymentBatches({ config: this.config, batches: automatic, handoff: this.ports.authenticatedPaymentHandoff, coordinator: this.ports.paymentCoordinator });
    }
    return (await this.ports.store.listLocal()).filter((record) => record.profileId === this.profileId);
  }
}

const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export function mountDemoAuth(options: { readonly document: Document; readonly rawConfig: string; readonly fundingApproval?: DemoFundingApproval; readonly profiles?: Readonly<Record<string, DemoProfilePorts>>; readonly disabledReason?: string }): readonly DemoAuthBidController[] {
  const config = parseDemoAuthUiConfig(options.rawConfig, options.fundingApproval); const region = options.document.getElementById("auctions-region"); if (region === null) throw new Error("demo-auth-region-missing");
  if (options.profiles !== undefined && (Object.keys(options.profiles).length !== 5 || config.profiles.some((profile) => options.profiles?.[profile.profileId] === undefined))) throw new Error("demo-auth-five-profile-bindings-required");
  region.innerHTML = `<section class="section" id="demo-auth"><p class="eyebrow">${TEST_ONLY_LABEL}</p><h1>Five-maintainer authenticated auction demo</h1><p>${TEST_UNIT_LABEL}</p><p>Fresh slots: configured cap ${config.sessionSubmissionCap}. Funding ${config.funding.usable ? "is explicitly approved for this run" : "is disabled"}. No authenticated Close is available.</p><div class="grid">${config.profiles.map((profile) => `<article class="card" data-demo-profile="${esc(profile.profileId)}"><h2>${esc(profile.profileId)}</h2><dl><dt>available</dt><dd data-balance="available">—</dd><dt>locked</dt><dd data-balance="locked">—</dd><dt>refund_eligible_locked</dt><dd data-balance="refund_eligible_locked">—</dd><dt>refunded</dt><dd data-balance="refunded">—</dd></dl>${config.funding.usable ? `<label>Exact approved funding amount <input data-demo-fund-amount="${esc(profile.profileId)}" inputmode="numeric" pattern="[1-9][0-9]*"></label><button type="button" data-demo-fund="${esc(profile.profileId)}" ${options.profiles?.[profile.profileId]?.fundOnce === undefined ? "disabled" : ""}>Fund explicit approved amount once</button>` : ""}<form data-demo-bid="${esc(profile.profileId)}"><label>Bid amount <input name="amount" inputmode="numeric" pattern="[1-9][0-9]*"></label><button type="submit" ${options.profiles?.[profile.profileId] === undefined ? "disabled" : ""}>Confirm fresh Bid</button><p data-demo-status>${options.profiles?.[profile.profileId] === undefined ? `attention_required — ${esc(options.disabledReason ?? `isolated wallet/signer binding absent for ${profile.profileId}`)}` : "funded — enter a balance-backed integer"}</p></form></article>`).join("")}</div></section>`;
  const guard = new DemoFreshBidGuard();
  const controllers = config.profiles.flatMap((profile) => { const ports = options.profiles?.[profile.profileId]; return ports === undefined ? [] : [new DemoAuthBidController(config, profile.profileId, ports, guard)]; });
  for (const controller of controllers) {
    const form = region.querySelector(`form[data-demo-bid="${controller.profileId}"]`) as HTMLFormElement; const card = form.closest("article")!;
    const paint = () => void controller.synchronize().catch((error) => { (form.querySelector("[data-demo-status]") as HTMLElement).textContent = `attention_required — ${error instanceof Error ? error.message : String(error)}`; return []; }).then(() => Promise.all([controller.displayBalances(), controller.pendingOperations()] as const)).then(([balance, pending]) => {
      for (const name of ["available", "locked", "refund_eligible_locked", "refunded"] as const) (card.querySelector(`[data-balance="${name}"]`) as HTMLElement).textContent = String(balance[name]);
      card.querySelectorAll("[data-demo-recover],[data-demo-refund]").forEach((node) => node.remove());
      for (const operationId of pending) { const button = options.document.createElement("button"); button.type = "button"; button.dataset.demoRecover = operationId; button.textContent = `Recover stored operation ${operationId}`; button.addEventListener("click", () => { const status = form.querySelector("[data-demo-status]")!; status.textContent = "recovering"; void controller.placeBid("", false, operationId).then((record) => { status.textContent = record.state; paint(); }, (error) => { status.textContent = `attention_required — ${error instanceof Error ? error.message : String(error)}`; }); }); card.append(button); }
    });
    paint();
    const fund = region.querySelector(`[data-demo-fund="${controller.profileId}"]`); fund?.addEventListener("click", () => { const status = form.querySelector("[data-demo-status]")!; const amount = region.querySelector(`[data-demo-fund-amount="${controller.profileId}"]`) as HTMLInputElement | null; status.textContent = "funding"; void controller.fundOnce(amount?.value ?? "").then(() => { status.textContent = "funded"; paint(); }, (error) => { status.textContent = `attention_required — ${error instanceof Error ? error.message : String(error)}`; }); });
    form.addEventListener("submit", (event) => { event.preventDefault(); const status = form.querySelector("[data-demo-status]")!; const amount = String(new FormData(form).get("amount") ?? ""); status.textContent = "locking"; void controller.placeBid(amount, true).then((record) => { status.textContent = record.state; paint(); }, (error) => { status.textContent = `attention_required — ${error instanceof Error ? error.message : String(error)}`; }); });
  }
  return controllers;
}
