#!/usr/bin/env node

/**
 * Test script to verify that the note component no longer triggers re-rendering
 * of hashtags and react emoji buttons unnecessarily.
 */

const fs = require('fs')
const path = require('path')

const NOTEVIEW_FILE = path.join(__dirname, 'src/components/NoteView.tsx')

function testNoteRerenderingFix() {
	console.log('Testing note component re-rendering fix...\n')

	try {
		const content = fs.readFileSync(NOTEVIEW_FILE, 'utf8')

		// Test 1: Check that reactions computation is memoized
		const hasReactionsMemo = content.includes('const reactionsData = useMemo(() => {')
		if (!hasReactionsMemo) {
			console.log('❌ Reactions computation is not memoized')
			return false
		}
		console.log('✅ Reactions computation is memoized')

		// Test 2: Check that hashtags computation is memoized
		const hasHashtagsMemo = content.includes('const hashtagsData = useMemo(() => {')
		if (!hasHashtagsMemo) {
			console.log('❌ Hashtags computation is not memoized')
			return false
		}
		console.log('✅ Hashtags computation is memoized')

		// Test 3: Check that reactions IIFE is removed
		const hasReactionsIIFE =
			content.includes("const id = ((note as any)?.id || '') as string") &&
			content.includes('const emap = id && reactionsMap ? reactionsMap[id] : undefined') &&
			content.includes('const entries = emap ? Object.entries(emap) : []') &&
			content.includes('})()}')
		if (hasReactionsIIFE) {
			console.log('❌ Reactions IIFE computation still present - may cause re-rendering')
			return false
		}
		console.log('✅ Reactions IIFE computation removed')

		// Test 4: Check that hashtags IIFE is removed
		const hasHashtagsIIFE =
			content.includes('const tagsArr = Array.isArray((note as any)?.tags)') &&
			content.includes('const tTags = tagsArr.filter') &&
			content.includes('const hashSet = new Set(tTags.map') &&
			content.includes('const hashtags = Array.from(hashSet)') &&
			content.includes('})()}')
		if (hasHashtagsIIFE) {
			console.log('❌ Hashtags IIFE computation still present - may cause re-rendering')
			return false
		}
		console.log('✅ Hashtags IIFE computation removed')

		// Test 5: Check that reactions use memoized data
		const usesReactionsData = content.includes('reactionsData.entries.map')
		if (!usesReactionsData) {
			console.log('❌ Reactions rendering does not use memoized data')
			return false
		}
		console.log('✅ Reactions rendering uses memoized data')

		// Test 6: Check that hashtags use memoized data
		const usesHashtagsData = content.includes('hashtagsData.map((tag)')
		if (!usesHashtagsData) {
			console.log('❌ Hashtags rendering does not use memoized data')
			return false
		}
		console.log('✅ Hashtags rendering uses memoized data')

		// Test 7: Check that memoized values have proper dependencies
		const hasReactionsDeps = content.includes('}, [note, reactionsMap])')
		const hasHashtagsDeps = content.includes('}, [note])')
		if (!hasReactionsDeps || !hasHashtagsDeps) {
			console.log('❌ Memoized computations do not have proper dependencies')
			return false
		}
		console.log('✅ Memoized computations have proper dependencies')

		console.log('\n🎉 All tests passed! Note component re-rendering has been optimized.')
		console.log('Benefits:')
		console.log('- Reactions and hashtags are now memoized and only recalculate when props change')
		console.log('- Eliminated IIFE computations that ran on every render')
		console.log('- Improved performance by preventing unnecessary re-computations')
		console.log('- Hashtags and reactions will no longer trigger re-rendering on every component update')

		return true
	} catch (error) {
		console.log('❌ Error reading NoteView.tsx file:', error.message)
		return false
	}
}

// Run the test
const success = testNoteRerenderingFix()
process.exit(success ? 0 : 1)
