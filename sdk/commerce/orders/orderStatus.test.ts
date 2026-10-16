import { describe, expect, test } from 'bun:test'
import { resolveBuyerOrderStatus, resolveBuyerShippingStatus } from './orderStatus'

describe('buyer order tracking status', () => {
	test('defaults unknown or absent order status to pending', () => {
		expect(resolveBuyerOrderStatus(undefined)).toBe('pending')
		expect(resolveBuyerOrderStatus([['status', 'unknown']])).toBe('pending')
	})

	test('keeps shipping status separate and nullable', () => {
		expect(resolveBuyerOrderStatus([['status', 'processing']])).toBe('processing')
		expect(resolveBuyerShippingStatus([['status', 'shipped']])).toBe('shipped')
		expect(resolveBuyerShippingStatus(undefined)).toBeNull()
	})
})
