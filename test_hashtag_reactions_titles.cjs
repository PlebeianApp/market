#!/usr/bin/env node

/**
 * Test script to verify that hashtag and reaction titles always appear
 * even when there are no hashtags or reactions in the fields.
 */

const fs = require('fs');
const path = require('path');

const NOTEVIEW_FILE = path.join(__dirname, 'src/components/NoteView.tsx');

function testHashtagsAndReactionsAlwaysShow() {
    console.log('Testing hashtag and reaction title visibility...\n');
    
    try {
        const content = fs.readFileSync(NOTEVIEW_FILE, 'utf8');
        
        // Test 1: Check that reactions section doesn't have early returns that prevent showing titles
        const reactionsSection = content.match(/\/\* Reactions row[\s\S]*?}\)\(\)/);
        if (!reactionsSection) {
            console.log('❌ Could not find reactions section');
            return false;
        }
        
        const reactionsCode = reactionsSection[0];
        
        // Should NOT have "if (!emap) return null" or "if (entries.length === 0) return null"
        if (reactionsCode.includes('if (!emap) return null') || reactionsCode.includes('if (entries.length === 0) return null')) {
            console.log('❌ Reactions section still has conditional returns that prevent showing title when empty');
            return false;
        }
        
        // Should have fallback rendering in catch block
        if (!reactionsCode.includes('catch {') || !reactionsCode.includes('<span className="text-gray-500">Reactions:</span>')) {
            console.log('❌ Reactions section missing proper fallback rendering');
            return false;
        }
        
        console.log('✅ Reactions section properly always shows title');
        
        // Test 2: Check that hashtags section doesn't have early returns that prevent showing titles
        const hashtagsSection = content.match(/\/\* Hashtags section[\s\S]*?}\)\(\)/);
        if (!hashtagsSection) {
            console.log('❌ Could not find hashtags section');
            return false;
        }
        
        const hashtagsCode = hashtagsSection[0];
        
        // Should NOT have "if (hashtags.length === 0) return null"
        if (hashtagsCode.includes('if (hashtags.length === 0) return null')) {
            console.log('❌ Hashtags section still has conditional return that prevents showing title when empty');
            return false;
        }
        
        // Should have fallback rendering in catch block
        if (!hashtagsCode.includes('catch {') || !hashtagsCode.includes('<span className="text-gray-500">Hashtags:</span>')) {
            console.log('❌ Hashtags section missing proper fallback rendering');
            return false;
        }
        
        console.log('✅ Hashtags section properly always shows title');
        
        // Test 3: Check that both sections always return a div with the title
        const reactionsAlwaysReturnsDiv = reactionsCode.includes('return (') && 
                                         reactionsCode.includes('<span className="text-gray-500">Reactions:</span>');
        const hashtagsAlwaysReturnsDiv = hashtagsCode.includes('return (') && 
                                        hashtagsCode.includes('<span className="text-gray-500">Hashtags:</span>');
        
        if (!reactionsAlwaysReturnsDiv) {
            console.log('❌ Reactions section does not always return a div with title');
            return false;
        }
        
        if (!hashtagsAlwaysReturnsDiv) {
            console.log('❌ Hashtags section does not always return a div with title');
            return false;
        }
        
        console.log('✅ Both sections always return divs with titles');
        console.log('\n🎉 All tests passed! Hashtag and reaction titles will always appear.');
        return true;
        
    } catch (error) {
        console.log('❌ Error reading NoteView.tsx file:', error.message);
        return false;
    }
}

// Run the test
const success = testHashtagsAndReactionsAlwaysShow();
process.exit(success ? 0 : 1);