/**
 * Cashu mint mock for e2e tests.
 *
 * Intercepts HTTP requests to a Cashu mint URL and serves pre-computed
 * responses. Each NUT-7 checkstate query is answered from a table of
 * known proof_y → state mappings, so tests can assert specific outcomes
 * (spent, unspent, pending) without contacting a real mint.
 *
 * Pre-computed token fixtures (see MOCK_TOKENS below) are generated with
 * fixed P2PK lock secrets, so the proof_y, lockSecret, and cashuB token
 * string are all deterministic and can be imported directly in tests.
 *
 * The mock also handles /v1/swap for the publishAuctionSettlement pipeline
 * (receiveLockedEcash). The swap handler echoes back blinded messages as
 * signatures — the resulting proofs are invalid but the swap call succeeds,
 * allowing the settlement event to be published.
 *
 * Usage:
 *   await CashuMintMock.setup(page, MINT_URL)
 *   // ... later, in a test:
 *   const token = MOCK_TOKENS.unspent.token
 *   const proofY = MOCK_TOKENS.unspent.proofY
 */

import type { Page } from '@playwright/test'

// ─── Pre-computed token fixtures ─────────────────────────────

export interface MockToken {
	/** hash_to_curve(secret) — the compressed secp256k1 Y value (66 hex) */
	proofY: string
	/** Cashu token string (cashuB...) ready for a kind-1025 cashu_token tag */
	token: string
	/** The P2PK lock secret JSON (used as the proof `secret` field) */
	lockSecret: string
	/** The NUT-7 state the mock will return for this proof_y */
	nut7State: 'UNSPENT' | 'PENDING' | 'SPENT'
}

/**
 * Fixed mint URL used by all pre-computed fixtures.
 * The mock intercepts all requests to this URL.
 */
export const MOCK_MINT_URL = 'https://testnut.cashu.space'

/**
 * Locktime constants for mock tokens. Tests must set
 * `auction.maxEndAt + auction.settlementGrace` to match the token's locktime.
 */
/** Locktime for past-window tokens (settlement window expired). */
export const MOCK_LOCKTIME_PAST = 150

/** Locktime for future-window tokens (settlement window still open). Year 2033. */
export const MOCK_LOCKTIME_FUTURE = 2000000000

/** Fixed keyset ID used by all mock tokens. */
export const MOCK_KEYSET_ID = '0000000000000000'

/**
 * Auction p2pk_xpub. In passive tests (1-9) this is used directly in
 * the auction event's p2pk_xpub tag. In the Publish Settlement UI test,
 * the xpub is computed dynamically from the wallet's actual keys via
 * deriveDynamicWalletKeys(), so this value is only used by passive tests.
 *
 * Computed from a fixed wallet key pair via:
 *   HDKey.fromMasterSeed(sha512(context:p2pk:privkey)).derive("m/30408'/0'/0'")
 */
export const MOCK_XPUB = 'xpub6CHGS91EATnrt7a3wBLqCeJ13KvVXQp3m39ufe1TYiFxHHmAK1TiwfrT1N89CAHNLa9YQgbJAyysBZTiRRH38wTvYeBiYvgRrqxALmvghTH'

/** HD derivation child pubkey (compressed secp256k1, 66 hex) at m/0. */
export const MOCK_CHILD_PUBKEY = '02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0'

/** Refund pubkey (compressed secp256k1, 66 hex). */
export const MOCK_REFUND_PUBKEY = '0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5'

/** Proof amount in all mock tokens. */
export const MOCK_PROOF_AMOUNT = 50000

/**
 * Pre-computed P2PK tokens with known NUT-7 states.
 *
 * Each token uses the same wallet-derived child pubkey and refund key but
 * a different nonce, producing distinct proof_y values. The mock mint
 * will return the associated `nut7State` for each proof_y in a NUT-7
 * checkstate query.
 *
 * Shared crypto values (identical across all tokens):
 *   xpub:        xpub6CHGS91EATnrt7a3wBLqCeJ13KvVXQp3m39ufe1TYiFxHHmAK1TiwfrT1N89CAHNLa9YQgbJAyysBZTiRRH38wTvYeBiYvgRrqxALmvghTH
 *   childPubkey: 02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0
 *   refundKey:   0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5
 *   C:           034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa
 *   amount:      50000
 */
