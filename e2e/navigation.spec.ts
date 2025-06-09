import { test, expect } from '@playwright/test'

test.describe.serial('2. App Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Start at home page and ensure we're not in setup mode
    await page.goto('/')
    await page.waitForTimeout(2000)
    
    // If we're redirected to setup, skip navigation tests
    if (page.url().includes('/setup')) {
      console.log('⚠️  App is in setup mode - skipping navigation tests')
      console.log('💡 Run setup tests first to configure the app')
      test.skip()
    }
  })

  test('should be able to navigate to products page', async ({ page }) => {
    console.log('🛍️ Testing navigation to products page')
    
    // Try direct navigation
    await page.goto('/products')
    await page.waitForTimeout(1000)
    
    // Check if we get redirected back to setup
    if (page.url().includes('/setup')) {
      console.log('❌ Redirected to setup - app configuration incomplete')
      test.skip()
      return
    }
    
    await expect(page).toHaveURL('/products')
    console.log('✅ Successfully navigated to products page')
  })

  test('should be able to navigate to posts page', async ({ page }) => {
    console.log('📝 Testing navigation to posts page')
    
    await page.goto('/posts')
    await page.waitForTimeout(1000)
    
    if (page.url().includes('/setup')) {
      console.log('❌ Redirected to setup - app configuration incomplete')
      test.skip()
      return
    }
    
    await expect(page).toHaveURL('/posts')
    console.log('✅ Successfully navigated to posts page')
  })

  test('should be able to navigate to community page', async ({ page }) => {
    console.log('👥 Testing navigation to community page')
    
    await page.goto('/community')
    await page.waitForTimeout(1000)
    
    if (page.url().includes('/setup')) {
      console.log('❌ Redirected to setup - app configuration incomplete')
      test.skip()
      return
    }
    
    await expect(page).toHaveURL('/community')
    console.log('✅ Successfully navigated to community page')
  })

  test('should be able to navigate to dashboard', async ({ page }) => {
    console.log('📊 Testing navigation to dashboard')
    
    await page.goto('/dashboard')
    await page.waitForTimeout(1000)
    
    if (page.url().includes('/setup')) {
      console.log('❌ Redirected to setup - app configuration incomplete')
      test.skip()
      return
    }
    
    await expect(page).toHaveURL('/dashboard')
    console.log('✅ Successfully navigated to dashboard')
  })

  test('should display page content without errors', async ({ page }) => {
    console.log('🔍 Testing page content loads without errors')
    
    // Only test if we're not in setup mode
    if (page.url().includes('/setup')) {
      console.log('ℹ️  In setup mode - skipping content validation')
      test.skip()
      return
    }
    
    // Check that the page doesn't have any obvious error messages
    const errorTexts = [
      'Something went wrong',
      'Error:',
      'Failed to load',
      '404',
      '500',
      'Internal Server Error'
    ]
    
    for (const errorText of errorTexts) {
      await expect(page.locator(`text=${errorText}`)).not.toBeVisible()
    }
    
    // Check that basic HTML structure is present
    await expect(page.locator('html')).toBeVisible()
    await expect(page.locator('body')).toBeVisible()
    
    console.log('✅ Page content validation passed')
  })
}) 