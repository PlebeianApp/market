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
export const MOCK_KEYSET_ID = '00000000000000000000000000000000'

/** Shared xpub used to derive the child pubkey in all mock tokens. */
export const MOCK_XPUB = 'xpub661MyMwAqRbcH1vUiLWqq4r4aHLuY7SU3m5CbuExkFfL6HohdcUmqbJfhccvv3g5zwMBu57oq59icgs1sCnsMXeDdVZQrvTLcS1fokbsGMT'

/** HD derivation child pubkey (compressed secp256k1, 66 hex). */
export const MOCK_CHILD_PUBKEY = '029d7d2e438394b3cd379980648bc3cd1f5146de2c2495bfade6fb5b0df7391ce7'

/** Refund pubkey (compressed secp256k1, 66 hex). */
export const MOCK_REFUND_PUBKEY = '0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5'

/** Proof amount in all mock tokens. */
export const MOCK_PROOF_AMOUNT = 50000

/**
 * Pre-computed P2PK tokens with known NUT-7 states.
 *
 * Each token uses the same xpub-derived child pubkey and refund key but
 * a different nonce, producing distinct proof_y values. The mock mint
 * will return the associated `nut7State` for each proof_y in a NUT-7
 * checkstate query.
 *
 * Shared crypto values (identical across all tokens):
 *   xpub:        xpub661MyMwAqRbcH1vUiLWqq4r4aHLuY7SU3m5CbuExkFfL6HohdcUmqbJfhccvv3g5zwMBu57oq59icgs1sCnsMXeDdVZQrvTLcS1fokbsGMT
 *   childPubkey: 029d7d2e438394b3cd379980648bc3cd1f5146de2c2495bfade6fb5b0df7391ce7
 *   refundKey:   0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5
 *   C:           034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa
 *   amount:      50000
 */
