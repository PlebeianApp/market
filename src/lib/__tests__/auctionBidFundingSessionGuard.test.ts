/**
 * #1235 follow-ups 1+2 — session-token guard on async completion writes.
 *
 * Race under test (review of PR #1235, follow-ups 1+2): Cancel is never
 * disabled mid-publish and no new-bid entry point is gated on the publish
 * mutations, so the user can start a NEW funding session while a retry or
 * publish is still in flight. Without the session-token guard, the stale
 * completion's raw writes — `setPendingBidSubmission(null)`,
 * `setIsDepositOpen(false)`, `onBidSuccess?.()`, and the catch-path
 * `setPublishedBidEventId(error.bidEventId)` — wipe the new session's
 * state: its deposit modal is force-closed, its pending submission is
 * cleared, and `handleFundingSuccess` then dead-ends at
 * `if (!pendingBidSubmission) return` — a silently lost bid (the Blocking 5
 * cross-leg-leak class, applied to retry/publish continuations).
 *
 * These tests render the REAL hook with the REAL React 19 renderer
 * (`createRoot` + `act`) against a minimal DOM shim — the unit suite has no
 * jsdom/happy-dom, and the hook's bid-publish dependencies (`publishBid` /
 * `republishBid` / `onBidSuccess`) are injected callbacks, so no module mocks
 * are needed and promise interleavings can be controlled deterministically.
 * The DOM shim globals are installed in `beforeAll` and restored in
 * `afterAll` so nothing leaks into other test files sharing this process
 * (ADR-0005: zero network, everything in-process).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from 'sonner'
import { nip60Store } from '@/lib/stores/nip60'
import {
	AuctionBidLockedButUnpublishedError,
	AuctionBidLockOutcomeUncertainError,
	AuctionBidPublishFailedError,
	type AuctionBidFormData,
} from '@/publish/auctions'
import {
	isSessionCurrent,
	nextLockedUnpublishedTokenIdOnSessionStart,
	nextLockOutcomeUncertainOnSessionStart,
	useAuctionBidFunding,
	type UseAuctionBidFundingOptions,
} from '@/hooks/useAuctionBidFunding'

// =============================================================================
// Minimal DOM shim — react-dom/client requires a DOM to render into.
// Implements exactly what createRoot + commit + unmount need for a
// stateless probe component (verified against react-dom 19.2): element /
// text nodes, appendChild/insertBefore/removeChild, textContent (React's
// setTextContent assigns textContent when an element has no text child),
// ownerDocument/defaultView, and the event-listener no-ops React installs
// on the root container.
// =============================================================================

class FakeNode {
	nodeType: number
	childNodes: FakeNode[] = []
	parentNode: FakeNode | null = null
	constructor(nodeType: number) {
		this.nodeType = nodeType
	}
	appendChild(child: FakeNode) {
		if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1)
		this.childNodes.push(child)
		child.parentNode = this
		return child
	}
	insertBefore(child: FakeNode, ref: FakeNode | null) {
		const idx = ref ? this.childNodes.indexOf(ref) : -1
		if (idx >= 0) this.childNodes.splice(idx, 0, child)
		else this.childNodes.push(child)
		if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1)
		child.parentNode = this
		return child
	}
	removeChild(child: FakeNode) {
		const idx = this.childNodes.indexOf(child)
		if (idx >= 0) this.childNodes.splice(idx, 1)
		child.parentNode = null
		return child
	}
	contains(node: FakeNode): boolean {
		let cursor: FakeNode | null = node
		while (cursor) {
			if (cursor === this) return true
			cursor = cursor.parentNode
		}
		return false
	}
	addEventListener() {}
	removeEventListener() {}
}

class FakeElement extends FakeNode {
	tagName: string
	attributes: Record<string, string> = {}
	style: Record<string, string> = {}
	innerHTML = ''
	ownerDocument: FakeDocument
	constructor(tag: string, ownerDocument: FakeDocument) {
		super(1)
		this.tagName = tag.toUpperCase()
		this.ownerDocument = ownerDocument
	}
	setAttribute(key: string, value: string) {
		this.attributes[key] = value
	}
	removeAttribute(key: string) {
		delete this.attributes[key]
	}
	getAttribute(key: string) {
		return this.attributes[key] ?? null
	}
	set textContent(text: string) {
		for (const child of [...this.childNodes]) {
			if (child.nodeType === 3) this.removeChild(child)
		}
		if (text !== '') this.appendChild(this.ownerDocument.createTextNode(text))
	}
	get textContent(): string {
		return this.childNodes
			.map((child) => (child.nodeType === 3 ? (child as FakeTextNode).nodeValue : (child as FakeElement).textContent))
			.join('')
	}
}

class FakeTextNode extends FakeNode {
	nodeValue: string
	constructor(text: string) {
		super(3)
		this.nodeValue = text
	}
}

class FakeDocument extends FakeElement {
	// Assigned immediately after construction in installHeadlessDom().
	documentElement!: FakeElement
	head!: FakeElement
	body!: FakeElement
	activeElement!: FakeElement
	implementation!: { hasFeature: () => boolean }
	defaultView: unknown
	constructor() {
		super('#document', null as unknown as FakeDocument)
		this.ownerDocument = this
	}
	createElement(tag: string) {
		return new FakeElement(tag, this)
	}
	createTextNode(text: string) {
		return new FakeTextNode(text)
	}
	createDocumentFragment() {
		return new FakeElement('#fragment', this)
	}
}

const shim = { installed: false, document: null as unknown as FakeDocument, previous: {} as Record<string, unknown>, restore: () => {} }

const installHeadlessDom = (): void => {
	const doc = new FakeDocument()
	doc.documentElement = doc.createElement('html')
	doc.head = doc.createElement('head')
	doc.body = doc.createElement('body')
	doc.activeElement = doc.body
	doc.implementation = { hasFeature: () => true }
	doc.addEventListener = () => {}
	doc.removeEventListener = () => {}

	const win = {
		document: doc,
		navigator: { userAgent: 'bun-test', product: 'bun' },
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
		cancelAnimationFrame: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		getComputedStyle: () => ({ getPropertyValue: () => '' }),
		location: { href: 'http://localhost/' },
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
		HTMLIFrameElement: class HTMLIFrameElement {},
		HTMLElement: class HTMLElement {},
		Element: FakeElement,
		Node: FakeNode,
	}
	doc.defaultView = win

	const globalsToSet: Record<string, unknown> = {
		document: doc,
		window: win,
		navigator: win.navigator,
		MutationObserver: win.MutationObserver,
		IS_REACT_ACT_ENVIRONMENT: true,
	}
	const previous: Record<string, unknown> = {}
	const globalScope = globalThis as Record<string, unknown>
	for (const [key, value] of Object.entries(globalsToSet)) {
		previous[key] = key in globalScope ? globalScope[key] : undefined
		globalScope[key] = value
	}
	shim.installed = true
	shim.document = doc
	shim.previous = previous
	shim.restore = () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete globalScope[key]
			else globalScope[key] = value
		}
		shim.installed = false
	}
}

// =============================================================================
// Controlled promises + toast spy
// =============================================================================

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (error: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

type ToastError = typeof toast.error
const realToastError = toast.error
const toastErrorMessages: string[] = []
const stubToastError = ((message: string) => {
	toastErrorMessages.push(message)
}) as unknown as ToastError

// #1235 round-3 fix 2 (felixfelix #1) — toast.info stub, mirroring the
// toast.error stub above exactly (messages array + reset + restore) so
// the uncertain-close guidance toast is observable in tests.
type ToastInfo = typeof toast.info
const realToastInfo = toast.info
const toastInfoMessages: string[] = []
const stubToastInfo = ((message: string) => {
	toastInfoMessages.push(message)
}) as unknown as ToastInfo

/** Settle a deferred inside act so the hook continuation's writes flush. */
const settleInsideAct = async (settle: () => void): Promise<void> => {
	await act(async () => {
		settle()
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

// =============================================================================
// Fixtures
// =============================================================================

const MINT_URL = 'https://mint.test'
const LEG_A_EVENT_ID = 'a'.repeat(64)
const LEG_B_EVENT_ID = 'b'.repeat(64)

const buildBidData = (amount: number): AuctionBidFormData => ({
	auctionEventId: 'e'.repeat(64),
	auctionCoordinates: `30408:${'1'.repeat(64)}:auction-1`,
	amount,
	auctionStartAt: 1,
	auctionEffectiveEndAt: 9_999_999_999,
	auctionLocktimeAt: 9_999_999_999,
	settlementGraceSeconds: 300,
	sellerPubkey: '1'.repeat(64),
	p2pkXpub: 'xpub-test',
	mintCandidates: [MINT_URL],
})

const startDepositFunding = (hook: ReturnType<typeof useAuctionBidFunding>, bidData: AuctionBidFormData): void => {
	hook.startFundingForBid({
		bidData,
		hasInsufficientBidFunds: true,
		depositMint: MINT_URL,
		deltaAmount: bidData.amount,
		mintError: null,
		selectedMint: null,
		canFund: false,
	})
}

// =============================================================================
// Harness — renders the real hook via createRoot + act.
// =============================================================================

type FundingHook = ReturnType<typeof useAuctionBidFunding>

const mountFundingHook = async () => {
	const impls = {
		publishBid: (_bidData: AuctionBidFormData): Promise<string> => Promise.reject(new Error('publishBid not wired for this test')),
		republishBid: (_bidEventId: string): Promise<string> => Promise.reject(new Error('republishBid not wired for this test')),
	}
	const calls = { publishBid: 0, republishBid: 0, onBidSuccess: 0 }

	// ONE stable options object for the hook's whole lifetime — matching the
	// component wiring (stable mutation handles), so the hook's callbacks are
	// never invalidated by re-renders and behavior swaps happen inside the
	// stable wrappers.
	const args: UseAuctionBidFundingOptions = {
		previousBidAmount: 0,
		publishBid: (bidData: AuctionBidFormData) => {
			calls.publishBid += 1
			return impls.publishBid(bidData)
		},
		republishBid: (bidEventId: string) => {
			calls.republishBid += 1
			return impls.republishBid(bidEventId)
		},
		onBidSuccess: () => {
			calls.onBidSuccess += 1
		},
		hasAcknowledgedRules: true,
	}

	const latest: { current: FundingHook } = { current: null as unknown as FundingHook }

	function FundingProbe() {
		latest.current = useAuctionBidFunding(args)
		return null
	}

	const container = shim.document.createElement('div')
	const root: Root = createRoot(container as unknown as HTMLElement)
	await act(async () => {
		root.render(React.createElement(FundingProbe))
	})

	return {
		latest,
		calls,
		setPublishBid: (impl: (bidData: AuctionBidFormData) => Promise<string>) => {
			impls.publishBid = impl
		},
		setRepublishBid: (impl: (bidEventId: string) => Promise<string>) => {
			impls.republishBid = impl
		},
		unmount: async () => {
			await act(async () => {
				root.unmount()
			})
		},
	}
}

type FundingHarness = Awaited<ReturnType<typeof mountFundingHook>>

/**
 * Drive one funding session through the REAL funding-success flow into
 * `mint_succeeded_bid_publish_failed_reclaimable` with `publishedBidEventId`
 * set — the exact preconditions of a retry: the deposit confirmed, e-cash was
 * minted (spendable balance on the funding mint), and the publish failed
 * AFTER the leg was locked and its kind-1023 cached (broadcast failure with
 * a recoverable event id).
 */
const driveSessionToPublishFailure = async (h: FundingHarness, bidData: AuctionBidFormData, bidEventId: string): Promise<void> => {
	await act(async () => {
		startDepositFunding(h.latest.current, bidData)
		h.latest.current.handleInvoiceCreated()
		nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 } }))
	})
	const publish = deferred<string>()
	h.setPublishBid(() => publish.promise)
	await act(async () => {
		h.latest.current.handleFundingSuccess()
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
	await settleInsideAct(() => publish.reject(new AuctionBidPublishFailedError(bidEventId, new Error('relay down'))))
	expect(h.latest.current.publishedBidEventId).toBe(bidEventId)
	expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
}

// =============================================================================
// Test lifecycle
// =============================================================================

beforeAll(() => {
	installHeadlessDom()
})

afterAll(() => {
	shim.restore()
})

beforeEach(() => {
	toastErrorMessages.length = 0
	toastInfoMessages.length = 0
	;(toast as { error: ToastError }).error = stubToastError
	;(toast as { info: ToastInfo }).info = stubToastInfo
	// Deterministic wallet-store state regardless of file ordering — the hook
	// reads mintBalances during handleFundingSuccess and refresh() is a
	// no-op without a wallet.
	nip60Store.setState((s) => ({ ...s, wallet: null, mintBalances: {}, pendingTokens: [], depositStatus: 'idle' }))
})

afterEach(() => {
	;(toast as { error: ToastError }).error = realToastError
	;(toast as { info: ToastInfo }).info = realToastInfo
})

// =============================================================================
// Tests
// =============================================================================

describe('isSessionCurrent (session-token guard predicate)', () => {
	test('a completion is current only for the session that started it', () => {
		expect(isSessionCurrent(1, 1)).toBe(true)
		expect(isSessionCurrent(2, 2)).toBe(true)
		expect(isSessionCurrent(0, 0)).toBe(true)
		// Any newer session (token bumped by startFundingForBid) invalidates
		// in-flight completions from the older one.
		expect(isSessionCurrent(1, 2)).toBe(false)
		expect(isSessionCurrent(2, 3)).toBe(false)
		expect(isSessionCurrent(1, 5)).toBe(false)
	})
})

describe('retryBidPublish session-token guard (#1235 follow-ups 1+2)', () => {
	test('retry race: a stale republish completion cannot wipe the new session’s state, and the new session proceeds to publish', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		// Session 1 — deposit-funded bid whose publish fails AFTER the leg was
		// locked and cached (broadcast failure with a recoverable event id).
		await driveSessionToPublishFailure(h, bidDataA, LEG_A_EVENT_ID)

		// Retry the publish — the rebroadcast is now in flight.
		const republishA = deferred<string>()
		h.setRepublishBid(() => republishA.promise)
		await act(async () => {
			void h.latest.current.retryBidPublish()
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_publish_attempted')
		expect(h.calls.republishBid).toBe(1)

		// While the retry is in flight the user starts a NEW funding session
		// (Cancel is never disabled mid-publish; nothing gates the bid form
		// on the rebroadcast).
		await act(async () => {
			startDepositFunding(h.latest.current, bidDataB)
		})
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.isDepositOpen).toBe(true)
		expect(h.latest.current.publishedBidEventId).toBeNull() // Blocking 5 reset

		// The STALE retry completes SUCCESSFULLY — its writes must be dropped.
		await settleInsideAct(() => republishA.resolve(LEG_A_EVENT_ID))

		// Invariant: the new session's pendingBidSubmission / deposit modal
		// survived the stale completion.
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.isDepositOpen).toBe(true)
		expect(h.latest.current.bidFundingLifecycleState).not.toBe('bid_published')
		expect(h.calls.onBidSuccess).toBe(0)
		expect(h.latest.current.publishedBidEventId).toBeNull()

		// And the new session's subsequent flow proceeds: the deposit
		// confirms, the minted funds publish a fresh bid event id.
		await act(async () => {
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 } }))
		})
		const publishB = deferred<string>()
		h.setPublishBid(() => publishB.promise)
		await act(async () => {
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		await settleInsideAct(() => publishB.resolve(LEG_B_EVENT_ID))
		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_published')
		expect(h.latest.current.publishedBidEventId).toBe(LEG_B_EVENT_ID)
		expect(h.latest.current.pendingBidSubmission).toBeNull()
		expect(h.calls.onBidSuccess).toBe(1)

		await h.unmount()
	})

	test('retry race (catch): a stale republish failure does not land the new session in the failure state', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		await driveSessionToPublishFailure(h, bidDataA, LEG_A_EVENT_ID)

		const republishA = deferred<string>()
		h.setRepublishBid(() => republishA.promise)
		await act(async () => {
			void h.latest.current.retryBidPublish()
		})

		await act(async () => {
			startDepositFunding(h.latest.current, bidDataB)
		})

		// The STALE rebroadcast fails — the new session must not see the
		// failure-state transition or an additional failure toast (the one
		// toast already recorded is session 1's own legitimate publish
		// failure from the setup above).
		const toastErrorCountBeforeStaleSettle = toastErrorMessages.length
		await settleInsideAct(() => republishA.reject(new Error('relay down')))

		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.isDepositOpen).toBe(true)
		expect(h.latest.current.bidFundingLifecycleState).not.toBe('mint_succeeded_bid_publish_failed_reclaimable')
		expect(toastErrorMessages).toHaveLength(toastErrorCountBeforeStaleSettle)
		expect(h.calls.onBidSuccess).toBe(0)

		await h.unmount()
	})

	test('retry completion still publishes when the session is unchanged (guard does not break the happy path)', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)

		await driveSessionToPublishFailure(h, bidDataA, LEG_A_EVENT_ID)

		const republishA = deferred<string>()
		h.setRepublishBid(() => republishA.promise)
		await act(async () => {
			void h.latest.current.retryBidPublish()
		})
		await settleInsideAct(() => republishA.resolve(LEG_A_EVENT_ID))

		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_published')
		expect(h.latest.current.pendingBidSubmission).toBeNull()
		expect(h.latest.current.isDepositOpen).toBe(false)
		expect(h.calls.onBidSuccess).toBe(1)
		expect(h.latest.current.publishedBidEventId).toBe(LEG_A_EVENT_ID)

		await h.unmount()
	})
})

