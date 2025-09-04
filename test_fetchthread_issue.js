// Test script to reproduce the fetchThread issue where reply-only notes
// get their own ID as root instead of using the reply target

// Mock NDKEvent structure for testing
function createMockEvent(id, tags) {
    return {
        id,
        tags,
        kind: 1
    };
}

// Copy helper functions from thread-view.tsx
function getETags(ev) {
    const tags = ev?.tags;
    if (Array.isArray(tags)) return tags.filter((t) => Array.isArray(t) && t[0] === 'e');
    return [];
}

function findTagByMarker(tags, marker) {
    for (const t of tags) {
        if (t[0] === 'e' && t[3] === marker && typeof t[1] === 'string') return t[1];
    }
    return undefined;
}

// Simulate the problematic root ID determination logic
function simulateRootIdDetermination(baseEvent) {
    console.log('=== SIMULATING ROOT ID DETERMINATION ===\n');
    console.log(`Base event ID: ${baseEvent.id}`);
    console.log(`Base event tags: ${JSON.stringify(baseEvent.tags)}`);
    
    const eTags = getETags(baseEvent);
    console.log(`E tags: ${JSON.stringify(eTags)}`);
    
    const rootFromTag = findTagByMarker(eTags, 'root');
    console.log(`Root from 'root' marker: ${rootFromTag || 'NOT FOUND'}`);
    
    // This is the problematic line from fetchThread
    const rootId = rootFromTag || baseEvent.id;
    console.log(`Final root ID (CURRENT LOGIC): ${rootId}`);
    
    // What it should be for reply-only notes
    const replyTarget = findTagByMarker(eTags, 'reply');
    console.log(`Reply target (what it SHOULD be): ${replyTarget || 'NOT FOUND'}`);
    
    const isProblematic = !rootFromTag && replyTarget && rootId === baseEvent.id;
    console.log(`Issue detected: ${isProblematic ? 'YES' : 'NO'}`);
    
    if (isProblematic) {
        console.log(`*** BUG: Reply-only note ${baseEvent.id} is using itself as root instead of reply target ${replyTarget} ***`);
    }
    
    return {
        currentRootId: rootId,
        correctRootId: replyTarget || rootId,
        isProblematic
    };
}

console.log('=== TESTING FETCHTHREAD ROOT ID DETERMINATION ===\n');

// Test cases that should reveal the issue
const testCases = [
    {
        name: 'Note with proper root tag (should work correctly)',
        event: createMockEvent('note1', [
            ['e', 'actual_root', '', 'root'],
            ['e', 'actual_root', '', 'reply']
        ])
    },
    {
        name: 'Reply-only note (THIS IS THE PROBLEMATIC CASE)',
        event: createMockEvent('reply_note', [
            ['e', 'actual_root', '', 'reply']  // Only reply tag, no root tag
        ])
    },
    {
        name: 'Note with no e tags (should use its own ID)',
        event: createMockEvent('standalone_note', [])
    },
    {
        name: 'Reply-only note with multiple reply targets',
        event: createMockEvent('multi_reply_note', [
            ['e', 'parent1', '', 'reply'],
            ['e', 'parent2', '', 'reply']
        ])
    }
];

console.log('=== INDIVIDUAL TEST CASES ===\n');
testCases.forEach(testCase => {
    console.log(`${testCase.name}:`);
    const result = simulateRootIdDetermination(testCase.event);
    console.log(`  Current root ID: ${result.currentRootId}`);
    console.log(`  Correct root ID: ${result.correctRootId}`);
    console.log(`  Problematic: ${result.isProblematic}`);
    console.log('');
});

// Simulate the impact on thread building
console.log('=== IMPACT ON THREAD BUILDING ===\n');

const replyOnlyNote = createMockEvent('reply_note', [
    ['e', 'actual_root', '', 'reply']
]);

const rootDetermination = simulateRootIdDetermination(replyOnlyNote);

console.log('When fetchThread is called with a reply-only note:');
console.log(`1. Current behavior: Uses '${rootDetermination.currentRootId}' as root`);
console.log(`2. Expected behavior: Should use '${rootDetermination.correctRootId}' as root`);
console.log('');

if (rootDetermination.isProblematic) {
    console.log('*** ISSUE CONFIRMED ***');
    console.log(`The reply-only note becomes the root of its own thread instead of being a child in the correct thread.`);
    console.log(`This means when viewing this note, it appears as a standalone post rather than part of the original conversation.`);
} else {
    console.log('No issue detected with this test case.');
}