export const MOCK_TOKENS = {
	unspent: {
		proofY: '027b78fbe27f4098f45e1e9e7d7e9fd9fb8f462f2109272153ee1ab2711cda7244',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBK1siUDJQSyIseyJub25jZSI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwiZGF0YSI6IjAyOWQ3ZDJlNDM4Mzk0YjNjZDM3OTk4MDY0OGJjM2NkMWY1MTQ2ZGUyYzI0OTViZmFkZTZmYjViMGRmNzM5MWNlNyIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMTUwIl0sWyJyZWZ1bmQiLCIwMjY4NjgwNzM3Yzc2ZGFiYjgwMWNiMjIwNGY1N2RiZTRlNDU3OWU0ZjcxMGNkNjdkYzFiNDIyNzU5MmM4MWU5YjUiXSxbIm5fc2lnc19yZWZ1bmQiLCIxIl0sWyJzaWdmbGFnIiwiU0lHX0lOUFVUUyJdXX1dYWNYIQNPNVvct8wK9yjvPM65YV2QaEu1sspfhZqw8LcEB1hxqg',
		lockSecret:
			'["P2PK",{"nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","data":"029d7d2e438394b3cd379980648bc3cd1f5146de2c2495bfade6fb5b0df7391ce7","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
		nut7State: 'UNSPENT' as const,
	},
	spent: {
		proofY: '02c341da22e82ea1a6bf0c324aef5f316dcdc8d058cf65068df9c17e79c5ac424a',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBK1siUDJQSyIseyJub25jZSI6ImJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiIiwiZGF0YSI6IjAyOWQ3ZDJlNDM4Mzk0YjNjZDM3OTk4MDY0OGJjM2NkMWY1MTQ2ZGUyYzI0OTViZmFkZTZmYjViMGRmNzM5MWNlNyIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMTUwIl0sWyJyZWZ1bmQiLCIwMjY4NjgwNzM3Yzc2ZGFiYjgwMWNiMjIwNGY1N2RiZTRlNDU3OWU0ZjcxMGNkNjdkYzFiNDIyNzU5MmM4MWU5YjUiXSxbIm5fc2lnc19yZWZ1bmQiLCIxIl0sWyJzaWdmbGFnIiwiU0lHX0lOUFVUUyJdXX1dYWNYIQNPNVvct8wK9yjvPM65YV2QaEu1sspfhZqw8LcEB1hxqg',
		lockSecret:
			'["P2PK",{"nonce":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","data":"029d7d2e438394b3cd379980648bc3cd1f5146de2c2495bfade6fb5b0df7391ce7","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
		nut7State: 'SPENT' as const,
	},
	pending: {
		proofY: '02d55d252dac1e828b10b20e21dd8ad72b8aed5c0cae5050a6970421c938f9153d',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBK1siUDJQSyIseyJub25jZSI6ImNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjIiwiZGF0YSI6IjAyOWQ3ZDJlNDM4Mzk0YjNjZDM3OTk4MDY0OGJjM2NkMWY1MTQ2ZGUyYzI0OTViZmFkZTZmYjViMGRmNzM5MWNlNyIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMTUwIl0sWyJyZWZ1bmQiLCIwMjY4NjgwNzM3Yzc2ZGFiYjgwMWNiMjIwNGY1N2RiZTRlNDU3OWU0ZjcxMGNkNjdkYzFiNDIyNzU5MmM4MWU5YjUiXSxbIm5fc2lnc19yZWZ1bmQiLCIxIl0sWyJzaWdmbGFnIiwiU0lHX0lOUFVUUyJdXX1dYWNYIQNPNVvct8wK9yjvPM65YV2QaEu1sspfhZqw8LcEB1hxqg',
		lockSecret:
			'["P2PK",{"nonce":"cccccccccccccccccccccccccccccccc","data":"029d7d2e438394b3cd379980648bc3cd1f5146de2c2495bfade6fb5b0df7391ce7","tags":[["n_sigs","1"],["locktime","150"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
		nut7State: 'PENDING' as const,
	},
	/** Token with a future locktime (year 2033) — settlement window still open. */
	unspentFuture: {
		proofY: '020104e1cca732603ae24f138994a00059bef85ebf471d70755c9ee5b2befee5ab',
		token:
			'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAAAAAAAAAABhcIGjYWEZw1Bhc3kBMlsiUDJQSyIseyJub25jZSI6ImRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkIiwiZGF0YSI6IjAyOWQ3ZDJlNDM4Mzk0YjNjZDM3OTk4MDY0OGJjM2NkMWY1MTQ2ZGUyYzI0OTViZmFkZTZmYjViMGRmNzM5MWNlNyIsInRhZ3MiOltbIm5fc2lncyIsIjEiXSxbImxvY2t0aW1lIiwiMjAwMDAwMDAwMCJdLFsicmVmdW5kIiwiMDI2ODY4MDczN2M3NmRhYmI4MDFjYjIyMDRmNTdkYmU0ZTQ1NzllNGY3MTBjZDY3ZGMxYjQyMjc1OTJjODFlOWI1Il0sWyJuX3NpZ3NfcmVmdW5kIiwiMSJdLFsic2lnZmxhZyIsIlNJR19JTlBVVFMiXV19XWFjWCEDTzVb3LfMCvco7zzOuWFdkGhLtbLKX4WasPC3BAdYcao',
		lockSecret:
			'["P2PK",{"nonce":"dddddddddddddddddddddddddddddddd","data":"029d7d2e438394b3cd379980648bc3cd1f5146de2c2495bfade6fb5b0df7391ce7","tags":[["n_sigs","1"],["locktime","2000000000"],["refund","0268680737c76dabb801cb2204f57dbe4e4579e4f710cd67dc1b4227592c81e9b5"],["n_sigs_refund","1"],["sigflag","SIG_INPUTS"]]}]',
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
					body: JSON.stringify(mock.handleCheckState(route.request().postData())),
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
			if (url.includes('/v1/keys') && method === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						keysets: [{ id: MOCK_KEYSET_ID, unit: 'sat', keys: {} }],
					}),
				})
				return
			}

			// ADR-0005: no external service dependencies in tests.
			// Abort unmocked requests instead of forwarding to the real mint.
			await route.abort('failed', `CashuMintMock: unmocked ${method} ${url}`)
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
