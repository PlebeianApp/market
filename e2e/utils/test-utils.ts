import { type Page, expect } from '@playwright/test'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { waitForAppReady, checkAppConfiguration } from './relay-utils'

export interface TestUser {
	privateKey: string
	publicKey: string
	npub: string
}

export function generateTestUser(): TestUser {
	const privateKey = generateSecretKey()
	const privateKeyHex = Buffer.from(privateKey).toString('hex')
	const publicKey = getPublicKey(privateKey)
	const npub = nip19.npubEncode(publicKey)

	return {
		privateKey: privateKeyHex,
		publicKey,
		npub,
	}
}

export async function waitForNavigation(page: Page, expectedUrl: string, timeout = 10000) {
	await page.waitForURL(expectedUrl, { timeout })
}

export async function fillSetupForm(page: Page, testUser: TestUser) {
  console.log('📝 Filling setup form...')
  
  // Wait for form to be visible
  await page.waitForSelector('input[name="name"]', { timeout: 10000 })
  
  // Fill required fields
  await page.fill('input[name="name"]', 'Test Market')
  await page.fill('input[name="displayName"]', 'Test Market Display')
  await page.fill('input[name="ownerPk"]', testUser.npub)
  await page.fill('input[name="contactEmail"]', 'test@example.com')
  
  // Submit the form
  await page.click('button[type="submit"]')
  
  console.log('✅ Setup form filled and submitted')
  
  // Wait for submission to complete
  await page.waitForTimeout(2000)
}

export async function expectToBeOnSetupPage(page: Page) {
	await expect(page).toHaveURL('/setup')
	await expect(page.getByText('Instance Setup')).toBeVisible()
}

export async function expectToBeOnHomePage(page: Page) {
	await expect(page).toHaveURL('/')
}

export async function mockNostrExtension(page: Page, testUser: TestUser) {
  // Mock the window.nostr extension for testing
  await page.addInitScript((user) => {
    ;(window as any).nostr = {
      async getPublicKey() {
        return user.publicKey
      },
      async signEvent(event: any) {
        // Mock signing - in real tests you might want proper signing
        return { ...event, sig: 'mock_signature' }
      },
    }
  }, testUser)
}

export async function ensureAppState(page: Page, expectedState: 'setup' | 'ready'): Promise<boolean> {
  try {
    const appState = await waitForAppReady(page)
    return appState === expectedState
  } catch (error) {
    console.error('Failed to determine app state:', error)
    return false
  }
}

export async function skipIfInSetupMode(page: Page, testContext: any) {
  if (page.url().includes('/setup')) {
    console.log('⚠️  App is in setup mode - skipping this test')
    console.log('💡 Run setup tests first to configure the app')
    testContext.skip()
    return true
  }
  return false
}
