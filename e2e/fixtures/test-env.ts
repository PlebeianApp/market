export const TEST_ENV = {
  NODE_ENV: 'test',
  APP_RELAY_URL: 'ws://localhost:10547',
  PORT: '3000',
  BASE_URL: 'http://localhost:3000',
  RELAY_PORT: '10547',
} as const

export function getTestPrivateKey(): string {
  return process.env.TEST_APP_PRIVATE_KEY || 'a'.repeat(64)
}

export function setTestEnvironment() {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] = value
  }
} 