## App Settings (kinds `31990` | `30078`)

### App's kind 31990 (application handler):
Event signed with app's pubkey
Content(stringified json):
- name: App's name
- displayName: App's display name
- picture: App's logo
- banner: App's banner 
- ownerPk: Hex pubkey
- allowRegister: Boolean
- defaultCurrency: ISO-compatible string
- blossom_server: String (optional)
- nip96_server: String (optional)
- ...

Tags:
- `d`: Random UUID
- `k`: Supported kinds
- `web`: As defined in NIP-89
- `r` : app's relay

For extended or encrypted app settings, use a NIP-78 (kind `30078`) event with the same `d` tag as the kind 31990 app handler event.

The app setup process involves creating and publishing these app setting events.
The app should also publish a kind 10002 event with the relay it uses to publish its data, can be just the app's relay.

Events example:
k: 31990
```json
{
"id": "...",
"pubkey": "<app's pubkey>",
"kind": 31990,
"content": JSON.strigify({
	name: "",
	display_name: "",
	picture: "",
	ownerPk: "",
	allow_register: "",
	default_currency: "",
	// Other fields
        }),
"tags": [
["d", "<random uuid>"],
["k", "30402"],
["k", "30405"],
// Other suported kinds
["web", "https://..../a/<bech32>", "nevent"],
["web", "https://..../p/<bech32>", "nprofile"],
// Other handlers
]
// other fields
}
```

k: 30078
```json
{
"id": "...",
"pubkey": "<app's pubkey>",
"kind": 30078,
"content": JSON.strigify({ // Same format as the 31990 events
	extended_field: "",
	field_to_encrypt: "",
	// Other fields
}),
"tags": [
["d", "<same uuid than 31990 event>"],
]
// other fields
}
```
## App's Ban List (kind `10000`)
App's NIP-51 mute list (kind `10000`) signed with the app's pubkey. This list contains banned pubkeys, words, and hashtags. It can be public, encrypted, or mixed as described in NIP-51.

## App User Roles (kind `30000`)
App's NIP-51 (kind `30000`) list, signed with the app's pubkey, with `d: "<role(admins | editors | plebs)>"`, and `p` tags for users in each group. It can be public, encrypted, or mixed.

All this settings and preferences should be decrypted and initialized in the app's server

---
## Featured Products (kind `30405`)
- For app's featured products: App's collection (kind `30405`) with `d: "featured_products"`
- For user's featured products: User's collection (kind `30405`) with `d: "featured_products"`

## Featured Collections (kind `30003`)
- For app's featured collections: App's NIP-51 (kind `30003`) with `d: "featured_collections"` and one or multiple `a` tags pointing to collection coordinates
- For user's featured collections: User's NIP-51 (kind `30003`) with `d: "featured_collections"` and one or multiple `a` tags pointing to collection coordinates

---
## User's settings and preferences

### User Payment Details (kind `30078`)
User-signed NIP-78 event with tags:
- `d: "<uuid>"`
- `l: "payment_detail"`
- `a: "<collection | product coordinates>"` (optional, if not present, it's global)
- `p: "<app's pubkey>"`

Payment details should be in the event's content, encrypted to the app's and user's pubkey.

content(stringified json):
- `payment_method`: `"<ln | on-chain | cashu> | ..."`
- `payment_detail`: `"<string(bolt11 or 12 | xpub | btc address | cashu pay req | ...>"`

One event per payment detail

Example event:

```json
{
"id": "...",
"pubkey": "<user's pubkey>",
"kind": 30078,
"content": encrypt(JSON.strigify({ // Same format as the 31990 events
	payment_method: "",
	payment_detail: "",
	// Other fields
})),
"tags": [
["d", "<random uuid>"],
["l", "payment_detail"],
["p", "<app's pubkey>"],
// Optional
["a", "<collection or product coordinates>"]
]
// other fields
}
```

### Wallet Details (kind `30078`)
App-signed NIP-78 event with `a: "<related user payment details event coordinates>"`. This event tracks on-chain wallet index or other state management for payment details. Content is encrypted to user pubkey, so it can be decrypted by both parties

Example event:

```json
{
"id": "...",
"pubkey": "<app's pubkey>",
"kind": 30078,
"content": encrypt(JSON.strigify({ // Same format as the 31990 events
	key: "<on-chain-index>", // For tracking use case
	value: "1",
	// Other fields
})),
"tags": [
["d", "<random uuid>"],
["l", "wallet_detail"],
["a", "<related user payment details event coordinates>"]
]
// other fields
}
```


### NWC Strings (kind `30078`)
User-signed NIP-78 event with:
- `d: "<uuid>"`
- `l: "nwc_string"`
- `p: "<app's pubkey>"` (optional)

The string should be encrypted in the event's content field for the app's pubkey.

```json
{
"id": "...",
"pubkey": "<user's pubkey>",
"kind": 30078,
"content": encrypt("<nwc_string>"),
"tags": [
["d", "<random uuid>"],
["l", "nwc_string"],
// Optional
["p", "<app's pubkey>"]
]
// other fields
}
```

### V4V/CECB Shares (kind `30078`)
User's NIP-78 event with shares:
- `d: "<uuid>"`
- `l: "v4v_share"`
- `p: "<app's pubkey>"`

Use the same convention as in NIP-57 using `zap` tags for global V4V shares. For future per-product shares, use the `zap` tag in the product event as described in NIP-57.

Example event:
```json
{
"id": "...",
"pubkey": "<user's pubkey>",
"kind": 30078,
"content": JSON.strigify({
	[
		["zap", "<pubkey of the profile to share>", "<weight>"],
		["zap", "<pubkey of the profile to share>", "<weight>"],
		["zap", "<pubkey of the profile to share>", "<weight>"],
		// All the shares
	]
}),
"tags": [
["d", "<random uuid>"],
["l", "v4v_share"],
["p", "<app's pubkey>"]
]
// other fields
}
```

---
## Architecture Overview

### Relay and App Relationship
- A single relay can support any number of apps
- Relays store app-specific data, state, settings, and related information
- Apps store their data and other relevant information in the relay

### Relay Configuration
- Relays store their settings and configuration as a registry of associated apps
- This information is stored as events in the relay db, signed with the relay's pubkey

### App Configuration Standards
- Apps must use NIP-89 for their public configuration
- NIP-78 events are used for extended or encrypted configuration

### Key Management
- Relays have their own keys
- Apps have their own keys
- Apps may receive a key derived from the relay's key if data needs to be decrypted indifferently by relay and app, but this is not mandatory.

### App Setup Process
1. When a new app is added, it fetches its configuration from the relay
2. If the configuration is not found, it must be created

### App Server Requirements
- Apps may have a server for decrypting information or for convenience
- Some apps can be pure front-end, especially if their configuration is entirely public

### Event Publishing
- Apps can publish various types of events using their keys, such as:
  - Terms of Service
  - Articles
  - About information
  - Outbox relay list
  - etc.

### Relay Publishing and Compliance
- Relays can publish events if needed (e.g., terms and conditions for accessing their service)
- Relays must comply with NIP-11 standards