describe('submitPreparedBid session-token guard (#1235 follow-ups 1+2)', () => {
	test('stale catch: a publish failure for an abandoned session does not overwrite the new session’s publishedBidEventId', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		// Session 1 — publish in flight via the REAL funding-success flow
		// (deposit session → invoice → minted funds → publish attempt).
		await act(async () => {
			startDepositFunding(h.latest.current, bidDataA)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 } }))
		})
		const publishA = deferred<string>()
		h.setPublishBid(() => publishA.promise)
		await act(async () => {
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		// The user abandons the leg and starts a NEW session while the stale
		// publish is in flight.
		await act(async () => {
			startDepositFunding(h.latest.current, bidDataB)
		})
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.isDepositOpen).toBe(true)
		expect(h.latest.current.publishedBidEventId).toBeNull()

		// The stale publish fails AFTER its leg was locked and cached — the
		// AuctionBidPublishFailedError carries the STALE leg's event id, which
		// must not leak into the new session's publishedBidEventId (the
		// progress dialog binds validator verdicts to that id).
		await settleInsideAct(() => publishA.reject(new AuctionBidPublishFailedError(LEG_A_EVENT_ID, new Error('relay down'))))

		expect(h.latest.current.publishedBidEventId).toBeNull()
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.isDepositOpen).toBe(true)
		expect(h.latest.current.bidFundingLifecycleState).not.toBe('mint_succeeded_bid_publish_failed_reclaimable')
		expect(toastErrorMessages).toHaveLength(0)
		expect(h.calls.onBidSuccess).toBe(0)

		await h.unmount()
	})

	test('stale success: the new session’s state is untouched by the stale publish success', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		await act(async () => {
			startDepositFunding(h.latest.current, bidDataA)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 } }))
		})
		const publishA = deferred<string>()
		h.setPublishBid(() => publishA.promise)
		await act(async () => {
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		await act(async () => {
			startDepositFunding(h.latest.current, bidDataB)
		})

		await settleInsideAct(() => publishA.resolve(LEG_A_EVENT_ID))

		expect(h.latest.current.publishedBidEventId).toBeNull()
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.isDepositOpen).toBe(true)
		expect(h.latest.current.bidFundingLifecycleState).not.toBe('bid_published')
		expect(h.calls.onBidSuccess).toBe(0)

		await h.unmount()
	})

	test('current-session publish still completes normally (guard does not break the happy path)', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)

		// Real funding-success flow: deposit session → invoice → minted funds →
		// publish succeeds in the SAME session that started it.
		await act(async () => {
			startDepositFunding(h.latest.current, bidDataA)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 } }))
		})
		const publishA = deferred<string>()
		h.setPublishBid(() => publishA.promise)
		await act(async () => {
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		await settleInsideAct(() => publishA.resolve(LEG_A_EVENT_ID))

		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_published')
		expect(h.latest.current.publishedBidEventId).toBe(LEG_A_EVENT_ID)
		expect(h.latest.current.pendingBidSubmission).toBeNull()
		expect(h.latest.current.isDepositOpen).toBe(false)
		expect(h.calls.onBidSuccess).toBe(1)

		await h.unmount()
	})
})

