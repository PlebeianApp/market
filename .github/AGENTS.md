# .github Directory Design Decisions Overview

## Governance

- **Class:** human-only
- **Sensitive Surface:** CI/CD supply chain; SSH deploy secrets (#996 H5: unpinned bun, H7: password SSH); workflows control production deployment

## CI/CD Pipeline Architecture

### Core Workflow Structure

1. **Unit and Integration Tests** (`ci-unit.yml`) - Automated testing on PRs and pushes
2. **End-to-End Tests** (`e2e.yml`) - Browser-based testing with Playwright
3. **Code Formatting** (`prettier.yml`) - Automated code style checking
4. **Staging Deployment** (`deploy.yml`) - Automated deployment after E2E success
5. **Production Deployment** (`release.yml`) - Manual production releases
6. **Specialized Deployments** (`deploy-auctionsdev.yml`, `deploy-relay.yml`) - Specific environment deployments

### Testing Strategy

1. **Unit Tests** - Run with `bun run test:unit` command
2. **Integration Tests** - Run with local relay and currency server
3. **End-to-End Tests** - Playwright tests in browser environment
4. **Code Quality** - Prettier formatting checks

### Deployment Strategy

1. **Staging Deployment** - Automatic after successful E2E tests on master
2. **Production Deployment** - Manual approval required
3. **Specialized Environments** - Separate workflows for specific components

## GitHub Actions Implementation

### Test Workflows

1. **Ubuntu Latest Runner** - All tests run on Ubuntu environment
2. **Bun Setup** - Uses oven-sh/setup-bun action
3. **Go Setup** - For local relay (nak) in integration tests
4. **Dependency Management** - Frozen lockfile installation

### Deployment Workflows

1. **Build Phase** - Artifact creation with compiled assets
2. **Deploy Phase** - SSH-based deployment to remote servers
3. **Environment Management** - PM2 process management
4. **Rollback Capability** - Automatic rollback on deployment failure

## Known Design Inconsistencies with Parent AGENTS.md

These are acknowledged inconsistencies with the parent directory AGENTS.md design:

1. **Security Issues (#9)**: GitHub Actions workflows store secrets in GitHub Actions secrets rather than using proper vault solutions, and environment files may contain unencrypted sensitive data, violating the parent requirement for secure credential management.

2. **Test Coverage Gaps**: Workflows lack performance testing, security scanning, and accessibility testing as required by comprehensive testing standards.

3. **Infrastructure as Code Limitations**: No proper infrastructure as code implementation, relying on manual SSH deployment rather than declarative infrastructure management.

## Contradictory Design Decisions

1. **Multiple Deployment Targets**:
   - General staging deployment (`deploy.yml`)
   - Specialized auction development deployment (`deploy-auctionsdev.yml`)
   - Relay deployment (`deploy-relay.yml`)
   - BUT inconsistent configuration management across these targets

2. **Environment Variable Management**:
   - Secrets stored in GitHub Actions
   - Environment files generated during deployment
   - BUT no centralized configuration management

3. **Testing Coverage**:
   - Unit, integration, and E2E tests exist
   - BUT no performance testing, security scanning, or accessibility testing

4. **Deployment Strategy**:
   - Blue-green deployment pattern attempted
   - BUT rollback logic is complex and error-prone
   - No canary deployment or feature flag support

## Code Reuse Opportunities

1. **Workflow Templates** - Common steps could be extracted as reusable actions:
   - Bun setup and dependency installation
   - Test execution patterns
   - Environment preparation

2. **Deployment Scripts** - Common deployment logic could be unified:
   - SSH connection handling
   - File transfer operations
   - Service management commands

3. **Environment Configuration** - Standardize environment file generation:
   - Common variables across environments
   - Secret management patterns
   - Configuration validation

4. **Health Checks** - Standardize application health verification:
   - Common endpoints to check
   - Retry logic and timeout handling
   - Alerting on failure conditions

## Test Coverage Gaps

1. **Workflow Testing**:
   - No tests for GitHub Actions workflows themselves
   - No validation of workflow logic changes
   - No simulation of failure scenarios

2. **Deployment Testing**:
   - No automated testing of deployment scripts
   - No validation of configuration files
   - No rollback scenario testing

3. **Security Testing**:
   - No automated security scanning in CI
   - No dependency vulnerability checking
   - No secret scanning in workflows

4. **Performance Testing**:
   - No load testing as part of CI
   - No performance regression testing
   - No resource usage monitoring

## Security Considerations

1. **Secrets Management**:
   - GitHub Actions secrets for deployment
   - Environment-specific configuration
   - BUT no encryption at rest for sensitive data

2. **Access Control**:
   - Environment protection rules
   - Manual approval for production
   - BUT no granular permission controls

3. **Infrastructure Security**:
   - SSH-based deployment
   - PM2 process management
   - BUT no infrastructure as code

## Infrastructure as Code Opportunities

1. **Server Configuration** - Standardize server setup:
   - Caddy web server configuration
   - PM2 process management
   - Log rotation and monitoring

2. **Environment Provisioning** - Automate environment creation:
   - Staging environment setup
   - Specialized service deployment
   - Resource allocation and scaling

3. **Monitoring and Alerting** - Standardize observability:
   - Health check implementations
   - Log aggregation and analysis
   - Performance metric collection

## Deployment Reliability Issues

1. **Complex Rollback Logic** - Error-prone manual rollback implementation
2. **Manual Health Checks** - Basic curl-based health verification only
3. **Limited Artifact Management** - Simple artifact retention policy
4. **No Blue-Green Validation** - No pre-deployment validation of new versions
