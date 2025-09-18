// Simple script to test reply functionality with the local relay

// Import required libraries
import NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import * as nostrTools from 'nostr-tools';

async function main() {
  // Create an NDK instance with the local relay
  const localRelay = 'ws://localhost:10547';
  const ndk = new NDK({
    explicitRelayUrls: [localRelay]
  });

  console.log('Connecting to relay:', localRelay);
  
  // Add timeout to prevent hanging indefinitely
  try {
    const connectPromise = ndk.connect();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000);
    });
    
    await Promise.race([connectPromise, timeoutPromise]);
    console.log('Connected to relay successfully');
  } catch (error) {
    console.error('Failed to connect to relay:', error.message);
    console.log('Continuing anyway to test event creation...');
  }

  // Generate a test private key
  const privateKey = nostrTools.generateSecretKey();
  const publicKey = nostrTools.getPublicKey(privateKey);
  console.log('Using test public key:', publicKey);

  // Create a signer using the private key
  const signer = {
    sign: async (event) => {
      return nostrTools.finalizeEvent(event, privateKey);
    }
  };

  // Set the signer for NDK
  ndk.signer = signer;

  // First create a root note
  console.log('Creating a root note...');
  const rootEvent = new NDKEvent(ndk);
  rootEvent.kind = 1;
  rootEvent.content = 'This is a test root note for reply testing';
  rootEvent.tags = [];
  
  // Sign and publish the root note
  await rootEvent.sign(signer);
  
  try {
    const publishPromise = rootEvent.publish();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Publish timeout after 5 seconds')), 5000);
    });
    
    await Promise.race([publishPromise, timeoutPromise]);
    console.log('Root note published with ID:', rootEvent.id);
    console.log('Root note JSON:', JSON.stringify(rootEvent.rawEvent()));
  } catch (error) {
    console.error('Failed to publish root note:', error.message);
    console.log('Root note ID:', rootEvent.id);
    console.log('Root note JSON:', JSON.stringify(rootEvent.rawEvent()));
  }

  // Create a reply to the root note
  console.log('\nCreating a reply to the root note...');
  const replyEvent = new NDKEvent(ndk);
  replyEvent.kind = 1;
  replyEvent.content = 'This is a reply to the root note';
  
  // Add tags for threading according to NIP-10
  replyEvent.tags = [];
  
  // Add "e" tag with root marker
  replyEvent.tags.push(['e', rootEvent.id, '', 'root']);
  
  // Add "e" tag with reply marker for the direct parent
  replyEvent.tags.push(['e', rootEvent.id, '', 'reply']);
  
  // Add "p" tag for the author of the note being replied to (same as our own in this test)
  replyEvent.tags.push(['p', publicKey]);
  
  // Sign and publish the reply
  await replyEvent.sign(signer);
  
  try {
    const publishPromise = replyEvent.publish();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Reply publish timeout after 5 seconds')), 5000);
    });
    
    await Promise.race([publishPromise, timeoutPromise]);
    console.log('Reply published successfully with ID:', replyEvent.id);
    console.log('Reply JSON:', JSON.stringify(replyEvent.rawEvent()));
  } catch (error) {
    console.error('Failed to publish reply:', error.message);
    console.log('Reply event ID:', replyEvent.id);
    console.log('Reply JSON:', JSON.stringify(replyEvent.rawEvent()));
  }

  // Wait a moment to ensure events are processed
  console.log('\nWaiting for events to be processed...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Fetch the events to verify they were saved
  console.log('\nFetching events from relay to verify storage...');
  const filter = { kinds: [1], authors: [publicKey] };
  
  try {
    const events = await ndk.fetchEvents(filter);
    
    const fetchedEvents = [];
    for await (const event of events) {
      fetchedEvents.push(event);
    }
    
    console.log(`Found ${fetchedEvents.length} events from our test author`);
    fetchedEvents.forEach(event => {
      console.log(`- Event ID: ${event.id}, kind: ${event.kind}, tags: ${JSON.stringify(event.tags)}`);
    });
  } catch (error) {
    console.error('Error fetching events:', error.message);
    console.log('Continuing with test completion...');
  }

  console.log('\nTest completed!');
  process.exit(0);
}

try {
  await main();
} catch (error) {
  console.error('Error in test script:', error);
  process.exit(1);
}