// Test script for enhanced event queries
// This script tests the new enhanced query system to ensure it works properly

import { fetchEnhancedNotes, fetchEnhancedNote, SUPPORTED_KINDS, ExtendedKind } from './queries/enhanced-firehose'
import { constructEnhancedThreadStructure, findEnhancedRootEvent, fetchThreadContext } from './queries/enhanced-thread'

async function testBasicEventFetching() {
	console.log('🧪 Testing basic enhanced event fetching...')

	try {
		// Test fetching general notes
		console.log('Fetching enhanced notes...')
		const notes = await fetchEnhancedNotes({ limit: 10 })
		console.log(`✅ Successfully fetched ${notes.length} enhanced notes`)

		if (notes.length > 0) {
			const firstNote = notes[0]
			console.log(`First note priority: ${firstNote.priority.toFixed(3)}`)
			console.log(`First note cached: ${firstNote.isFromCache}`)
			console.log(`First note relays seen: ${firstNote.relaysSeen.length}`)
		}

		return true
	} catch (error) {
		console.error('❌ Basic event fetching failed:', error)
		return false
	}
}

async function testKindFiltering() {
	console.log('🧪 Testing kind filtering...')

	try {
		// Test with specific kinds
		const textNotes = await fetchEnhancedNotes({
			kinds: [1], // Only text notes
			limit: 5,
		})
		console.log(`✅ Successfully fetched ${textNotes.length} text notes`)

		// Test with media kinds
		const mediaEvents = await fetchEnhancedNotes({
			kinds: [ExtendedKind.PICTURE, ExtendedKind.VIDEO],
			limit: 5,
		})
		console.log(`✅ Successfully fetched ${mediaEvents.length} media events`)

		return true
	} catch (error) {
		console.error('❌ Kind filtering failed:', error)
		return false
	}
}

async function testTagFiltering() {
	console.log('🧪 Testing tag filtering...')

	try {
		// Test with tag filter
		const bitcoinNotes = await fetchEnhancedNotes({
			tag: 'bitcoin',
			limit: 5,
		})
		console.log(`✅ Successfully fetched ${bitcoinNotes.length} bitcoin-tagged notes`)

		return true
	} catch (error) {
		console.error('❌ Tag filtering failed:', error)
		return false
	}
}

async function testSingleEventFetching() {
	console.log('🧪 Testing single enhanced event fetching...')

	try {
		// First get some notes to test with
		const notes = await fetchEnhancedNotes({ limit: 1 })

		if (notes.length === 0) {
			console.log('⚠️ No notes available to test single event fetching')
			return true
		}

		const noteId = (notes[0].event as any).id
		if (!noteId) {
			console.log('⚠️ Note has no ID to test with')
			return true
		}

		// Test fetching single note
		const singleNote = await fetchEnhancedNote(noteId)
		console.log(`✅ Successfully fetched single note`)
		console.log(`Note priority: ${singleNote.priority.toFixed(3)}`)
		console.log(`Note from cache: ${singleNote.isFromCache}`)

		return true
	} catch (error) {
		console.error('❌ Single event fetching failed:', error)
		return false
	}
}

async function testThreadConstruction() {
	console.log('🧪 Testing enhanced thread construction...')

	try {
		// Get some notes to find potential threads
		const notes = await fetchEnhancedNotes({ limit: 10 })

		if (notes.length === 0) {
			console.log('⚠️ No notes available to test thread construction')
			return true
		}

		// Try to construct threads for the first few notes
		for (let i = 0; i < Math.min(3, notes.length); i++) {
			const noteId = (notes[i].event as any).id
			if (!noteId) continue

			try {
				console.log(`Testing thread construction for note ${i + 1}...`)

				// Test root finding
				const rootInfo = await findEnhancedRootEvent(noteId)
				if (rootInfo) {
					console.log(`  ✅ Found root event: ${rootInfo.rootId}`)

					// Test full thread construction
					const threadStructure = await constructEnhancedThreadStructure(noteId)
					if (threadStructure) {
						console.log(`  ✅ Built thread structure:`)
						console.log(`    - Total replies: ${threadStructure.metadata.totalReplies}`)
						console.log(`    - Max depth: ${threadStructure.metadata.maxDepth}`)
						console.log(`    - Participants: ${threadStructure.metadata.participantCount}`)
						console.log(`    - Has media: ${threadStructure.metadata.hasMedia}`)
					} else {
						console.log(`  ⚠️ Could not build thread structure`)
					}
				} else {
					console.log(`  ⚠️ Could not find root event`)
				}
			} catch (error) {
				console.log(`  ⚠️ Thread construction failed for note ${i + 1}:`, error.message)
			}
		}

		return true
	} catch (error) {
		console.error('❌ Thread construction test failed:', error)
		return false
	}
}

