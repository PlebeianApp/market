import { describe, expect, test } from "bun:test";

import { FridayCustodyLedger, FridayWalletSerializers } from "./friday-ledger";

const A = "11".repeat(32);
const B = "22".repeat(32);

function proposal(id: string, amount: number, overrides: Partial<Parameters<FridayCustodyLedger["propose"]>[0]> = {}) {
	return { id, actor: A, auctionId: "auction-a", amount, expiresAt: 1_300, now: 1_000, walletBacking: 3_000, ...overrides };
}

describe("Friday custodial reservation ledger", () => {
	test("concurrent 2000 bids from one 3000 wallet admit exactly one", async () => {
		const ledger = new FridayCustodyLedger();
		const locks = new FridayWalletSerializers();
		const attempts = await Promise.allSettled([
			locks.run(A, async () => ledger.propose(proposal("bid-one", 2_000, { auctionId: "auction-one" }))),
			locks.run(A, async () => ledger.propose(proposal("bid-two", 2_000, { auctionId: "auction-two" }))),
		]);
		expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
		expect(ledger.conservation(A, 3_000)).toEqual({ backing: 3_000, operationLocked: 0, spendable: 1_000, reserved: 2_000, inFlight: 0, unknown: 0, incomingPending: 0, accountedTotal: 3_000, conserved: true });
	});

	test("own raise holds only the delta until atomic replacement commit", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("first", 1_000));
		ledger.commit("first", "bid-first");
		ledger.propose(proposal("raise", 2_000, { replacesReservationId: "first" }));
		expect(ledger.conservation(A, 3_000).reserved).toBe(2_000);
		ledger.commit("raise", "bid-raise");
		expect(ledger.reservation("first")?.status).toBe("release_entitled");
		expect(ledger.reservation("raise")?.status).toBe("reserved");
		expect(ledger.conservation(A, 3_000)).toMatchObject({ spendable: 1_000, reserved: 2_000, conserved: true });
	});

	test("parallel replacement proposals on the same leader fail closed", async () => {
		const ledger = new FridayCustodyLedger();
		const locks = new FridayWalletSerializers();
		ledger.propose(proposal("first", 1_000)); ledger.commit("first", "bid-first");
		const attempts = await Promise.allSettled([
			locks.run(A, async () => ledger.propose(proposal("raise-a", 1_500, { replacesReservationId: "first" }))),
			locks.run(A, async () => ledger.propose(proposal("raise-b", 2_000, { replacesReservationId: "first" }))),
		]);
		expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
	});

	test("outbid release restores spendable backing without a mint call", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("first", 1_000)); ledger.commit("first", "bid-first");
		ledger.releaseEntitlement("first");
		expect(ledger.conservation(A, 3_000).spendable).toBe(3_000);
		ledger.release("first");
		expect(ledger.reservation("first")?.status).toBe("released");
	});

	test("lost send response stays unavailable until exact token recovery and receive", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("winner", 2_500, { walletBacking: 10_000 }));
		ledger.commit("winner", "bid-winner"); ledger.payoutEntitlement("winner");
		ledger.preparePayment({ id: "pay-auction-a", reservationId: "winner", recipient: B });
		ledger.markSending("pay-auction-a", 10_000, 0); ledger.markUnknown("pay-auction-a", "response lost", 10_000);
		expect(ledger.zeroPending()).toBeFalse();
		expect(ledger.conservation(A, 10_000)).toMatchObject({ unknown: 2_500, spendable: 7_500, accountedTotal: 10_000, conserved: true });
		ledger.checkpointToken("pay-auction-a", "cashuA" + "x".repeat(32), 7_500);
		expect(ledger.conservation(A, 7_500)).toMatchObject({ inFlight: 2_500, spendable: 7_500, accountedTotal: 10_000, conserved: true });
		ledger.markReceiving("pay-auction-a"); ledger.markPaid("pay-auction-a");
		expect(ledger.zeroPending()).toBeTrue();
		expect(ledger.payment("pay-auction-a")?.token).toBeUndefined();
	});

	test("encrypted-checkpoint round trip keeps unknown unavailable", () => {
		const first = new FridayCustodyLedger();
		first.propose(proposal("winner", 2_500, { walletBacking: 10_000 })); first.commit("winner", "bid-winner"); first.payoutEntitlement("winner");
		first.preparePayment({ id: "pay", reservationId: "winner", recipient: B }); first.markSending("pay", 10_000, 0); first.markUnknown("pay", "timeout", 7_500);
		const restored = new FridayCustodyLedger(JSON.parse(JSON.stringify(first.snapshot())));
		expect(restored.payment("pay")?.status).toBe("unknown");
		expect(restored.conservation(A, 7_500)).toMatchObject({ unknown: 2_500, spendable: 7_500, accountedTotal: 10_000, conserved: true });
	});

	test("ambiguous balance movement fails conservation closed", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("winner", 2_500, { walletBacking: 10_000 })); ledger.commit("winner", "bid-winner"); ledger.payoutEntitlement("winner");
		ledger.preparePayment({ id: "pay", reservationId: "winner", recipient: B }); ledger.markSending("pay", 10_000, 0);
		ledger.markUnknown("pay", "unexpected wallet movement", 8_000);
		expect(ledger.conservation(A, 8_000)).toMatchObject({ spendable: 5_500, unknown: 2_500, accountedTotal: 8_000, conserved: false });
	});

	test("a recipient cannot spend proofs until receive completion is durable", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("winner", 2_500, { walletBacking: 10_000 })); ledger.commit("winner", "bid-winner"); ledger.payoutEntitlement("winner");
		ledger.preparePayment({ id: "pay", reservationId: "winner", recipient: B }); ledger.markSending("pay", 10_000, 0);
		ledger.checkpointToken("pay", "cashuA" + "x".repeat(32), 7_500); ledger.markReceiving("pay");
		expect(ledger.hasPendingMutation(B)).toBeTrue();
		expect(ledger.conservation(B, 2_500)).toMatchObject({ spendable: 0, incomingPending: 2_500, accountedTotal: 2_500, conserved: true });
		expect(ledger.conservation(B, 1_000)).toMatchObject({ spendable: 0, incomingPending: 1_000, conserved: false });
		ledger.markPaid("pay");
		expect(ledger.hasPendingMutation(B)).toBeFalse();
		expect(ledger.conservation(B, 2_500)).toMatchObject({ spendable: 2_500, incomingPending: 0, conserved: true });
	});

	test("durable funding and payments explain restored wallet backing without blessing legacy value", () => {
		const ledger = new FridayCustodyLedger();
		expect(ledger.explainsWalletBacking(A, 10_000, 10_000)).toBeTrue();
		expect(ledger.explainsWalletBacking(A, 0, 2_500)).toBeFalse();
		ledger.propose(proposal("winner", 2_500, { walletBacking: 10_000 })); ledger.commit("winner", "bid-winner");
		ledger.payoutEntitlement("winner"); ledger.preparePayment({ id: "pay", reservationId: "winner", recipient: B });
		ledger.markSending("pay", 10_000, 0); ledger.checkpointToken("pay", "cashuA"+"x".repeat(32), 7_500); ledger.markReceiving("pay");
		expect(ledger.explainsWalletBacking(A, 10_000, 7_500)).toBeTrue();
		expect(ledger.explainsWalletBacking(B, 0, 2_500)).toBeTrue();
		expect(ledger.explainsWalletBacking(B, 0, 2_499)).toBeFalse();
		ledger.markPaid("pay");
		expect(ledger.explainsWalletBacking(A, 10_000, 7_500)).toBeTrue();
		expect(ledger.explainsWalletBacking(B, 0, 2_500)).toBeTrue();
	});

	test("tampered checkpoint relationships fail closed", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("winner", 2_500, { walletBacking: 10_000 })); ledger.commit("winner", "bid-winner"); ledger.payoutEntitlement("winner");
		ledger.preparePayment({ id: "pay", reservationId: "winner", recipient: B });
		const snapshot = ledger.snapshot();
		const wrongAmount = { ...snapshot, payments: snapshot.payments.map((payment) => ({ ...payment, amount: 2_499 })) };
		expect(() => new FridayCustodyLedger(wrongAmount)).toThrow("friday-ledger-invalid-payment-reservation");
		const wrongState = { ...snapshot, reservations: snapshot.reservations.map((reservation) => ({ ...reservation, status: "reserved" as const })) };
		expect(() => new FridayCustodyLedger(wrongState)).toThrow("friday-ledger-payment-reservation-state-mismatch");
	});

	test("global conservation counts an uncertain transfer in exactly one bucket", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("winner", 2_500, { walletBacking: 10_000 })); ledger.commit("winner", "bid-winner");
		expect(ledger.globalConservation({ [A]: 10_000, [B]: 0 }, 10_000)).toMatchObject({
			spendable: 7_500, reserved: 2_500, inFlight: 0, unknown: 0, incomingPending: 0, accountedTotal: 10_000, conserved: true,
		});
		ledger.payoutEntitlement("winner"); ledger.preparePayment({ id: "pay", reservationId: "winner", recipient: B });
		ledger.markSending("pay", 10_000, 0);
		expect(ledger.globalConservation({ [A]: 10_000, [B]: 0 }, 10_000)).toMatchObject({
			spendable: 7_500, reserved: 0, inFlight: 2_500, unknown: 0, incomingPending: 0, accountedTotal: 10_000, conserved: true,
		});
		ledger.markUnknown("pay", "mint response lost", 7_500);
		expect(ledger.globalConservation({ [A]: 7_500, [B]: 0 }, 10_000)).toMatchObject({
			spendable: 7_500, inFlight: 0, unknown: 2_500, incomingPending: 0, accountedTotal: 10_000, conserved: true,
		});
		ledger.checkpointToken("pay", "cashuA"+"x".repeat(32), 7_500); ledger.markReceiving("pay");
		expect(ledger.globalConservation({ [A]: 7_500, [B]: 2_500 }, 10_000)).toMatchObject({
			spendable: 7_500, inFlight: 0, unknown: 0, incomingPending: 2_500, accountedTotal: 10_000, conserved: true,
		});
		ledger.markPaid("pay");
		expect(ledger.globalConservation({ [A]: 7_500, [B]: 2_500 }, 10_000)).toMatchObject({
			spendable: 10_000, reserved: 0, inFlight: 0, unknown: 0, incomingPending: 0, accountedTotal: 10_000, conserved: true,
		});
	});

	test("Coco input selection keeps payment and change exclusive while a prepared send is locally reserved", () => {
		const ledger = new FridayCustodyLedger();
		ledger.propose(proposal("winner", 2_500, { walletBacking: 10_000 })); ledger.commit("winner", "bid-winner");
		ledger.payoutEntitlement("winner"); ledger.preparePayment({ id: "pay", reservationId: "winner", recipient: B });
		ledger.markSending("pay", 10_000, 0);
		// Coco may reserve a whole 10k input proof before mint I/O even though the
		// outgoing amount is 2.5k. The other 7.5k is recoverable change, not a loss
		// and not spendable until the operation advances.
		expect(ledger.conservation(A, 10_000, 0)).toMatchObject({
			spendable: 0, operationLocked: 7_500, inFlight: 2_500, accountedTotal: 10_000, conserved: true,
		});
		expect(ledger.globalConservation({ [A]: 10_000, [B]: 0 }, 10_000, 0, { [A]: 0, [B]: 0 })).toMatchObject({
			walletBacking: 10_000, walletSpendable: 0, operationLocked: 7_500,
			spendable: 0, inFlight: 2_500, accountedTotal: 10_000, conserved: true,
		});
	});

	test("global conservation includes exactly observed pending faucet value once", () => {
		const ledger = new FridayCustodyLedger();
		expect(ledger.globalConservation({ [A]: 0 }, 10_000, 10_000)).toMatchObject({
			walletBacking: 0, fundingPending: 10_000, accountedTotal: 10_000, conserved: true,
		});
		expect(ledger.globalConservation({ [A]: 0 }, 9_999, 10_000).conserved).toBeFalse();
	});
});
