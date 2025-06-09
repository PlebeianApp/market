import { type FullConfig } from '@playwright/test'

async function globalTeardown(config: FullConfig) {
  console.log('🧹 Starting global teardown for e2e tests...')
  
  // Clean up any test data or environment state if needed
  // For now, just log completion
  
  console.log('✅ Global teardown completed')
}

export default globalTeardown 