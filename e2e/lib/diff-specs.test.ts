import { expect, test, describe } from 'bun:test'
import {
	specStem,
	primaryKeyword,
	titleKeyword,
	escapeRegex,
	changedSourceToSpecStems,
	buildGrepPattern,
	getRecordingScopeSync,
	resetRecordingScopeCache,
} from './diff-specs'

const STEMS = [
	'app-settings',
	'auth',
	'buyer-purchase',
	'cart',
	'checkout',
	'collections',
	'marketplace',
	'order-detail',
	'order-lifecycle',
	'payments',
	'product-page',
	'products',
	'shipping-options',
	'user-profile',
	'zaps',
]

describe('diff-specs — pure helpers', () => {
	test('specStem strips path and .spec.ts suffix', () => {
		expect(specStem('cart.spec.ts')).toBe('cart')
		expect(specStem('e2e/tests/order-detail.spec.ts')).toBe('order-detail')
		expect(specStem('community.progressive-loading.spec.ts')).toBe('community.progressive-loading')
	})

	test('primaryKeyword takes the first hyphen token, lowercased', () => {
		expect(primaryKeyword('order-detail')).toBe('order')
		expect(primaryKeyword('Product-Page')).toBe('product')
		expect(primaryKeyword('cart')).toBe('cart')
	})

	test('titleKeyword depluralizes for title matching', () => {
		expect(titleKeyword('payments')).toBe('payment')
		expect(titleKeyword('products')).toBe('product')
		expect(titleKeyword('cart')).toBe('cart') // no trailing s
		expect(titleKeyword('collections')).toBe('collection')
	})

	test('escapeRegex escapes regex metacharacters', () => {
		expect(escapeRegex('a.b+c')).toBe('a\\.b\\+c')
		expect(escapeRegex('cart')).toBe('cart')
	})

	test('changedSourceToSpecStems maps changed source to spec stems by path token', () => {
		const changed = ['src/components/CartButton.tsx', 'src/lib/checkout/flow.ts']
		const matched = changedSourceToSpecStems(changed, STEMS)
		expect(matched).toContain('cart')
		expect(matched).toContain('checkout')
	})

	test('matches flat-layout files (src/lib/payments.ts → payments)', () => {
		const matched = changedSourceToSpecStems(['src/lib/payments.ts'], STEMS)
		expect(matched).toContain('payments')
	})

	test('is conservatively over-inclusive: order* changes surface order specs', () => {
		// "order" primary keyword matches all order-* stems whose titles contain "order"
		const matched = changedSourceToSpecStems(['src/routes/orders.tsx'], STEMS)
		expect(matched.some((s) => s.startsWith('order'))).toBe(true)
	})

	test('returns empty for changed files that map to no spec', () => {
		const matched = changedSourceToSpecStems(['src/lib/utils/format.ts'], STEMS)
		expect(matched).toEqual([])
	})

	test('returns empty for empty input', () => {
		expect(changedSourceToSpecStems([], STEMS)).toEqual([])
		expect(changedSourceToSpecStems(['src/a.ts'], [])).toEqual([])
	})
})

describe('diff-specs — buildGrepPattern', () => {
	test('always includes the @happy-path baseline', () => {
		const re = buildGrepPattern([])
		expect(re.source).toContain('happy-path')
		expect(re.test('should display product details @happy-path')).toBe(true)
	})

	test('includes diff-affected keywords (case-insensitive)', () => {
		const re = buildGrepPattern(['cart'])
		// Titles use title case ("Cart"); the pattern is case-insensitive.
		expect(re.test('Cart - Remove Items > can remove item')).toBe(true)
		expect(re.test('Checkout > flow')).toBe(false)
	})

	test('union: @happy-path OR keyword both match', () => {
		const re = buildGrepPattern(['payments'])
		expect(re.test('NWC Wallet Management > add wallet @happy-path')).toBe(true)
		expect(re.test('can add Lightning payment method')).toBe(true)
	})

	test('multiple stems produce an alternation', () => {
		const re = buildGrepPattern(['cart', 'checkout'])
		expect(re.test('Cart items persist')).toBe(true)
		expect(re.test('Checkout flow works')).toBe(true)
	})
})

describe('diff-specs — getRecordingScopeSync', () => {
	test('non-CI (hermetic) returns static @happy-path pattern with no git side effect', () => {
		resetRecordingScopeCache()
		delete process.env.CI
		delete process.env.DIFF_AFFECTED_GREP
		delete process.env.DIFF_AFFECTED_SPECS
		const scope = getRecordingScopeSync({ forceDiffAware: false })
		// Reset module cache between tests by clearing via a fresh process state:
		// pattern must include @happy-path and nothing else.
		expect(scope.pattern.test('x @happy-path')).toBe(true)
		expect(scope.pattern.test('Cart flow')).toBe(false)
		expect(scope.diffStems).toEqual([])
		expect(scope.reason).toContain('non-CI')
	})

	test('DIFF_AFFECTED_SPECS env overrides the selection', () => {
		resetRecordingScopeCache()
		delete process.env.CI
		process.env.DIFF_AFFECTED_SPECS = 'cart, checkout'
		const scope = getRecordingScopeSync({ forceDiffAware: false })
		expect(scope.diffStems).toEqual(['cart', 'checkout'])
		expect(scope.pattern.test('Cart items')).toBe(true)
		expect(scope.pattern.test('Checkout')).toBe(true)
		expect(scope.pattern.test('Zaps flow')).toBe(false)
		delete process.env.DIFF_AFFECTED_SPECS
	})

	test('DIFF_AFFECTED_GREP env override is used verbatim', () => {
		resetRecordingScopeCache()
		delete process.env.CI
		process.env.DIFF_AFFECTED_GREP = 'checkout'
		const scope = getRecordingScopeSync({ forceDiffAware: false })
		expect(scope.pattern.source).toBe('checkout')
		// Verbatim grep is case-sensitive (no implicit 'i' flag).
		expect(scope.pattern.test('checkout flow')).toBe(true)
		expect(scope.pattern.test('Checkout Flow')).toBe(false)
		delete process.env.DIFF_AFFECTED_GREP
	})

	test('diff-aware path with injected changed files maps to stems', () => {
		resetRecordingScopeCache()
		delete process.env.CI
		delete process.env.DIFF_AFFECTED_GREP
		delete process.env.DIFF_AFFECTED_SPECS
		const scope = getRecordingScopeSync({
			forceDiffAware: true,
			changedFiles: ['src/components/CartButton.tsx'],
			specStems: STEMS,
		})
		expect(scope.diffStems).toContain('cart')
		expect(scope.reason).toContain('diff-aware')
	})

	test('diff-aware path with no mappable changes falls back to @happy-path', () => {
		resetRecordingScopeCache()
		delete process.env.CI
		delete process.env.DIFF_AFFECTED_GREP
		delete process.env.DIFF_AFFECTED_SPECS
		const scope = getRecordingScopeSync({
			forceDiffAware: true,
			changedFiles: ['src/lib/utils/format.ts'],
			specStems: STEMS,
		})
		expect(scope.diffStems).toEqual([])
		expect(scope.pattern.test('x @happy-path')).toBe(true)
		expect(scope.pattern.test('Cart flow')).toBe(false)
		expect(scope.reason).toContain('fallback')
	})
})
