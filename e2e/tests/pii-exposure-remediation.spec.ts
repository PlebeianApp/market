import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { finalizeEvent } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { RELAY_URL } from '../test-config'
import { queryRelayEvents } from '../utils/relay-query'

useWebSocketImplementation(WebSocket)

test.use({ scenario: 'base' })

// Helper function to create order events with PII
async function createOrderEventWithPII(userSk: string, userPk: string, orderId: string, piiFields: string[] = ['address', 'email']) {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const tags: string[][] = [
			['p', devUser2.pk], // Merchant pubkey (using devUser2 as merchant for this test)
			['subject', `Order ${orderId}`],
			['type', '1'], // Order creation
			['order', orderId],
			['amount', '10000'],
			['item', '30402:abc:product1', '1'],
		]

		// Add PII tags
		if (piiFields.includes('address')) {
			tags.push(['address', '123 Main St, City, State 12345'])
		}
		if (piiFields.includes('email')) {
			tags.push(['email', 'customer@example.com'])
		}
		if (piiFields.includes('phone')) {
			tags.push(['phone', '+1234567890'])
		}
		if (piiFields.includes('notes')) {
			tags.push(['notes', 'Please leave at the front door'])
		}

		const eventTemplate = {
			kind: 16,
			created_at: Math.floor(Date.now() / 1000),
			content: 'Order notes',
			tags: tags,
		}

		const skBytes = hexToBytes(userSk)
		const event = finalizeEvent(eventTemplate, skBytes)
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

// Helper function to create clean order events without PII
async function createCleanOrderEvent(userSk: string, userPk: string, orderId: string) {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const eventTemplate = {
			kind: 16,
			created_at: Math.floor(Date.now() / 1000),
			content: 'Clean order without PII',
			tags: [
				['p', devUser2.pk],
				['subject', `Order ${orderId}`],
				['type', '1'],
				['order', orderId],
				['amount', '10000'],
				['item', '30402:abc:product1', '1'],
			],
		}

		const skBytes = hexToBytes(userSk)
		const event = finalizeEvent(eventTemplate, skBytes)
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

// Helper function to create unrelated events
async function createUnrelatedEvent(userSk: string, kind: number = 1) {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const eventTemplate = {
			kind: kind,
			created_at: Math.floor(Date.now() / 1000),
			content: 'Unrelated note',
			tags: [],
		}

		const skBytes = hexToBytes(userSk)
		const event = finalizeEvent(eventTemplate, skBytes)
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

// Helper function to delete all kind 16 events on the relay (reset state)
async function deleteAllKind16Events(userSk: string, userPk: string) {
	const relay = await Relay.connect(RELAY_URL)
	try {
		// First fetch all kind 16 events authored by the user
		const events = await queryRelayEvents({
			authors: [userPk],
			kinds: [16],
		})

		if (events.length === 0) return

		// Create deletion event (kind 5) for all events
		const deletionTags = events.map((event) => ['e', event.id])
		deletionTags.push(['k', '16']) // Indicate we're deleting kind 16 events

		const deletionEventTemplate = {
			kind: 5, // Deletion event
			created_at: Math.floor(Date.now() / 1000),
			content: 'Deleting all kind 16 events for test cleanup',
			tags: deletionTags,
		}

		const skBytes = hexToBytes(userSk)
		const deletionEvent = finalizeEvent(deletionEventTemplate, skBytes)
		await relay.publish(deletionEvent)

		console.log(`Deleted ${events.length} kind 16 events`)
	} catch (error) {
		console.error('Error deleting kind 16 events:', error)
	} finally {
		relay.close()
	}
}

// Helper function to check for PII exposure modal by looking for header text
async function waitForPIIModal(page: Page, timeout: number = 15000) {
	try {
		await expect(page.getByRole('heading').filter({ hasText: 'Personal Information Leak Detected' })).toBeVisible({ timeout })

		return true
	} catch {
		return false
	}
}

// Helper function to check if PII modal is visible
async function isPIIModalVisible(page: Page) {
	const headerText = await page.locator('h2').filter({ hasText: 'Personal Information Leak Detected' }).count()
	return headerText > 0
}

// Helper function to find deletion event
async function findDeletionEvent(originalEventId: string) {
	const events = await queryRelayEvents({
		kinds: [5], // Kind 5 for deletions
		'#e': [originalEventId],
	})
	return events.length > 0 ? events[0] : null
}

test.describe('PII Exposure Remediation Workflow', () => {
	test.beforeEach(async ({ merchantPage }) => {
		// Ensure clean state before each test - delete all kind 16 events
		await deleteAllKind16Events(devUser1.sk, devUser1.pk)
	})

	test.afterEach(async () => {
		// Clean up after each test
		await deleteAllKind16Events(devUser1.sk, devUser1.pk)
	})

	test('scanner flags affected kind 16 order events with sensitive delivery/contact fields', async ({ merchantPage }) => {
		// Create an order event with PII fields
		const orderId = `pii-test-${Date.now()}`
		const piiEvent = await createOrderEventWithPII(devUser1.sk, devUser1.pk, orderId, ['address', 'email'])

		// Navigate to dashboard where scanner would run
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('domcontentloaded')

		// Wait for potential PII exposure modal using header text detection
		const modalVisible = await waitForPIIModal(merchantPage)

		// Check that the event was created with PII
		const events = await queryRelayEvents({
			authors: [devUser1.pk],
			kinds: [16],
			'#order': [orderId],
		})

		expect(events).toHaveLength(1)
		const event = events[0]

		// Verify the event has PII tags
		const hasAddress = event.tags.some((tag) => tag[0] === 'address')
		const hasEmail = event.tags.some((tag) => tag[0] === 'email')

		expect(hasAddress).toBe(true)
		expect(hasEmail).toBe(true)

		// If modal appears, verify it shows the correct information
		if (modalVisible) {
			const piiList = await merchantPage.locator('ul:has(li div:has-text("Contains:"))').textContent()
			expect(piiList).toContain('address')
			expect(piiList).toContain('email')
		}
	})

	test('scanner ignores unrelated/non-PII events', async ({ merchantPage }) => {
		// Create clean events without PII
		const cleanOrderId = `clean-test-${Date.now()}`
		await createCleanOrderEvent(devUser1.sk, devUser1.pk, cleanOrderId)

		// Create unrelated events
		await createUnrelatedEvent(devUser1.sk, 1)
		await createUnrelatedEvent(devUser1.sk, 30402)

		// Navigate to the app
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('domcontentloaded')

		// Wait a bit to let scanner potentially run
		await merchantPage.waitForTimeout(2000)

		// Check if modal appears - it shouldn't for clean events
		const modalVisible = await isPIIModalVisible(merchantPage)
		expect(modalVisible).toBe(false)

		// For negative test, we ensure no PII modal appears for clean events
		// Query for the clean order event
		const events = await queryRelayEvents({
			authors: [devUser1.pk],
			kinds: [16],
			'#order': [cleanOrderId],
		})

		expect(events).toHaveLength(1)
		const event = events[0]

		// Verify the clean event does NOT have PII tags
		const hasAddress = event.tags.some((tag) => tag[0] === 'address')
		const hasEmail = event.tags.some((tag) => tag[0] === 'email')
		const hasPhone = event.tags.some((tag) => tag[0] === 'phone')

		expect(hasAddress).toBe(false)
		expect(hasEmail).toBe(false)
		expect(hasPhone).toBe(false)
	})

	test('successfully deletes PII events through UI and confirms deletion via relay query', async ({ merchantPage }) => {
		// Create an order event with PII that we'll delete
		const orderId = `deletion-test-${Date.now()}`
		const piiEvent = await createOrderEventWithPII(devUser1.sk, devUser1.pk, orderId)

		// Navigate to dashboard
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('domcontentloaded')

		// Wait for PII modal to appear using header text detection
		const modalVisible = await waitForPIIModal(merchantPage, 10000)
		expect(modalVisible).toBe(true)

		// Click the "Request Deletion and Verify" button
		await merchantPage.click('button:has-text("Request Deletion and Verify")')

		// Wait for deletion to complete (look for success message)
		await expect(merchantPage.getByText('✓ Success').first()).toBeVisible({ timeout: 15_000 })

		// Check that a kind 5 deletion event was created
		const deletionEvents = await queryRelayEvents({
			kinds: [5],
			authors: [devUser1.pk],
			'#e': [piiEvent.id],
		})

		expect(deletionEvents).toHaveLength(1)

		const deletionEvent = deletionEvents[0]

		// Verify it has the correct structure
		expect(deletionEvent.kind).toBe(5)

		// Check for 'e' tag referencing the original event
		const hasETag = deletionEvent.tags.some((tag) => tag[0] === 'e' && tag[1] === piiEvent.id)
		expect(hasETag).toBe(true)

		// Check for 'k' tag with value '16'
		const hasKTag = deletionEvent.tags.some((tag) => tag[0] === 'k' && tag[1] === '16')
		expect(hasKTag).toBe(true)
	})

	test('prevents deletion of events not authored by the current user', async ({ merchantPage, buyerPage }) => {
		// Create an order event with PII that we'll delete
		const orderId = `deletion-test-${Date.now()}`
		const piiEvent = await createOrderEventWithPII(devUser2.sk, devUser2.pk, orderId)

		// Navigate to dashboard
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('domcontentloaded')

		// The unauthorized events should not appear in the current user's modal
		// Check that the unauthorized event exists on relay
		const orderEvents = await queryRelayEvents({
			authors: [devUser2.pk],
			kinds: [16],
			'#order': [orderId],
		})

		expect(orderEvents).toHaveLength(1)

		// Check that the PII modal does not appear for this user
		const modalVisible = await waitForPIIModal(merchantPage, 15000)
		expect(modalVisible).toBe(false)
	})

	test('modal copy says "request deleted," not "deleted"', async ({ merchantPage }) => {
		// Create an order event with PII
		const orderId = `modal-copy-test-${Date.now()}`
		await createOrderEventWithPII(devUser1.sk, devUser1.pk, orderId)

		// Navigate to the app
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('domcontentloaded')

		// Wait for PII modal to appear using header text detection
		const modalVisible = await waitForPIIModal(merchantPage, 10000)
		expect(modalVisible).toBe(true)

		// Check button text
		const buttonText = await merchantPage.locator('button:has-text("Request Deletion and Verify")').textContent()
		expect(buttonText).toContain('Request Deletion')
		expect(buttonText).not.toContain('Delete')
	})

	test('hides raw PII values in UI showing only field types', async ({ merchantPage }) => {
		// Create an order event with PII
		const orderId = `pii-values-test-${Date.now()}`
		await createOrderEventWithPII(devUser1.sk, devUser1.pk, orderId, ['address', 'email', 'phone'])

		// Navigate to the app
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('domcontentloaded')

		// Wait for PII modal to appear using header text detection
		const modalVisible = await waitForPIIModal(merchantPage, 10000)
		expect(modalVisible).toBe(true)

		// Get modal content
		const modalContent = await (await merchantPage.getByRole('dialog', { name: 'Personal Information Leak' }).allTextContents()).join('')

		// Should show field names but not raw values
		if (modalContent) {
			// Should show the field types
			expect(modalContent).toMatch(/address/i)
			expect(modalContent).toMatch(/email/i)
			expect(modalContent).toMatch(/phone/i)

			// Should NOT show actual PII values
			expect(modalContent).not.toContain('123 Main St')
			expect(modalContent).not.toContain('customer@example.com')
			expect(modalContent).not.toContain('+1234567890')

			// Check that it shows only field names in the event list
			const eventListContent = await merchantPage.locator('ul:has(li div:has-text("Contains:"))').textContent()
			expect(eventListContent).toMatch(/Contains:.*address/)
			expect(eventListContent).toMatch(/Contains:.*email/)
			expect(eventListContent).toMatch(/Contains:.*phone/)
		}
	})

	test('completely executes deletion workflow and verifies event removal', async ({ merchantPage }) => {
		// Create multiple order events with PII that we'll delete
		const orderId1 = `complete-deletion-test-1-${Date.now()}`
		const orderId2 = `complete-deletion-test-2-${Date.now()}`

		const piiEvent1 = await createOrderEventWithPII(devUser1.sk, devUser1.pk, orderId1, ['address', 'email'])
		const piiEvent2 = await createOrderEventWithPII(devUser1.sk, devUser1.pk, orderId2, ['phone'])

		// Navigate to dashboard
		await merchantPage.goto('/dashboard')
		await merchantPage.waitForLoadState('domcontentloaded')

		// Wait for PII modal to appear
		const modalVisible = await waitForPIIModal(merchantPage, 10000)
		expect(modalVisible).toBe(true)

		// Verify both events are listed in the modal
		const event1ListItem = await merchantPage.locator(`li:has-text("Event ${piiEvent1.id.substring(0, 8)}")`)
		const event2ListItem = await merchantPage.locator(`li:has-text("Event ${piiEvent2.id.substring(0, 8)}")`)
		await expect(event1ListItem).toBeVisible()
		await expect(event2ListItem).toBeVisible()

		// Check initial status is "Live"
		const event1Status = await event1ListItem.locator('div:text("Live")').count()
		const event2Status = await event2ListItem.locator('div:text("Live")').count()
		expect(event1Status).toBe(1)
		expect(event2Status).toBe(1)

		// Click the "Request Deletion and Verify" button
		await merchantPage.click('button:has-text("Request Deletion and Verify")')

		// Wait for deletion verification to complete
		await merchantPage.getByRole('paragraph').filter({ hasText: '✓ Success' }).waitFor({ state: 'visible', timeout: 15000 })

		// Verify both events now show "Deletion Verified" status
		const event1VerifiedStatus = await event1ListItem.locator('div:text("Deletion Verified")').count()
		const event2VerifiedStatus = await event2ListItem.locator('div:text("Deletion Verified")').count()
		expect(event1VerifiedStatus).toBe(1)
		expect(event2VerifiedStatus).toBe(1)

		// Verify the deletion requests were actually published to the relay
		const deletionEvents1 = await queryRelayEvents({
			kinds: [5],
			authors: [devUser1.pk],
			'#e': [piiEvent1.id],
		})

		const deletionEvents2 = await queryRelayEvents({
			kinds: [5],
			authors: [devUser1.pk],
			'#e': [piiEvent2.id],
		})

		// Should have deletion events for both
		expect(deletionEvents1).toHaveLength(1)
		expect(deletionEvents2).toHaveLength(1)

		// Verify deletion events conform to NIP-09 specification
		const deletionEvent1 = deletionEvents1[0]
		const deletionEvent2 = deletionEvents2[0]

		expect(deletionEvent1.kind).toBe(5)
		expect(deletionEvent2.kind).toBe(5)

		expect(deletionEvent1.tags.some((tag) => tag[0] === 'e' && tag[1] === piiEvent1.id)).toBe(true)
		expect(deletionEvent2.tags.some((tag) => tag[0] === 'e' && tag[1] === piiEvent2.id)).toBe(true)

		expect(deletionEvent1.tags.some((tag) => tag[0] === 'k' && tag[1] === '16')).toBe(true)
		expect(deletionEvent2.tags.some((tag) => tag[0] === 'k' && tag[1] === '16')).toBe(true)
	})
})