export const MOCK_TOKENS = {
	unspent: {
		proofY: '023d5fb1f71aa08f907ce34a0cdebea8c52d35648756dd6392254b1cbf897944bc',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBK1siUDJQSyIseyJub25jZSI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiZGF0YSI6IjAyYzcxM2UwOTZkZjRmMzc0YjMyZDFjYjBlOTZkNzE2ZjE4MmZiNjJjMTVjZjdiZDk5YzNhODE2ZmFkMzJmMzBlMCIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMTUwIl0sWyJyZWZ1bmQiLCIwMjY4NjgwNzM3Yzc2ZGFiYjgwMWNiMjIwNGY1N2RiZTRlNDU3OWU0ZjcxMGNkNjdkYzFiNDIyNzU5MmM4MWU5YjUiXSxbIm5fc2lnc19yZWZ1bmQiLCIxIl0sWyJzaWdmbGFnIiwiU0lHX0lOUFVUUyJdXX1dYWNYIQNPNVvct8wK9yjvPM65YV2QaEu1sspfhZqw8LcEB1hxqg',
		lockSecret:
			'["P2PK",{"nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","data":"02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
		nut7State: 'UNSPENT' as const,
	},
	spent: {
		proofY: '02844eeb7c0110a286712cf8e2a63b396aae08bb41515828e80af449dc31515f82',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBK1siUDJQSyIseyJub25jZSI6ImJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiIiwiZGF0YSI6IjAyYzcxM2UwOTZkZjRmMzc0YjMyZDFjYjBlOTZkNzE2ZjE4MmZiNjJjMTVjZjdiZDk5YzNhODE2ZmFkMzJmMzBlMCIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMTUwIl0sWyJyZWZ1bmQiLCIwMjY4NjgwNzM3Yzc2ZGFiYjgwMWNiMjIwNGY1N2RiZTRlNDU3OWU0ZjcxMGNkNjdkYzFiNDIyNzU5MmM4MWU5YjUiXSxbIm5fc2lnc19yZWZ1bmQiLCIxIl0sWyJzaWdmbGFnIiwiU0lHX0lOUFVUUyJdXX1dYWNYIQNPNVvct8wK9yjvPM65YV2QaEu1sspfhZqw8LcEB1hxqg',
		lockSecret:
			'["P2PK",{"nonce":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","data":"02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
		nut7State: 'SPENT' as const,
	},
	pending: {
		proofY: '02e015e38e0c6097cef803558a77f73e7702044f3bb871f7960c33e248ff571688',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBK1siUDJQSyIseyJub25jZSI6ImNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjIiwiZGF0YSI6IjAyYzcxM2UwOTZkZjRmMzc0YjMyZDFjYjBlOTZkNzE2ZjE4MmZiNjJjMTVjZjdiZDk5YzNhODE2ZmFkMzJmMzBlMCIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMTUwIl0sWyJyZWZ1bmQiLCIwMjY4NjgwNzM3Yzc2ZGFiYjgwMWNiMjIwNGY1N2RiZTRlNDU3OWU0ZjcxMGNkNjdkYzFiNDIyNzU5MmM4MWU5YjUiXSxbIm5fc2lnc19yZWZ1bmQiLCIxIl0sWyJzaWdmbGFnIiwiU0lHX0lOUFVUUyJdXX1dYWNYIQNPNVvct8wK9yjvPM65YV2QaEu1sspfhZqw8LcEB1hxqg',
		lockSecret:
			'["P2PK",{"nonce":"cccccccccccccccccccccccccccccccc","data":"02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
		nut7State: 'PENDING' as const,
	},
	/** Token with a future locktime (year 2033) — settlement window still open. */
	unspentFuture: {
		proofY: '0205110fc3ac905384000bdd11f2977d22148ff7fe1cab680971389626fdf8b06e',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBMlsiUDJQSyIseyJub25jZSI6ImRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkIiwiZGF0YSI6IjAyYzcxM2UwOTZkZjRmMzc0YjMyZDFjYjBlOTZkNzE2ZjE4MmZiNjJjMTVjZjdiZDk5YzNhODE2ZmFkMzJmMzBlMCIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMjAwMDAwMDAwMCJdLFsicmVmdW5kIiwiMDI2ODY4MDczN2M3NmRhYmI4MDFjYjIyMDRmNTdkYmU0ZTQ1NzllNGY3MTBjZDY3ZGMxYjQyMjc1OTJjODFlOWI1Il0sWyJuX3NpZ3NfcmVmdW5kIiwiMSJdLFsic2lnZmxhZyIsIlNJR19JTlBVVFMiXV19XWFjWCEDTzVb3LfMCvco7zzOuWFdkGhLtbLKX4WasPC3BAdYcao',
		lockSecret:
			'["P2PK",{"nonce":"dddddddddddddddddddddddddddddddd","data":"02c713e096df4f374b32d1cb0e96d716f182fb62c15cf7bd99c3a816fad32f30e0","tags":[["n_sigs","1"],["locktime","2000000000"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
		nut7State: 'UNSPENT' as const,
	},
} satisfies Record<string, MockToken>

// ─── Mock mint info response ────────────────────────────────

