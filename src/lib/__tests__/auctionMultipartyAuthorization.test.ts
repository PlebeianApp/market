import { describe, expect, test } from 'bun:test'
import { base64urlnopad } from '@scure/base'
import { HDKey } from '@scure/bip32'
import type { NostrEventLike } from '../nostr/eventLike'
import {
	AUCTION_MULTIPARTY_ACTIVATION_KIND,
	AUCTION_MULTIPARTY_ENTITLEMENT_BASIS,
	AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND,
	AUCTION_MULTIPARTY_ROOT_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND,
	AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT,
	AuctionMultipartyAuthorizationError,
	parseMultipartyPayoutCapability,
	parseMultipartyRoot,
	parseMultipartySellerActivation,
	parseMultipartyValidatorAcceptance,
	parseMultipartyValidatorOffer,
	validateMultipartyAuthorizationSnapshotRelations,
} from '../auction/multipartyAuthorization'
import {
	AUCTION_MULTIPARTY_SETTLEMENT_POLICY,
	compileSourceSchedule,
	type AuctionMultipartySourceScheduleEntry,
} from '../auction/multipartySchedule'

const SELLER = 'aa'.repeat(32)
const VALIDATOR = '11'.repeat(32)
const V4V = '22'.repeat(32)
const EXTRA_AUDITOR = '12'.repeat(32)

const ROOT_ID = 'bb'.repeat(32)
const VALIDATOR_CAPABILITY_ID = '33'.repeat(32)
const V4V_CAPABILITY_ID = '44'.repeat(32)
const OFFER_ID = '55'.repeat(32)
const ACCEPTANCE_ID = '66'.repeat(32)
const ACTIVATION_ID = '77'.repeat(32)

const SIG = '99'.repeat(64)

const MINT_A = 'https://mint-a.example'
const MINT_B = 'https://mint-b.example'
const MINT_C = 'https://mint-c.example'

const START_AT = 1_800_000_000
const MAX_END_AT = 1_800_003_600

const xpub = (seedByte: number): string => HDKey.fromMasterSeed(new Uint8Array(32).fill(seedByte)).publicExtendedKey

const SELLER_XPUB = xpub(1)
const VALIDATOR_XPUB = xpub(2)
const V4V_XPUB = xpub(3)

const scheduleEntries = (validatorBps = 625, v4vBps = 313): AuctionMultipartySourceScheduleEntry[] => [
	{
		role: 'validator',
		recipient_pubkey: VALIDATOR,
		payout_capability_event_id: VALIDATOR_CAPABILITY_ID,
		allocation_bps: validatorBps,
		validator_offer_event_id: OFFER_ID,
	},
	{
		role: 'v4v',
		recipient_pubkey: V4V,
		payout_capability_event_id: V4V_CAPABILITY_ID,
		allocation_bps: v4vBps,
	},
]

const makeEvent = (kind: number, id: string, pubkey: string, tags: string[][], content = ''): NostrEventLike => ({
	id,
	pubkey,
	kind,
	created_at: START_AT - 100,
	content,
	tags,
	sig: SIG,
})

const cloneEvent = (event: NostrEventLike, patch: Partial<NostrEventLike> = {}): NostrEventLike => ({
	...event,
	...patch,
	tags: patch.tags ? patch.tags.map((tag) => [...tag]) : event.tags.map((tag) => [...tag]),
})