describe('locked-but-unpublished legs map to a RECLAIM-ONLY retry (#1235 follow-up 3)', () => {
	/**
	 * Drive one funding session through the REAL funding-success flow until
	 * its publish fails post-lock but PRE-publishable — the publish pipeline
	 * throws AuctionBidLockedButUnpublishedError carrying the lock token id
	 * (event finalization or the STRICT recovery-record write failed).
	 */
	const driveSessionToLockedUnpublishedFailure = async (
		h: FundingHarness,
		bidData: AuctionBidFormData,
		lockTokenId: string,
	): Promise<void> => {
		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 } }))
		})
		const publish = deferred<string>()
		h.setPublishBid(() => publish.promise)
		await act(async () => {
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		await settleInsideAct(() => publish.reject(new AuctionBidLockedButUnpublishedError(lockTokenId, new Error('toNostrEvent exploded'))))
		expect(h.latest.current.lockedUnpublishedTokenId).toBe(lockTokenId)
		expect(h.latest.current.publishedBidEventId).toBeNull()
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
	}

	test('a locked-but-unpublished failure is recorded as reclaim-only state, with NO rebroadcast affordance', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)

		await driveSessionToLockedUnpublishedFailure(h, bidDataA, 'pending-token-7')

		// The failure is surfaced (not silent) and the session is preserved
		// for the reclaim flow.
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataA)
		expect(toastErrorMessages.length).toBeGreaterThan(0)
		expect(toastErrorMessages[0]).toContain('Funding completed, but bid publishing failed')

		await h.unmount()
	})

	test('retry from the locked-unpublished state NEVER re-submits the pipeline — reclaim-only, no re-lock', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)

		await driveSessionToLockedUnpublishedFailure(h, bidDataA, 'pending-token-7')

		const publishCallsBeforeRetry = h.calls.publishBid
		const republishCallsBeforeRetry = h.calls.republishBid

		// Retry: must take the RECLAIM-ONLY path — neither a full re-submit
		// (would re-lock the delta) nor a rebroadcast (nothing publishable
		// exists for this leg).
		await act(async () => {
			await h.latest.current.retryBidPublish()
		})

		expect(h.calls.publishBid).toBe(publishCallsBeforeRetry) // NO second publishBid → NO second lockAuctionBidFunds
		expect(h.calls.republishBid).toBe(republishCallsBeforeRetry) // no rebroadcast either
		expect(h.calls.onBidSuccess).toBe(0)
		// Reclaim-only guidance is surfaced to the user.
		expect(toastErrorMessages.some((message) => message.toLowerCase().includes('reclaim'))).toBe(true)
		// The session stays in the reclaimable state with the pending
		// submission preserved — reclaim happens through the wallet.
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataA)
		expect(h.latest.current.lockedUnpublishedTokenId).toBe('pending-token-7')

		await h.unmount()
	})

	test('a NEW funding session resets the locked-unpublished tracker — the new session is not blocked', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		await driveSessionToLockedUnpublishedFailure(h, bidDataA, 'pending-token-7')

		// The previous leg stays reclaimable via the wallet's pending token,
		// but a NEW session starts with no locked-unpublished state.
		await act(async () => {
			startDepositFunding(h.latest.current, bidDataB)
		})
		expect(h.latest.current.lockedUnpublishedTokenId).toBeNull()
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)

		// The new session's retry falls back to the full pipeline — nothing
		// is locked for the NEW session yet, so a re-submit is safe.
		const publishB = deferred<string>()
		h.setPublishBid(() => publishB.promise)
		await act(async () => {
			void h.latest.current.retryBidPublish()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(h.calls.publishBid).toBe(2)
		await settleInsideAct(() => publishB.resolve(LEG_B_EVENT_ID))
		expect(h.calls.onBidSuccess).toBe(1)

		await h.unmount()
	})

	test('nextLockedUnpublishedTokenIdOnSessionStart: a new session starts with no locked-unpublished token', () => {
		expect(nextLockedUnpublishedTokenIdOnSessionStart('pending-token-7')).toBeNull()
		expect(nextLockedUnpublishedTokenIdOnSessionStart(null)).toBeNull()
	})
})

