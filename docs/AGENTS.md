# docs/ Directory Design Decisions Overview

## Documentation Architecture

### Core Documentation Types
1. **Architectural Decision Records (ADRs)** - Formal decision documentation in `docs/adr/`
2. **Maintainer Guides** - Security and operations guidance in `docs/maintainer/`
3. **LLM/Codex Guides** - AI assistant documentation in `docs/llm/`
4. **Security Documentation** - Threat models and security guidance in `docs/security/`
5. **Technical Specifications** - Protocol and workflow documentation throughout the directory
6. **Handover Documentation** - Project transition materials in `docs/handover/`

### Documentation Strategy
1. **Layered Approach** - Root documentation provides overview, subdirectories provide detail
2. **Maintainer-Focused** - Emphasis on security, operations, and architectural guidance
3. **Protocol-Centric** - Strong focus on Nostr protocol implementation details
4. **Decision-Driven** - ADRs anchor technical decisions and changes

## Current Documentation Structure

### ADR System
1. **Formal Decision Process** - Structured ADR format for major architectural decisions
2. **Workflow Boundaries** - Example ADR for add product workflow stabilization
3. **Decision Tracking** - Status tracking (Proposed, Accepted, etc.)

### Technical Specifications
1. **Lightning Payment Flow** - Detailed payment processing documentation
2. **Zap Purchase Manager** - NIP-57 zap receipt handling
3. **Vanity URLs** - Custom URL handling and NIP-05 integration
4. **ContextVM Workflow** - Backend service integration documentation
5. **Relay Configuration** - Nostr relay setup and management

### Security Documentation
1. **Security Operations Brief** - Maintainer security guidance
2. **Threat Model** - Security risk analysis and mitigation
3. **Terms and Conditions** - Legal documentation

### AI/LLM Integration
1. **Launch Pad** - AI assistant usage guidance
2. **Command Safety** - Safe command execution for AI assistants
3. **Agent Rules** - AI agent operational constraints

## Known Design Inconsistencies with Parent AGENTS.md

These are acknowledged inconsistencies with the parent directory AGENTS.md design:

1. **Architecture Boundary Violations (#7)**: Documentation discusses ContextVM integration and cross-project imports, acknowledging the architectural boundary violations in the codebase rather than enforcing proper separation.

2. **Security Documentation Gaps**: While security documentation exists, it doesn't adequately address the specific security violations identified in the parent AGENTS.md (private keys in localStorage, credential management issues, etc.).

## Contradictory Design Decisions

1. **Documentation Organization**:
   - ADRs in dedicated directory
   - Technical specs mixed throughout
   - Security docs in separate subdirectory
   - BUT no clear overall documentation hierarchy

2. **Documentation Audience**:
   - Maintainer-focused security docs
   - Developer-focused technical specs
   - User-focused terms and conditions
   - BUT inconsistent targeting and scope

3. **Documentation Format**:
   - Formal ADR structure
   - Ad-hoc technical documentation
   - Mixed markdown styles and conventions
   - BUT no standardized template enforcement

4. **Documentation Completeness**:
   - Detailed security auditing guidance
   - Sparse user documentation
   - Incomplete API documentation
   - BUT critical system documentation exists

## Code Reuse Opportunities

1. **Template Standardization** - Create standardized templates for different documentation types:
   - ADR templates
   - Technical specification templates
   - Security documentation templates
   - User guide templates

2. **Cross-Reference System** - Standardize linking between documentation:
   - Security implications in technical specs
   - Implementation details in ADRs
   - Protocol references in security docs

3. **Automated Documentation** - Extract documentation from code:
   - API documentation from TypeScript types
   - Component documentation from source code
   - Configuration documentation from env files

4. **Documentation Generation** - Automate documentation creation:
   - CHANGELOG generation from commit history
   - Architecture diagrams from code structure
   - Test coverage reporting

## Test Coverage Gaps

1. **Documentation Validation**:
   - No automated checking of documentation accuracy
   - No link validation or dead link detection
   - No consistency checking between related documents

2. **Example Code Testing**:
   - Documentation examples may not be tested
   - Code snippets may become outdated
   - No verification of example correctness

3. **Protocol Documentation**:
   - No automated validation of protocol specs
   - No conformance testing against documentation
   - No versioning of protocol documentation

## Security Documentation Gaps

1. **User-Facing Security**:
   - Limited user security guidance
   - No threat modeling for end users
   - No security best practices for users

2. **Developer Security**:
   - Some security guidance exists
   - BUT incomplete secure coding guidelines
   - No security review checklist

3. **Operational Security**:
   - Detailed maintainer guidance
   - BUT limited operational security documentation
   - No incident response documentation

## AI/LLM Documentation Issues

1. **Agent Constraints**:
   - Detailed AI operations brief
   - BUT potentially limiting for AI assistance
   - No clear balance between security and usability

2. **Automation Opportunities**:
   - Recognized AI opportunities
   - BUT limited implementation
   - No automated documentation generation

3. **Workflow Integration**:
   - LLM workflow policy defined
   - BUT integration with development workflow unclear
   - No automated AI-assisted documentation updates

## Documentation Maintenance Issues

1. **Version Control**:
   - Documentation tracked in git
   - BUT no versioning strategy
   - No documentation release process

2. **Review Process**:
   - Some documentation reviewed
   - BUT no formal review process
   - No documentation quality metrics

3. **Accessibility**:
   - Markdown-based documentation
   - BUT no structured navigation
   - No search functionality

## Protocol Documentation Strengths

1. **Nostr Protocol Focus**:
   - Detailed NIP documentation
   - Protocol implementation guidance
   - Security considerations for Nostr

2. **Payment System Documentation**:
   - Lightning integration details
   - Zap purchase flow documentation
   - Wallet connection specifications

3. **Decentralized Architecture**:
   - Relay configuration guidance
   - Event handling documentation
   - Decentralized state management