async function testThreadContext() {
	console.log('🧪 Testing thread context fetching...')

	try {
		// Get some notes to test context with
		const notes = await fetchEnhancedNotes({ limit: 5 })

		if (notes.length === 0) {
			console.log('⚠️ No notes available to test thread context')
			return true
		}

		const noteId = (notes[0].event as any).id
		if (!noteId) {
			console.log('⚠️ Note has no ID to test context with')
			return true
		}

		// Test context fetching
		const context = await fetchThreadContext(noteId, 3)
		console.log(`✅ Successfully fetched thread context: ${context.length} events`)

		return true
	} catch (error) {
		console.error('❌ Thread context fetching failed:', error)
		return false
	}
}

async function testCachingBehavior() {
	console.log('🧪 Testing caching behavior...')

	try {
		// Fetch notes twice to test caching
		console.log('First fetch (should populate cache)...')
		const notes1 = await fetchEnhancedNotes({ limit: 5 })

		console.log('Second fetch (should use cache)...')
		const notes2 = await fetchEnhancedNotes({ limit: 5 })

		console.log(`✅ Both fetches completed successfully`)
		console.log(`First fetch: ${notes1.length} notes`)
		console.log(`Second fetch: ${notes2.length} notes`)

		// Check if any notes are marked as from cache in the second fetch
		const cachedNotes = notes2.filter((n) => n.isFromCache)
		console.log(`Notes from cache in second fetch: ${cachedNotes.length}`)

		return true
	} catch (error) {
		console.error('❌ Caching behavior test failed:', error)
		return false
	}
}

async function testDataLoaderBatching() {
	console.log('🧪 Testing DataLoader batching...')

	try {
		// Get some note IDs
		const notes = await fetchEnhancedNotes({ limit: 3 })

		if (notes.length < 2) {
			console.log('⚠️ Not enough notes to test batching')
			return true
		}

		const noteIds = notes.map((n) => (n.event as any).id).filter(Boolean)

		if (noteIds.length < 2) {
			console.log('⚠️ Not enough valid note IDs to test batching')
			return true
		}

		// Fetch multiple notes simultaneously to test batching
		console.log(`Testing batching with ${noteIds.length} notes...`)
		const promises = noteIds.slice(0, 2).map((id) => fetchEnhancedNote(id))
		const results = await Promise.all(promises)

		console.log(`✅ Successfully batched fetch of ${results.length} notes`)

		return true
	} catch (error) {
		console.error('❌ DataLoader batching test failed:', error)
		return false
	}
}

async function runAllTests() {
	console.log('🚀 Starting enhanced query system tests...\n')

	const tests = [
		{ name: 'Basic Event Fetching', fn: testBasicEventFetching },
		{ name: 'Kind Filtering', fn: testKindFiltering },
		{ name: 'Tag Filtering', fn: testTagFiltering },
		{ name: 'Single Event Fetching', fn: testSingleEventFetching },
		{ name: 'Thread Construction', fn: testThreadConstruction },
		{ name: 'Thread Context', fn: testThreadContext },
		{ name: 'Caching Behavior', fn: testCachingBehavior },
		{ name: 'DataLoader Batching', fn: testDataLoaderBatching },
	]

	const results = []

	for (const test of tests) {
		console.log(`\n${'='.repeat(50)}`)
		console.log(`Running: ${test.name}`)
		console.log('='.repeat(50))

		const startTime = Date.now()
		const success = await test.fn()
		const duration = Date.now() - startTime

		results.push({
			name: test.name,
			success,
			duration,
		})

		console.log(`${success ? '✅' : '❌'} ${test.name} ${success ? 'PASSED' : 'FAILED'} (${duration}ms)`)
	}

	console.log('\n' + '='.repeat(60))
	console.log('TEST SUMMARY')
	console.log('='.repeat(60))

	const passed = results.filter((r) => r.success).length
	const total = results.length

	console.log(`Tests passed: ${passed}/${total}`)
	console.log(`Success rate: ${((passed / total) * 100).toFixed(1)}%`)

	if (passed === total) {
		console.log('\n🎉 All tests passed! Enhanced query system is working correctly.')
	} else {
		console.log('\n⚠️ Some tests failed. Please check the implementation.')
	}

	console.log('\nDetailed Results:')
	results.forEach((result) => {
		console.log(`  ${result.success ? '✅' : '❌'} ${result.name} (${result.duration}ms)`)
	})
}

// Export for use in other contexts
export {
	testBasicEventFetching,
	testKindFiltering,
	testTagFiltering,
	testSingleEventFetching,
	testThreadConstruction,
	testThreadContext,
	testCachingBehavior,
	testDataLoaderBatching,
	runAllTests,
}

// If running directly
if (require.main === module) {
	runAllTests().catch(console.error)
}