// =============================================================================
// #1235 round-3 B1 — lock-outcome-uncertain failures: the mint lock's outcome
// is uncertain (a swap/lock request may already have been sent), so the retry
// must be REFUSED outright — no full re-submit (double-consume risk) and no
// rebroadcast (nothing is known to be publishable). The recovery record id is
// session-scoped, mirroring lockedUnpublishedTokenId.
// =============================================================================

describe('lock-outcome-uncertain legs refuse the retry outright (#1235 round-3 B1)', () => {
	const UNCERTAIN_RECOVERY_RECORD_ID = '11111111-2222-3333-4444-555555555555'

	const driveSessionToLockOutcomeUncertainFailure = async (h: FundingHarness, bidData: AuctionBidFormData): Promise<void> => {
		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 } }))
		})
		const publish = deferred<string>()
		h.setPublishBid(() => publish.promise)
		await act(async () => {
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		await settleInsideAct(() =>
			publish.reject(
				new AuctionBidLockOutcomeUncertainError({
					recoveryRecordId: UNCERTAIN_RECOVERY_RECORD_ID,
					mintUrl: MINT_URL,
					legAmount: bidData.amount,
					refundPubkey: '03' + 'e'.repeat(64),
					cause: new Error('swap send failed mid-flight'),
				}),
			),
		)
		expect(h.latest.current.lockOutcomeUncertainRecoveryRecordId).toBe(UNCERTAIN_RECOVERY_RECORD_ID)
		expect(h.latest.current.publishedBidEventId).toBeNull()
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
	}

	test('uncertain-lock FAILURE toast is honest — no "Funding completed" claim, states no second lock + recovery record (#1235 round-3 fix 3)', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)

		await driveSessionToLockOutcomeUncertainFailure(h, bidDataA)

		// The FAILURE toast itself (not just the later retry-refusal toast) must
		// be honest: for an uncertain lock outcome nothing is evidenced —
		// neither that the funding completed nor that the leg locked. The old
		// shared copy claimed "Funding completed, but bid publishing failed".
		const failureToast = toastErrorMessages[0]
		expect(failureToast).toContain('no second lock')
		expect(failureToast.toLowerCase()).toContain('uncertain')
		expect(failureToast.toLowerCase()).toContain('recovery record')
		expect(failureToast).not.toContain('Funding completed')
		// The honest copy fires exactly once for the failure.
		expect(toastErrorMessages).toHaveLength(1)

		// The failure landed in the shared terminal state with the tracker set
		// (copy-only fix: the lifecycle state itself is unchanged).
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
		expect(h.latest.current.lockOutcomeUncertainRecoveryRecordId).toBe(UNCERTAIN_RECOVERY_RECORD_ID)

		// Retry: refused — publishBid count unchanged (no second lock), no
		// rebroadcast either; the refusal surfaces honest copy again.
		const publishCallsBeforeRetry = h.calls.publishBid
		const republishCallsBeforeRetry = h.calls.republishBid
		await act(async () => {
			await h.latest.current.retryBidPublish()
		})
		expect(h.calls.publishBid).toBe(publishCallsBeforeRetry)
		expect(h.calls.republishBid).toBe(republishCallsBeforeRetry)
		expect(h.calls.onBidSuccess).toBe(0)
		expect(toastErrorMessages[toastErrorMessages.length - 1]).toContain('no second lock')

		await h.unmount()
	})

	test('lock-outcome-uncertain failure → retry refused, no second publishBid (no second lock attempt)', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)

		await driveSessionToLockOutcomeUncertainFailure(h, bidDataA)

		const publishCallsBeforeRetry = h.calls.publishBid
		const republishCallsBeforeRetry = h.calls.republishBid

		// Retry: must be REFUSED — neither a full re-submit (would re-lock the
		// delta / double-consume inputs at the mint) nor a rebroadcast
		// (nothing is known to be publishable for this leg).
		await act(async () => {
			await h.latest.current.retryBidPublish()
		})

		expect(h.calls.publishBid).toBe(publishCallsBeforeRetry) // NO second publishBid → NO second lock
		expect(h.calls.republishBid).toBe(republishCallsBeforeRetry) // no rebroadcast either
		expect(h.calls.onBidSuccess).toBe(0)
		// Honest reclaim guidance: the outcome is uncertain, a recovery record
		// was saved, NO second lock was attempted.
		const lastToast = toastErrorMessages[toastErrorMessages.length - 1]
		expect(lastToast).toContain('no second lock')
		expect(lastToast.toLowerCase()).toContain('uncertain')
		expect(lastToast.toLowerCase()).toContain('recovery record')
		// The session stays in the retry/reclaim bucket with the submission
		// preserved, and the tracker still holds the record id.
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataA)
		expect(h.latest.current.lockOutcomeUncertainRecoveryRecordId).toBe(UNCERTAIN_RECOVERY_RECORD_ID)

		await h.unmount()
	})

	test('a NEW funding session resets the uncertain-outcome tracker — the new session is not blocked', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		await driveSessionToLockOutcomeUncertainFailure(h, bidDataA)

		// The uncertain leg stays recoverable via its persisted recovery record
		// + the wallet — a NEW session starts clean.
		await act(async () => {
			startDepositFunding(h.latest.current, bidDataB)
		})
		expect(h.latest.current.lockOutcomeUncertainRecoveryRecordId).toBeNull()
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)

		// The new session's retry falls back to the full pipeline — nothing is
		// known to be locked or uncertain for the NEW session.
		const publishB = deferred<string>()
		h.setPublishBid(() => publishB.promise)
		await act(async () => {
			void h.latest.current.retryBidPublish()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(h.calls.publishBid).toBe(2)
		await settleInsideAct(() => publishB.resolve(LEG_B_EVENT_ID))
		expect(h.calls.onBidSuccess).toBe(1)

		await h.unmount()
	})

	test('nextLockOutcomeUncertainOnSessionStart: a new session starts with no uncertain-outcome record id', () => {
		expect(nextLockOutcomeUncertainOnSessionStart('recovery-record-1')).toBeNull()
		expect(nextLockOutcomeUncertainOnSessionStart(null)).toBeNull()
	})
})

