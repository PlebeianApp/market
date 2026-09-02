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
import { AuctionBidPublishFailedError, type AuctionBidFormData } from '@/publish/auctions'
import { isSessionCurrent, useAuctionBidFunding, type UseAuctionBidFundingOptions } from '@/hooks/useAuctionBidFunding'

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
	;(toast as { error: ToastError }).error = stubToastError
	// Deterministic wallet-store state regardless of file ordering — the hook
	// reads mintBalances during handleFundingSuccess and refresh() is a
	// no-op without a wallet.
	nip60Store.setState((s) => ({ ...s, wallet: null, mintBalances: {}, pendingTokens: [], depositStatus: 'idle' }))
})

afterEach(() => {
	;(toast as { error: ToastError }).error = realToastError
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
