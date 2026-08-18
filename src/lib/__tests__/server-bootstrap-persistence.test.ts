import { describe, expect, test } from 'bun:test'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import { AdminManagerImpl } from '@/server/AdminManager'
import { BootstrapManagerImpl } from '@/server/BootstrapManager'
import { EditorManagerImpl } from '@/server/EditorManager'
import { EventValidator } from '@/server/EventValidator'

const APP_PRIVATE_KEY = 'a'.repeat(64)
const OUTSIDER_PUBKEY = getPublicKey(hexToBytes('b'.repeat(64)))
const ADMIN_PUBKEY = getPublicKey(hexToBytes('c'.repeat(64)))

type ValidatorEvent = Parameters<EventValidator['validateEvent']>[0]

function setupEvent(pubkey: string): ValidatorEvent {
	return {
		kind: 31990,
		pubkey,
		created_at: 1,
		tags: [['d', 'plebeian-market-handler']],
		content: '{"name":"demo"}',
	} as ValidatorEvent
}

function adminListEvent(pubkey: string): ValidatorEvent {
	return {
		kind: 30000,
		pubkey,
		created_at: 1,
		tags: [
			['d', 'admins'],
			['p', ADMIN_PUBKEY],
		],
		content: '',
	} as ValidatorEvent
}

function validatorFor(adminManager: AdminManagerImpl, bootstrapManager: BootstrapManagerImpl) {
	return new EventValidator(APP_PRIVATE_KEY, adminManager, new EditorManagerImpl(), bootstrapManager)
}

describe('server bootstrap persistence boundary', () => {
	test('fresh instance stays closed unless public bootstrap is explicitly allowed', () => {
		const adminManager = new AdminManagerImpl()
		const bootstrapManager = new BootstrapManagerImpl(adminManager)
		const validator = validatorFor(adminManager, bootstrapManager)

		expect(bootstrapManager.isBootstrapMode()).toBe(false)
		expect(validator.validateEvent(setupEvent(OUTSIDER_PUBKEY))).toEqual({
			isValid: false,
			reason: 'Setup event rejected: not in bootstrap mode and not signed by app or admin',
		})
		expect(validator.validateEvent(adminListEvent(OUTSIDER_PUBKEY))).toEqual({
			isValid: false,
			reason: 'Role list event rejected: not in bootstrap mode and not from admin',
		})
	})

	test('fresh instance permits first setup and role-list events', () => {
		const adminManager = new AdminManagerImpl()
		const bootstrapManager = new BootstrapManagerImpl(adminManager, 0, false, true)
		const validator = validatorFor(adminManager, bootstrapManager)

		expect(bootstrapManager.isBootstrapMode()).toBe(true)
		expect(validator.validateEvent(setupEvent(OUTSIDER_PUBKEY)).isValid).toBe(true)
		expect(validator.validateEvent(adminListEvent(OUTSIDER_PUBKEY)).isValid).toBe(true)
	})

	test('persisted setup closes bootstrap before admins are loaded', () => {
		const adminManager = new AdminManagerImpl()
		const bootstrapManager = new BootstrapManagerImpl(adminManager, 0, true, true)
		const validator = validatorFor(adminManager, bootstrapManager)

		expect(bootstrapManager.isBootstrapMode()).toBe(false)

		expect(validator.validateEvent(setupEvent(OUTSIDER_PUBKEY))).toEqual({
			isValid: false,
			reason: 'Setup event rejected: not in bootstrap mode and not signed by app or admin',
		})

		expect(validator.validateEvent(adminListEvent(OUTSIDER_PUBKEY))).toEqual({
			isValid: false,
			reason: 'Role list event rejected: not in bootstrap mode and not from admin',
		})
	})

	test('persisted admin remains authorized after bootstrap is closed', () => {
		const adminManager = new AdminManagerImpl([ADMIN_PUBKEY])
		const bootstrapManager = new BootstrapManagerImpl(adminManager, 1, true, true)
		const validator = validatorFor(adminManager, bootstrapManager)

		expect(bootstrapManager.isBootstrapMode()).toBe(false)
		expect(validator.validateEvent(setupEvent(ADMIN_PUBKEY)).isValid).toBe(true)
		expect(validator.validateEvent(adminListEvent(ADMIN_PUBKEY)).isValid).toBe(true)
	})

	test('existing initial admins still close bootstrap without persisted setup', () => {
		const adminManager = new AdminManagerImpl([ADMIN_PUBKEY])
		const bootstrapManager = new BootstrapManagerImpl(adminManager, 1, false, true)

		expect(bootstrapManager.isBootstrapMode()).toBe(false)
	})
})