const rootEvent = (
	source = scheduleEntries(),
	options: {
		auditors?: string[]
		quorum?: string
		mints?: string[]
		commitment?: string
		scheduleB64u?: string
		extraTags?: string[][]
	} = {},
): NostrEventLike => {
	const schedule = compileSourceSchedule(source)
	const encoded = options.scheduleB64u ?? base64urlnopad.encode(schedule.canonical_bytes)

	const auditors = options.auditors ?? [VALIDATOR, EXTRA_AUDITOR]
	const mints = options.mints ?? [MINT_A, MINT_B]

	return makeEvent(
		AUCTION_MULTIPARTY_ROOT_KIND,
		ROOT_ID,
		SELLER,
		[
			['d', 'demo-auction'],
			['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
			['payout_schedule_commitment', options.commitment ?? schedule.schedule_commitment],
			['payout_schedule', `b64u:${encoded}`],
			['start_at', String(START_AT)],
			['max_end_at', String(MAX_END_AT)],
			['p2pk_xpub', SELLER_XPUB],
			...mints.map((mint) => ['mint', mint]),
			...auditors.map((auditor) => ['auditors', auditor]),
			['auditor_quorum', options.quorum ?? '1'],
			...(options.extraTags ?? []),
		],
		'auction display content',
	)
}

const capabilityEvent = (id: string, pubkey: string, payoutXpub: string, mints = [MINT_A, MINT_B]): NostrEventLike =>
	makeEvent(AUCTION_MULTIPARTY_PAYOUT_CAPABILITY_KIND, id, pubkey, [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_xpub', payoutXpub],
		['payout_xpub_pop', '88'.repeat(64)],
		...mints.map((mint) => ['mint', mint]),
		['valid_from', String(START_AT - 1000)],
		['expires_at', String(MAX_END_AT + 1000)],
	])

const offerEvent = (mints = [MINT_A, MINT_B], allocation = '625'): NostrEventLike =>
	makeEvent(AUCTION_MULTIPARTY_VALIDATOR_OFFER_KIND, OFFER_ID, VALIDATOR, [
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_capability', VALIDATOR_CAPABILITY_ID],
		['allocation_bps', allocation],
		['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
		['service_contract', AUCTION_MULTIPARTY_VALIDATOR_SERVICE_CONTRACT],
		...mints.map((mint) => ['mint', mint]),
		['valid_from', String(START_AT - 1000)],
		['expires_at', String(MAX_END_AT + 1000)],
	])

const acceptanceEvent = (): NostrEventLike => {
	const root = parseMultipartyRoot(rootEvent())

	return makeEvent(AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND, ACCEPTANCE_ID, VALIDATOR, [
		['e', ROOT_ID],
		['a', root.coordinate],
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_schedule_commitment', root.payout_schedule_commitment],
		['schedule_index', '0'],
		['payout_capability', VALIDATOR_CAPABILITY_ID],
		['validator_offer', OFFER_ID],
		['allocation_bps', '625'],
		['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
		['expires_at', String(MAX_END_AT + 1000)],
	])
}

const activationEvent = (mints = [MINT_A, MINT_B], acceptanceId = ACCEPTANCE_ID): NostrEventLike => {
	const root = parseMultipartyRoot(rootEvent())

	return makeEvent(AUCTION_MULTIPARTY_ACTIVATION_KIND, ACTIVATION_ID, SELLER, [
		['e', ROOT_ID],
		['a', root.coordinate],
		['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
		['payout_schedule_commitment', root.payout_schedule_commitment],
		...mints.map((mint) => ['mint', mint]),
		['acceptance', '0', acceptanceId],
	])
}

const expectAuthError = (expectedCode: string, operation: () => unknown): void => {
	try {
		operation()
		throw new Error(`Expected ${expectedCode}, but operation succeeded`)
	} catch (error) {
		expect(error).toBeInstanceOf(AuctionMultipartyAuthorizationError)
		expect((error as AuctionMultipartyAuthorizationError).code).toBe(expectedCode)
	}
}

const validBundle = () => {
	const root = parseMultipartyRoot(rootEvent())
	const validatorCapability = parseMultipartyPayoutCapability(capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB))
	const v4vCapability = parseMultipartyPayoutCapability(capabilityEvent(V4V_CAPABILITY_ID, V4V, V4V_XPUB))
	const offer = parseMultipartyValidatorOffer(offerEvent())
	const acceptance = parseMultipartyValidatorAcceptance(acceptanceEvent())
	const activation = parseMultipartySellerActivation(activationEvent())

	return {
		root,
		validatorCapability,
		v4vCapability,
		offer,
		acceptance,
		activation,
	}
}

describe('Auction Multiparty Gate C1 root parsing', () => {
	test('parses exact embedded canonical schedule and root snapshot', () => {
		const root = parseMultipartyRoot(rootEvent())

		expect(root.id).toBe(ROOT_ID)
		expect(root.coordinate).toBe(`${AUCTION_MULTIPARTY_ROOT_KIND}:${SELLER}:demo-auction`)
		expect(root.schedule_entries).toHaveLength(2)
		expect(root.schedule_entries[0].role).toBe('validator')
		expect(root.schedule_entries[1].role).toBe('v4v')
		expect(root.auditor_quorum).toBe(1)
		expect(Object.isFrozen(root)).toBe(true)
		expect(Object.isFrozen(root.schedule_entries)).toBe(true)
	})

	test('allows unrelated zap metadata without changing payout binding', () => {
		const plain = parseMultipartyRoot(rootEvent())
		const withZap = parseMultipartyRoot(
			rootEvent(scheduleEntries(), {
				extraTags: [['zap', 'lnurl-or-routing-metadata']],
			}),
		)

		expect(withZap.payout_schedule_commitment).toBe(plain.payout_schedule_commitment)
		expect(withZap.schedule_entries).toEqual(plain.schedule_entries)
	})

	test('rejects competing zapSplit payout metadata', () => {
		expectAuthError('root_competing_payout_metadata_forbidden', () =>
			parseMultipartyRoot(
				rootEvent(scheduleEntries(), {
					extraTags: [['zapSplit', 'something']],
				}),
			),
		)
	})

	test('rejects competing v4v payout metadata', () => {
		expectAuthError('root_competing_payout_metadata_forbidden', () =>
			parseMultipartyRoot(
				rootEvent(scheduleEntries(), {
					extraTags: [['v4v', 'something']],
				}),
			),
		)
	})

	test('rejects stale commitment against canonical schedule bytes', () => {
		expectAuthError('root_schedule_commitment_mismatch', () =>
			parseMultipartyRoot(
				rootEvent(scheduleEntries(), {
					commitment: '00'.repeat(32),
				}),
			),
		)
	})

	test('rejects padded base64url schedule carriage', () => {
		const schedule = compileSourceSchedule(scheduleEntries())
		const encoded = base64urlnopad.encode(schedule.canonical_bytes)

		expectAuthError('root_payout_schedule_noncanonical', () =>
			parseMultipartyRoot(
				rootEvent(scheduleEntries(), {
					scheduleB64u: `${encoded}=`,
				}),
			),
		)
	})

	test('rejects duplicate settlement policy', () => {
		const event = rootEvent()
		event.tags.push(['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY])

		expectAuthError('root_settlement_policy_duplicate', () => parseMultipartyRoot(event))
	})

	test('rejects unknown profile without seller-only fallback', () => {
		const event = rootEvent()
		event.tags = event.tags.map((tag) =>
			tag[0] === 'settlement_policy' ? ['settlement_policy', 'cashu_p2pk_bidder_path_multiparty_v2'] : tag,
		)

		expectAuthError('root_profile_unsupported', () => parseMultipartyRoot(event))
	})

	test('enforces root tag count before semantic lookup', () => {
		const event = rootEvent()

		for (let index = event.tags.length; index <= 256; index++) {
			event.tags.push(['display', String(index)])
		}

		expectAuthError('root_tag_count_exceeds_limit', () => parseMultipartyRoot(event))
	})

	test('enforces aggregate tag bytes before semantics', () => {
		const event = rootEvent()
		event.tags.push(['display', 'x'.repeat(32_768)])

		expectAuthError('root_tag_bytes_exceeds_limit', () => parseMultipartyRoot(event))
	})

	test('requires every schedule validator to be a root auditor', () => {
		expectAuthError('root_schedule_validator_not_auditor', () =>
			parseMultipartyRoot(
				rootEvent(scheduleEntries(), {
					auditors: [EXTRA_AUDITOR],
				}),
			),
		)
	})

	test('rejects V4V-only schedule as unfundable under validator quorum policy', () => {
		const v4vOnly: AuctionMultipartySourceScheduleEntry[] = [
			{
				role: 'v4v',
				recipient_pubkey: V4V,
				payout_capability_event_id: V4V_CAPABILITY_ID,
				allocation_bps: 313,
			},
		]

		expectAuthError('root_validator_schedule_quorum_insufficient', () =>
			parseMultipartyRoot(
				rootEvent(v4vOnly, {
					auditors: [EXTRA_AUDITOR],
					quorum: '1',
				}),
			),
		)
	})
})

describe('Auction Multiparty Gate C1 authorization event parsing', () => {
	test('parses canonical payout capability', () => {
		const capability = parseMultipartyPayoutCapability(capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB))

		expect(capability.id).toBe(VALIDATOR_CAPABILITY_ID)
		expect(capability.payout_xpub).toBe(VALIDATOR_XPUB)
		expect(capability.mints).toEqual([MINT_A, MINT_B])
		expect(Object.isFrozen(capability)).toBe(true)
	})

	test('rejects xprv in payout capability', () => {
		const xprv = HDKey.fromMasterSeed(new Uint8Array(32).fill(4)).privateExtendedKey

		const event = capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, xprv)

		expectAuthError('capability_payout_xpub_noncanonical', () => parseMultipartyPayoutCapability(event))
	})

	test('rejects unknown capability tags', () => {
		const event = capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB)
		event.tags.push(['latest_policy', 'do-not-resolve-me'])

		expectAuthError('capability_unknown_tag', () => parseMultipartyPayoutCapability(event))
	})

	test('rejects duplicate capability mint identifiers', () => {
		const event = capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB, [MINT_A, MINT_A])

		expectAuthError('capability_mint_set_invalid', () => parseMultipartyPayoutCapability(event))
	})

	test('rejects noncanonical capability mint ordering', () => {
		const event = capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB, [MINT_B, MINT_A])

		expectAuthError('capability_mint_set_noncanonical', () => parseMultipartyPayoutCapability(event))
	})

	test('rejects non-http mint identifiers', () => {
		const event = capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB, ['mint:test:A'])

		expectAuthError('capability_mint_set_invalid', () => parseMultipartyPayoutCapability(event))
	})

	test('rejects reversed capability validity window', () => {
		const event = capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB)
		event.tags = event.tags.map((tag) => (tag[0] === 'valid_from' ? ['valid_from', String(MAX_END_AT + 2000)] : tag))

		expectAuthError('capability_validity_window_invalid', () => parseMultipartyPayoutCapability(event))
	})

	test('requires authorization event content to be empty', () => {
		const event = capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB)
		event.content = 'not allowed'

		expectAuthError('capability_content_nonempty', () => parseMultipartyPayoutCapability(event))
	})

	test('parses zero-BPS validator offer without changing service semantics', () => {
		const offer = parseMultipartyValidatorOffer(offerEvent([MINT_A], '0'))

		expect(offer.allocation_bps).toBe(0)
	})

	test('rejects leading-zero validator offer allocation', () => {
		expectAuthError('offer_allocation_bps_noncanonical', () => parseMultipartyValidatorOffer(offerEvent([MINT_A], '0625')))
	})

	test('rejects mutable-policy substitution in exact offer wire', () => {
		const event = offerEvent()
		event.tags.push(['validator_policy', 'latest'])

		expectAuthError('offer_unknown_tag', () => parseMultipartyValidatorOffer(event))
	})

	test('parses exact-root validator acceptance', () => {
		const acceptance = parseMultipartyValidatorAcceptance(acceptanceEvent())

		expect(acceptance.auction_root_event_id).toBe(ROOT_ID)
		expect(acceptance.schedule_index).toBe(0)
		expect(acceptance.validator_offer_event_id).toBe(OFFER_ID)
	})

	test('rejects noncanonical acceptance schedule index', () => {
		const event = acceptanceEvent()
		event.tags = event.tags.map((tag) => (tag[0] === 'schedule_index' ? ['schedule_index', '00'] : tag))

		expectAuthError('acceptance_schedule_index_noncanonical', () => parseMultipartyValidatorAcceptance(event))
	})

	test('parses seller activation in exact validator-index order', () => {
		const activation = parseMultipartySellerActivation(activationEvent())

		expect(activation.validator_acceptances).toEqual([
			{
				schedule_index: 0,
				acceptance_event_id: ACCEPTANCE_ID,
			},
		])
		expect(activation.mints).toEqual([MINT_A, MINT_B])
	})

	test('rejects duplicate activation acceptance index', () => {
		const event = activationEvent()
		event.tags.push(['acceptance', '0', 'ab'.repeat(32)])

		expectAuthError('activation_acceptance_order_noncanonical', () => parseMultipartySellerActivation(event))
	})

	test('rejects noncanonical activation mint ordering', () => {
		const event = activationEvent([MINT_B, MINT_A])

		expectAuthError('activation_mint_set_noncanonical', () => parseMultipartySellerActivation(event))
	})
})

