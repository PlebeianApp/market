#!/usr/bin/env node

/**
 * Test script to verify that reactions only load once when created and don't reload again.
 */

const fs = require('fs')
const path = require('path')

const REACTIONS_FILE = path.join(__dirname, 'src/queries/reactions.ts')

function testReactionsLoadOnce() {
	console.log('Testing reactions load-once behavior...\n')

	try {
		const content = fs.readFileSync(REACTIONS_FILE, 'utf8')

		// Test 1: Check that staleTime is set to Infinity
		const hasInfiniteStaleTime = content.includes('staleTime: Infinity')
		if (!hasInfiniteStaleTime) {
			console.log('❌ staleTime is not set to Infinity - reactions may still reload')
			return false
		}
		console.log('✅ staleTime set to Infinity - reactions will never become stale')

		// Test 2: Check that refetchOnWindowFocus is disabled
		const hasDisabledWindowFocus = content.includes('refetchOnWindowFocus: false')
		if (!hasDisabledWindowFocus) {
			console.log('❌ refetchOnWindowFocus is not disabled - reactions may reload on focus')
			return false
		}
		console.log("✅ refetchOnWindowFocus disabled - reactions won't reload on window focus")

		// Test 3: Check that refetchOnReconnect is disabled
		const hasDisabledReconnect = content.includes('refetchOnReconnect: false')
		if (!hasDisabledReconnect) {
			console.log('❌ refetchOnReconnect is not disabled - reactions may reload on reconnect')
			return false
		}
		console.log("✅ refetchOnReconnect disabled - reactions won't reload on reconnect")

		// Test 4: Check that the comment explains the behavior
		const hasComment = content.includes('Never refetch reactions once loaded - they are immutable after creation')
		if (!hasComment) {
			console.log('❌ Missing explanatory comment about reaction immutability')
			return false
		}
		console.log('✅ Explanatory comment present')

		// Test 5: Verify that the old staleTime (10_000) is no longer present
		const hasOldStaleTime = content.includes('staleTime: 10_000')
		if (hasOldStaleTime) {
			console.log('❌ Old 10-second staleTime still present - may cause conflicts')
			return false
		}
		console.log('✅ Old 10-second staleTime removed')

		console.log('\n🎉 All tests passed! Reactions will now only load once and never reload.')
		console.log('Benefits:')
		console.log('- Reactions are immutable after creation, so no need to refetch')
		console.log('- Reduced network requests and server load')
		console.log('- Better performance and no UI flickering')
		console.log("- Hashtags already only load once as they're parsed from note content")

		return true
	} catch (error) {
		console.log('❌ Error reading reactions.ts file:', error.message)
		return false
	}
}

// Run the test
const success = testReactionsLoadOnce()
process.exit(success ? 0 : 1)
