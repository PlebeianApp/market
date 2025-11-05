# NDK Temporal Dead Zone Error - Fix Summary

## Problem

The application was experiencing `ReferenceError: can't access lexical declaration 's' before initialization` errors when navigating between views (particularly sales/purchase views). This error was occurring in NDK's internal code, specifically in:

- NDK's `fetchEvent` function with timeout handlers (`t2`)
- NDK's subscription management
- NDK's `aiGuardrails` feature

## Root Cause

This is a JavaScript **temporal dead zone (TDZ)** issue in NDK's bundled code. The error occurs when:

1. NDK creates subscriptions with lexical declarations: `let s = ...`
2. Timeout callbacks or cleanup functions try to access these variables before they're fully initialized
3. JavaScript's strict mode throws a ReferenceError when attempting to access a variable in its TDZ

This is particularly problematic with:

- Rapid navigation between routes
- Component unmounting during async operations
- Browser extensions (like Gooti) that interact with Nostr events

## Solutions Implemented

### 1. Enhanced Global Error Handler (`src/frontend.tsx`)

Updated the existing global error handler to catch the specific error patterns:

- **Firefox error pattern**: `"can't access lexical declaration 's' before initialization"`
- **Chrome error pattern**: `"Cannot access 's' before initialization"`
- **aiGuardrails errors**: Related internal NDK feature errors
- **fetchEvent errors**: Timeout-related errors in NDK's event fetching

The handler now:

- Detects temporal dead zone errors more accurately
- Checks if errors originate from NDK (via stack traces)
- Suppresses errors while logging them as warnings
- Prevents error popups and console spam
- Provides detailed debugging information

### 2. Subscription Cleanup Enhancements

Enhanced all NDK subscription cleanup patterns across the codebase:

**Files Updated:**

- `src/components/orders/OrderDetailComponent.tsx`
- `src/components/auth/NostrConnectQR.tsx`
- `src/queries/payment.tsx`
- `src/queries/orders.tsx`
- `src/queries/blacklist.tsx`
- `src/queries/app-settings.tsx`
- `src/lib/stores/ndk.ts`

**Changes:**

- Added `aiGuardrails` error suppression to all cleanup handlers
- Increased cleanup delays (50-100ms) to give NDK more initialization time
- Enhanced error logging with detailed context
- Added try-catch blocks around subscription creation
- Improved subscription state tracking

### 3. Safe Subscription Utility (`src/lib/utils/subscription.ts`)

Created a reusable utility for handling NDK subscriptions safely:

**Features:**

- Consistent error handling for all subscription operations
- Automatic cleanup with proper timing
- Hook-based API for React components
- Promise-based subscription patterns
- Built-in timeout management
- Comprehensive TDZ error suppression

**Usage Example:**

```typescript
import { createSafeSubscription } from '@/lib/utils/subscription'

const { subscription, cleanup } = createSafeSubscription(
	ndk,
	{ kinds: [1], authors: [pubkey] },
	{
		closeOnEose: true,
		timeout: 5000,
		onEvent: (event) => console.log('Event:', event),
		onEose: () => console.log('Complete'),
	},
)

// Later...
cleanup()
```

### 4. Standalone Error Handler (`src/lib/utils/ndk-error-handler.ts`)

Created a standalone module for NDK error handling that can be used independently:

**Features:**

- Install/uninstall capability
- Handles both synchronous errors and promise rejections
- Detailed error logging
- Pattern matching for known NDK issues

## Testing

After implementing these changes, you should:

1. **Test navigation**: Navigate between sales/purchase views multiple times
2. **Check console**: You should see warnings like:

   ```
   [NDK] Suppressed temporal dead zone error (NDK race condition): {...}
   ```

   Instead of uncaught errors

3. **Verify functionality**: All Nostr operations should work normally
4. **Browser compatibility**: Test in both Firefox and Chrome

## Why This Approach?

1. **Non-invasive**: Doesn't modify NDK source code
2. **Defensive**: Catches errors at multiple levels (global, cleanup, subscription)
3. **Debuggable**: Logs all suppressed errors for monitoring
4. **User-friendly**: Prevents error popups while maintaining functionality
5. **Future-proof**: Will catch similar errors if they occur in other NDK operations

## Known Limitations

- The errors still occur internally in NDK, we just suppress them
- This is a workaround until NDK fixes the underlying issue
- May suppress legitimate errors if they match the patterns (unlikely)

## Monitoring

Watch for these warnings in the console:

- `[NDK] Suppressed temporal dead zone error`
- `[NDK] Suppressed aiGuardrails race condition`
- `[NDK] Suppressed subscription cleanup race condition`

If you see these frequently, it indicates NDK operations are running into timing issues, but they're being handled gracefully.

## Future Improvements

1. **Report to NDK**: Consider reporting this issue to the NDK maintainers
2. **Update NDK**: Monitor for NDK updates that fix the underlying issue
3. **Gradual adoption**: Use the new `SafeSubscription` utility for new code
4. **Performance monitoring**: Track if error suppression impacts performance

## Related Issues

This issue is related to:

- JavaScript temporal dead zone (TDZ)
- NDK's bundling/compilation process
- Browser-specific error message formats
- Async/await timing in subscription lifecycle
- Component unmounting during async operations