describe('Auction Multiparty Gate C1 exact snapshot relations', () => {
	test('binds the complete validator + V4V exact authorization snapshot', () => {
		const bundle = validBundle()

		const result = validateMultipartyAuthorizationSnapshotRelations({
			root: bundle.root,
			capabilities: [bundle.validatorCapability, bundle.v4vCapability],
			offers: [bundle.offer],
			acceptances: [bundle.acceptance],
			activation: bundle.activation,
		})

		expect(result.root_event_id).toBe(ROOT_ID)
		expect(result.activation_event_id).toBe(ACTIVATION_ID)
		expect(result.mints).toEqual([MINT_A, MINT_B])
		expect(result.bindings).toHaveLength(2)

		expect(result.bindings[0]).toMatchObject({
			schedule_index: 0,
			role: 'validator',
			recipient_pubkey: VALIDATOR,
			payout_xpub: VALIDATOR_XPUB,
			payout_capability_event_id: VALIDATOR_CAPABILITY_ID,
			validator_offer_event_id: OFFER_ID,
			validator_acceptance_event_id: ACCEPTANCE_ID,
			allocation_bps: 625,
		})

		expect(result.bindings[1]).toMatchObject({
			schedule_index: 1,
			role: 'v4v',
			recipient_pubkey: V4V,
			payout_xpub: V4V_XPUB,
			payout_capability_event_id: V4V_CAPABILITY_ID,
			allocation_bps: 313,
		})

		expect(Object.isFrozen(result)).toBe(true)
		expect(Object.isFrozen(result.bindings)).toBe(true)
	})

	test('rejects capability author substitution', () => {
		const bundle = validBundle()
		const wrong = {
			...bundle.validatorCapability,
			recipient_pubkey: EXTRA_AUDITOR,
		}

		expectAuthError('auth_capability_author_mismatch', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root: bundle.root,
				capabilities: [wrong, bundle.v4vCapability],
				offers: [bundle.offer],
				acceptances: [bundle.acceptance],
				activation: bundle.activation,
			}),
		)
	})

	test('rejects capability that does not cover the root funding window', () => {
		const bundle = validBundle()
		const short = {
			...bundle.validatorCapability,
			expires_at: MAX_END_AT - 1,
		}

		expectAuthError('auth_capability_validity_window_insufficient', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root: bundle.root,
				capabilities: [short, bundle.v4vCapability],
				offers: [bundle.offer],
				acceptances: [bundle.acceptance],
				activation: bundle.activation,
			}),
		)
	})

	test('rejects offer capability substitution', () => {
		const bundle = validBundle()
		const wrong = {
			...bundle.offer,
			payout_capability_event_id: V4V_CAPABILITY_ID,
		}

		expectAuthError('auth_offer_capability_mismatch', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root: bundle.root,
				capabilities: [bundle.validatorCapability, bundle.v4vCapability],
				offers: [wrong],
				acceptances: [bundle.acceptance],
				activation: bundle.activation,
			}),
		)
	})

	test('rejects offer mint outside capability authorization', () => {
		const root = parseMultipartyRoot(rootEvent(scheduleEntries(), { mints: [MINT_A] }))
		const validatorCapability = parseMultipartyPayoutCapability(
			capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB, [MINT_A]),
		)
		const v4vCapability = parseMultipartyPayoutCapability(capabilityEvent(V4V_CAPABILITY_ID, V4V, V4V_XPUB, [MINT_A]))
		const offer = parseMultipartyValidatorOffer(offerEvent([MINT_A, MINT_B]))
		const acceptance = parseMultipartyValidatorAcceptance(acceptanceEvent())
		const activation = parseMultipartySellerActivation(activationEvent([MINT_A]))

		expectAuthError('auth_offer_mint_not_capability_authorized', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root,
				capabilities: [validatorCapability, v4vCapability],
				offers: [offer],
				acceptances: [acceptance],
				activation,
			}),
		)
	})

	test('rejects acceptance for another exact root', () => {
		const bundle = validBundle()
		const wrong = {
			...bundle.acceptance,
			auction_root_event_id: 'bc'.repeat(32),
		}

		expectAuthError('auth_acceptance_root_mismatch', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root: bundle.root,
				capabilities: [bundle.validatorCapability, bundle.v4vCapability],
				offers: [bundle.offer],
				acceptances: [wrong],
				activation: bundle.activation,
			}),
		)
	})

	test('rejects activation with missing validator acceptance', () => {
		const bundle = validBundle()
		const activation = {
			...bundle.activation,
			validator_acceptances: [],
		}

		expectAuthError('auth_activation_acceptance_set_mismatch', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root: bundle.root,
				capabilities: [bundle.validatorCapability, bundle.v4vCapability],
				offers: [bundle.offer],
				acceptances: [bundle.acceptance],
				activation,
			}),
		)
	})

	test('rejects activation mint outside seller root mint set', () => {
		const bundle = validBundle()
		const activation = {
			...bundle.activation,
			mints: [MINT_C],
		}

		expectAuthError('auth_activation_mint_not_root_authorized', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root: bundle.root,
				capabilities: [bundle.validatorCapability, bundle.v4vCapability],
				offers: [bundle.offer],
				acceptances: [bundle.acceptance],
				activation,
			}),
		)
	})

	test('zero-BPS validator need not authorize activation payout mint', () => {
		const zeroSchedule = scheduleEntries(0, 313)

		const root = parseMultipartyRoot(rootEvent(zeroSchedule, { mints: [MINT_A] }))

		const validatorCapability = parseMultipartyPayoutCapability(
			capabilityEvent(VALIDATOR_CAPABILITY_ID, VALIDATOR, VALIDATOR_XPUB, [MINT_B]),
		)

		const v4vCapability = parseMultipartyPayoutCapability(capabilityEvent(V4V_CAPABILITY_ID, V4V, V4V_XPUB, [MINT_A]))

		const offer = parseMultipartyValidatorOffer(offerEvent([MINT_B], '0'))

		const parsedRoot = root
		const acceptance = parseMultipartyValidatorAcceptance(
			makeEvent(AUCTION_MULTIPARTY_VALIDATOR_ACCEPTANCE_KIND, ACCEPTANCE_ID, VALIDATOR, [
				['e', ROOT_ID],
				['a', parsedRoot.coordinate],
				['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
				['payout_schedule_commitment', parsedRoot.payout_schedule_commitment],
				['schedule_index', '0'],
				['payout_capability', VALIDATOR_CAPABILITY_ID],
				['validator_offer', OFFER_ID],
				['allocation_bps', '0'],
				['entitlement_basis', AUCTION_MULTIPARTY_ENTITLEMENT_BASIS],
				['expires_at', String(MAX_END_AT + 1000)],
			]),
		)

		const activation = parseMultipartySellerActivation(
			makeEvent(AUCTION_MULTIPARTY_ACTIVATION_KIND, ACTIVATION_ID, SELLER, [
				['e', ROOT_ID],
				['a', parsedRoot.coordinate],
				['settlement_policy', AUCTION_MULTIPARTY_SETTLEMENT_POLICY],
				['payout_schedule_commitment', parsedRoot.payout_schedule_commitment],
				['mint', MINT_A],
				['acceptance', '0', ACCEPTANCE_ID],
			]),
		)

		const result = validateMultipartyAuthorizationSnapshotRelations({
			root,
			capabilities: [validatorCapability, v4vCapability],
			offers: [offer],
			acceptances: [acceptance],
			activation,
		})

		expect(result.bindings[0].allocation_bps).toBe(0)
		expect(result.bindings[1].allocation_bps).toBe(313)
	})

	test('unreferenced extra acceptance cannot replace activation-selected event', () => {
		const bundle = validBundle()

		const extra = {
			...bundle.acceptance,
			id: 'ab'.repeat(32),
			auction_root_event_id: 'bc'.repeat(32),
		}

		const result = validateMultipartyAuthorizationSnapshotRelations({
			root: bundle.root,
			capabilities: [bundle.validatorCapability, bundle.v4vCapability],
			offers: [bundle.offer],
			acceptances: [bundle.acceptance, extra],
			activation: bundle.activation,
		})

		expect(result.bindings[0].validator_acceptance_event_id).toBe(ACCEPTANCE_ID)
	})

	test('wrong activation-selected acceptance id fails closed without latest fallback', () => {
		const bundle = validBundle()
		const activation = {
			...bundle.activation,
			validator_acceptances: [
				{
					schedule_index: 0,
					acceptance_event_id: 'ab'.repeat(32),
				},
			],
		}

		expectAuthError('auth_acceptance_missing', () =>
			validateMultipartyAuthorizationSnapshotRelations({
				root: bundle.root,
				capabilities: [bundle.validatorCapability, bundle.v4vCapability],
				offers: [bundle.offer],
				acceptances: [bundle.acceptance],
				activation,
			}),
		)
	})
})
