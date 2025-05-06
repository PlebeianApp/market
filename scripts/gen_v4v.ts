import { NDKEvent, type NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { randomBytes } from 'crypto';

const POTENTIAL_V4V_RECIPEINTS = ['npub10pensatlcfwktnvjjw2dtem38n6rvw8g6fv73h84cuacxn4c28eqyfn34f', 'npub1dergggklka99wwrs92yz8wdjs952h2ux2ha2ed598ngwu9w7a6fsh9xzpc', 'npub12rv5lskctqxxs2c8rf2zlzc7xx3qpvzs3w4etgemauy9thegr43sf485vg']

// Helper to generate random integers in a range
function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper to shuffle array randomly
function shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Generate V4V share data
export async function createV4VSharesEvent(signer: NDKPrivateKeySigner, ndk: any, appPubkey: string = "app_pubkey") {
    try {
        // Generate a random UUID for the event
        const uuid = Buffer.from(randomBytes(16)).toString('hex');
        
        // Decide on total percentage to share (5-20%)
        const totalPercentage = getRandomInt(5, 20);
        
        // Decide how many recipients (1-3)
        const recipientCount = getRandomInt(1, Math.min(POTENTIAL_V4V_RECIPEINTS.length, 3));
        
        // Shuffle the recipients array and take the first recipientCount elements
        const selectedRecipients = shuffleArray(POTENTIAL_V4V_RECIPEINTS).slice(0, recipientCount);
        
        // Distribute the total percentage among recipients
        let remainingPercentage = totalPercentage;
        const zapTags: string[][] = [];
        
        for (let i = 0; i < selectedRecipients.length; i++) {
            // For the last recipient, assign the remaining percentage
            if (i === selectedRecipients.length - 1) {
                zapTags.push(["zap", selectedRecipients[i], remainingPercentage.toString()]);
            } else {
                // Otherwise, assign a random percentage of the remaining
                const percentage = i === selectedRecipients.length - 1 
                    ? remainingPercentage 
                    : getRandomInt(1, remainingPercentage - (selectedRecipients.length - i - 1));
                
                zapTags.push(["zap", selectedRecipients[i], percentage.toString()]);
                remainingPercentage -= percentage;
            }
        }
        
        // Create the event
        const event = new NDKEvent(ndk);
        event.kind = 30078;
        event.content = JSON.stringify(zapTags);
        event.tags = [
            ["d", uuid],
            ["l", "v4v_share"],
            ["p", appPubkey]
        ];
        
        // Sign and publish the event
        event.pubkey = (await signer.user()).pubkey;
        await event.sign(signer);
        await event.publish();
        
        console.log(`Created V4V share event for ${event.pubkey.substring(0, 8)} with ${recipientCount} recipients (${totalPercentage}% total)`);
        return true;
    } catch (error) {
        console.error('Failed to create V4V share event:', error);
        return false;
    }
}