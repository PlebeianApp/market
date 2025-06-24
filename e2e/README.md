# E2E Testing with Playwright

This directory contains end-to-end tests for the market application using Playwright.

## Prerequisites

- [nak](https://github.com/fiatjaf/nak) installed for running the test relay
- Node.js and bun installed
- Playwright browsers installed (automatically done during setup)

## Setup

The e2e tests are automatically configured to:

1. Start a local Nostr relay using `nak serve` on port 10547
2. Start the application in test mode on port 3000
3. Generate test keys automatically
4. Run tests against the fresh environment

## Running Tests

### Quick Start (Recommended)

1. **Start test environment:**

   ```bash
   ./scripts/start-test-env.sh
   ```

2. **In another terminal, run tests with visible browser:**
   ```bash
   bun run test:e2e:manual
   ```

### All Available Commands

#### With Manual Environment Control

```bash
# Start test environment first
./scripts/start-test-env.sh

# Then run tests (in another terminal)
bun run test:e2e:manual              # Headed mode with visible browser
bun run test:e2e:manual:debug        # Debug mode (step-by-step)
```

#### With Automatic Environment Setup

```bash
bun run test:e2e                     # Headless mode (CI/automated testing)
bun run test:e2e:headed              # Headed mode (visible browser)
bun run test:e2e:ui                  # Interactive UI mode
bun run test:e2e:debug               # Debug mode (step through tests)
```

## Test Structure

### Files

- `setup.spec.ts` - Tests the initial app setup flow
- `navigation.spec.ts` - Tests basic navigation after setup
- `utils/test-utils.ts` - Utility functions for tests
- `fixtures/test-env.ts` - Test environment configuration
- `global-setup.ts` - Global setup before all tests
- `global-teardown.ts` - Global cleanup after all tests

### Test Flow

1. **Global Setup**: Generate test keys and environment
2. **Setup Tests**: Test initial app setup and configuration
3. **Navigation Tests**: Test basic app navigation
4. **Feature Tests**: Test specific app features (add more as needed)
5. **Global Teardown**: Cleanup test environment

## Configuration

The Playwright configuration is in `playwright.config.ts` at the project root. Key settings:

- **Base URL**: `http://localhost:3000`
- **Test Directory**: `./e2e`
- **Browsers**: Chromium, Firefox, WebKit, Mobile browsers
- **Parallel**: Disabled for reliable relay state
- **Timeout**: 30 seconds per test
- **Retries**: 2 on CI, 0 locally

## Environment Variables

The tests use these environment variables:

- `NODE_ENV=test` - Set automatically
- `APP_RELAY_URL=ws://localhost:10547` - Test relay URL
- `TEST_APP_PRIVATE_KEY` - Generated automatically if not provided
- `PORT=3000` - App port for testing

## Adding New Tests

1. Create test files in the `e2e/` directory with `.spec.ts` extension
2. Use utilities from `utils/test-utils.ts` for common operations
3. Follow the existing patterns for test structure
4. Add page object models in `e2e/pages/` for complex page interactions

## Debugging Tests

- Use `--debug` flag to step through tests
- Use `--headed` flag to see browser interactions
- Screenshots and videos are captured on failure
- Check `playwright-report/` for detailed test reports

## CI/CD Integration

The tests are configured to work in CI environments:

- Automatically install required dependencies
- Run in headless mode
- Generate HTML reports
- Capture artifacts on failure

## ✅ Current Test Coverage

The test suite runs sequentially and covers:

### 1. Setup Flow (`setup.spec.ts`)

- ✅ Initial setup form submission and validation
- ✅ App configuration persistence
- ✅ Redirect behavior after setup completion
- ✅ Navigation after successful setup

### 2. Navigation (`navigation.spec.ts`)

- ✅ Products page navigation
- ✅ Posts page navigation
- ✅ Community page navigation
- ✅ Dashboard navigation
- ✅ Basic error detection

### 3. User Profile Flow (`user-profile.spec.ts`)

- ✅ Private key generation and login
- ✅ Password encryption and storage
- ✅ Profile form completion and submission
- ✅ Profile data persistence verification
- ✅ Relay event monitoring and verification
- ✅ Authentication state management

### Infrastructure (`test-setup.spec.ts`)

- ✅ Relay connectivity
- ✅ App server health
- ✅ Environment variable validation

### Debug Tools (`debug-setup.spec.ts`)

- ✅ Step-by-step setup analysis
- ✅ Config endpoint validation
- ✅ State persistence testing

**Total: 13+ passing tests** 🎉

All tests run in sequence to ensure proper state flow from app setup → navigation → user authentication → profile management.
