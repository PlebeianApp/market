import { describe, expect, test } from 'bun:test'
import { assertDemoMaintainerAuctionPayoutFence, type DemoMaintainerExactBranchTemplate } from './demo-maintainer-offline'
import { Database } from 'bun:sqlite'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { prepareDemoFridayAuctionPayoutAuthorization } from './demo-friday-auction-payout-authorization'
import type { DemoFridaySellerOpeningRefV1 } from './demo-friday-browser-coco-seller-plan'
import {
	assertDemoFridayAuctionPayoutSignerBinding,
	createDemoFridayAuctionPayoutAuthority,
	createDemoFridayAuctionPayoutBrowserController,
	DemoFridayAuctionPayoutRegistrySqlite,
	DemoFridayAuctionPayoutRollbackAnchorSqlite,
	withDemoFridayAuctionPayoutOpenings,
	type DemoFridayAuctionPayoutWinnerOutcomeV1,
} from './demo-friday-auction-payout-runtime'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { demoDenominationKeyDigest } from './demo-sigall-settlement'
import { createDemoFridayPaymentSignerFromSecret } from './poc-demo-browser-signer'

const actorSecret = hexToBytes('41'.padStart(64, '0'))
const sellerActor = bytesToHex(schnorr.getPublicKey(actorSecret))
const recipientSecret = hexToBytes('42'.padStart(64, '0'))
const bidderA = '6'.repeat(64), bidderB = '7'.repeat(64)
const now = 1_000

function compressed(value: number): string {
	return bytesToHex(secp256k1.getPublicKey(hexToBytes(value.toString(16).padStart(64, '0')), true))
}

function signed(unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
		0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content,
	]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), actorSecret)) }
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'friday-auction-payout.'))
	const statePath = join(root, 'state.sqlite3'), anchorPath = join(root, 'anchor.sqlite3')
	const stateDb = new Database(statePath), anchorDb = new Database(anchorPath)
	const anchor = new DemoFridayAuctionPayoutRollbackAnchorSqlite(anchorDb, true)
	const registry = new DemoFridayAuctionPayoutRegistrySqlite(stateDb, 'deployment-1', anchor)
	const keyset = { id: '00auction', unit: 'sat' as const,
		keys: Object.fromEntries([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768]
			.map((amount, index) => [String(amount), compressed(100 + index)])) }
	const recipient = createDemoFridayPaymentSignerFromSecret(recipientSecret)
	const rows = new Map<string, DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>>()
	const journal = {
		async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() },
		async load(scope: string) { return structuredClone(rows.get(scope) ?? null) },
		async savePrepared(scope: string, record: DemoRecipientPrivateRecord<DemoFridaySellerOpeningRefV1>) {
			rows.set(scope, structuredClone(record))
		},
		async markImported() { throw new Error('unused') },
	}
	const scope = {
		schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_SCOPE_V1' as const,
		authNetworkId: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1', sellerActor,
		sellerPaymentPublicKey: await recipient.getPublicKey(), canonicalMintUrl: 'https://172.105.64.142',
		activeSatKeysetId: keyset.id, denominationKeyDigest: demoDenominationKeyDigest(keyset.keys),
		startingBid: 100, minIncrement: 10, reserve: 0, originalEndTime: 4_600, maximumEndTime: 5_200,
		maximumPayout: 50_000, validFrom: now, validUntil: 5_800,
	}
	const envelope = await prepareDemoFridayAuctionPayoutAuthorization({
		scope, keyset, journal, recipientKey: recipient,
		nostr: { async getPublicKey() { return sellerActor }, async signEvent(value) { return signed(value) } },
		nowSeconds: now,
	})
	let clock = 1_100
	const auction = {
		auctionId: 'auction-1', sellerActor, sellerPaymentPublicKey: scope.sellerPaymentPublicKey,
		status: 'open' as const, startingBid: 100, minIncrement: 10, reserve: 0,
		originalEndTime: 4_600, endTime: 4_600, leaderBidId: '', leaderActor: '', leaderBidAmount: 0,
		stateHeight: 20, appHash: 'a'.repeat(64),
	}
	const authority = createDemoFridayAuctionPayoutAuthority({
		keyset, registry, auctions: { async readExact() { return structuredClone(auction) } }, nowSeconds: () => clock,
	})
	return { root, statePath, anchorPath, stateDb, anchorDb, registry, keyset, recipient, rows, journal,
		scope, envelope, auction, authority, setClock(value: number) { clock = value } }
}

