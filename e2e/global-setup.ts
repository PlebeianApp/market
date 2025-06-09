import { chromium, type FullConfig } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools'

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting global setup for e2e tests...')

  // Generate test keys if not provided
  if (!process.env.TEST_APP_PRIVATE_KEY) {
    const privateKey = generateSecretKey()
    const privateKeyHex = Buffer.from(privateKey).toString('hex')
    const publicKey = getPublicKey(privateKey)
    
    process.env.TEST_APP_PRIVATE_KEY = privateKeyHex
    process.env.TEST_APP_PUBLIC_KEY = publicKey
    
    console.log('📝 Generated test keys:')
    console.log(`  Private Key: ${privateKeyHex}`)
    console.log(`  Public Key: ${publicKey}`)
  }

  // Set up test environment variables
  process.env.NODE_ENV = 'test'
  process.env.APP_RELAY_URL = 'ws://localhost:10547'
  
  console.log('✅ Global setup completed')
  
  // Wait a bit for relay to be ready
  await new Promise(resolve => setTimeout(resolve, 2000))
}

export default globalSetup 