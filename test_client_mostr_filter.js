// Test script to verify client:Mostr filtering logic

// Mock NDKEvent objects for testing
const eventWithClientMostrTag = {
	id: 'test1',
	tags: [
		['p', 'somepubkey'],
		['client', 'Mostr'],
		['e', 'someeventid'],
	],
}

const eventWithDifferentClientTag = {
	id: 'test2',
	tags: [
		['p', 'somepubkey'],
		['client', 'Damus'],
		['e', 'someeventid'],
	],
}

const eventWithoutClientTag = {
	id: 'test3',
	tags: [
		['p', 'somepubkey'],
		['e', 'someeventid'],
		['t', 'hashtag'],
	],
}

const eventWithNoTags = {
	id: 'test4',
	tags: [],
}

const eventWithNullTags = {
	id: 'test5',
	tags: null,
}

// Utility function to check if an event has a "client:Mostr" tag (copied from implementation)
function hasClientMostrTag(event) {
	const tags = event?.tags
	if (!Array.isArray(tags)) return false

	return tags.some((tag) => Array.isArray(tag) && tag.length >= 2 && tag[0] === 'client' && tag[1] === 'Mostr')
}

console.log('Testing hasClientMostrTag function:')
console.log('Event with client:Mostr tag:', hasClientMostrTag(eventWithClientMostrTag)) // Should be true
console.log('Event with different client tag:', hasClientMostrTag(eventWithDifferentClientTag)) // Should be false
console.log('Event without client tag:', hasClientMostrTag(eventWithoutClientTag)) // Should be false
console.log('Event with no tags:', hasClientMostrTag(eventWithNoTags)) // Should be false
console.log('Event with null tags:', hasClientMostrTag(eventWithNullTags)) // Should be false

// Test filtering behavior
const testEvents = [eventWithClientMostrTag, eventWithDifferentClientTag, eventWithoutClientTag, eventWithNoTags, eventWithNullTags]

console.log('\nFiltering test events:')
console.log('Total events:', testEvents.length)

const filteredEvents = testEvents.filter((e) => !hasClientMostrTag(e))
console.log('Events after filtering out client:Mostr:', filteredEvents.length)
console.log(
	'Filtered event IDs:',
	filteredEvents.map((e) => e.id),
)

// Verify the correct event was filtered out
const shouldBeFiltered = testEvents.filter((e) => hasClientMostrTag(e))
console.log(
	'Events that should be filtered (client:Mostr):',
	shouldBeFiltered.map((e) => e.id),
)
