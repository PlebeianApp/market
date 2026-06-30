# TypeScript Claude Skill

Comprehensive TypeScript skill for type-safe development with modern JavaScript/TypeScript applications.

## Overview

This skill provides in-depth knowledge about TypeScript's type system, patterns, best practices, and integration with popular frameworks like React. It covers everything from basic types to advanced type manipulation techniques.

## Files

### Core Documentation

- **SKILL.md** - Main skill file with workflows and when to use this skill
- **quick-reference.md** - Quick lookup guide for common TypeScript syntax and patterns

### Reference Materials

- **references/type-system.md** - Comprehensive guide to TypeScript's type system
- **references/utility-types.md** - Complete reference for built-in and custom utility types
- **references/common-patterns.md** - Real-world TypeScript patterns and idioms

### Examples

- **examples/type-system-basics.ts** - Fundamental TypeScript concepts
- **examples/advanced-types.ts** - Generics, conditional types, mapped types
- **examples/react-patterns.ts** - Type-safe React components and hooks
- **examples/README.md** - Guide to using the examples

## Usage

### When to Use This Skill

Reference this skill when:

- Writing or refactoring TypeScript code
- Designing type-safe APIs and interfaces
- Working with advanced type system features
- Configuring TypeScript projects
- Troubleshooting type errors
- Implementing type-safe patterns with libraries
- Converting JavaScript to TypeScript

### Quick Start

For quick lookups, start with `quick-reference.md` which provides concise syntax and patterns.

For learning or deep dives:

1. **Fundamentals**: Start with `references/type-system.md`
2. **Utilities**: Learn about transformations in `references/utility-types.md`
3. **Patterns**: Study real-world patterns in `references/common-patterns.md`
4. **Practice**: Explore code examples in `examples/`

## Key Topics Covered

### Type System

- Primitive types and special types
- Object types (interfaces, type aliases)
- Union and intersection types
- Literal types and template literal types
- Type inference and narrowing
- Generic types with constraints
- Conditional types and mapped types
- Recursive types

### Advanced Features

- Type guards and type predicates
- Assertion functions
- Branded types for nominal typing
- Key remapping and filtering
- Distributive conditional types
- Type-level programming

### Utility Types

- Built-in utilities (Partial, Pick, Omit, etc.)
- Custom utility type patterns
- Deep transformations
- Type composition

### React Integration

- Component props typing
- Generic components
- Hooks with TypeScript
- Context with type safety
- Event handlers
- Ref typing

### Best Practices

- Type safety patterns
- Error handling
- Code organization
- Integration with Zod for runtime validation
- Named return variables (Go-style)
- Discriminated unions for state management

## Integration with Project Stack

This skill is designed to work seamlessly with:

- **React 19**: Type-safe component development
- **TanStack Ecosystem**: Typed queries, routing, forms, and stores
- **Zod**: Runtime validation with type inference
- **Radix UI**: Component prop typing
- **Tailwind CSS**: Type-safe className composition

## Examples

All examples are self-contained and demonstrate practical patterns:

- Based on real-world usage
- Follow project best practices
- Include comprehensive comments
- Can be run with `ts-node`
- Ready to adapt to your needs

## Configuration

The skill includes guidance on TypeScript configuration with recommended settings for:

- Strict type checking
- Module resolution
- JSX support
- Path aliases
- Declaration files

## Contributing

When adding new patterns or examples:

1. Follow existing file structure
2. Include comprehensive comments
3. Demonstrate real-world usage
4. Add to appropriate reference file
5. Update this README if needed

## Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [Type Challenges](https://github.com/type-challenges/type-challenges)
- [TSConfig Reference](https://www.typescriptlang.org/tsconfig)