// =============================================================================
// #1235 round-3 B3 — close-while-pending deposits land the honest
// deposit_outcome_uncertain state, and the SAME preserved deposit can still
// settle late: the late success must walk the lifecycle forward out of the
// uncertain state (payment_acknowledged → minting_started → ecash_minted →
// publish) so the bid proceeds — including the Retry-publish affordance on a
// publish failure.
// =============================================================================

describe('late success after uncertain close (#1235 round-3 B3)', () => {
	/** Drive a deposit-funded session to invoice_created with a pending deposit. */
	const driveToPendingDeposit = async (h: FundingHarness, bidData: AuctionBidFormData): Promise<void> => {
		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, depositStatus: 'pending' }))
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('invoice_created')
	}

	test('close pending QR deposit → same preserved deposit later succeeds → publish failure still exposes Retry publish', async () => {
		const h = await mountFundingHook()
		const bidData = buildBidData(1_000)

		await driveToPendingDeposit(h, bidData)

		// Act 1 — the user closes the deposit modal while the payment's outcome
		// is unevidenced: the lifecycle lands the honest uncertain state and
		// the pending submission is PRESERVED.
		await act(async () => {
			h.latest.current.handleDepositModalClose()
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('deposit_outcome_uncertain')
		expect(h.latest.current.pendingBidSubmission).toEqual(bidData)
		expect(h.latest.current.isDepositOpen).toBe(false)

		// Act 2 — late success: the SAME preserved deposit settles (the deposit
		// object kept checking after the preserveRecovery close); the minted
		// funds walk the lifecycle forward out of the uncertain state and the
		// publish then fails AFTER the leg was locked (broadcast failure).
		const publish = deferred<string>()
		h.setPublishBid(() => publish.promise)
		await act(async () => {
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 }, depositStatus: 'success' }))
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		await settleInsideAct(() => publish.reject(new AuctionBidPublishFailedError(LEG_A_EVENT_ID, new Error('relay down'))))

		// Assert 2 — hook-level proxy for "the Retry-publish affordance is
		// exposed": the dialog renders the button iff
		// mint_succeeded_bid_publish_failed_reclaimable (PUBLISH_FAILED_STATES)
		// + this tracker.
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
		expect(h.latest.current.publishedBidEventId).toBe(LEG_A_EVENT_ID)
		expect(h.latest.current.lockedUnpublishedTokenId).toBeNull()

		// Act 3 — Retry publish: the idempotent rebroadcast path — republishBid
		// (NO second publishBid → NO second lock).
		const republish = deferred<string>()
		h.setRepublishBid(() => republish.promise)
		await act(async () => {
			void h.latest.current.retryBidPublish()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(h.calls.republishBid).toBe(1)
		await settleInsideAct(() => republish.resolve(LEG_A_EVENT_ID))

		const publishCallsAfterRetry = h.calls.publishBid
		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_published')
		expect(publishCallsAfterRetry).toBe(1) // exactly one publishBid — no second lock
		expect(h.latest.current.pendingBidSubmission).toBeNull()
		expect(h.calls.onBidSuccess).toBe(1)

		await h.unmount()
	})

	test('late success → publish resolves → bid_published, success fired, submission cleared', async () => {
		const h = await mountFundingHook()
		const bidData = buildBidData(1_500)

		await driveToPendingDeposit(h, bidData)
		await act(async () => {
			h.latest.current.handleDepositModalClose()
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('deposit_outcome_uncertain')

		const publish = deferred<string>()
		h.setPublishBid(() => publish.promise)
		await act(async () => {
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 }, depositStatus: 'success' }))
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		await settleInsideAct(() => publish.resolve(LEG_B_EVENT_ID))

		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_published')
		expect(h.latest.current.publishedBidEventId).toBe(LEG_B_EVENT_ID)
		expect(h.latest.current.pendingBidSubmission).toBeNull()
		expect(h.calls.onBidSuccess).toBe(1)

		await h.unmount()
	})

	test('fresh session from deposit_outcome_uncertain: startFundingForBid re-enters cleanly with trackers reset', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		await driveToPendingDeposit(h, bidDataA)
		await act(async () => {
			h.latest.current.handleDepositModalClose()
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('deposit_outcome_uncertain')

		// A fresh funding session can start directly from the uncertain state.
		await act(async () => {
			startDepositFunding(h.latest.current, bidDataB)
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('funding_session_created')
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.publishedBidEventId).toBeNull()
		expect(h.latest.current.lockOutcomeUncertainRecoveryRecordId).toBeNull()
		expect(h.latest.current.isDepositOpen).toBe(true)

		await h.unmount()
	})

	test('close with NO deposit in flight still cleanly cancels (funding_canceled)', async () => {
		const h = await mountFundingHook()
		const bidData = buildBidData(1_000)

		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, depositStatus: 'idle' }))
		})
		await act(async () => {
			h.latest.current.handleDepositModalClose()
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('funding_canceled')
		expect(h.latest.current.pendingBidSubmission).toBeNull()

		await h.unmount()
	})
})

