# Strategic DDD Patterns

Strategic DDD patterns address the large-scale structure of a system: how to divide it into bounded contexts, how those contexts relate, and how to prioritize investment across subdomains.

## Bounded Context

### Definition

A Bounded Context is an explicit boundary within which a domain model exists. Inside the boundary, all terms have specific, unambiguous meanings. The same term may mean different things in different bounded contexts.

### Why It Matters

- **Linguistic clarity** - "Customer" in Sales means something different than "Customer" in Shipping
- **Model isolation** - Changes to one model don't cascade across the system
- **Team autonomy** - Teams can work independently within their context
- **Focused complexity** - Each context solves one set of problems well

### Identification Heuristics

1. **Language divergence** - When stakeholders use the same word differently, there's a context boundary
2. **Department boundaries** - Organizational structure often mirrors domain structure
3. **Process boundaries** - End-to-end business processes often define context edges
4. **Data ownership** - Who is the authoritative source for this data?
5. **Change frequency** - Parts that change together should stay together

### Example: E-Commerce Platform

| Context         | "Order" means...                 | "Product" means...                                    |
| --------------- | -------------------------------- | ----------------------------------------------------- |
| **Catalog**     | N/A                              | Displayable item with description, images, categories |
| **Inventory**   | N/A                              | Stock keeping unit with quantity and location         |
| **Sales**       | Shopping cart ready for checkout | Line item with price                                  |
| **Fulfillment** | Shipment to be picked and packed | Physical item to ship                                 |
| **Billing**     | Invoice to collect payment       | Taxable good                                          |

### Implementation Patterns

#### Separate Deployables

Each bounded context as its own service/application.

```
catalog-service/
├── src/domain/Product.ts
└── src/infrastructure/CatalogRepository.ts

sales-service/
├── src/domain/Product.ts    # Different model!
└── src/domain/Order.ts
```

#### Module Boundaries

Bounded contexts as modules within a monolith.

```
src/
├── catalog/
│   └── domain/Product.ts
├── sales/
│   └── domain/Product.ts    # Different model!
└── shared/
    └── kernel/Money.ts      # Shared kernel
```

## Context Map

### Definition

A Context Map is a visual and documented representation of how bounded contexts relate to each other. It makes integration patterns explicit.

### Integration Patterns

#### Partnership

Two contexts develop together with mutual dependencies. Changes are coordinated.

```
┌─────────────┐     Partnership     ┌─────────────┐
│   Catalog   │◄──────────────────►│  Inventory  │
└─────────────┘                     └─────────────┘
```

**Use when**: Two teams must succeed or fail together.

#### Shared Kernel

A small, shared model that multiple contexts depend on. Changes require agreement from all consumers.

```
┌─────────────┐                    ┌─────────────┐
│    Sales    │                    │   Billing   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       └─────────►  Money  ◄──────────────┘
                   (shared kernel)
```

**Use when**: Core concepts genuinely need the same model.
**Danger**: Creates coupling. Keep shared kernels minimal.

#### Customer-Supplier

Upstream context (supplier) provides data/services; downstream context (customer) consumes. Supplier considers customer needs.

```
┌─────────────┐                    ┌─────────────┐
│   Catalog   │───── supplies ────►│    Sales    │
│  (upstream) │                    │ (downstream)│
└─────────────┘                    └─────────────┘
```

**Use when**: One context clearly serves another, and the supplier is responsive.

#### Conformist

Downstream adopts upstream's model without negotiation. Upstream doesn't accommodate downstream needs.

```
┌─────────────┐                    ┌─────────────┐
│ External    │───── dictates ────►│  Our App    │
│    API      │                    │ (conformist)│
└─────────────┘                    └─────────────┘
```

**Use when**: Upstream won't change (third-party API), and their model is acceptable.

#### Anti-Corruption Layer (ACL)

Translation layer that protects a context from external models. Transforms data at the boundary.

```
┌─────────────┐        ┌───────┐        ┌─────────────┐
│   Legacy    │───────►│  ACL  │───────►│  New System │
│   System    │        └───────┘        └─────────────┘
```

**Use when**: Upstream model would pollute downstream; translation is worth the cost.

```typescript
// Anti-Corruption Layer example
class LegacyOrderAdapter {
	constructor(private legacyApi: LegacyOrderApi) {}

	translateOrder(legacyOrder: LegacyOrder): Order {
		return new Order({
			id: OrderId.from(legacyOrder.order_num),
			customer: this.translateCustomer(legacyOrder.cust_data),
			items: legacyOrder.line_items.map(this.translateLineItem),
			// Transform legacy status codes to domain concepts
			status: this.mapStatus(legacyOrder.stat_cd),
		})
	}

	private mapStatus(legacyCode: string): OrderStatus {
		const mapping: Record<string, OrderStatus> = {
			OP: OrderStatus.Open,
			SH: OrderStatus.Shipped,
			CL: OrderStatus.Closed,
		}
		return mapping[legacyCode] ?? OrderStatus.Unknown
	}
}
```

#### Open Host Service

A context provides a well-defined protocol/API for others to consume.

```
                    ┌─────────────┐
        ┌──────────►│   Reports   │
        │           └─────────────┘
┌───────┴───────┐   ┌─────────────┐
│ Catalog API   │──►│   Search    │
│ (open host)   │   └─────────────┘
└───────┬───────┘   ┌─────────────┐
        └──────────►│   Partner   │
                    └─────────────┘
```

