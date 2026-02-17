import { test, expect } from '../fixtures'
import type { BrowserContext, Page } from '@playwright/test'
import { devUser1, devUser2 } from '../../src/lib/fixtures'
import { getPublicKey, finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { nip19 } from 'nostr-tools'
import { Nip46Mock } from '../utils/nip46-mock'
import { RELAY_URL } from '../test-config'

test.use({ scenario: 'base' })

// ─── Helpers ────────────────────────────────────────────────

/** Set up window.nostr mock WITHOUT auto-login (user must click "Connect to Extension") */
async function setupExtensionOnly(context: BrowserContext, user: { sk: string; pk: string }) {
	await context.exposeFunction('__nostrSignEvent', (eventJson: string): string => {
		const event = JSON.parse(eventJson) as UnsignedEvent
		const signed = finalizeEvent(event, hexToBytes(user.sk))
		return JSON.stringify(signed)
	})

	await context.exposeFunction('__nostrGetPublicKey', (): string => {
		return user.pk
	})

	await context.addInitScript(() => {
		;(window as any).nostr = {
			getPublicKey: async () => {
				return await (window as any).__nostrGetPublicKey()
			},
			signEvent: async (event: any) => {
				const result = await (window as any).__nostrSignEvent(JSON.stringify(event))
				return JSON.parse(result)
			},
			nip04: {
				encrypt: async (_pubkey: string, plaintext: string) => `test_encrypted:${plaintext}`,
				decrypt: async (_pubkey: string, ciphertext: string) =>
					ciphertext.startsWith('test_encrypted:') ? ciphertext.slice('test_encrypted:'.length) : ciphertext,
			},
		}

		// Pre-accept terms so they don't interfere with login testing
		localStorage.setItem('plebeian_terms_accepted', 'true')
		// Do NOT set nostr_auto_login — user must use the dialog
	})
}

/** Create a completely unauthenticated page (no mocks, no localStorage) */
async function createFreshPage(context: BrowserContext): Promise<Page> {
	await context.addInitScript(() => {
		// Pre-accept terms so they don't interfere with login testing
		localStorage.setItem('plebeian_terms_accepted', 'true')
	})
	return await context.newPage()
}

/** Open the login dialog from the header */
async function openLoginDialog(page: Page) {
	const loginButton = page.locator('[data-testid="login-button"]').first()
	await expect(loginButton).toBeVisible({ timeout: 10_000 })
	await loginButton.click()
	await expect(page.locator('[data-testid="login-dialog"]')).toBeVisible({ timeout: 5_000 })
}

/** Verify the user is authenticated (dashboard button visible) */
async function expectAuthenticated(page: Page) {
	await expect(page.locator('[data-testid="dashboard-button"]').first()).toBeVisible({ timeout: 10_000 })
}

/** Verify the user is NOT authenticated (login button visible) */
async function expectNotAuthenticated(page: Page) {
	await expect(page.locator('[data-testid="login-button"]').first()).toBeVisible({ timeout: 10_000 })
}

/** Convert hex SK to nsec format */
function hexToNsec(hexSk: string): string {
	return nip19.nsecEncode(hexToBytes(hexSk))
}

// ─── Tests ──────────────────────────────────────────────────

test.describe('Authentication', () => {
	test.describe('Extension Login', () => {
		test('login via extension tab in dialog', async ({ browser }) => {
			const context = await browser.newContext()
			await setupExtensionOnly(context, devUser1)
			const page = await context.newPage()

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')

				// Should NOT be auto-logged in
				await openLoginDialog(page)

				// Extension tab is the default
				await page.locator('[data-testid="connect-extension-button"]').click()

				// Verify auth succeeds
				await expectAuthenticated(page)

				// Verify localStorage
				const autoLogin = await page.evaluate(() => localStorage.getItem('nostr_auto_login'))
				expect(autoLogin).toBe('true')

				const storedPubkey = await page.evaluate(() => localStorage.getItem('nostr_user_pubkey'))
				expect(storedPubkey).toBe(devUser1.pk)
			} finally {
				await context.close()
			}
		})
	})

	test.describe('Private Key Login', () => {
		test('generate new key, encrypt, and login', async ({ browser }) => {
			const context = await browser.newContext()
			const page = await createFreshPage(context)

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')
				await openLoginDialog(page)

				// Switch to Private Key tab
				await page.locator('[data-testid="private-key-tab"]').click()

				// Generate new key
				await page.locator('[data-testid="generate-key-button"]').click()

				// Verify warning appears
				await expect(page.getByText('Copy this text and save it somewhere safe')).toBeVisible()

				// Continue button should be disabled (warning not acknowledged)
				await expect(page.locator('[data-testid="continue-button"]')).toBeDisabled()

				// Acknowledge the warning
				await page.locator('[data-testid="acknowledge-warning-checkbox"]').click()

				// Now Continue should be enabled
				await expect(page.locator('[data-testid="continue-button"]')).toBeEnabled()
				await page.locator('[data-testid="continue-button"]').click()

				// Password form should appear
				await expect(page.getByText('Set Password')).toBeVisible()

				// Fill password fields
				await page.locator('[data-testid="new-password-input"]').fill('testpassword123')
				await page.locator('[data-testid="confirm-password-input"]').fill('testpassword123')

				// Encrypt and continue
				await page.locator('[data-testid="encrypt-continue-button"]').click()

				// Verify auth succeeds
				await expectAuthenticated(page)

				// Verify localStorage has the encrypted key
				const storedKey = await page.evaluate(() => localStorage.getItem('nostr_local_encrypted_signer_key'))
				expect(storedKey).toBeTruthy()
				expect(storedKey).toContain(':nsec1')
			} finally {
				await context.close()
			}
		})

		test('login with existing seeded user private key (hex format)', async ({ browser }) => {
			const context = await browser.newContext()
			const page = await createFreshPage(context)

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')
				await openLoginDialog(page)

				// Switch to Private Key tab
				await page.locator('[data-testid="private-key-tab"]').click()

				// Enter the hex private key for devUser1
				await page.locator('[data-testid="private-key-input"]').fill(devUser1.sk)

				// Click Continue
				await page.locator('[data-testid="continue-button"]').click()

				// Password form should appear
				await expect(page.getByText('Set Password')).toBeVisible()
				await page.locator('[data-testid="new-password-input"]').fill('test123')
				await page.locator('[data-testid="confirm-password-input"]').fill('test123')

				await page.locator('[data-testid="encrypt-continue-button"]').click()

				// Verify auth succeeds
				await expectAuthenticated(page)

				// Verify stored key uses the correct pubkey
				const storedKey = await page.evaluate(() => localStorage.getItem('nostr_local_encrypted_signer_key'))
				expect(storedKey).toBeTruthy()
				expect(storedKey!.startsWith(devUser1.pk)).toBe(true)
			} finally {
				await context.close()
			}
		})

		test('stored key login with password', async ({ browser }) => {
			const context = await browser.newContext()
			const nsec = hexToNsec(devUser2.sk)

			// Pre-seed localStorage with an "encrypted" key
			await context.addInitScript(
				({ pk, nsec }: { pk: string; nsec: string }) => {
					localStorage.setItem('nostr_local_encrypted_signer_key', `${pk}:${nsec}`)
					localStorage.setItem('plebeian_terms_accepted', 'true')
				},
				{ pk: devUser2.pk, nsec },
			)

			const page = await context.newPage()

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')
				await openLoginDialog(page)

				// Switch to Private Key tab — should show stored key UI
				await page.locator('[data-testid="private-key-tab"]').click()

				// Verify stored key UI appears
				await expect(page.getByText('Enter Password')).toBeVisible()
				await expect(page.getByText(devUser2.pk.slice(0, 8))).toBeVisible()

				// Enter password (any password works since "encryption" is just a UI gate)
				await page.locator('[data-testid="stored-password-input"]').fill('anypassword')
				await page.locator('[data-testid="stored-key-login-button"]').click()

				// Verify auth succeeds
				await expectAuthenticated(page)
			} finally {
				await context.close()
			}
		})

		test('remove stored key shows fresh key input', async ({ browser }) => {
			const context = await browser.newContext()
			const nsec = hexToNsec(devUser2.sk)

			await context.addInitScript(
				({ pk, nsec }: { pk: string; nsec: string }) => {
					localStorage.setItem('nostr_local_encrypted_signer_key', `${pk}:${nsec}`)
					localStorage.setItem('plebeian_terms_accepted', 'true')
				},
				{ pk: devUser2.pk, nsec },
			)

			const page = await context.newPage()

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')
				await openLoginDialog(page)

				await page.locator('[data-testid="private-key-tab"]').click()

				// Should show stored key UI
				await expect(page.getByText('Enter Password')).toBeVisible()

				// Click "Remove Stored Key"
				await page.locator('[data-testid="clear-stored-key-button"]').click()

				// Should now show fresh key input
				await expect(page.locator('[data-testid="private-key-input"]')).toBeVisible()
				await expect(page.locator('[data-testid="generate-key-button"]')).toBeVisible()

				// localStorage should be cleared
				const storedKey = await page.evaluate(() => localStorage.getItem('nostr_local_encrypted_signer_key'))
				expect(storedKey).toBeNull()
			} finally {
				await context.close()
			}
		})
	})

	test.describe('Bunker URL Validation', () => {
		test('validates bunker URL format', async ({ browser }) => {
			const context = await browser.newContext()
			const page = await createFreshPage(context)

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')
				await openLoginDialog(page)

				// Navigate to N-Connect → Bunker URL tab
				await page.locator('[data-testid="connect-tab"]').click()
				await page.locator('[data-testid="bunker-tab"]').click()

				// Test: invalid format (not bunker://)
				await page.locator('[data-testid="bunker-url-input"]').fill('not-a-bunker-url')
				await page.locator('[data-testid="connect-bunker-button"]').click()
				await expect(page.getByText(/Must start with bunker:\/\//)).toBeVisible()

				// Test: invalid pubkey
				await page.locator('[data-testid="bunker-url-input"]').fill('bunker://abc?relay=wss://r.test&secret=s')
				await page.locator('[data-testid="connect-bunker-button"]').click()
				await expect(page.getByText(/Invalid pubkey/)).toBeVisible()

				// Test: missing secret
				const fakePk = 'a'.repeat(64)
				await page.locator('[data-testid="bunker-url-input"]').fill(`bunker://${fakePk}?relay=wss://relay.test`)
				await page.locator('[data-testid="connect-bunker-button"]').click()
				await expect(page.getByText(/secret/i)).toBeVisible()
			} finally {
				await context.close()
			}
		})
	})

	test.describe('NIP-46 Nostr Connect', () => {
		test('QR code login with NIP-46 mock', async ({ browser }) => {
			test.setTimeout(60_000)
			const context = await browser.newContext()
			const page = await createFreshPage(context)
			const mock = new Nip46Mock(devUser2.sk)

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')
				await openLoginDialog(page)

				// Navigate to N-Connect → QR Code tab
				await page.locator('[data-testid="connect-tab"]').click()
				await page.locator('[data-testid="qr-tab"]').click()

				// Select the local test relay via "Custom relay..." option
				await page.locator('[role="combobox"]').click()
				await page.locator('[role="option"]').filter({ hasText: 'Custom relay...' }).click()
				await page.locator('input[placeholder="wss://..."]').fill(RELAY_URL)

				// Wait for the QR code / connection URL input to appear
				const urlInput = page.locator('input[readonly]')
				await expect(urlInput).toBeVisible({ timeout: 15_000 })

				// Extract the nostrconnect:// URL
				const nostrconnectUrl = await urlInput.inputValue()
				expect(nostrconnectUrl).toContain('nostrconnect://')

				// Start the NIP-46 mock responder (runs in background via WebSocket)
				await mock.respondToConnect(nostrconnectUrl)

				// The NIP-46 handshake completes quickly: the mock responds to
				// connect, get_public_key, etc. The dialog shows "Connected
				// successfully!" briefly before closing via onSuccess(). Verify
				// auth directly since the intermediate text may flash too fast.
				await expectAuthenticated(page)

				// Verify localStorage has NIP-46 keys
				const signerKey = await page.evaluate(() => localStorage.getItem('nostr_local_signer_key'))
				expect(signerKey).toBeTruthy()

				const connectUrl = await page.evaluate(() => localStorage.getItem('nostr_connect_url'))
				expect(connectUrl).toBeTruthy()
				expect(connectUrl).toContain('bunker://')
			} finally {
				mock.close()
				await context.close()
			}
		})

		test('bunker URL connect with NIP-46 mock', async ({ browser }) => {
			test.setTimeout(60_000)
			const context = await browser.newContext()
			const page = await createFreshPage(context)
			const mock = new Nip46Mock(devUser2.sk)
			const secret = 'test-secret-' + Date.now()

			try {
				// Start the signer loop BEFORE navigating (must be ready for NDKNip46Signer)
				const cleanup = await mock.startSignerLoop(RELAY_URL)

				await page.goto('/')
				await page.waitForLoadState('networkidle')
				await openLoginDialog(page)

				// Navigate to N-Connect → Bunker URL tab
				await page.locator('[data-testid="connect-tab"]').click()
				await page.locator('[data-testid="bunker-tab"]').click()

				// Construct a valid bunker URL pointing to our mock
				const bunkerUrl = `bunker://${mock.pk}?relay=${encodeURIComponent(RELAY_URL)}&secret=${secret}`
				await page.locator('[data-testid="bunker-url-input"]').fill(bunkerUrl)
				await page.locator('[data-testid="connect-bunker-button"]').click()

				// Verify auth succeeds
				await expectAuthenticated(page)

				// Verify localStorage
				const storedConnectUrl = await page.evaluate(() => localStorage.getItem('nostr_connect_url'))
				expect(storedConnectUrl).toBeTruthy()
				expect(storedConnectUrl).toContain('bunker://')

				const signerKey = await page.evaluate(() => localStorage.getItem('nostr_local_signer_key'))
				expect(signerKey).toBeTruthy()
			} finally {
				mock.close()
				await context.close()
			}
		})
	})

	test.describe('Persistence and Reload', () => {
		test('auto-login with extension after reload', async ({ browser }) => {
			const context = await browser.newContext()
			await setupExtensionOnly(context, devUser1)
			const page = await context.newPage()

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')

				// Login via extension dialog
				await openLoginDialog(page)
				await page.locator('[data-testid="connect-extension-button"]').click()
				await expectAuthenticated(page)

				// Reload
				await page.reload()
				await page.waitForLoadState('networkidle')

				// Should still be authenticated (auto-login via extension)
				await expectAuthenticated(page)

				// Verify localStorage persisted
				const autoLogin = await page.evaluate(() => localStorage.getItem('nostr_auto_login'))
				expect(autoLogin).toBe('true')
			} finally {
				await context.close()
			}
		})

		test('decrypt dialog appears for stored private key after reload', async ({ browser }) => {
			const context = await browser.newContext()
			const nsec = hexToNsec(devUser2.sk)

			await context.addInitScript(
				({ pk, nsec }: { pk: string; nsec: string }) => {
					// Simulate a previously stored encrypted key with auto-login enabled
					localStorage.setItem('nostr_local_encrypted_signer_key', `${pk}:${nsec}`)
					localStorage.setItem('nostr_auto_login', 'true')
					localStorage.setItem('plebeian_terms_accepted', 'true')
				},
				{ pk: devUser2.pk, nsec },
			)

			const page = await context.newPage()

			try {
				await page.goto('/')

				// DecryptPasswordDialog should appear automatically
				await expect(page.locator('[data-testid="decrypt-password-dialog"]')).toBeVisible({ timeout: 10_000 })

				// Enter password and decrypt
				await page.locator('[data-testid="decrypt-password-input"]').fill('anypassword')
				await page.locator('[data-testid="decrypt-login-button"]').click()

				// Verify authenticated
				await expectAuthenticated(page)
			} finally {
				await context.close()
			}
		})
	})

	test.describe('Logout', () => {
		test('logout clears auth state and localStorage', async ({ browser }) => {
			const context = await browser.newContext()
			await setupExtensionOnly(context, devUser1)
			const page = await context.newPage()

			try {
				await page.goto('/')
				await page.waitForLoadState('networkidle')

				// Login via extension
				await openLoginDialog(page)
				await page.locator('[data-testid="connect-extension-button"]').click()
				await expectAuthenticated(page)

				// Click logout
				await page.locator('[data-testid="logout-button"]').click()

				// Verify logged out
				await expectNotAuthenticated(page)

				// Verify localStorage cleared
				const autoLogin = await page.evaluate(() => localStorage.getItem('nostr_auto_login'))
				expect(autoLogin).toBeNull()

				const signerKey = await page.evaluate(() => localStorage.getItem('nostr_local_signer_key'))
				expect(signerKey).toBeNull()

				const connectUrl = await page.evaluate(() => localStorage.getItem('nostr_connect_url'))
				expect(connectUrl).toBeNull()

				// Reload — should NOT auto-login
				await page.reload()
				await page.waitForLoadState('networkidle')
				await expectNotAuthenticated(page)
			} finally {
				await context.close()
			}
		})
	})
})
