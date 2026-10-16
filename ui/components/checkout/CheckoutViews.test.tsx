import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CheckoutDeliveryRequirements, CheckoutFormField, PaymentInvoiceData } from '@sdk/commerce/checkout'
import { OnChainPaymentView } from './OnChainPaymentView'
import { OrderFinalizeView } from './OrderFinalizeView'
import { PaymentContentView } from './PaymentContentView'
import { WalletSelectorView } from './PaymentViews'
import { ShippingAddressFormView, type CheckoutFieldBinding } from './ShippingAddressFormView'

const noop = () => {}

const requirements = (overrides: Partial<CheckoutDeliveryRequirements> = {}): CheckoutDeliveryRequirements => ({
	hasDigitalDelivery: false,
	hasPhysicalDelivery: true,
	hasPickupDelivery: false,
	needsDigitalDeliveryContact: false,
	needsPhysicalAddress: true,
	isResolved: true,
	unresolvedShippingRefs: [],
	...overrides,
})

const fieldNames: CheckoutFormField[] = [
	'name',
	'email',
	'phone',
	'firstLineOfAddress',
	'zipPostcode',
	'city',
	'country',
	'additionalInformation',
]
const fields = (overrides: Partial<Record<CheckoutFormField, Partial<CheckoutFieldBinding>>> = {}) =>
	Object.fromEntries(fieldNames.map((name) => [name, { value: '', onChange: noop, onBlur: noop, ...overrides[name] }])) as Record<
		CheckoutFormField,
		CheckoutFieldBinding
	>

const invoice = (status: PaymentInvoiceData['status']): PaymentInvoiceData => ({
	id: `inv-${status}`,
	orderId: 'o1',
	amount: 2100,
	description: 'Mug',
	recipientName: 'Seller',
	status,
	createdAt: 1,
	recipientPubkey: `pk-${status}`,
	type: 'merchant',
})

describe('ShippingAddressFormView', () => {
	test('shows address fields and touched errors for physical delivery', () => {
		const markup = renderToStaticMarkup(
			createElement(ShippingAddressFormView, {
				fields: fields({ firstLineOfAddress: { error: 'Address is required' } }),
				hasAllShippingMethods: true,
				deliveryRequirements: requirements(),
				isDeliveryRequirementsLoading: false,
				deliveryRequirementsError: null,
				pickupAddresses: [],
				isSubmitting: false,
				onSubmit: noop,
			}),
		)
		expect(markup).toContain('id="firstLineOfAddress"')
		expect(markup).toContain('Address is required')
	})

	test('pickup-only orders hide the address and list pickup locations', () => {
		const markup = renderToStaticMarkup(
			createElement(ShippingAddressFormView, {
				fields: fields(),
				hasAllShippingMethods: true,
				deliveryRequirements: requirements({ hasPhysicalDelivery: false, hasPickupDelivery: true, needsPhysicalAddress: false }),
				isDeliveryRequirementsLoading: false,
				deliveryRequirementsError: null,
				pickupAddresses: [{ title: 'Shop', address: '1 Main St' }],
				isSubmitting: false,
				onSubmit: noop,
			}),
		)
		expect(markup).not.toContain('id="firstLineOfAddress"')
		expect(markup).toContain('1 Main St')
	})
})

describe('OrderFinalizeView', () => {
	test('summarises mixed payment outcomes', () => {
		const markup = renderToStaticMarkup(
			createElement(OrderFinalizeView, {
				shippingData: null,
				invoices: [invoice('paid'), invoice('expired')],
				totalInSats: 4200,
				deliveryRequirements: requirements(),
				pickupAddresses: [],
				onMessageSeller: noop,
				onNewOrder: noop,
				onPrint: noop,
			}),
		)
		expect(markup).toContain('1 payment completed')
		expect(markup).toContain('1 payment expired')
		expect(markup).toContain('Back to Store')
	})
})

describe('payment views', () => {
	test('payment content shows progress and the processor for an open invoice', () => {
		const markup = renderToStaticMarkup(
			createElement(PaymentContentView, {
				invoiceCount: 2,
				completedCount: 1,
				activeIndex: 1,
				showNavigation: true,
				onNavigate: noop,
				current: { status: 'pending', recipientName: 'Seller', amount: 2100 },
				isCurrentCompleted: false,
				processor: createElement('span', null, 'processor'),
			}),
		)
		expect(markup).toContain('1 of 2 completed')
		expect(markup).toContain('processor')
	})

	test('wallet selector renders host labels', () => {
		const markup = renderToStaticMarkup(
			createElement(WalletSelectorView, {
				wallets: [{ id: 'w1', label: '⚡ Lightning: me@ln' }],
				selectedWalletId: null,
				onSelect: noop,
				sellerName: 'Bob',
			}),
		)
		expect(markup).toContain('Bob&#x27;s Wallet')
	})

	test('on-chain view shows the confirmed transaction', () => {
		const markup = renderToStaticMarkup(
			createElement(OnChainPaymentView, {
				status: 'completed',
				disabled: false,
				address: 'bc1q',
				amountSats: 1000,
				amountBtc: 0.00001,
				bitcoinUri: 'bitcoin:bc1q',
				timeLeft: null,
				expirySeconds: 1800,
				checkAttempts: 2,
				error: null,
				transaction: { txid: 'tx123', confirmed: true },
				isManualChecking: false,
				onOpenInWallet: noop,
				onCopyAddress: noop,
				onCopyUri: noop,
				onManualCheck: noop,
				onCancel: noop,
			}),
		)
		expect(markup).toContain('tx123')
		expect(markup).toContain('Payment Complete')
	})
})