// =============================================================================
// #1235 round-3 fix 2 (felixfelix #1) — closing the deposit modal while the
// payment's outcome is unevidenced (pending / awaiting_confirmation_retry)
// must not be silent: the honest deposit_outcome_uncertain landing is
// surfaced via toast.info so the user knows the preserved deposit may still
// settle and continue their bid automatically.
// =============================================================================

describe('uncertain deposit-modal close surfaces toast.info (#1235 round-3 fix 2)', () => {
	test('closing while the deposit is pending → deposit_outcome_uncertain + exactly one guidance toast.info', async () => {
		const h = await mountFundingHook()
		const bidData = buildBidData(1_000)

		// Drive a deposit-funded session to invoice_created with the deposit
		// still pending (payment outcome unevidenced either way).
		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, depositStatus: 'pending' }))
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('invoice_created')

		await act(async () => {
			h.latest.current.handleDepositModalClose()
		})

		// The lifecycle lands the honest uncertain state, the session stays
		// preserved, and the guidance fired EXACTLY ONCE per close event.
		expect(h.latest.current.bidFundingLifecycleState).toBe('deposit_outcome_uncertain')
		expect(h.latest.current.pendingBidSubmission).toEqual(bidData)
		expect(h.latest.current.isDepositOpen).toBe(false)
		expect(toastInfoMessages).toEqual(['Payment outcome unconfirmed — if it settles, your bid continues automatically'])
		expect(toastInfoMessages).toHaveLength(1)

		await h.unmount()
	})

	test('closing with NO deposit in flight fires no toast.info (clean cancel stays silent)', async () => {
		const h = await mountFundingHook()
		const bidData = buildBidData(1_000)

		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, depositStatus: 'idle' }))
		})
		await act(async () => {
			h.latest.current.handleDepositModalClose()
		})

		expect(h.latest.current.bidFundingLifecycleState).toBe('funding_canceled')
		expect(toastInfoMessages).toHaveLength(0)

		await h.unmount()
	})
})

