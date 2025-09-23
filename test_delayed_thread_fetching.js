// Test script to verify delayed thread data fetching
// This is a simple test that can be run in browser console to observe behavior

console.log('Testing delayed thread data fetching')

// Function to check if a NoteView component has thread data loaded
function checkThreadDataLoaded() {
	// Count how many notes have been rendered vs how many have thread data loaded
	const allNotes = document.querySelectorAll('[data-note-id]')
	console.log(`Total notes rendered: ${allNotes.length}`)

	// Check how many thread buttons are visible (indicating thread data is loaded)
	const visibleThreadButtons = document.querySelectorAll('button[title="View thread"]')
	console.log(`Notes with thread data loaded (visible thread buttons): ${visibleThreadButtons.length}`)

	return {
		totalNotes: allNotes.length,
		notesWithThreadData: visibleThreadButtons.length,
	}
}

// Run checks at different time intervals to observe the delay
console.log('Initial check (should show notes rendered but no thread data yet):')
const initial = checkThreadDataLoaded()

// Check again after 200ms (should still have minimal thread data)
setTimeout(() => {
	console.log('Check at 200ms (should still have minimal thread data):')
	const at200ms = checkThreadDataLoaded()

	// Check again after 1 second (should have more thread data loaded)
	setTimeout(() => {
		console.log('Check at 1.2s (should have more thread data loaded):')
		const at1200ms = checkThreadDataLoaded()

		// Final check after another second
		setTimeout(() => {
			console.log('Final check at 2.2s (most thread data should be loaded):')
			const final = checkThreadDataLoaded()

			console.log('Summary:')
			console.log(`- Initial: ${initial.notesWithThreadData}/${initial.totalNotes} notes had thread data`)
			console.log(`- 200ms: ${at200ms.notesWithThreadData}/${at200ms.totalNotes} notes had thread data`)
			console.log(`- 1.2s: ${at1200ms.notesWithThreadData}/${at1200ms.totalNotes} notes had thread data`)
			console.log(`- 2.2s: ${final.notesWithThreadData}/${final.totalNotes} notes had thread data`)
		}, 1000)
	}, 1000)
}, 200)

console.log('Test running, check console for results...')
