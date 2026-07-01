# e2e/ Directory Design Decisions Overview

## Governance

- **Class:** bot-reviewed-human-approve
- **Sensitive Surface:** Test infrastructure; global-setup.ts and seed-relay.ts touch relay state and auth flow

## End-to-End Testing Architecture

### Core Purpose

1. **Full Application Testing** - Test the entire application stack from UI to Nostr relay
2. **User Journey Validation** - Verify complete user workflows and experiences
3. **Integration Testing** - Test interactions between all system components
4. **Regression Prevention** - Catch breaking changes before deployment

### Technology Stack

1. **Playwright** - Cross-browser testing framework for web applications
2. **TypeScript** - Strongly typed testing with modern JavaScript features
3. **Nostr Tools** - Direct Nostr protocol interaction for relay monitoring
4. **Bun Runtime** - Execution environment for test scripts and utilities
5. **nak** - Local Nostr relay for test environment isolation

### Testing Architecture Layers

1. **Infrastructure Layer** - Local relay and application server management
2. **Data Layer** - Scenario-based test data seeding
3. **Auth Layer** - Authentication fixture injection and management
4. **Locator Strategy** - User-perception based element selection
5. **Waiting Strategy** - Auto-waiting and web-first assertions
6. **Relay Monitoring** - WebSocket traffic capture and validation

## Design Patterns

### Scenario-Based Testing

1. **Cumulative Scenarios** - Build test data in layers (none → base → merchant → marketplace)
2. **Idempotent Seeding** - Safe to run multiple times without duplication
3. **Per-Worker Caching** - Efficient test execution with shared data setup
4. **Nostr Tools Integration** - Direct relay communication avoiding NDK lifecycle issues

### Authentication Mocking

1. **window.nostr Mock** - Browser-side NIP-07 implementation injection
2. **Node.js Signing Bridge** - Exposed functions for event signing in Node.js
3. **T&C Pre-Acceptance** - Automatic terms and conditions acceptance
4. **Multi-Auth Method Support** - Extension, private key, NIP-46 mocking

### Locator Strategy

1. **Role-Based Selection** - Prioritize semantic HTML roles and labels
2. **Content-Based Matching** - Text content and visible elements first
3. **Data Test ID Fallback** - Last resort for complex dynamic elements
4. **Accessible UI Requirement** - Tests drive accessibility improvements

### Relay Monitoring

1. **WebSocket Frame Capture** - Raw WebSocket traffic interception
2. **Event Parsing and Storage** - Typed Nostr event handling
3. **Generic Waiting Support** - waitForEvent with filtering capabilities
4. **Direction Awareness** - Sent vs received event differentiation

## Known Design Inconsistencies with Parent AGENTS.md

These are acknowledged inconsistencies with the parent directory AGENTS.md design:

