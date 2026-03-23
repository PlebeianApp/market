# In-Memory State Variables (`src/server/`)

All state below is ephemeral — rebuilt from Nostr relay events on app initialization, lost on page refresh.

## EventHandler (`src/server/EventHandler.ts`)

| Variable               | Type          | Line | Purpose                                                    |
| ---------------------- | ------------- | ---- | ---------------------------------------------------------- |
| `isInitialized`        | `boolean`     | 16   | Whether initialization has completed                       |
| `handledZapReceiptIds` | `Set<string>` | 29   | Dedup cache for processed zap receipts (capped at 2000)    |
| `ndk`                  | `NDK \| null` | 27   | NDK instance connected to the app relay                    |
| `zapNdk`               | `NDK \| null` | 28   | NDK instance connected to zap relays (for vanity receipts) |

## AdminManager (`src/server/AdminManager.ts`)

| Variable       | Type          | Line | Purpose                                |
| -------------- | ------------- | ---- | -------------------------------------- |
| `adminPubkeys` | `Set<string>` | 5    | Set of admin public keys (64-char hex) |

Synced from: kind `30000` event with `d` tag = `admins`, `p` tags = pubkeys.

## EditorManager (`src/server/EditorManager.ts`)

| Variable        | Type          | Line | Purpose                                 |
| --------------- | ------------- | ---- | --------------------------------------- |
| `editorPubkeys` | `Set<string>` | 5    | Set of editor public keys (64-char hex) |

Synced from: kind `30000` event with `d` tag = `editors`, `p` tags = pubkeys.

## BootstrapManager (`src/server/BootstrapManager.ts`)

| Variable        | Type      | Line | Purpose                                                  |
| --------------- | --------- | ---- | -------------------------------------------------------- |
| `bootstrapMode` | `boolean` | 6    | Whether the app is in initial setup mode (no admins yet) |
| `hasSetupEvent` | `boolean` | 7    | Whether a kind 31990 setup event has been received       |

Synced from: kind `31990` setup event.

## BlacklistManager (`src/server/BlacklistManager.ts`)

| Variable                 | Type          | Line | Purpose                                                 |
| ------------------------ | ------------- | ---- | ------------------------------------------------------- |
| `blacklistedPubkeys`     | `Set<string>` | 17   | Set of blacklisted user pubkeys                         |
| `blacklistedProducts`    | `Set<string>` | 18   | Set of blacklisted product coordinates (`30402:...`)    |
| `blacklistedCollections` | `Set<string>` | 19   | Set of blacklisted collection coordinates (`30405:...`) |
| `ndk`                    | `NDK \| null` | 22   | NDK instance for fetching/publishing blacklist events   |

Synced from: kind `10000` event from the app pubkey, `p` tags = users, `a` tags = products/collections.

## VanityManager (`src/server/VanityManager.ts`)

| Variable               | Type                       | Line | Purpose                                            |
| ---------------------- | -------------------------- | ---- | -------------------------------------------------- |
| `vanityRegistry`       | `Map<string, VanityEntry>` | 75   | Vanity name -> entry (pubkey + expiry)             |
| `pubkeyToVanity`       | `Map<string, string>`      | 76   | Reverse lookup: pubkey -> vanity name              |
| `processedZapReceipts` | `Set<string>`              | 77   | Dedup cache for processed zap receipts             |
| `ndk`                  | `NDK \| null`              | 80   | NDK instance for fetching/publishing vanity events |
| `appPubkey`            | `string`                   | 81   | App's public key for filtering relay queries       |

Synced from: kind `30000` event with `d` tag = `vanity-urls`, `vanity` tags = entries.

## EventSigner (`src/server/EventSigner.ts`)

| Variable        | Type         | Line | Purpose                               |
| --------------- | ------------ | ---- | ------------------------------------- |
| `appPrivateKey` | `string`     | 6    | App's private key (hex)               |
| `privateBytes`  | `Uint8Array` | 7    | Private key as byte array for signing |
| `appPubkey`     | `string`     | 8    | Derived public key                    |

Not synced — these are config values loaded from environment on init.

## NDKService (`src/server/NDKService.ts`)

| Variable | Type          | Line | Purpose                              |
| -------- | ------------- | ---- | ------------------------------------ |
| `ndk`    | `NDK \| null` | 6    | NDK instance for relay communication |

Not stateful — just a relay connection wrapper.