describe('auction payout authority, signer, winner fence and seller recovery', () => {
	test('recovers a lost registration response without another recipient or Nostr signature', async () => {
		const held = await fixture()
		try {
			held.rows.clear()
			let recipientSignatures = 0, nostrSignatures = 0, loseFirstResponse = true
			const controller = createDemoFridayAuctionPayoutBrowserController({
				keyset: held.keyset, journal: held.journal,
				recipientKey: {
					getPublicKey: () => held.recipient.getPublicKey(),
					async signRecipientCapability(value) {
						recipientSignatures += 1
						return held.recipient.signRecipientCapability(value)
					},
				},
				nostr: { async getPublicKey() { return sellerActor }, async signEvent(value) {
					nostrSignatures += 1
					return signed(value)
				} },
				authority: {
					readExact: (auctionId) => held.authority.readExact(auctionId),
					async registerExact(value) {
						const registered = await held.authority.registerExact(value)
						if (loseFirstResponse) { loseFirstResponse = false; throw new Error('response lost after commit') }
						return registered
					},
				},
				nowSeconds: () => now,
			})
			const { validFrom: _validFrom, ...request } = held.scope
			await expect(controller.authorizeAuctionExact(request)).rejects.toThrow(/response lost/)
			expect({ recipientSignatures, nostrSignatures }).toEqual({ recipientSignatures: 1, nostrSignatures: 1 })
			const recovered = await controller.authorizeAuctionExact(request)
			expect(recovered.authorizationDigest)
				.toBe((await held.authority.readExact('auction-1'))!.authorizationDigest)
			expect({ recipientSignatures, nostrSignatures }).toEqual({ recipientSignatures: 1, nostrSignatures: 1 })
		} finally { held.recipient.dispose(); held.stateDb.close(false); held.anchorDb.close(false) }
	})

	test('registers durably, selects offline, validates at a signer, and exposes only chosen openings to seller recovery', async () => {
		const held = await fixture()
		try {
			const registered = await held.authority.registerExact(held.envelope)
			expect(registered.authorizationDigest).toBe(held.envelope.authorizationDigest)
			const selection = await held.authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-a',
				bidderActor: bidderA, bidAmount: 111, replacesBidId: '' })
			expect(selection?.outputs.reduce((sum, output) => sum + output.amount, 0)).toBe(111)
			assertDemoFridayAuctionPayoutSignerBinding({
				authorization: registered, selection: selection!, keyset: held.keyset, observedAt: 1_100,
				template: { network: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1',
					operationId: 'funding-a', bidderActorId: bidderA, amount: 111,
					recipientPublicKey: held.scope.sellerPaymentPublicKey, activeSatKeysetId: held.keyset.id,
					denominationKeyDigest: held.scope.denominationKeyDigest, outputs: selection!.outputs },
			})
			const seen = await withDemoFridayAuctionPayoutOpenings({ authorization: registered, selection: selection!,
				keyset: held.keyset, observedAt: 1_100, journal: held.journal,
				async useExact(value) { return value.map(({ index, output, opening }) => ({ index, amount: output.amount,
					matches: output.B_ === opening.B_ })) },
			})
			expect(seen.every(({ matches }) => matches)).toBe(true)
			expect(seen.map(({ amount }) => amount)).toEqual([64, 32, 8, 4, 2, 1])
		} finally { held.recipient.dispose(); held.stateDb.close(false); held.anchorDb.close(false) }
	})

	test('winner fence is idempotent for one exact outcome and rejects another bidder or operation', async () => {
		const held = await fixture()
		try {
			await held.authority.registerExact(held.envelope)
			const first = (await held.authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-a',
				bidderActor: bidderA, bidAmount: 111, replacesBidId: '' }))!
			const outcome: DemoFridayAuctionPayoutWinnerOutcomeV1 = {
				schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_OUTCOME_V1', auctionId: 'auction-1',
				winnerFundingOperationId: 'funding-a', winnerActor: bidderA, winningAmount: 111,
				stateHeight: 40, appHash: 'b'.repeat(64), closedAt: 4_601,
			}
			expect(await held.authority.claimWinnerExact({ selection: first, outcome }))
				.toMatchObject({ fundingOperationId: 'funding-a', selectionDigest: first.selectionDigest })
			expect(await held.authority.claimWinnerExact({ selection: first, outcome }))
				.toMatchObject({ fundingOperationId: 'funding-a' })

			held.auction.leaderBidId = 'c'.repeat(64); held.auction.leaderActor = bidderA
			held.auction.leaderBidAmount = 111; held.auction.stateHeight = 21
			const second = (await held.authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-b',
				bidderActor: bidderB, bidAmount: 121, replacesBidId: held.auction.leaderBidId }))!
			await expect(held.authority.claimWinnerExact({ selection: second, outcome: { ...outcome,
				winnerFundingOperationId: 'funding-b', winnerActor: bidderB, winningAmount: 121 } }))
				.rejects.toThrow(/already paid another winner/)
		} finally { held.recipient.dispose(); held.stateDb.close(false); held.anchorDb.close(false) }
	})

	test('survives restart, accepts a lost-response replay, and detects rollback or same-revision mutation', async () => {
		const held = await fixture()
		try {
			await held.authority.registerExact(held.envelope)
			const before = held.registry.anchorSnapshot()
			held.stateDb.close(false); held.anchorDb.close(false)
			const state2 = new Database(held.statePath), anchor2 = new Database(held.anchorPath)
			const registry2 = new DemoFridayAuctionPayoutRegistrySqlite(state2, 'deployment-1',
				new DemoFridayAuctionPayoutRollbackAnchorSqlite(anchor2))
			expect(registry2.readAuthorizationExact('auction-1')?.authorizationDigest)
				.toBe(held.envelope.authorizationDigest)
			// Another valid Schnorr signature over the same body replays the stored
			// envelope rather than changing the immutable authorization.
			const replayEnvelope = structuredClone(held.envelope)
			replayEnvelope.sellerAuthorization = signed({ ...replayEnvelope.sellerAuthorization,
				id: undefined, sig: undefined } as never)
			expect(registry2.registerAuthorizationExact(replayEnvelope).authorizationDigest)
				.toBe(held.envelope.authorizationDigest)
			expect(registry2.anchorSnapshot().globalRevision).toBe(before.globalRevision)
			state2.close(false); anchor2.close(false)

			const rolledState = new Database(held.statePath), rolledAnchor = new Database(held.anchorPath)
			rolledState.query('UPDATE friday_auction_payout_metadata SET global_revision=0 WHERE id=1').run()
			expect(() => new DemoFridayAuctionPayoutRegistrySqlite(rolledState, 'deployment-1',
				new DemoFridayAuctionPayoutRollbackAnchorSqlite(rolledAnchor))).toThrow(/revision regressed|changed/)
			rolledState.close(false); rolledAnchor.close(false)
		} finally { held.recipient.dispose() }
	})

	test('fails closed on signer substitution, altered final outcome, missing private journal, and changed auction scope', async () => {
		const held = await fixture()
		try {
			await held.authority.registerExact(held.envelope)
			const selection = (await held.authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-a',
				bidderActor: bidderA, bidAmount: 111, replacesBidId: '' }))!
			expect(() => assertDemoFridayAuctionPayoutSignerBinding({ authorization: held.envelope, selection,
				keyset: held.keyset, observedAt: 1_100, template: { network: 'friday-network', chainId: 'friday-chain',
					auctionId: 'auction-1', operationId: 'funding-a', bidderActorId: bidderA, amount: 111,
					recipientPublicKey: compressed(77), activeSatKeysetId: held.keyset.id,
					denominationKeyDigest: held.scope.denominationKeyDigest, outputs: selection.outputs } }))
				.toThrow(/signer template/)
			await expect(held.authority.claimWinnerExact({ selection, outcome: {
				schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_OUTCOME_V1', auctionId: 'auction-1',
				winnerFundingOperationId: 'funding-a', winnerActor: bidderB, winningAmount: 111,
				stateHeight: 40, appHash: 'b'.repeat(64), closedAt: 4_601,
			} })).rejects.toThrow(/differs/)
			held.rows.clear()
			await expect(withDemoFridayAuctionPayoutOpenings({ authorization: held.envelope, selection,
				keyset: held.keyset, observedAt: 1_100, journal: held.journal, async useExact() { return true } }))
				.rejects.toThrow(/journal/)
			held.auction.minIncrement = 11
			await expect(held.authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-b',
				bidderActor: bidderB, bidAmount: 121, replacesBidId: '' })).rejects.toThrow(/differs/)
		} finally { held.recipient.dispose(); held.stateDb.close(false); held.anchorDb.close(false) }
	})
})


