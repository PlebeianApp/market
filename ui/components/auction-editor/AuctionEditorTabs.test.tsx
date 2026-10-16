import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AuctionFormData } from '@sdk/commerce/auctions/auctionForm'
import {
	AuctionShippingView,
	CategoryTab,
	ImagesTab,
	NameTab,
	parseDatetimeLocalSeconds,
	SpecTab,
	toDatetimeLocal,
} from './AuctionEditorTabs'

const noop = () => {}

const formData: AuctionFormData = {
	title: 'Vintage Leica',
	summary: '',
	description: 'Film camera',
	startingBid: '1000',
	bidIncrement: '100',
	startAt: '',
	endAt: '',
	antiSnipeWindowMinutes: 0,
	minBidCurveShape: 'none',
	minBidCurvePeakMultiplier: 2,
	settlementGracePreset: '1h',
	mainCategory: 'Art',
	categories: [],
	imageUrls: [],
	specs: [{ key: 'Brand', value: 'Leica' }],
	shippings: [],
	trustedMints: [],
	isNSFW: false,
	enableLiveChat: true,
	auditorPubkey: '',
}

describe('auction editor tabs', () => {
	test('name and spec tabs render the form values', () => {
		expect(renderToStaticMarkup(createElement(NameTab, { formData, setFormData: noop }))).toContain('Vintage Leica')
		expect(renderToStaticMarkup(createElement(SpecTab, { formData, setFormData: noop }))).toContain('Leica')
	})

	test('category tab lists host-supplied categories', () => {
		const markup = renderToStaticMarkup(
			createElement(CategoryTab, {
				formData,
				setFormData: noop,
				subCategoryInput: 'Cameras',
				setSubCategoryInput: noop,
				mainCategories: ['Art'],
			}),
		)
		expect(markup).toContain('Cameras')
	})

	test('images tab delegates uploading to the host renderer', () => {
		const markup = renderToStaticMarkup(
			createElement(ImagesTab, {
				images: [{ imageUrl: 'https://img/1.png', imageOrder: 0 }],
				setImages: noop,
				error: 'At least one image',
				renderUploader: ({ src, index }) => createElement('span', null, `uploader:${index}:${src ?? 'new'}`),
			}),
		)
		expect(markup).toContain('uploader:0:https://img/1.png')
		expect(markup).toContain('uploader:-1:new')
		expect(markup).toContain('At least one image')
	})

	test('shipping view separates attached and available options', () => {
		const option = { id: '30406:me:std', name: 'Standard', price: '10', currency: 'USD', service: 'standard', carrier: 'DHL' }
		const markup = renderToStaticMarkup(
			createElement(AuctionShippingView, {
				attached: [{ shippingRef: '30406:me:gone', extraCost: '', option: null }],
				unselected: [option],
				hasUser: true,
				isLoading: false,
				hasAnyOptions: true,
				extraCostErrors: { 0: 'Invalid extra cost' },
				onAdd: noop,
				onRemove: noop,
				onExtraCostChange: noop,
			}),
		)
		expect(markup).toContain('Unknown shipping option')
		expect(markup).toContain('Invalid extra cost')
		expect(markup).toContain('10 USD · standard · DHL')
	})

	test('datetime-local helpers round-trip', () => {
		const date = new Date(2026, 0, 2, 3, 4)
		expect(parseDatetimeLocalSeconds(toDatetimeLocal(date))).toBe(Math.floor(date.getTime() / 1000))
	})
})
