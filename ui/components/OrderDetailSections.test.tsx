import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatPrivateAuctionClaimAddress, OrderDetailHeader, OrderShippingCard, PrivateAuctionClaimCard } from './OrderDetailSections'

describe('order detail sections', () => {
	test('header renders amount, status, and host actions', () => {
		const markup = renderToStaticMarkup(
			<OrderDetailHeader
				title="Products (1 unique)"
				subText="2 items"
				totalSats={2100}
				createdAt={0}
				status={{ label: 'confirmed', iconName: 'check', explanation: 'Seller confirmed' }}
				actions={<button>Cancel</button>}
			/>,
		)
		expect(markup).toContain('2100 sats')
		expect(markup).toContain('N/A')
		expect(markup).toContain('confirmed')
		expect(markup).toContain('Seller confirmed')
		expect(markup).toContain('<button>Cancel</button>')
		expect(markup).toContain('lucide-check')
	})

	test('auction claim card shows the claim, loading, or the host-supplied reason', () => {
		const claim = { shippingAddress: { name: 'Ada', city: 'Berlin', zipPostcode: '10115', country: 'DE' }, email: 'a@example.com' }
		expect(formatPrivateAuctionClaimAddress(claim)).toBe('Ada\nBerlin 10115\nDE')
		expect(renderToStaticMarkup(<PrivateAuctionClaimCard isLoading={false} claim={claim} unavailableMessage="x" />)).toContain(
			'a@example.com',
		)
		expect(renderToStaticMarkup(<PrivateAuctionClaimCard isLoading claim={null} unavailableMessage="x" />)).toContain(
			'Loading private auction',
		)
		expect(renderToStaticMarkup(<PrivateAuctionClaimCard isLoading={false} claim={null} unavailableMessage="No signer" />)).toContain(
			'No signer',
		)
	})

	test('shipping card only shows the delivery address in shipping mode', () => {
		const address = <p>1 Main St</p>
		expect(renderToStaticMarkup(<OrderShippingCard mode="shipping" deliveryAddress={address} />)).toContain('1 Main St')
		const pickup = renderToStaticMarkup(<OrderShippingCard mode="pickup" pickupAddress="Shop" deliveryAddress={address} />)
		expect(pickup).toContain('Pickup Information')
		expect(pickup).toContain('Shop')
		expect(pickup).not.toContain('1 Main St')
		expect(renderToStaticMarkup(<OrderShippingCard mode="digital" deliveryAddress={address} />)).not.toContain('1 Main St')
	})
})
