// Test script to verify immediate thread loading from top of list
// This can be run in the browser console to verify behavior

console.log('Testing immediate thread loading from top of list')

// Function to check which notes have visible thread buttons
function checkThreadButtons() {
	// Get all notes in the feed
	const allNotes = document.querySelectorAll('[data-note-id]')
	console.log(`Total notes rendered: ${allNotes.length}`)

	// Check which notes have thread buttons visible
	const notesWithButtons = []

	allNotes.forEach((note, index) => {
		const threadButton = note.querySelector('button[title="View thread"]')
		if (threadButton) {
			notesWithButtons.push({
				index,
				noteId: note.getAttribute('data-note-id'),
			})
		}
	})

	console.log(`Notes with thread buttons: ${notesWithButtons.length}/${allNotes.length}`)

	// Check if thread buttons appear in order from top to bottom
	if (notesWithButtons.length > 0) {
		console.log('Thread buttons are visible on these notes (in order from top):')
		notesWithButtons.forEach((item) => {
			console.log(`- Note at index ${item.index}, ID: ${item.noteId}`)
		})

		// Check if the first few notes have thread buttons (top of the list priority)
		const topNotesCount = Math.min(5, allNotes.length)
		const topNotesWithButtons = notesWithButtons.filter((item) => item.index < topNotesCount)
		console.log(`${topNotesWithButtons.length}/${topNotesCount} notes at the top have thread buttons visible`)
	}

	return {
		totalNotes: allNotes.length,
		notesWithButtons: notesWithButtons.length,
		topNotesHaveButtons: notesWithButtons.filter((item) => item.index < 5).length,
	}
}

// Run test immediately and after a short delay
console.log('Initial check:')
const initial = checkThreadButtons()

// Check again after a short delay
setTimeout(() => {
	console.log('\nCheck after 500ms:')
	const after500ms = checkThreadButtons()

	// Compare results
	console.log('\nComparison:')
	console.log(`- Initial: ${initial.notesWithButtons}/${initial.totalNotes} notes had thread buttons`)
	console.log(`- After 500ms: ${after500ms.notesWithButtons}/${after500ms.totalNotes} notes had thread buttons`)
	console.log(`- Initial top notes with buttons: ${initial.topNotesHaveButtons}/5`)
	console.log(`- After 500ms top notes with buttons: ${after500ms.topNotesHaveButtons}/5`)

	// Final check after a longer delay
	setTimeout(() => {
		console.log('\nFinal check after 2s:')
		const final = checkThreadButtons()
		console.log(`${final.notesWithButtons}/${final.totalNotes} notes have thread buttons`)
		console.log(`${final.topNotesHaveButtons}/5 top notes have thread buttons`)

		if (final.topNotesHaveButtons > initial.topNotesHaveButtons) {
			console.log('✅ Top notes priority loading is working correctly')
		} else {
			console.log('❌ Top notes priority loading may not be working as expected')
		}
	}, 1500)
}, 500)

console.log('Test running, watch console for results...')
