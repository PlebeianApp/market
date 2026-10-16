import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LightningPaymentView, type LightningPaymentViewProps } from './LightningPaymentView'

const noop = () => {}

const base: LightningPaymentViewProps = {
	invoice: 'lnbc1invoice',
	isGeneratingInvoice: false,
	isPaymentInProgress: false,
	isCheckingForReceipt: false,
	capabilities: { hasNwc: true, hasNip60: false, hasWebLn: false, canManualVerify: true },
	manualPreimage: '',
	onManualPreimageChange: noop,
	onPayNip60: noop,
	onPayNwc: noop,
	onPayWebLn: noop,
	onVerifyPreimage: noop,
	onCopyInvoice: noop,
	skippable: false,
}

describe('LightningPaymentView', () => {
	test('shows the invoice, wallet buttons and manual verification', () => {
		const markup = renderToStaticMarkup(createElement(LightningPaymentView, base))
		expect(markup).toContain('lnbc1invoice')
		expect(markup).toContain('Pay with NWC')
		expect(markup).toContain('Payment Preimage (Manual Verification)')
		expect(markup).not.toContain('Pay with NIP-60 Wallet')
	})

	test('offers skip when no invoice could be generated', () => {
		const markup = renderToStaticMarkup(createElement(LightningPaymentView, { ...base, invoice: null, skippable: true, onSkip: noop }))
		expect(markup).toContain('Unable to generate Lightning invoice')
		expect(markup).toContain('Skip Payment (Pay Later)')
	})
})
