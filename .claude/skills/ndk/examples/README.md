# NDK Examples Index

Complete code examples extracted from the Plebeian Market production codebase.

## Available Examples

### 01-initialization.ts

- Basic NDK initialization
- Multiple NDK instances (main + zap relays)
- Connection with timeout protection
- Connection status checking
- Full initialization flow with error handling

### 02-authentication.ts

- NIP-07 browser extension login
- Private key signer
- NIP-46 remote signer (Bunker)
- Auto-login from localStorage
- Saving auth credentials
- Logout functionality
- Getting current user

### 03-publishing-events.ts

- Basic note publishing
- Events with tags (mentions, hashtags, replies)
- Product listings (parameterized replaceable events)
- Order creation events
- Status update events
- Batch publishing
- Custom signer usage
- Comprehensive error handling

### 04-querying-subscribing.ts

- Basic fetch queries
- Multiple author queries
- Tag filtering
- Time range filtering
- Event ID lookup
- Real-time subscriptions
- Subscription cleanup patterns
- React integration hooks
- React Query integration
- Waiting for specific events
- Payment monitoring

### 05-users-profiles.ts

- Fetch profile by npub
- Fetch profile by hex pubkey
- Fetch profile by NIP-05
- Universal identifier lookup
- Get current user
- Extract profile information
- Update user profile
- Batch fetch multiple profiles
- Convert between pubkey formats (hex/npub)
- React hooks for profiles
- Follow/unfollow users

## Usage

Each file contains:

- Fully typed TypeScript code
- JSDoc comments explaining the pattern
- Error handling examples
- Integration patterns with React/TanStack Query
- Real-world usage examples

All examples are based on actual production code from the Plebeian Market application.

## Running Examples

```typescript
import { initializeNDK } from './01-initialization'
import { loginWithExtension } from './02-authentication'
import { publishBasicNote } from './03-publishing-events'

// Initialize NDK
const { ndk, isConnected } = await initializeNDK()

if (isConnected) {
	// Authenticate
	const { user } = await loginWithExtension(ndk)

	// Publish
	await publishBasicNote(ndk, 'Hello Nostr!')
}
```

## Additional Resources

- See `../ndk-skill.md` for detailed documentation
- See `../quick-reference.md` for quick lookup
- Check the main codebase for more complex patterns
