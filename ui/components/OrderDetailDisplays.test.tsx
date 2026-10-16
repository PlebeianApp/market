import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaymentProgressBar } from './PaymentProgressBar'
import { PickupAddressDisplay } from './PickupAddressDisplay'
import { ShippingInfoDisplay } from './ShippingInfoDisplay'
import { V4VRecipientsCard } from './V4VRecipientsCard'

describe('order detail displays', () => {
	test('renders payment progress counts and width', () => {
		const markup = renderToStaticMarkup(<PaymentProgressBar paidCount={1} totalCount={3} progressPercent={33} />)
		expect(markup).toContain('1/3 Complete')
		expect(markup).toContain('width:33%')
	})

	test('renders pickup address', () => {
		expect(renderToStaticMarkup(<PickupAddressDisplay pickupAddress="1 Main St" />)).toContain('1 Main St')
	})

	test('renders shipping info and omits absent optional fields', () => {
		const markup = renderToStaticMarkup(
			<ShippingInfoDisplay shippingInfo={{ title: 'Post', price: { amount: 500, currency: 'SATS' }, service: 'standard' }} />,
		)
		expect(markup).toContain('Post')
		expect(markup).toContain('500 SATS')
		expect(markup).toContain('Standard')
		expect(markup).not.toContain('Carrier:')
	})

	test('normalizes fractional and whole V4V percentages', () => {
		const markup = renderToStaticMarkup(
			<V4VRecipientsCard
				shares={[
					{ name: 'Dev fund', percentage: 0.05 },
					{ name: 'Relay', percentage: 10 },
				]}
			/>,
		)
		expect(markup).toContain('2 community recipients')
		expect(markup).toContain('>5%<')
		expect(markup).toContain('>10%<')
	})
})
