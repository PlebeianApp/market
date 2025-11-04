# NDK Version Downgrade - 2.18.1 → 2.15.2

## Issue
Versions 2.17.x - 2.18.x of `@nostr-dev-kit/ndk` were causing temporal dead zone errors:
```
ReferenceError: can't access lexical declaration 's' before initialization
    at ["node_modules/@nostr-dev-kit/ndk/dist/index.mjs"]</fetchEvent/</t2<
```

This error was occurring in:
- NDK's `fetchEvent` function with timeout handlers
- Navigation between views (particularly sales/purchase pages)
- Subscription lifecycle management

## Versions Tested
- ❌ **2.18.1** - Temporal dead zone errors
- ❌ **2.17.10** - Still has temporal dead zone errors  
- ✅ **2.15.2** - Testing this version (earlier stable release)

## Solution
Downgraded to NDK version 2.15.2, which predates the introduction of the temporal dead zone issue.

## Command Used
```bash
bun add @nostr-dev-kit/ndk@2.15.2
```

## Testing Instructions
1. Restart the dev server: `bun run dev`
2. Navigate to the sales page
3. Navigate to the purchases page
4. Navigate back to sales
5. Check the browser console for errors

## Expected Outcome
The temporal dead zone errors should no longer occur, or occur much less frequently.

## Rollback Plan
If issues arise with 2.15.2, you can:

### Try even earlier versions:
```bash
# Try 2.14.38 (earlier stable from 2.14.x series)
bun add @nostr-dev-kit/ndk@2.14.38

# Try 2.14.30
bun add @nostr-dev-kit/ndk@2.14.30
```

### Or try newer versions:
```bash
# Try 2.16.1
bun add @nostr-dev-kit/ndk@2.16.1

# Try 2.18.1 again with error suppression
bun add @nostr-dev-kit/ndk@2.18.1

# Try beta 3.x (if you want newest features)
bun add @nostr-dev-kit/ndk@3.0.0-beta.32
```

## Version History

| Version | Status | Notes |
|---------|--------|-------|
| 2.18.1  | ❌ Issues | Temporal dead zone errors in fetchEvent |
| 2.17.10 | ❌ Issues | Still has temporal dead zone errors |
| 2.16.1  | ⚠️ Untested | Between 2.15 and 2.17 |
| 2.15.2  | ✅ Testing | Earlier stable, may avoid TDZ issue |
| 2.14.38 | ✅ Stable | Fallback if 2.15.2 has issues |
| 3.0.0-beta.32 | ⚠️ Beta | Latest beta, may have different API |

## Related Files
- Error handling improvements: `src/frontend.tsx`
- Safe subscription utility: `src/lib/utils/subscription.ts`
- Documentation: `docs/NDK_TEMPORAL_DEAD_ZONE_FIX.md`

## Notes
- Keep the error handling code in `frontend.tsx` even if this version works - it provides defense in depth
- Monitor for any new errors or regressions
- If 2.17.10 works well, consider pinning the version (remove `^` prefix) to prevent automatic updates

## Date
November 4, 2025

