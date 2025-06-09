import { test, expect } from '@playwright/test'

test.describe('Test Setup Validation', () => {
  test('should have relay and app running', async ({ page }) => {
    console.log('🔍 Validating test setup...')
    
    // Test that we can reach the application
    await page.goto('/')
    
    // Should not see connection errors
    const body = await page.locator('body').textContent()
    expect(body).not.toContain('WebSocket connection failed')
    expect(body).not.toContain('Relay connection error')
    
    // Should have basic HTML structure
    await expect(page.locator('html')).toBeVisible()
    await expect(page.locator('body')).toBeVisible()
    
    console.log('✅ Basic test setup validation passed')
  })

  test('should generate and use test environment variables', async ({ page }) => {
    console.log('🔧 Validating environment variables...')
    
    // Check that environment variables are set correctly
    expect(process.env.NODE_ENV).toBe('test')
    expect(process.env.APP_RELAY_URL).toBe('ws://localhost:10547')
    
    console.log('✅ Environment variables validation passed')
  })
}) 