1. **Security Issues (#9)**: Test credential management uses fixed test private keys stored directly in source code (`src/lib/fixtures.ts`), violating the parent requirement that secrets must be passed via vault or environment variables and never committed in files.

2. **Architecture Boundary Violations (#7)**: Test infrastructure directly imports and uses `nostr-tools/Relay` to connect to relays, bypassing the NDK abstraction layer required by the parent AGENTS.md design.

## Contradictory Design Decisions

1. **Infrastructure Management**:
   - Tests manage local infrastructure (nak relay, dev server)
   - BUT infrastructure startup order is critical and complex
   - No containerization or infrastructure as code for consistency

2. **Data Seeding**:
   - Scenario-based seeding for efficient test execution
   - BUT no cleanup or isolation between test runs
   - Risk of state leakage in long-running test sessions

3. **Authentication Mocking**:
   - Comprehensive auth mocking for all authentication methods
   - BUT complex setup requiring multiple exposed functions and init scripts
   - No standardized auth testing patterns across applications

4. **Locator Strategy**:
   - User-perception based locators preferred
   - BUT fallback to data-testid for complex components
   - Inconsistent application of accessibility best practices

## Code Reuse Opportunities

1. **Common Testing Utilities**:
   - Authentication fixture creation patterns
   - Relay monitoring and event parsing utilities
   - Common locator and assertion patterns
   - Scenario seeding utilities

2. **Mock Implementations**:
   - NIP-46 remote signer mock for QR code and bunker flows
   - Lightning payment mock with zap receipt simulation
   - Relay query utilities for direct event access
   - WebLN browser mock for payment simulation

3. **Infrastructure Management**:
   - Playwright configuration patterns
   - Local relay and server management utilities
   - Global setup and teardown patterns
   - Test environment configuration management

4. **Test Data Generation**:
   - Scenario definition and seeding patterns
   - Test user and profile generation
   - Product and collection seeding utilities
   - Order and payment flow simulation

## Test Coverage Gaps

1. **Feature Testing**:
   - Auth flows well tested
   - BUT many other features lack comprehensive test coverage
   - No testing of edge cases and error conditions
   - Limited negative testing scenarios

2. **Cross-Browser Testing**:
   - Currently Chromium-only testing
   - No Firefox or Safari test coverage
   - No mobile browser testing
   - No cross-platform compatibility testing

3. **Performance Testing**:
   - No load testing integration
   - No performance regression testing
   - No resource usage monitoring
   - No stress testing scenarios

4. **Security Testing**:
   - No automated security scanning
   - No input validation testing
   - No authentication bypass testing
   - No privilege escalation testing

## Security Issues

1. **Test Credential Management**:
   - Fixed test private keys in source code
   - No secure credential rotation
   - No encryption of test credentials
   - Risk of credential leakage

2. **Network Security**:
   - Local relay testing only
   - No testing of network security scenarios
   - No certificate validation testing
   - No encryption in transit validation

3. **Data Generation**:
   - Test data may contain realistic PII
   - No data sanitization for sharing
   - No encryption of sensitive test data
   - No data retention policies

## Performance Considerations

1. **Test Execution Speed**:
   - Sequential test execution by default
   - No parallel test execution optimization
   - Scenario seeding overhead for each worker
   - No test caching or smart execution

2. **Memory Usage**:
   - Multiple browser contexts per test
   - No memory usage monitoring
   - No garbage collection optimization
   - No resource cleanup between tests

3. **Network Efficiency**:
   - Individual relay connections per test
   - No connection pooling or reuse
   - No network mocking for external services
   - No bandwidth or latency simulation

## Deployment and Operations

1. **Test Environment Management**:
   - Local infrastructure management
   - No cloud-based test environments
   - No environment provisioning automation
   - No test environment versioning

2. **Execution Management**:
   - Manual test execution primarily
   - No scheduled or automated testing
   - No test result aggregation
   - No test failure notification systems

3. **Configuration Management**:
   - Environment variable based configuration
   - No configuration file management
   - No dynamic configuration updates
   - No environment-specific configurations

4. **Monitoring and Reporting**:
   - Basic console and HTML reporting
   - No structured test result storage
   - No test result trend analysis
   - No integration with project management tools

## Maintenance Issues

1. **Test Dependencies**:
   - Hardcoded paths and selectors
   - No dependency version management
   - No automated dependency updates
   - No test dependency isolation

2. **Documentation**:
   - Comprehensive architecture documentation
   - BUT limited inline documentation
   - No API documentation for test utilities
   - No test case documentation

3. **Code Quality**:
   - No linting or formatting standards
   - No code review requirements for tests
   - No automated code quality checks
   - No test code complexity monitoring

4. **Version Control**:
   - Tests tracked in git
   - No versioning strategy for tests
   - No changelog for test changes
   - No test migration management

## Test Organization Issues

1. **Test Structure**:
   - Feature-based organization
   - BUT inconsistent test file structure
   - No standardized test naming conventions
   - No test case prioritization

2. **Test Data Management**:
   - Scenario-based data seeding
   - BUT no data cleanup strategies
   - No test data versioning
   - No data consistency validation

3. **Test Configuration**:
   - Centralized configuration management
   - BUT no environment-specific configurations
   - No configuration validation
   - No dynamic configuration updates

4. **Test Execution Environment**:
   - Local execution focused
   - No CI/CD integration patterns
   - No containerization for consistency
   - No cross-platform execution support
