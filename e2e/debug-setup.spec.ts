import { test, expect } from '@playwright/test'
import { generateTestUser, mockNostrExtension } from './utils/test-utils'

test.describe('Debug Setup Process', () => {
  test('debug setup process step by step', async ({ page }) => {
    const testUser = generateTestUser()
    console.log('🔍 Debug: Starting setup analysis')
    console.log(`👤 Test user: ${testUser.npub}`)

    // Mock nostr extension
    await mockNostrExtension(page, testUser)

    // Step 1: Check initial app state
    console.log('📍 Step 1: Checking initial app state')
    await page.goto('/')
    await page.waitForTimeout(3000)
    
    console.log(`📍 Current URL: ${page.url()}`)
    
    // Step 2: Check /api/config endpoint
    console.log('📍 Step 2: Checking /api/config')
    const configResponse = await page.evaluate(async () => {
      const res = await fetch('/api/config')
      return res.json()
    })
    console.log('📊 Config response:', configResponse)

    // Step 3: If on setup page, fill the form
    if (page.url().includes('/setup')) {
      console.log('📍 Step 3: On setup page - filling form')
      
      await page.fill('input[name="name"]', 'Debug Test Market')
      await page.fill('input[name="displayName"]', 'Debug Test Display')
      await page.fill('input[name="ownerPk"]', testUser.npub)
      await page.fill('input[name="contactEmail"]', 'debug@test.com')
      
      console.log('📍 Form filled, submitting...')
      await page.click('button[type="submit"]')
      
      // Wait for response
      await page.waitForTimeout(5000)
      console.log(`📍 After submit URL: ${page.url()}`)
      
      // Step 4: Check config again after submission
      console.log('📍 Step 4: Checking config after submission')
      const newConfigResponse = await page.evaluate(async () => {
        const res = await fetch('/api/config')
        return res.json()
      })
      console.log('📊 New config response:', newConfigResponse)
      
      // Step 5: Try refreshing page
      console.log('📍 Step 5: Refreshing page to test persistence')
      await page.reload()
      await page.waitForTimeout(3000)
      console.log(`📍 After reload URL: ${page.url()}`)
      
      // Step 6: Check config after reload
      const reloadConfigResponse = await page.evaluate(async () => {
        const res = await fetch('/api/config')
        return res.json()
      })
      console.log('📊 Config after reload:', reloadConfigResponse)
      
    } else {
      console.log('📍 Not on setup page - setup already completed or app misconfigured')
    }

    // Step 7: Check console errors
    console.log('📍 Step 7: Checking for JavaScript errors')
    const logs = await page.evaluate(() => {
      return (window as any).errors || []
    })
    if (logs.length > 0) {
      console.log('⚠️  JavaScript errors found:', logs)
    }

    console.log('🔍 Debug analysis completed')
  })
}) 