# NDK (Nostr Development Kit) Claude Skill

> **Comprehensive knowledge base for working with NDK in production applications**

This Claude skill provides deep expertise in the Nostr Development Kit based on real-world usage patterns from the Plebeian Market application.

## 📚 Documentation Structure

```
.claude/skills/ndk/
├── README.md                    # This file - Overview and getting started
├── ndk-skill.md                 # Complete reference guide (18KB)
├── quick-reference.md           # Fast lookup for common tasks (7KB)
├── troubleshooting.md           # Common problems and solutions
└── examples/                    # Production code examples
    ├── README.md
    ├── 01-initialization.ts     # NDK setup and connection
    ├── 02-authentication.ts     # NIP-07, NIP-46, private keys
    ├── 03-publishing-events.ts  # Creating and publishing events
    ├── 04-querying-subscribing.ts # Fetching and real-time subs
    └── 05-users-profiles.ts     # User and profile management
```

## 🚀 Quick Start

### For Quick Lookups

Start with **`quick-reference.md`** for:

- Common code snippets
- Quick syntax reminders
- Frequently used patterns

### For Deep Learning

Read **`ndk-skill.md`** for:

- Complete API documentation
- Best practices
- Integration patterns
- Performance optimization

### For Problem Solving

Check **`troubleshooting.md`** for:

- Common error solutions
- Performance tips
- Testing strategies
- Debug techniques

### For Code Examples

Browse **`examples/`** directory for:

- Real production code
- Full implementations
- React integration patterns
- Error handling examples

## 📖 Core Topics Covered

### 1. Initialization & Setup

- Basic NDK initialization
- Multiple instance patterns (main + zap relays)
- Connection management with timeouts
- Relay pool configuration
- Connection status monitoring

### 2. Authentication

- **NIP-07**: Browser extension signers (Alby, nos2x)
- **NIP-46**: Remote signers (Bunker)
- **Private Keys**: Direct key management
- Auto-login with localStorage
- Multi-account session management

### 3. Event Publishing

- Basic text notes
- Parameterized replaceable events (products, profiles)
- Order and payment events
- Batch publishing
- Error handling patterns

### 4. Querying & Subscriptions

- One-time fetches with `fetchEvents()`
- Real-time subscriptions
- Tag filtering patterns
- Time-range queries
- Event monitoring
- React Query integration

### 5. User & Profile Management

- Fetch profiles (npub, hex, NIP-05)
- Update user profiles
- Follow/unfollow operations
- Batch profile loading
- Profile caching strategies

### 6. Advanced Patterns

- Store-based NDK management
- Query + subscription combination
- Event parsing utilities
- Memory leak prevention
- Performance optimization

## 🎯 Use Cases

### Building a Nostr Client

```typescript
// Initialize
const { ndk, isConnected } = await initializeNDK({
	relays: ['wss://relay.damus.io', 'wss://nos.lol'],
	timeoutMs: 10000,
})

// Authenticate
const { user } = await loginWithExtension(ndk)

// Publish
await publishBasicNote(ndk, 'Hello Nostr!')

// Subscribe
const sub = subscribeToNotes(ndk, user.pubkey, (event) => {
	console.log('New note:', event.content)
})
```

### Building a Marketplace

```typescript
// Publish product
await publishProduct(ndk, {
	slug: 'bitcoin-shirt',
	title: 'Bitcoin T-Shirt',
	price: 25,
	currency: 'USD',
	images: ['https://...'],
})

// Create order
await createOrder(ndk, {
	orderId: uuidv4(),
	sellerPubkey: merchant.pubkey,
	productRef: '30402:pubkey:bitcoin-shirt',
	quantity: 1,
	totalAmount: '25.00',
})

// Monitor payment
monitorPaymentReceipt(ndk, orderId, invoiceId, (preimage) => {
	console.log('Payment confirmed!')
})
```

### React Integration

```typescript
function Feed() {
  const ndk = useNDK()
  const { user } = useAuth()

  // Query with real-time updates
  const { data: notes } = useNotesWithSubscription(
    ndk,
    user.pubkey
  )

  return (
    <div>
      {notes?.map(note => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  )
}
```

## 🔍 Common Patterns Quick Reference

### Safe NDK Access

```typescript
const ndk = ndkActions.getNDK()
if (!ndk) throw new Error('NDK not initialized')
```

### Subscription Cleanup

```typescript
useEffect(() => {
	const sub = ndk.subscribe(filter, { closeOnEose: false })
	sub.on('event', handleEvent)
	return () => sub.stop() // Critical!
}, [ndk])
```

### Error Handling

```typescript
try {
	await event.sign()
	await event.publish()
} catch (error) {
	console.error('Publishing failed:', error)
	throw new Error('Failed to publish. Check connection.')
}
```

### Tag Filtering

```typescript
// ✅ Correct (note the # prefix for tag filters)
{ kinds: [16], '#order': [orderId] }

// ❌ Wrong
{ kinds: [16], 'order': [orderId] }
```

## 🛠 Development Tools

### VS Code Integration

These skill files work with:

- Cursor AI for code completion
- Claude for code assistance
- GitHub Copilot with context

### Debugging Tips

```typescript
// Check connection
console.log(
	'Connected relays:',
	Array.from(ndk.pool?.relays.values() || [])
		.filter((r) => r.status === 1)
		.map((r) => r.url),
)

// Verify signer
console.log('Signer:', ndk.signer)
console.log('Active user:', ndk.activeUser)

// Event inspection
console.log('Event:', {
	id: event.id,
	kind: event.kind,
	tags: event.tags,
	sig: event.sig,
})
```

## 📊 Statistics

- **Total Documentation**: ~50KB
- **Code Examples**: 5 complete modules
- **Patterns Documented**: 50+
- **Common Issues Covered**: 15+
- **Based On**: Real production code

## 🔗 Additional Resources

### Official NDK Resources

- **GitHub**: https://github.com/nostr-dev-kit/ndk
- **Documentation**: https://ndk.fyi
- **NPM**: `@nostr-dev-kit/ndk`

### Nostr Protocol

- **NIPs**: https://github.com/nostr-protocol/nips
- **Nostr**: https://nostr.com

### Related Tools

- **TanStack Query**: React state management
- **TanStack Router**: Type-safe routing
- **Radix UI**: Accessible components

## 💡 Tips for Using This Skill

1. **Start Small**: Begin with quick-reference.md for syntax
2. **Go Deep**: Read ndk-skill.md section by section
3. **Copy Examples**: Use examples/ as templates
4. **Debug Issues**: Check troubleshooting.md first
5. **Stay Updated**: Patterns based on production usage

## 🤝 Contributing

This skill is maintained based on the Plebeian Market codebase. To improve it:

1. Document new patterns you discover
2. Add solutions to common problems
3. Update examples with better approaches
4. Keep synchronized with NDK updates

## 📝 Version Info

- **Skill Version**: 1.0.0
- **NDK Version**: Latest (based on production usage)
- **Last Updated**: November 2025
- **Codebase**: Plebeian Market

---

**Ready to build with NDK?** Start with `quick-reference.md` or dive into `examples/01-initialization.ts`!
