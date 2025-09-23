#!/usr/bin/env node

/**
 * Test script to verify that selectedEmoji initialization order issue is fixed.
 */

const fs = require('fs');
const path = require('path');

const NOSTR_INDEX_FILE = path.join(__dirname, 'src/routes/nostr.index.tsx');

function testSelectedEmojiInitialization() {
    console.log('Testing selectedEmoji initialization order fix...\n');
    
    try {
        const content = fs.readFileSync(NOSTR_INDEX_FILE, 'utf8');
        const lines = content.split('\n');
        
        // Find the line numbers for selectedEmoji declaration and usage
        let selectedEmojiDeclarationLine = -1;
        let noteIdsForReactionsLine = -1;
        let selectedEmojiUsageInMemoLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Find selectedEmoji state declaration
            if (line.includes('const [selectedEmoji, setSelectedEmoji] = useState<string>(\'\')')) {
                selectedEmojiDeclarationLine = i + 1;
            }
            
            // Find noteIdsForReactions useMemo declaration
            if (line.includes('const noteIdsForReactions = useMemo(')) {
                noteIdsForReactionsLine = i + 1;
            }
            
            // Find selectedEmoji usage in dependency array
            if (line.includes('}, filterMode === \'reactions\' ? [selectedEmoji] : [notes])')) {
                selectedEmojiUsageInMemoLine = i + 1;
            }
        }
        
        console.log(`selectedEmoji declaration found at line: ${selectedEmojiDeclarationLine}`);
        console.log(`noteIdsForReactions useMemo found at line: ${noteIdsForReactionsLine}`);
        console.log(`selectedEmoji usage in dependency array at line: ${selectedEmojiUsageInMemoLine}\n`);
        
        // Test 1: Check that selectedEmoji is declared before its usage
        if (selectedEmojiDeclarationLine === -1) {
            console.log('❌ selectedEmoji state declaration not found');
            return false;
        }
        
        if (selectedEmojiUsageInMemoLine === -1) {
            console.log('❌ selectedEmoji usage in dependency array not found');
            return false;
        }
        
        if (selectedEmojiDeclarationLine >= selectedEmojiUsageInMemoLine) {
            console.log('❌ selectedEmoji is still declared after its usage - initialization order issue not fixed');
            console.log(`Declaration at line ${selectedEmojiDeclarationLine}, usage at line ${selectedEmojiUsageInMemoLine}`);
            return false;
        }
        
        console.log('✅ selectedEmoji is now declared before its usage - initialization order fixed');
        
        // Test 2: Check that the declaration is moved to the correct position
        if (selectedEmojiDeclarationLine >= noteIdsForReactionsLine) {
            console.log('❌ selectedEmoji declaration should be before noteIdsForReactions useMemo');
            return false;
        }
        
        console.log('✅ selectedEmoji declaration is properly positioned before noteIdsForReactions useMemo');
        
        // Test 3: Check for the explanatory comment
        const hasComment = content.includes('State for selected emoji in reactions view (must be declared before use in useMemo)');
        if (!hasComment) {
            console.log('❌ Missing explanatory comment about initialization order');
            return false;
        }
        console.log('✅ Explanatory comment present');
        
        console.log('\n🎉 All tests passed! selectedEmoji initialization order issue is fixed.');
        console.log('Benefits:');
        console.log('- Web app will now load without "Cannot access \'selectedEmoji\' before initialization" error');
        console.log('- Variable is properly declared before being referenced in dependency arrays');
        console.log('- Temporal dead zone error eliminated');
        
        return true;
        
    } catch (error) {
        console.log('❌ Error reading nostr.index.tsx file:', error.message);
        return false;
    }
}

// Run the test
const success = testSelectedEmojiInitialization();
process.exit(success ? 0 : 1);