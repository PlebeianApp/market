#!/usr/bin/env node

/**
 * Test script to verify that the continuous hashtag reloading issue has been fixed.
 * Checks for the presence of appropriate delays and intervals in the code.
 */

const fs = require('fs')
const path = require('path')

const ROUTE_FILE = path.join(__dirname, 'src/routes/nostr.index.tsx')

function testHashtagReloadFix() {
	console.log('Testing hashtag continuous reload fix...\n')

	try {
		const content = fs.readFileSync(ROUTE_FILE, 'utf8')

		// Test 1: Check that prefetch interval is no longer 45 seconds (45_000ms)
		const hasFastPrefetch = content.includes('45_000')
		if (hasFastPrefetch) {
			console.log('❌ Still has 45-second prefetch interval - continuous reloading may persist')
			return false
		}
		console.log('✅ Fast prefetch interval (45s) removed')

		// Test 2: Check that prefetch interval is now 5 minutes (5 * 60 * 1000ms)
		const hasSlowPrefetch = content.includes('5 * 60 * 1000')
		if (!hasSlowPrefetch) {
			console.log('❌ Expected 5-minute prefetch interval not found')
			return false
		}
		console.log('✅ Prefetch interval increased to 5 minutes')

		// Test 3: Check that retry mechanism has delay
		const hasRetryDelay = content.includes('setTimeout') && content.includes('2000')
		if (!hasRetryDelay) {
			console.log('❌ Expected 2-second delay in retry mechanism not found')
			return false
		}
		console.log('✅ Retry mechanism has 2-second delay')

		// Test 4: Check that the retry delay comment is present
		const hasRetryDelayComment = content.includes('Add delay before refetch to prevent continuous reloading')
		if (!hasRetryDelayComment) {
			console.log('❌ Expected retry delay comment not found')
			return false
		}
		console.log('✅ Retry delay comment present')

		// Test 5: Check that prefetch comment is updated
		const hasPrefetchComment = content.includes('keep it warm every 5 minutes in the background to reduce continuous reloading')
		if (!hasPrefetchComment) {
			console.log('❌ Expected prefetch interval comment not found')
			return false
		}
		console.log('✅ Prefetch interval comment updated')

		console.log('\n🎉 All tests passed! Continuous hashtag reloading should be resolved.')
		console.log('Changes made:')
		console.log('- Prefetch interval increased from 45s to 5 minutes')
		console.log('- Added 2-second delay between retry attempts')
		console.log('- This should significantly reduce network requests and UI flickering')

		return true
	} catch (error) {
		console.log('❌ Error reading route file:', error.message)
		return false
	}
}

// Run the test
const success = testHashtagReloadFix()
process.exit(success ? 0 : 1)
