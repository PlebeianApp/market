import { describe, expect, test } from 'bun:test'
import { getOrderManagementActions } from './orderManagement'

describe('local order-management action affordances', () => {
	test('offers buyer cancellation only while pending and receipt only after shipping', () => {
		expect(getOrderManagementActions({ role: 'buyer', orderStatus: 'pending' })).toMatchObject({
			canCancel: true,
			canConfirm: false,
			canProcess: false,
			canShip: false,
			canReceive: false,
		})
		expect(getOrderManagementActions({ role: 'buyer', orderStatus: 'processing', shippingStatus: 'shipped' }).canReceive).toBe(true)
		expect(getOrderManagementActions({ role: 'buyer', orderStatus: 'processing', shippingStatus: 'processing' }).canReceive).toBe(false)
	})

	test('offers seller progression actions only for the matching current status', () => {
		expect(getOrderManagementActions({ role: 'seller', orderStatus: 'pending' })).toMatchObject({ canCancel: true, canConfirm: true })
		expect(getOrderManagementActions({ role: 'seller', orderStatus: 'confirmed' }).canProcess).toBe(true)
		expect(getOrderManagementActions({ role: 'seller', orderStatus: 'processing' }).canShip).toBe(true)
		expect(getOrderManagementActions({ role: 'seller', orderStatus: 'processing', shippingStatus: 'shipped' }).canShip).toBe(false)
	})

	test('never offers management actions to unrelated users', () => {
		expect(getOrderManagementActions({ role: 'other', orderStatus: 'pending' })).toEqual({
			canCancel: false,
			canConfirm: false,
			canProcess: false,
			canShip: false,
			canReceive: false,
		})
	})
})