const MOCK_MINT_INFO = {
	name: 'E2E Mock Mint',
	pubkey: '02'.repeat(32),
	version: '1.0.0',
	description: 'Mock Cashu mint for e2e testing',
	description_long: '',
	contact: [],
	mots: [],
	icon_url: '',
	time: 1730000000,
	nuts: {
		'4': { methods: [{ endpoint: 'bolt11', supported: true }], disabled: false },
		'5': { methods: [{ endpoint: 'bolt11', supported: true }], disabled: false },
		'7': { supported: true },
		'8': { supported: true },
		'9': { supported: true },
		'10': { supported: true },
		'11': { supported: true },
		'12': { supported: true },
		'20': { supported: true },
	},
}

const MOCK_KEYSETS = {
	keysets: [{ id: MOCK_KEYSET_ID, unit: 'sat', active: true, finalised: false }],
}

// ─── Mock class ─────────────────────────────────────────────

export interface CashuMintMockOptions {
	/** Default NUT-7 state for proof_y values not in MOCK_TOKENS. Defaults to 'UNSPENT'. */
	defaultState?: 'UNSPENT' | 'PENDING' | 'SPENT'
	/** Override the mint URL (defaults to MOCK_MINT_URL). */
	mintUrl?: string
}

export class CashuMintMock {
	private constructor(
		private readonly mintUrl: string,
		private readonly defaultState: 'UNSPENT' | 'PENDING' | 'SPENT',
	) {}

	/**
	 * Intercept all HTTP requests to the mint URL.
	 * Must be called BEFORE the page navigates to the app.
	 */
	static async setup(page: Page, options?: CashuMintMockOptions): Promise<CashuMintMock> {
		const mintUrl = options?.mintUrl ?? MOCK_MINT_URL
		const defaultState = options?.defaultState ?? 'UNSPENT'
		const mock = new CashuMintMock(mintUrl, defaultState)

		await page.route(`${mintUrl}/**`, async (route) => {
			const url = route.request().url()
			const method = route.request().method()

			// NUT-7: checkstate
			if (url.endsWith('/v1/checkstate') && method === 'POST') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(mock.handleCheckState(route.request().postData() ?? undefined)),
				})
				return
			}

			// Mint info
			if (url.endsWith('/v1/info') && method === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(MOCK_MINT_INFO),
				})
				return
			}

			// Keysets list
			if (url.endsWith('/v1/keysets') && method === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(MOCK_KEYSETS),
				})
				return
			}

			// Keys (mint public keys for blind signature verification)
			// Provide dummy keys for all power-of-2 amounts up to 2^16.
			// The mock /v1/swap handler echoes B_ as C_ without real
			// signing, so the keys don't need to be cryptographically valid.
			if (url.includes('/v1/keys') && method === 'GET') {
				const dummyKey = '034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa'
				const keys: Record<string, string> = {}
				for (let i = 0; i <= 16; i++) {
					keys[String(2 ** i)] = dummyKey
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						keysets: [{ id: MOCK_KEYSET_ID, unit: 'sat', keys }],
					}),
				})
				return
			}

			// NUT-12: swap (for receiveLockedEcash in publishAuctionSettlement)
			if (url.endsWith('/v1/swap') && method === 'POST') {
				const body = JSON.parse(route.request().postData() ?? '{}')
				const outputs: Array<{ amount: number; id: string; B_: string }> = body.outputs ?? []
				// Echo back blinded messages as signatures. The resulting proofs
				// are cryptographically invalid, but the swap call succeeds,
				// allowing the settlement pipeline to publish kind-1024.
				const signatures = outputs.map((o) => ({
					amount: o.amount,
					id: o.id,
					C_: o.B_,
				}))
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ signatures }),
				})
				return
			}

			// ADR-0005: no external service dependencies in tests.
			// Abort unmocked requests instead of forwarding to the real mint.
			await route.abort('external-test-dependency-blocked')
		})

		return mock
	}

	/**
	 * Handle a NUT-7 checkstate request.
	 * Looks up each Y in the MOCK_TOKENS table and returns the associated state.
	 * Unknown Ys get the default state.
	 */
	private handleCheckState(postData: string | undefined): { states: { Y: string; state: string; witness: string }[] } {
		let requestedYs: string[] = []
		try {
			const body = JSON.parse(postData ?? '{}')
			requestedYs = Array.isArray(body.Ys) ? body.Ys : []
		} catch {
			return { states: [] }
		}

		// Build a lookup table from MOCK_TOKENS
		const stateByY = new Map<string, string>()
		for (const token of Object.values(MOCK_TOKENS)) {
			stateByY.set(token.proofY.toLowerCase(), token.nut7State)
		}

		const states = requestedYs.map((Y) => ({
			Y,
			state: stateByY.get(Y.toLowerCase()) ?? this.defaultState,
			witness: '',
		}))

		return { states }
	}
}
