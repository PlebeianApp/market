/**
 * Durable application ledger for the fake-money Friday demo.
 *
 * Values in this ledger are allocations over a real Coco wallet balance. The
 * ledger never claims to be a mint lock and never stores a Cashu proof. Bearer
 * payout tokens may appear only in an encrypted coordinator checkpoint while
 * they cross from a deterministic send to a deterministic receive.
 */

export type ReservationStatus =
	| "proposed"
	| "reserved"
	| "release_entitled"
	| "released"
	| "payout_entitled"
	| "delivering"
	| "unknown"
	| "paid";

export interface FridayReservation {
	readonly id: string;
	readonly actor: string;
	readonly auctionId: string;
	readonly amount: number;
	readonly replacesReservationId: string;
	readonly expiresAt: number;
	readonly createdAt: number;
	readonly bidId?: string;
	readonly status: ReservationStatus;
}
export type PaymentStatus = "prepared" | "sending" | "unknown" | "token_checkpointed" | "receiving" | "paid" | "failed";

export interface FridayPayment {
	readonly id: string;
	readonly reservationId: string;
	readonly sender: string;
	readonly recipient: string;
	readonly amount: number;
	/** Persisted before the first mint call; absent only while prepared. */
	readonly senderBeforeBalance?: number;
	readonly recipientBeforeBalance?: number;
	/** Last balance observed after an uncertain or token-producing send. */
	readonly senderBalanceObserved?: number;
	readonly sendOperationId: string;
	readonly receiveOperationId: string;
	readonly status: PaymentStatus;
	/** Sensitive bearer material. Persist only inside the encrypted checkpoint. */
	readonly token?: string;
	readonly error?: string;
}

export interface FridayLedgerState {
	readonly schema: "PlebeianFridayCustodyLedgerV1";
	readonly reservations: readonly FridayReservation[];
	readonly payments: readonly FridayPayment[];
}

export interface ReservationProposal {
	readonly id: string;
	readonly actor: string;
	readonly auctionId: string;
	readonly amount: number;
	readonly replacesReservationId?: string;
	readonly expiresAt: number;
	readonly now: number;
	readonly walletBacking: number;
}

export interface ConservationView {
	/** Proof value currently held by the actor's Coco wallet. */
	readonly backing: number;
	/** Value Coco owns but has made unavailable inside one durable operation. */
	readonly operationLocked: number;
	readonly spendable: number;
	readonly reserved: number;
	readonly inFlight: number;
	readonly unknown: number;
	/** Value observed in a recipient wallet but not yet durably marked paid. */
	readonly incomingPending: number;
	/** Spendable + every mutually exclusive unavailable bucket. */
	readonly accountedTotal: number;
	readonly conserved: boolean;
}

export interface GlobalConservationView {
	/** Finalized grants plus any exactly observed, still-pending faucet output. */
	readonly issued: number;
	readonly walletBacking: number;
	readonly walletSpendable: number;
	readonly operationLocked: number;
	readonly spendable: number;
	readonly reserved: number;
	readonly inFlight: number;
	readonly unknown: number;
	readonly incomingPending: number;
	readonly fundingPending: number;
	readonly accountedTotal: number;
	readonly observationsExact: boolean;
	readonly conserved: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ACTOR = /^[0-9a-f]{64}$/;

function integer(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`friday-ledger-invalid-${label}`);
}

function cloneReservation(value: FridayReservation): FridayReservation {
	return { ...value };
}

function clonePayment(value: FridayPayment): FridayPayment {
	return { ...value };
}

function heldAmount(reservation: FridayReservation): number {
	switch (reservation.status) {
		case "proposed":
			return reservation.amount;
		case "reserved":
		case "payout_entitled":
			return reservation.amount;
		case "delivering":
		case "unknown":
			return 0;
		case "release_entitled":
		case "released":
		case "paid":
			return 0;
	}
}

export class FridayCustodyLedger {
	readonly #reservations = new Map<string, FridayReservation>();
	readonly #payments = new Map<string, FridayPayment>();