describe('payout adversarial execution boundaries', () => {
    test('unfenced V3 fails closed while legacy remains compatible', async () => {
        await expect(assertDemoMaintainerAuctionPayoutFence({ schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V3' } as DemoMaintainerExactBranchTemplate))
            .rejects.toThrow(/requires an authenticated durable winner fence/)
        await assertDemoMaintainerAuctionPayoutFence({ schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2' } as DemoMaintainerExactBranchTemplate)
    })

    test('monotonic observations survive restart and reject regression and same-height mutation', async () => {
        const held = await fixture()
        try {
            await held.authority.registerExact(held.envelope)
            const observed = structuredClone(held.auction)
            held.registry.observeAuctionExact({ ...observed, stateHeight: 22 })
            held.stateDb.close(false); held.anchorDb.close(false)
            const state = new Database(held.statePath), anchor = new Database(held.anchorPath)
            try {
                const registry = new DemoFridayAuctionPayoutRegistrySqlite(state, 'deployment-1', new DemoFridayAuctionPayoutRollbackAnchorSqlite(anchor))
                expect(() => registry.observeAuctionExact(observed)).toThrow(/regressed/)
                expect(() => registry.observeAuctionExact({ ...observed, stateHeight: 22, appHash: 'f'.repeat(64) })).toThrow(/conflicts/)
                registry.observeAuctionExact({ ...observed, stateHeight: 22 })
            } finally { state.close(false); anchor.close(false) }
        } finally { held.recipient.dispose() }
    })

    test('concurrent conflicting winner claims preserve the exact fence across repeated restart', async () => {
        const held = await fixture()
        try {
            await held.authority.registerExact(held.envelope)
            const first = (await held.authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-a', bidderActor: bidderA, bidAmount: 111, replacesBidId: '' }))!
            const second = (await held.authority.selectExact({ auctionId: 'auction-1', fundingOperationId: 'funding-b', bidderActor: bidderB, bidAmount: 121, replacesBidId: '' }))!
            const outcome: DemoFridayAuctionPayoutWinnerOutcomeV1 = { schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_OUTCOME_V1', auctionId: 'auction-1', winnerFundingOperationId: 'funding-a', winnerActor: bidderA, winningAmount: 111, stateHeight: 40, appHash: 'b'.repeat(64), closedAt: 4601 }
            const results = await Promise.allSettled([
                held.authority.claimWinnerExact({ selection: first, outcome }),
                held.authority.claimWinnerExact({ selection: second, outcome: { ...outcome, winnerFundingOperationId: 'funding-b', winnerActor: bidderB, winningAmount: 121 } }),
            ])
            expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
            // Crash before external effect: durable claim must not be released.
            held.stateDb.close(false); held.anchorDb.close(false)
            for (let restart = 0; restart < 2; restart++) {
                const state = new Database(held.statePath), anchor = new Database(held.anchorPath)
                try {
                    const registry = new DemoFridayAuctionPayoutRegistrySqlite(state, 'deployment-1', new DemoFridayAuctionPayoutRollbackAnchorSqlite(anchor))
                    const claim = registry.readWinnerByAuctionExact('auction-1')!
                    expect(registry.claimWinnerExact(claim)).toEqual(claim)
                    expect(() => registry.claimWinnerExact({ ...claim, fundingOperationId: 'funding-b', selectionDigest: second.selectionDigest, selection: second }))
                        .toThrow(/already paid another winner/)
                } finally { state.close(false); anchor.close(false) }
            }
        } finally { held.recipient.dispose() }
    })
})


test('V3 effect gate awaits durable claim and propagates pre/post-claim crashes before mint or restore', async () => {
    const branch = { schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V3' } as DemoMaintainerExactBranchTemplate
    let mintCalls = 0, restoreCalls = 0, durable = false
    const run = async (mode: 'mint' | 'restore', claim: () => Promise<void>) => {
        await assertDemoMaintainerAuctionPayoutFence(branch, claim)
        if (mode === 'mint') mintCalls++
        else restoreCalls++
    }
    for (const mode of ['mint', 'restore'] as const) {
        await expect(run(mode, async () => { throw new Error('before claim commit') })).rejects.toThrow(/before claim/)
        await expect(run(mode, async () => { durable = true; throw new Error('after claim commit') })).rejects.toThrow(/after claim/)
    }
    expect(durable).toBe(true)
    expect({ mintCalls, restoreCalls }).toEqual({ mintCalls: 0, restoreCalls: 0 })
    await run('mint', async () => { expect(durable).toBe(true) })
    // Lost mint response: restart/recovery still passes the identical fence.
    await run('restore', async () => { expect(durable).toBe(true) })
    expect({ mintCalls, restoreCalls }).toEqual({ mintCalls: 1, restoreCalls: 1 })
})


// Separate OS processes share only SQLite files. The mint is a durable local
// receipt fixture, not a network mint; SIGKILL exercises real SQLite reopening.
const payoutProcessScript = `
import { Database } from 'bun:sqlite';
const { DemoFridayAuctionPayoutRegistrySqlite, DemoFridayAuctionPayoutRollbackAnchorSqlite } = await import(process.argv[1]);
const [statePath, anchorPath, claimJson, mode, mintPath] = process.argv.slice(2);
const state = new Database(statePath), anchor = new Database(anchorPath);
state.exec('PRAGMA busy_timeout=5000'); anchor.exec('PRAGMA busy_timeout=5000');
const registry = new DemoFridayAuctionPayoutRegistrySqlite(state, 'deployment-1', new DemoFridayAuctionPayoutRollbackAnchorSqlite(anchor));
const claim = JSON.parse(claimJson);
const pause = async () => { console.log('READY'); await Bun.stdin.stream().getReader().read(); };
try {
 if (mode === 'race') await pause();
 registry.claimWinnerExact(claim);
 if (mode === 'before-mint') await pause();
 if (mode === 'after-mint' || mode === 'resume') {
  const mint = new Database(mintPath);
  mint.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts (operation_id TEXT PRIMARY KEY, selection_digest TEXT NOT NULL) STRICT');
  mint.query('INSERT OR IGNORE INTO receipts VALUES (?,?)').run(claim.fundingOperationId, claim.selectionDigest);
  mint.close(false);
 }
 if (mode === 'after-mint') await pause();
 console.log('CLAIMED');
} catch (error) { console.error(String(error)); process.exitCode = 2; }
state.close(false); anchor.close(false);
`

async function readyPayoutProcess(child: ReturnType<typeof Bun.spawn>) {
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader()
    const value = await reader.read()
    reader.releaseLock()
    expect(new TextDecoder().decode(value.value)).toContain('READY')
}

function payoutChild(held: Awaited<ReturnType<typeof fixture>>, claim: unknown, mode: string) {
    return Bun.spawn([process.execPath, '-e', payoutProcessScript,
        join(import.meta.dir, 'demo-friday-auction-payout-runtime.ts'), held.statePath, held.anchorPath,
        JSON.stringify(claim), mode, join(held.root, 'mock-mint.sqlite3')],
        { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
}

async function processClaims(held: Awaited<ReturnType<typeof fixture>>) {
    await held.authority.registerExact(held.envelope)
    const selections = await Promise.all(['funding-a', 'funding-b'].map((fundingOperationId, i) => held.authority.selectExact({
        auctionId: 'auction-1', fundingOperationId, bidderActor: i ? bidderB : bidderA, bidAmount: i ? 121 : 111, replacesBidId: '',
    })))
    return selections.map(selection => ({ schema: 'PLEBEIAN_FRIDAY_AUCTION_PAYOUT_WINNER_CLAIM_V1',
        auctionId: selection!.auctionId, authorizationDigest: selection!.authorizationDigest,
        fundingOperationId: selection!.fundingOperationId, selectionDigest: selection!.selectionDigest,
        selection, outcomeHeight: 40, closedAt: 4601 }))
}

test('two OS processes racing different winners allow exactly one durable claim', async () => {
    const held = await fixture()
    const children: ReturnType<typeof payoutChild>[] = []
    try {
        const claims = await processClaims(held)
        for (const claim of claims) children.push(payoutChild(held, claim, 'race'))
        await Promise.all(children.map(readyPayoutProcess))
        for (const child of children) { child.stdin.write('go'); child.stdin.end() }
        const exits = await Promise.all(children.map(child => child.exited))
        expect(exits.sort()).toEqual([0, 2])
        const failures = await Promise.all(children.map(child => new Response(child.stderr).text()))
        expect(failures.join('')).toContain('already paid another winner')
        expect(claims.map(claim => claim.fundingOperationId)).toContain(held.registry.readWinnerByAuctionExact('auction-1')!.fundingOperationId)
    } finally {
        for (const child of children) child.kill()
        held.recipient.dispose(); held.stateDb.close(false); held.anchorDb.close(false)
    }
}, 15000)

for (const mode of ['before-mint', 'after-mint']) {
    test(`SIGKILL ${mode} preserves winner fence and exact mock-mint recovery`, async () => {
        const held = await fixture()
        let child: ReturnType<typeof payoutChild> | undefined
        try {
            const [claim, conflicting] = await processClaims(held)
            child = payoutChild(held, claim, mode)
            await readyPayoutProcess(child)
            child.kill('SIGKILL')
            expect(await child.exited).not.toBe(0)
            const rival = payoutChild(held, conflicting, 'resume')
            expect(await rival.exited).toBe(2)
            expect(await new Response(rival.stderr).text()).toContain('already paid another winner')
            for (let replay = 0; replay < 2; replay++) {
                const resumed = payoutChild(held, claim, 'resume')
                expect(await resumed.exited).toBe(0)
            }
            const mint = new Database(join(held.root, 'mock-mint.sqlite3'))
            try {
                expect(mint.query('SELECT * FROM receipts').all()).toEqual([
                    { operation_id: claim!.fundingOperationId, selection_digest: claim!.selectionDigest },
                ])
            } finally { mint.close(false) }
        } finally {
            child?.kill(); held.recipient.dispose(); held.stateDb.close(false); held.anchorDb.close(false)
        }
    }, 15000)
}