// =============================================================================
// round-3.5 duplicate-success guards (#1235 — felixfelix review #3/#4 window)
// A deposit 'success' can arrive while a submission for the SAME pending bid
// is in flight (a preserved uncertain deposit settling late via the deposit's
// own poll), or after the lock boundary was already crossed. Neither may
// start a second lock pipeline.
// =============================================================================

describe('duplicate deposit-success guards (#1235 round-3.5)', () => {
	test('a second deposit success while a submission is in flight → refused, no second lock', async () => {
		const h = await mountFundingHook()
		const bidData = buildBidData(1_000)

		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, depositStatus: 'pending' }))
		})

		// First success → the submission pipeline is in flight (deferred publish).
		const publish = deferred<string>()
		h.setPublishBid(() => publish.promise)
		await act(async () => {
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 }, depositStatus: 'success' }))
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_publish_attempted')
		expect(h.calls.publishBid).toBe(1)

		// Second success (a preserved sibling deposit settling late) while the
		// first pipeline is in flight → refused at the hook entry.
		await act(async () => {
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(h.calls.publishBid).toBe(1)
		expect(toastErrorMessages.some((message) => message.includes('No second bid was submitted'))).toBe(true)

		// The in-flight submission completes normally.
		await settleInsideAct(() => publish.resolve(LEG_A_EVENT_ID))
		expect(h.latest.current.bidFundingLifecycleState).toBe('bid_published')
		expect(h.calls.onBidSuccess).toBe(1)

		await h.unmount()
	})

	test('a deposit success after the lock boundary was crossed → refused, no second lock', async () => {
		const h = await mountFundingHook()
		const bidData = buildBidData(1_000)

		await act(async () => {
			startDepositFunding(h.latest.current, bidData)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, depositStatus: 'pending' }))
		})

		// First success → lock crossed, publish failed (the locked-unpublished tier).
		const publish = deferred<string>()
		h.setPublishBid(() => publish.promise)
		await act(async () => {
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 }, depositStatus: 'success' }))
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		await settleInsideAct(() => publish.reject(new AuctionBidPublishFailedError(LEG_A_EVENT_ID, new Error('relay down'))))
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')

		// A second deposit settles after the lock boundary was crossed → the
		// consumed flag refuses the submission (no second lock for the same
		// pending bid); the minted funds stay in the wallet.
		const publishCallsBefore = h.calls.publishBid
		await act(async () => {
			nip60Store.setState((s) => ({ ...s, depositStatus: 'success' }))
			h.latest.current.handleFundingSuccess()
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(h.calls.publishBid).toBe(publishCallsBefore)
		expect(h.latest.current.bidFundingLifecycleState).toBe('mint_succeeded_bid_publish_failed_reclaimable')
		expect(toastErrorMessages.some((message) => message.includes('No second bid was submitted'))).toBe(true)

		await h.unmount()
	})

	test('stale continuation: a new funding session started during the refresh window drops the old continuation', async () => {
		const h = await mountFundingHook()
		const bidDataA = buildBidData(1_000)
		const bidDataB = buildBidData(2_500)

		await act(async () => {
			startDepositFunding(h.latest.current, bidDataA)
			h.latest.current.handleInvoiceCreated()
			nip60Store.setState((s) => ({ ...s, depositStatus: 'pending' }))
		})

		// The deposit settles → the continuation starts (synchronous up to the
		// refresh await). While it is suspended, the user starts a NEW funding
		// session (session-token bump + lifecycle reset + new pending bid).
		await act(async () => {
			nip60Store.setState((s) => ({ ...s, mintBalances: { [MINT_URL]: 100_000 }, depositStatus: 'success' }))
			h.latest.current.handleFundingSuccess()
			startDepositFunding(h.latest.current, bidDataB)
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		// The stale continuation must not walk session 2's lifecycle, must not
		// submit session 1's bid into it, and must not close session 2's
		// deposit modal. Two timings exist and both must hold the invariant:
		// (production) real refresh suspends → the post-refresh gate drops the
		// continuation before the walk/submit (state stays at session 2's
		// fail-closed reset result, publishBid never called); (co-run with the
		// retry suite's import-time nip60 mock) refresh is absent → the
		// continuation completes synchronously while the session is still
		// current, and the LATER bump invalidates its completion via the
		// stale-catch guard. In both, the invariants are: at most ONE
		// submission for the pending bid, session 2's pendingBidSubmission and
		// deposit modal intact, and no success fired for the stale leg.
		expect(h.calls.publishBid).toBeLessThanOrEqual(1)
		expect(h.latest.current.pendingBidSubmission).toEqual(bidDataB)
		expect(h.latest.current.isDepositOpen).toBe(true)
		expect(h.latest.current.bidFundingLifecycleState).not.toBe('bid_published')
		expect(h.calls.onBidSuccess).toBe(0)

		await h.unmount()
	})
})