**Use when**: Multiple downstream contexts need access; worth investing in a stable API.

#### Published Language

A shared language format (schema) for communication between contexts. Often combined with Open Host Service.

Examples: JSON schemas, Protocol Buffers, GraphQL schemas, industry standards (HL7 for healthcare).

#### Separate Ways

Contexts have no integration. Each solves its needs independently.

**Use when**: Integration cost exceeds benefit; duplication is acceptable.

### Context Map Notation

```
┌───────────────────────────────────────────────────────────────┐
│                      CONTEXT MAP                              │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────┐         Partnership          ┌─────────┐        │
│  │ Sales   │◄────────────────────────────►│Inventory│        │
│  │  (U,D)  │                              │  (U,D)  │        │
│  └────┬────┘                              └────┬────┘        │
│       │                                        │              │
│       │ Customer/Supplier                      │              │
│       ▼                                        │              │
│  ┌─────────┐                                   │              │
│  │ Billing │◄──────────────────────────────────┘              │
│  │   (D)   │         Conformist                               │
│  └─────────┘                                                  │
│                                                               │
│  Legend: U = Upstream, D = Downstream                         │
└───────────────────────────────────────────────────────────────┘
```

## Subdomain Classification

### Core Domain

The essential differentiator. This is where competitive advantage lives.

**Characteristics**:

- Unique to this business
- Complex, requires deep expertise
- Frequently changing as business evolves
- Worth significant investment

**Strategy**: Build in-house with best talent. Invest heavily in modeling.

### Supporting Subdomain

Necessary for the business but not a differentiator.

**Characteristics**:

- Important but not unique
- Moderate complexity
- Changes less frequently
- Custom implementation needed

**Strategy**: Build with adequate (not exceptional) investment. May outsource.

### Generic Subdomain

Solved problems with off-the-shelf solutions.

**Characteristics**:

- Common across industries
- Well-understood solutions exist
- Rarely changes
- Not a differentiator

**Strategy**: Buy or use open-source. Don't reinvent.

### Example: E-Commerce Platform

| Subdomain                     | Type       | Strategy                        |
| ----------------------------- | ---------- | ------------------------------- |
| Product Recommendation Engine | Core       | In-house, top talent            |
| Inventory Management          | Supporting | Build, adequate investment      |
| Payment Processing            | Generic    | Third-party (Stripe, etc.)      |
| User Authentication           | Generic    | Third-party or standard library |
| Shipping Logistics            | Supporting | Build or integrate vendor       |
| Customer Analytics            | Core       | In-house, strategic investment  |

## Ubiquitous Language

### Definition

A common language shared by developers and domain experts. It appears in conversations, documentation, and code.

### Building Ubiquitous Language

1. **Listen to experts** - Use their terminology, not technical jargon
2. **Challenge vague terms** - "Process the order" → What exactly happens?
3. **Document glossary** - Maintain a living dictionary
4. **Enforce in code** - Class and method names use the language
5. **Refine continuously** - Language evolves with understanding

### Language in Code

```typescript
// Bad: Technical terms
class OrderProcessor {
	handleOrderCreation(data: OrderData): void {
		this.validateData(data)
		this.persistToDatabase(data)
		this.sendNotification(data)
	}
}

// Good: Ubiquitous language
class OrderTaker {
	placeOrder(cart: ShoppingCart): PlacedOrder {
		const order = cart.checkout()
		order.confirmWith(this.paymentGateway)
		this.orderRepository.save(order)
		this.domainEvents.publish(new OrderPlaced(order))
		return order
	}
}
```

### Glossary Example

| Term         | Definition                                                | Context     |
| ------------ | --------------------------------------------------------- | ----------- |
| **Order**    | A confirmed purchase with payment collected               | Sales       |
| **Shipment** | Physical package(s) sent to fulfill an order              | Fulfillment |
| **SKU**      | Stock Keeping Unit; unique identifier for inventory       | Inventory   |
| **Cart**     | Uncommitted collection of items a customer intends to buy | Sales       |
| **Listing**  | Product displayed for purchase in the catalog             | Catalog     |

### Anti-Pattern: Technical Language Leakage

```typescript
// Bad: Database terminology leaks into domain
order.setForeignKeyCustomerId(customerId)
order.persist()

// Bad: HTTP concerns leak into domain
order.deserializeFromJson(request.body)
order.setHttpStatus(200)

// Good: Domain language only
order.placeFor(customer)
orderRepository.save(order)
```

## Strategic Design Decisions

### When to Split a Bounded Context

Split when:

- Different parts need to evolve at different speeds
- Different teams need ownership
- Model complexity is becoming unmanageable
- Language conflicts are emerging within the context

Don't split when:

- Transaction boundaries would become awkward
- Integration cost outweighs isolation benefit
- Single team can handle the complexity

### When to Merge Bounded Contexts

Merge when:

- Integration overhead is excessive
- Same team owns both
- Models are converging naturally
- Separate contexts create artificial complexity

### Dealing with Legacy Systems

1. **Bubble context** - New bounded context with ACL to legacy
2. **Strangler fig** - Gradually replace legacy feature by feature
3. **Conformist** - Accept legacy model if acceptable
4. **Separate ways** - Rebuild independently, migrate data later
