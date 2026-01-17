---
name: domain-driven-design
description: This skill should be used when designing software architecture, modeling domains, reviewing code for DDD compliance, identifying bounded contexts, designing aggregates, or discussing strategic and tactical DDD patterns. Provides comprehensive Domain-Driven Design principles, axioms, heuristics, and anti-patterns for building maintainable, domain-centric software systems.
---

# Domain-Driven Design

## Overview

Domain-Driven Design (DDD) is an approach to software development that centers the design on the core business domain. This skill provides principles, patterns, and heuristics for both strategic design (system boundaries and relationships) and tactical design (code-level patterns).

## When to Apply This Skill

- Designing new systems or features with complex business logic
- Identifying and defining bounded contexts
- Modeling aggregates, entities, and value objects
- Reviewing code for DDD pattern compliance
- Decomposing monoliths into services
- Establishing ubiquitous language with domain experts

## Core Axioms

### Axiom 1: The Domain is Supreme

Software exists to solve domain problems. Technical decisions serve the domain, not vice versa. When technical elegance conflicts with domain clarity, domain clarity wins.

### Axiom 2: Language Creates Reality

The ubiquitous language shapes how teams think about the domain. Ambiguous language creates ambiguous software. Invest heavily in precise terminology.

### Axiom 3: Boundaries Enable Autonomy

Explicit boundaries (bounded contexts) allow teams to evolve independently. The cost of integration is worth the benefit of isolation.

### Axiom 4: Models are Imperfect Approximations

No model captures all domain complexity. Accept that models simplify reality. Refine models continuously as understanding deepens.

## Strategic Design Quick Reference

| Pattern                 | Purpose                            | Key Heuristic                                             |
| ----------------------- | ---------------------------------- | --------------------------------------------------------- |
| **Bounded Context**     | Define linguistic/model boundaries | One team, one language, one model                         |
| **Context Map**         | Document context relationships     | Make implicit integrations explicit                       |
| **Subdomain**           | Classify domain areas by value     | Core (invest), Supporting (adequate), Generic (outsource) |
| **Ubiquitous Language** | Shared vocabulary                  | If experts don't use the term, neither should code        |

For detailed strategic patterns, consult `references/strategic-patterns.md`.

## Tactical Design Quick Reference

| Pattern            | Purpose                  | Key Heuristic                                                      |
| ------------------ | ------------------------ | ------------------------------------------------------------------ |
| **Entity**         | Identity-tracked object  | "Same identity = same thing" regardless of attributes              |
| **Value Object**   | Immutable, identity-less | Equality by value, always immutable, self-validating               |
| **Aggregate**      | Consistency boundary     | Small aggregates, reference by ID, one transaction = one aggregate |
| **Domain Event**   | Record state changes     | Past tense naming, immutable, contains all relevant data           |
| **Repository**     | Collection abstraction   | One per aggregate root, domain-focused interface                   |
| **Domain Service** | Stateless operations     | When logic doesn't belong to any single entity                     |
| **Factory**        | Complex object creation  | When construction logic is complex or variable                     |

For detailed tactical patterns, consult `references/tactical-patterns.md`.

## Essential Heuristics

### Aggregate Design Heuristics

1. **Protect business invariants inside aggregate boundaries** - If two pieces of data must be consistent, they belong in the same aggregate
2. **Design small aggregates** - Large aggregates cause concurrency issues and slow performance
3. **Reference other aggregates by identity only** - Never hold direct object references across aggregate boundaries
4. **Update one aggregate per transaction** - Eventual consistency across aggregates using domain events
5. **Aggregate roots are the only entry point** - External code never reaches inside to manipulate child entities

### Bounded Context Heuristics

1. **Linguistic boundaries** - When the same word means different things, you have different contexts
2. **Team boundaries** - One context per team enables autonomy
3. **Process boundaries** - Different business processes often indicate different contexts
4. **Data ownership** - Each context owns its data; no shared databases

### Modeling Heuristics

1. **Nouns → Entities or Value Objects** - Things with identity become entities; descriptive things become value objects
2. **Verbs → Domain Services or Methods** - Actions become methods on entities or stateless services
3. **Business rules → Invariants** - Rules the domain must always satisfy become aggregate invariants
4. **Events in domain expert language → Domain Events** - "When X happens" becomes a domain event

## Decision Guides

### Entity vs Value Object

```
Does this thing have a lifecycle and identity that matters?
├─ YES → Is identity based on an ID (not attributes)?
│        ├─ YES → Entity
│        └─ NO  → Reconsider; might be Value Object with natural key
└─ NO  → Value Object
```

### Where Does This Logic Belong?

```
Is this logic stateless?
├─ NO  → Does it belong to a single aggregate?
│        ├─ YES → Method on the aggregate/entity
│        └─ NO  → Reconsider aggregate boundaries
└─ YES → Does it coordinate multiple aggregates?
         ├─ YES → Application Service
         └─ NO  → Does it represent a domain concept?
                  ├─ YES → Domain Service
                  └─ NO  → Infrastructure Service
```

### Should This Be a Separate Bounded Context?

```
Do different stakeholders use different language for this?
├─ YES → Separate bounded context
└─ NO  → Does a different team own this?
         ├─ YES → Separate bounded context
         └─ NO  → Would a separate model reduce complexity?
                  ├─ YES → Consider separation (but weigh integration cost)
                  └─ NO  → Keep in current context
```

## Anti-Patterns Overview

| Anti-Pattern               | Description                          | Fix                                           |
| -------------------------- | ------------------------------------ | --------------------------------------------- |
| **Anemic Domain Model**    | Entities with only getters/setters   | Move behavior into domain objects             |
| **Big Ball of Mud**        | No clear boundaries                  | Identify bounded contexts                     |
| **Smart UI**               | Business logic in presentation layer | Extract domain layer                          |
| **Database-Driven Design** | Model follows database schema        | Model follows domain, map to database         |
| **Leaky Abstractions**     | Infrastructure concerns in domain    | Dependency inversion, ports and adapters      |
| **God Aggregate**          | One aggregate does everything        | Split by invariant boundaries                 |
| **Premature Abstraction**  | Abstracting before understanding     | Concrete first, abstract when patterns emerge |

For detailed anti-patterns and remediation, consult `references/anti-patterns.md`.

## Implementation Checklist

When implementing DDD in a codebase:

- [ ] Ubiquitous language documented and used consistently in code
- [ ] Bounded contexts identified with clear boundaries
- [ ] Context map documenting integration patterns
- [ ] Aggregates designed small with clear invariants
- [ ] Entities have behavior, not just data
- [ ] Value objects are immutable and self-validating
- [ ] Domain events capture important state changes
- [ ] Repositories abstract persistence for aggregate roots
- [ ] No business logic in application services (orchestration only)
- [ ] No infrastructure concerns in domain layer

## Resources

### references/

- `strategic-patterns.md` - Detailed strategic DDD patterns including bounded contexts, context maps, subdomain classification, and ubiquitous language
- `tactical-patterns.md` - Detailed tactical DDD patterns including entities, value objects, aggregates, domain events, repositories, and services
- `anti-patterns.md` - Common DDD anti-patterns, how to identify them, and remediation strategies

To search references for specific topics:

- Bounded contexts: `grep -i "bounded context" references/`
- Aggregate design: `grep -i "aggregate" references/`
- Value objects: `grep -i "value object" references/`