	constructor(state?: FridayLedgerState) {
		if (state === undefined) return;
		if (state.schema !== "PlebeianFridayCustodyLedgerV1" || !Array.isArray(state.reservations) || !Array.isArray(state.payments)) {
			throw new Error("friday-ledger-invalid-state");
		}
		for (const reservation of state.reservations) {
			this.#validateReservation(reservation);
			if (this.#reservations.has(reservation.id)) throw new Error("friday-ledger-duplicate-reservation");
			this.#reservations.set(reservation.id, cloneReservation(reservation));
		}
		for (const payment of state.payments) {
			this.#validatePayment(payment);
			if (this.#payments.has(payment.id)) throw new Error("friday-ledger-duplicate-payment");
			this.#payments.set(payment.id, clonePayment(payment));
		}
		for (const reservation of this.#reservations.values()) {
			if (reservation.replacesReservationId !== "") {
				const prior = this.#reservations.get(reservation.replacesReservationId);
				if (prior === undefined || prior.actor !== reservation.actor || prior.auctionId !== reservation.auctionId || reservation.amount <= prior.amount) {
					throw new Error("friday-ledger-invalid-replacement-reference");
				}
			}
		}
		for (const payment of this.#payments.values()) {
			const reservation = this.#reservations.get(payment.reservationId);
			if (reservation === undefined || reservation.actor !== payment.sender || reservation.amount !== payment.amount) throw new Error("friday-ledger-invalid-payment-reservation");
			const compatible = payment.status === "prepared" && reservation.status === "payout_entitled"
				|| ["sending", "token_checkpointed", "receiving"].includes(payment.status) && reservation.status === "delivering"
				|| payment.status === "unknown" && reservation.status === "unknown"
				|| payment.status === "paid" && reservation.status === "paid"
				|| payment.status === "failed" && ["unknown", "payout_entitled"].includes(reservation.status);
			if (!compatible) throw new Error("friday-ledger-payment-reservation-state-mismatch");
		}
	}

	snapshot(): FridayLedgerState {
		return {
			schema: "PlebeianFridayCustodyLedgerV1",
			reservations: [...this.#reservations.values()].sort((a, b) => a.id.localeCompare(b.id)).map(cloneReservation),
			payments: [...this.#payments.values()].sort((a, b) => a.id.localeCompare(b.id)).map(clonePayment),
		};
	}

	reservation(id: string): FridayReservation | null {
		const found = this.#reservations.get(id);
		return found === undefined ? null : cloneReservation(found);
	}

	payment(id: string): FridayPayment | null {
		const found = this.#payments.get(id);
		return found === undefined ? null : clonePayment(found);
	}

	propose(input: ReservationProposal): FridayReservation {
		if (!ID.test(input.id) || !ACTOR.test(input.actor) || !ID.test(input.auctionId)) throw new Error("friday-ledger-invalid-proposal-identity");
		integer(input.amount, "amount"); integer(input.now, "now"); integer(input.expiresAt, "expiry"); integer(input.walletBacking, "backing");
		if (input.amount === 0 || input.expiresAt <= input.now) throw new Error("friday-ledger-invalid-proposal");
		const replaces = input.replacesReservationId ?? "";
		if (replaces !== "" && !ID.test(replaces)) throw new Error("friday-ledger-invalid-replacement");
		const existing = this.#reservations.get(input.id);
		if (existing !== undefined) {
			if (existing.actor !== input.actor || existing.auctionId !== input.auctionId || existing.amount !== input.amount || existing.replacesReservationId !== replaces || existing.expiresAt !== input.expiresAt) {
				throw new Error("friday-ledger-reservation-id-conflict");
			}
			return cloneReservation(existing);
		}
		let additional = input.amount;
		if (replaces !== "") {
			const prior = this.#reservations.get(replaces);
			if (prior === undefined || prior.actor !== input.actor || prior.auctionId !== input.auctionId || prior.status !== "reserved" || input.amount <= prior.amount) {
				throw new Error("friday-ledger-replacement-not-active-raise");
			}
			if ([...this.#reservations.values()].some((candidate) => candidate.status === "proposed" && candidate.replacesReservationId === replaces)) {
				throw new Error("friday-ledger-replacement-already-proposed");
			}
			additional = input.amount - prior.amount;
		}
		const view = this.conservation(input.actor, input.walletBacking);
		if (view.spendable < additional) throw new Error("friday-ledger-insufficient-backed-value");
		const reservation: FridayReservation = {
			id: input.id, actor: input.actor, auctionId: input.auctionId, amount: input.amount,
			replacesReservationId: replaces, expiresAt: input.expiresAt, createdAt: input.now, status: "proposed",
		};
		this.#reservations.set(input.id, reservation);
		return cloneReservation(reservation);
	}

	commit(id: string, bidId: string): FridayReservation {
		const current = this.#requireReservation(id);
		if (!ID.test(bidId)) throw new Error("friday-ledger-invalid-bid-id");
		if (current.status === "reserved" && current.bidId === bidId) return current;
		if (current.status !== "proposed") throw new Error("friday-ledger-reservation-not-proposed");
		if (current.replacesReservationId !== "") {
			const prior = this.#requireReservation(current.replacesReservationId);
			if (prior.status !== "reserved") throw new Error("friday-ledger-replaced-reservation-not-active");
			this.#reservations.set(prior.id, { ...prior, status: "release_entitled" });
		}
		const committed = { ...current, status: "reserved" as const, bidId };
		this.#reservations.set(id, committed);
		return cloneReservation(committed);
	}

	expireUncommitted(now: number): string[] {
		integer(now, "now");
		const released: string[] = [];
		for (const reservation of this.#reservations.values()) {
			if (reservation.status === "proposed" && reservation.expiresAt < now) {
				this.#reservations.set(reservation.id, { ...reservation, status: "released" });
				released.push(reservation.id);
			}
		}
		return released.sort();
	}

	releaseEntitlement(id: string): FridayReservation {
		const current = this.#requireReservation(id);
		if (current.status === "release_entitled" || current.status === "released") return current;
		if (current.status !== "reserved") throw new Error("friday-ledger-reservation-not-releasable");
		const next = { ...current, status: "release_entitled" as const };
		this.#reservations.set(id, next);
		return cloneReservation(next);
	}

	release(id: string): FridayReservation {
		const current = this.#requireReservation(id);
		if (current.status === "released") return current;
		if (current.status !== "release_entitled") throw new Error("friday-ledger-release-without-entitlement");
		const next = { ...current, status: "released" as const };
		this.#reservations.set(id, next);
		return cloneReservation(next);
	}

	payoutEntitlement(id: string): FridayReservation {
		const current = this.#requireReservation(id);
		if (current.status === "payout_entitled") return current;
		if (current.status !== "reserved") throw new Error("friday-ledger-payout-without-reservation");
		const next = { ...current, status: "payout_entitled" as const };
		this.#reservations.set(id, next);
		return cloneReservation(next);
	}

	preparePayment(input: { id: string; reservationId: string; recipient: string }): FridayPayment {
		if (!ID.test(input.id) || !ACTOR.test(input.recipient)) throw new Error("friday-ledger-invalid-payment-identity");
		const existing = this.#payments.get(input.id);
		if (existing !== undefined) return clonePayment(existing);
		const reservation = this.#requireReservation(input.reservationId);
		if (reservation.status !== "payout_entitled") throw new Error("friday-ledger-payment-without-entitlement");
		const payment: FridayPayment = {
			id: input.id, reservationId: reservation.id, sender: reservation.actor, recipient: input.recipient,
			amount: reservation.amount,
			sendOperationId: `send-${input.id}`, receiveOperationId: `receive-${input.id}`, status: "prepared",
		};
		this.#payments.set(payment.id, payment);
		return clonePayment(payment);
	}

	markSending(id: string, senderBeforeBalance: number, recipientBeforeBalance: number): FridayPayment {
		integer(senderBeforeBalance, "sender-balance"); integer(recipientBeforeBalance, "recipient-balance");
		const next = this.#paymentTransition(id, ["prepared"], "sending", { senderBeforeBalance, recipientBeforeBalance });
		const reservation = this.#requireReservation(next.reservationId);
		this.#reservations.set(reservation.id, { ...reservation, status: "delivering" });
		return next;
	}
	markUnknown(id: string, error: string, senderBalanceObserved: number): FridayPayment {
		integer(senderBalanceObserved, "sender-observed-balance");
		const next = this.#paymentTransition(id, ["sending", "unknown", "token_checkpointed", "receiving"], "unknown", { error: error.slice(0, 240), senderBalanceObserved });
		const reservation = this.#requireReservation(next.reservationId);
		this.#reservations.set(reservation.id, { ...reservation, status: "unknown" });
		return next;
	}
	checkpointToken(id: string, token: string, senderBalanceObserved: number): FridayPayment {
		if (typeof token !== "string" || token.length < 16) throw new Error("friday-ledger-invalid-token");
		integer(senderBalanceObserved, "sender-observed-balance");
		const next = this.#paymentTransition(id, ["sending", "unknown", "token_checkpointed"], "token_checkpointed", { token, error: undefined, senderBalanceObserved });
		const reservation = this.#requireReservation(next.reservationId);
		this.#reservations.set(reservation.id, { ...reservation, status: "delivering" });
		return next;
	}
	markReceiving(id: string): FridayPayment { return this.#paymentTransition(id, ["token_checkpointed", "receiving"], "receiving"); }
	markPaid(id: string): FridayPayment {
		const next = this.#paymentTransition(id, ["receiving", "paid"], "paid", { token: undefined, error: undefined });
		const reservation = this.#requireReservation(next.reservationId);
		this.#reservations.set(reservation.id, { ...reservation, status: "paid" });
		return next;
	}

	conservation(actor: string, walletBacking: number, walletSpendable = walletBacking): ConservationView {
		if (!ACTOR.test(actor)) throw new Error("friday-ledger-invalid-actor");
		integer(walletBacking, "backing"); integer(walletSpendable, "spendable-backing");
		if (walletSpendable > walletBacking) throw new Error("friday-ledger-spendable-exceeds-backing");
		let reserved = 0; let inFlight = 0; let unknown = 0; let incomingPending = 0; let observationsExact = true;
		let spendable = walletSpendable;
		let operationLocked = walletBacking-walletSpendable;
		const consumeUnavailable = (amount: number): void => {
			const fromOperation = Math.min(operationLocked, amount);
			operationLocked -= fromOperation;
			spendable -= amount-fromOperation;
			if (spendable < 0) observationsExact = false;
		};
		for (const reservation of this.#reservations.values()) {
			if (reservation.actor !== actor) continue;
			if (reservation.status === "delivering" || reservation.status === "unknown") {
				if (reservation.status === "delivering") inFlight += reservation.amount;
				else unknown += reservation.amount;
				const payment = [...this.#payments.values()].find((candidate) => candidate.reservationId === reservation.id);
				const before = payment?.senderBeforeBalance;
				if (before === undefined) { observationsExact = false; consumeUnavailable(reservation.amount); }
				else {
					const movement = before-walletBacking;
					if (movement === 0) consumeUnavailable(reservation.amount);
					else if (movement !== reservation.amount) { observationsExact = false; consumeUnavailable(reservation.amount); }
				}
			}
			else if (reservation.status === "proposed" && reservation.replacesReservationId !== "") {
				const prior = this.#reservations.get(reservation.replacesReservationId);
				const delta = reservation.amount - (prior?.amount ?? 0);
				reserved += delta; spendable -= delta;
			} else {
				const held = heldAmount(reservation);
				reserved += held; spendable -= held;
			}
		}
		for (const payment of this.#payments.values()) {
			if (payment.recipient !== actor || payment.status === "prepared" || payment.status === "paid" || payment.status === "failed") continue;
			const before = payment.recipientBeforeBalance;
			if (before === undefined) {
				observationsExact = false;
				continue;
			}
			const movement = walletBacking-before;
			if (movement === 0) continue;
			if (movement !== payment.amount) observationsExact = false;
			const held = Math.min(walletSpendable, Math.max(0, movement));
			incomingPending += held;
			spendable -= held;
		}
		const accountedTotal = spendable + operationLocked + reserved + inFlight + unknown + incomingPending;
		return { backing: walletBacking, operationLocked, spendable, reserved, inFlight, unknown, incomingPending, accountedTotal,
			conserved: observationsExact && spendable >= 0 };
	}

	/**
	 * One exclusive, all-wallet observation. `backings` must already exclude a
	 * faucet increase that is still pending in the funding journal; that value is
	 * supplied once in `fundingPending`. An outgoing payment is counted exactly
	 * once: in the sender while inputs remain there, as recoverable transit after
	 * the sender spent, or as recipient-pending after the recipient received.
	 */
	globalConservation(backings: Readonly<Record<string, number>>, issued: number, fundingPending = 0,
		spendableBackings: Readonly<Record<string, number>> = backings): GlobalConservationView {
		integer(issued, "issued"); integer(fundingPending, "funding-pending");
		let walletBacking = 0; let walletSpendable = 0;
		for (const [actor, amount] of Object.entries(backings)) {
			if (!ACTOR.test(actor)) throw new Error("friday-ledger-invalid-actor");
			integer(amount, "backing");
			const available = spendableBackings[actor];
			if (available === undefined) throw new Error("friday-ledger-spendable-backing-missing");
			integer(available, "spendable-backing");
			if (available > amount) throw new Error("friday-ledger-spendable-exceeds-backing");
			walletBacking += amount; walletSpendable += available;
		}
		if (Object.keys(spendableBackings).some((actor) => backings[actor] === undefined)) throw new Error("friday-ledger-unknown-spendable-backing");
		let spendable = walletSpendable;
		let operationLocked = walletBacking-walletSpendable;
		let reserved = 0; let inFlight = 0; let unknown = 0; let incomingPending = 0;
		let observationsExact = true;
		const consumeUnavailable = (amount: number): void => {
			const fromOperation = Math.min(operationLocked, amount);
			operationLocked -= fromOperation;
			spendable -= amount-fromOperation;
			if (spendable < 0) observationsExact = false;
		};
		const byReservation = new Map([...this.#payments.values()].map((payment) => [payment.reservationId, payment]));
		for (const reservation of this.#reservations.values()) {
			const senderBacking = backings[reservation.actor];
			if (senderBacking === undefined) { observationsExact = false; continue; }
			if (["proposed", "reserved", "payout_entitled"].includes(reservation.status)) {
				let held = reservation.amount;
				if (reservation.status === "proposed" && reservation.replacesReservationId !== "") {
					const prior = this.#reservations.get(reservation.replacesReservationId);
					if (prior === undefined) { observationsExact = false; continue; }
					held -= prior.amount;
				}
				reserved += held; spendable -= held; continue;
			}
			if (!["delivering", "unknown"].includes(reservation.status)) continue;
			const payment = byReservation.get(reservation.id);
			const recipientBacking = payment === undefined ? undefined : backings[payment.recipient];
			if (payment === undefined || payment.senderBeforeBalance === undefined || payment.recipientBeforeBalance === undefined || recipientBacking === undefined) {
				observationsExact = false; unknown += reservation.amount; spendable -= Math.min(senderBacking, reservation.amount); continue;
			}
			const senderMovement = payment.senderBeforeBalance-senderBacking;
			const recipientMovement = recipientBacking-payment.recipientBeforeBalance;
			if (![0, payment.amount].includes(senderMovement) || ![0, payment.amount].includes(recipientMovement)
				|| recipientMovement === payment.amount && senderMovement !== payment.amount) {
				observationsExact = false; unknown += payment.amount; consumeUnavailable(payment.amount); continue;
			}
			if (recipientMovement === payment.amount) {
				incomingPending += payment.amount; spendable -= payment.amount;
			} else {
				if (payment.status === "unknown") unknown += payment.amount;
				else inFlight += payment.amount;
				if (senderMovement === 0) consumeUnavailable(payment.amount);
			}
		}
		const accountedTotal = spendable+operationLocked+reserved+inFlight+unknown+incomingPending+fundingPending;
		return { issued, walletBacking, walletSpendable, operationLocked, spendable, reserved, inFlight, unknown, incomingPending, fundingPending,
			accountedTotal, observationsExact, conserved: observationsExact && spendable >= 0 && accountedTotal === issued };
	}

	hasPendingMutation(actor: string): boolean {
		if (!ACTOR.test(actor)) throw new Error("friday-ledger-invalid-actor");
		return [...this.#payments.values()].some((payment) => payment.status !== "paid" && payment.status !== "failed"
			&& (payment.sender === actor || payment.recipient === actor));
	}

	zeroPending(): boolean {
		return [...this.#payments.values()].every((payment) => payment.status === "paid" || payment.status === "failed");
	}

	/**
	 * Prove that a restored wallet balance is explained by durable faucet value
	 * plus terminal transfers and, at most, one unresolved exact transfer. This
	 * is deliberately stricter than merely recognizing a positive balance.
	 */
	explainsWalletBacking(actor: string, fundedBacking: number, walletBacking: number): boolean {
		if (!ACTOR.test(actor)) throw new Error("friday-ledger-invalid-actor");
		integer(fundedBacking, "funded-backing"); integer(walletBacking, "wallet-backing");
		let expected = fundedBacking;
		for (const payment of this.#payments.values()) {
			if (payment.status !== "paid") continue;
			if (payment.sender === actor) expected -= payment.amount;
			if (payment.recipient === actor) expected += payment.amount;
		}
		if (expected < 0) return false;
		if (walletBacking === expected) return true;
		const unresolved = [...this.#payments.values()].filter((payment) => payment.status !== "paid" && payment.status !== "failed"
			&& (payment.sender === actor || payment.recipient === actor));
		if (unresolved.length !== 1) return false;
		const payment = unresolved[0]!;
		if (payment.sender === actor && payment.senderBeforeBalance === expected) {
			return walletBacking === expected-payment.amount;
		}
		if (payment.recipient === actor && payment.recipientBeforeBalance === expected) {
			return walletBacking === expected+payment.amount;
		}
		return false;
	}

	#requireReservation(id: string): FridayReservation {
		const found = this.#reservations.get(id);
		if (found === undefined) throw new Error("friday-ledger-reservation-missing");
		return found;
	}

	#paymentTransition(id: string, allowed: readonly PaymentStatus[], status: PaymentStatus, patch: Partial<FridayPayment> = {}): FridayPayment {
		const current = this.#payments.get(id);
		if (current === undefined) throw new Error("friday-ledger-payment-missing");
		if (!allowed.includes(current.status)) throw new Error("friday-ledger-payment-transition-refused");
		const next = { ...current, ...patch, status };
		this.#payments.set(id, next);
		return clonePayment(next);
	}

	#validateReservation(value: FridayReservation): void {
		if (!ID.test(value.id) || !ACTOR.test(value.actor) || !ID.test(value.auctionId) || !["proposed", "reserved", "release_entitled", "released", "payout_entitled", "delivering", "unknown", "paid"].includes(value.status)) throw new Error("friday-ledger-invalid-reservation");
		integer(value.amount, "amount"); integer(value.expiresAt, "expiry"); integer(value.createdAt, "created");
		if (value.amount === 0 || value.expiresAt <= value.createdAt || value.replacesReservationId !== "" && !ID.test(value.replacesReservationId)) throw new Error("friday-ledger-invalid-reservation");
		if (value.status === "proposed" && value.bidId !== undefined || value.status !== "proposed" && (value.bidId === undefined || !ID.test(value.bidId))) throw new Error("friday-ledger-reservation-bid-state-mismatch");
	}
	#validatePayment(value: FridayPayment): void {
		if (!ID.test(value.id) || !ID.test(value.reservationId) || !ACTOR.test(value.sender) || !ACTOR.test(value.recipient)
			|| !ID.test(value.sendOperationId) || !ID.test(value.receiveOperationId)
			|| value.sendOperationId !== `send-${value.id}` || value.receiveOperationId !== `receive-${value.id}`
			|| !["prepared", "sending", "unknown", "token_checkpointed", "receiving", "paid", "failed"].includes(value.status)) throw new Error("friday-ledger-invalid-payment");
		integer(value.amount, "amount");
		if (value.amount === 0 || value.sender === value.recipient) throw new Error("friday-ledger-invalid-payment");
		if (value.status === "prepared") {
			if (value.senderBeforeBalance !== undefined || value.recipientBeforeBalance !== undefined || value.senderBalanceObserved !== undefined) throw new Error("friday-ledger-prepared-payment-has-mint-state");
		} else {
			if (value.senderBeforeBalance === undefined || value.recipientBeforeBalance === undefined) throw new Error("friday-ledger-payment-missing-recovery-balances");
			integer(value.senderBeforeBalance, "sender-balance"); integer(value.recipientBeforeBalance, "recipient-balance");
			if (value.senderBalanceObserved !== undefined) integer(value.senderBalanceObserved, "sender-observed-balance");
		}
	}
}

/** Per-wallet FIFO serialization; different wallets can progress independently. */
export class FridayWalletSerializers {
	readonly #tails = new Map<string, Promise<void>>();

	async run<T>(actor: string, action: () => Promise<T>): Promise<T> {
		if (!ACTOR.test(actor)) throw new Error("friday-ledger-invalid-actor");
		const prior = this.#tails.get(actor) ?? Promise.resolve();
		let release!: () => void;
		const held = new Promise<void>((resolve) => { release = resolve; });
		const tail = prior.then(() => held, () => held);
		this.#tails.set(actor, tail);
		await prior.catch(() => undefined);
		try {
			return await action();
		} finally {
			release();
			if (this.#tails.get(actor) === tail) this.#tails.delete(actor);
		}
	}
}
