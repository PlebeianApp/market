# DDD Anti-Patterns

This reference documents common anti-patterns encountered when implementing Domain-Driven Design, how to identify them, and remediation strategies.

## Anemic Domain Model

### Description

Entities that are mere data containers with getters and setters, while all business logic lives in "service" classes. The domain model looks like a relational database schema mapped to objects.

### Symptoms

- Entities with only get/set methods and no behavior
- Service classes with methods like `orderService.calculateTotal(order)`
- Business rules scattered across multiple services
- Heavy use of DTOs that mirror entity structure
- "Transaction scripts" in application services

### Example

```typescript
// ANTI-PATTERN: Anemic domain model
class Order {
	id: string
	customerId: string
	items: OrderItem[]
	status: string
	total: number

	// Only data access, no behavior
	getId(): string {
		return this.id
	}
	setStatus(status: string): void {
		this.status = status
	}
	getItems(): OrderItem[] {
		return this.items
	}
	setTotal(total: number): void {
		this.total = total
	}
}

class OrderService {
	// All logic external to the entity
	calculateTotal(order: Order): number {
		let total = 0
		for (const item of order.getItems()) {
			total += item.price * item.quantity
		}
		order.setTotal(total)
		return total
	}

	canShip(order: Order): boolean {
		return order.status === 'PAID' && order.getItems().length > 0
	}

	ship(order: Order, trackingNumber: string): void {
		if (!this.canShip(order)) {
			throw new Error('Cannot ship order')
		}
		order.setStatus('SHIPPED')
		order.trackingNumber = trackingNumber
	}
}
```

### Remediation

```typescript
// CORRECT: Rich domain model
class Order {
	private _id: OrderId
	private _items: OrderItem[]
	private _status: OrderStatus

	// Behavior lives in the entity
	get total(): Money {
		return this._items.reduce((sum, item) => sum.add(item.subtotal()), Money.zero())
	}

	canShip(): boolean {
		return this._status === OrderStatus.Paid && this._items.length > 0
	}

	ship(trackingNumber: TrackingNumber): void {
		if (!this.canShip()) {
			throw new OrderNotShippableError(this._id, this._status)
		}
		this._status = OrderStatus.Shipped
		this._trackingNumber = trackingNumber
	}

	addItem(item: OrderItem): void {
		this.ensureCanModify()
		this._items.push(item)
	}
}

// Application service is thin - only orchestration
class OrderApplicationService {
	async shipOrder(orderId: OrderId, trackingNumber: TrackingNumber): Promise<void> {
		const order = await this.orderRepository.findById(orderId)
		order.ship(trackingNumber) // Domain logic in entity
		await this.orderRepository.save(order)
	}
}
```

### Root Causes

- Developers treating objects as data structures
- Thinking in terms of database tables
- Copying patterns from CRUD applications
- Misunderstanding "service" to mean "all logic goes here"

## God Aggregate

### Description

An aggregate that has grown to encompass too much. It handles multiple concerns, has many child entities, and becomes a performance and concurrency bottleneck.

### Symptoms

- Aggregates with 10+ child entity types
- Long load times due to eager loading everything
- Frequent optimistic concurrency conflicts
- Methods that only touch a small subset of the aggregate
- Difficulty reasoning about invariants

### Example

```typescript
// ANTI-PATTERN: God aggregate
class Customer {
	private _id: CustomerId
	private _profile: CustomerProfile
	private _addresses: Address[]
	private _paymentMethods: PaymentMethod[]
	private _orders: Order[] // History of all orders!
	private _wishlist: WishlistItem[]
	private _reviews: Review[]
	private _loyaltyPoints: LoyaltyAccount
	private _preferences: Preferences
	private _notifications: Notification[]
	private _supportTickets: SupportTicket[]

	// Loading this customer loads EVERYTHING
	// Updating preferences causes concurrency conflict with order placement
}
```

### Remediation

```typescript
// CORRECT: Small, focused aggregates
class Customer {
	private _id: CustomerId
	private _profile: CustomerProfile
	private _defaultAddressId: AddressId
	private _membershipTier: MembershipTier
}

class CustomerAddressBook {
	private _customerId: CustomerId
	private _addresses: Address[]
}

class ShoppingCart {
	private _customerId: CustomerId // Reference by ID
	private _items: CartItem[]
}

class Wishlist {
	private _customerId: CustomerId // Reference by ID
	private _items: WishlistItem[]
}

class LoyaltyAccount {
	private _customerId: CustomerId // Reference by ID
	private _points: Points
	private _transactions: LoyaltyTransaction[]
}
```

### Identification Heuristic

Ask: "Do all these things need to be immediately consistent?" If the answer is no, they probably belong in separate aggregates.

## Aggregate Reference Violation

### Description

Aggregates holding direct object references to other aggregates instead of referencing by identity. Creates implicit coupling and makes it impossible to reason about transactional boundaries.

### Symptoms

- Navigation from one aggregate to another: `order.customer.address`
- Loading an aggregate brings in connected aggregates
- Unclear what gets saved when calling `save()`
- Difficulty implementing eventual consistency

### Example

```typescript
// ANTI-PATTERN: Direct reference
class Order {
	private customer: Customer // Direct reference!
	private shippingAddress: Address

	getCustomerEmail(): string {
		return this.customer.email // Navigating through!
	}

	validate(): void {
		// Touching another aggregate's data
		if (this.customer.creditLimit < this.total) {
			throw new Error('Credit limit exceeded')
		}
	}
}
```

### Remediation

```typescript
// CORRECT: Reference by identity
class Order {
	private _customerId: CustomerId // ID only!
	private _shippingAddress: Address // Value object copied at order time

	// If customer data is needed, it must be explicitly loaded
	static create(
		customerId: CustomerId,
		shippingAddress: Address,
		creditLimit: Money, // Passed in, not navigated to
	): Order {
		return new Order(customerId, shippingAddress, creditLimit)
	}
}

// Application service coordinates loading if needed
class OrderApplicationService {
	async getOrderWithCustomerDetails(orderId: OrderId): Promise<OrderDetails> {
		const order = await this.orderRepository.findById(orderId)
		const customer = await this.customerRepository.findById(order.customerId)

		return new OrderDetails(order, customer)
	}
}
```

## Smart UI

### Description

Business logic embedded directly in the user interface layer. Controllers, presenters, or UI components contain domain rules.

### Symptoms

- Validation logic in form handlers
- Business calculations in controllers
- State machines in UI components
- Domain rules duplicated across different UI views
- "If we change the UI framework, we lose the business logic"

### Example

```typescript
// ANTI-PATTERN: Smart UI
class OrderController {
	submitOrder(request: Request): Response {
		const cart = request.body

		// Business logic in controller!
		let total = 0
		for (const item of cart.items) {
			total += item.price * item.quantity
		}

		// Discount rules in controller!
		if (cart.items.length > 10) {
			total *= 0.9 // 10% bulk discount
		}

		if (total > 1000 && !this.hasValidPaymentMethod(cart.customerId)) {
			return Response.error('Orders over $1000 require verified payment')
		}

		// More business rules...
		const order = {
			customerId: cart.customerId,
			items: cart.items,
			total: total,
			status: 'PENDING',
		}

		this.database.insert('orders', order)
		return Response.ok(order)
	}
}
```

### Remediation

```typescript
// CORRECT: UI delegates to domain
class OrderController {
	submitOrder(request: Request): Response {
		const command = new PlaceOrderCommand(request.body.customerId, request.body.items)

		try {
			const orderId = this.orderApplicationService.placeOrder(command)
			return Response.ok({ orderId })
		} catch (error) {
			if (error instanceof DomainError) {
				return Response.badRequest(error.message)
			}
			throw error
		}
	}
}

// Domain logic in domain layer
class Order {
	private calculateTotal(): Money {
		const subtotal = this._items.reduce((sum, item) => sum.add(item.subtotal()), Money.zero())
		return this._discountPolicy.apply(subtotal, this._items.length)
	}
}

class BulkDiscountPolicy implements DiscountPolicy {
	apply(subtotal: Money, itemCount: number): Money {
		if (itemCount > 10) {
			return subtotal.multiply(0.9)
		}
		return subtotal
	}
}
```

## Database-Driven Design

### Description

The domain model is derived from the database schema rather than from domain concepts. Tables become classes; foreign keys become object references; database constraints become business rules.

### Symptoms

- Class names match table names exactly
- Foreign key relationships drive object graph
- ID fields everywhere, even where identity doesn't matter
- `nullable` database columns drive optional properties
- Domain model changes require database migration first

### Example

```typescript
// ANTI-PATTERN: Database-driven model
// Mirrors database schema exactly
class orders {
	order_id: number
	customer_id: number
	order_date: Date
	status_cd: string
	shipping_address_id: number
	billing_address_id: number
	total_amt: number
	tax_amt: number
	created_ts: Date
	updated_ts: Date
}

class order_items {
	order_item_id: number
	order_id: number
	product_id: number
	quantity: number
	unit_price: number
	discount_pct: number
}
```

### Remediation

```typescript
// CORRECT: Domain-driven model
class Order {
	private readonly _id: OrderId
	private _status: OrderStatus
	private _items: OrderItem[]
	private _shippingAddress: Address // Value object, not FK
	private _billingAddress: Address

	// Domain behavior, not database structure
	get total(): Money {
		return this._items.reduce((sum, item) => sum.add(item.lineTotal()), Money.zero())
	}

	ship(trackingNumber: TrackingNumber): void {
		// Business logic
	}
}

// Mapping is infrastructure concern
class OrderRepository {
	async save(order: Order): Promise<void> {
		// Map rich domain object to database tables
		await this.db.query('INSERT INTO orders (id, status, shipping_street, shipping_city...) VALUES (...)')
	}
}
```

### Key Principle

The domain model reflects how domain experts think, not how data is stored. Persistence is an infrastructure detail.

## Leaky Abstractions

### Description

Infrastructure concerns bleeding into the domain layer. Domain objects depend on frameworks, databases, or external services.

### Symptoms

- Domain entities with ORM decorators
- Repository interfaces returning database-specific types
- Domain services making HTTP calls
- Framework annotations on domain objects
- `import { Entity } from 'typeorm'` in domain layer

### Example

```typescript
// ANTI-PATTERN: Infrastructure leaking into domain
import { Entity, Column, PrimaryColumn, ManyToOne } from 'typeorm'
import { IsEmail, IsNotEmpty } from 'class-validator'

@Entity('customers') // ORM in domain!
export class Customer {
	@PrimaryColumn()
	id: string

	@Column()
	@IsNotEmpty() // Validation framework in domain!
	name: string

	@Column()
	@IsEmail()
	email: string

	@ManyToOne(() => Subscription) // ORM relationship in domain!
	subscription: Subscription
}

// Domain service calling external API directly
class ShippingCostService {
	async calculateCost(order: Order): Promise<number> {
		// HTTP call in domain!
		const response = await fetch('https://shipping-api.com/rates', {
			body: JSON.stringify(order),
		})
		return response.json().cost
	}
}
```

### Remediation

```typescript
// CORRECT: Clean domain layer
// Domain object - no framework dependencies
class Customer {
	private constructor(
		private readonly _id: CustomerId,
		private readonly _name: CustomerName,
		private readonly _email: Email,
	) {}

	static create(name: string, email: string): Customer {
		return new Customer(
			CustomerId.generate(),
			CustomerName.create(name), // Self-validating value object
			Email.create(email), // Self-validating value object
		)
	}
}

// Port (interface) defined in domain
interface ShippingRateProvider {
	getRate(destination: Address, weight: Weight): Promise<Money>
}

// Domain service uses port
class ShippingCostCalculator {
	constructor(private rateProvider: ShippingRateProvider) {}

	async calculate(order: Order): Promise<Money> {
		return this.rateProvider.getRate(order.shippingAddress, order.totalWeight())
	}
}

// Adapter (infrastructure) implements port
class ShippingApiRateProvider implements ShippingRateProvider {
	async getRate(destination: Address, weight: Weight): Promise<Money> {
		const response = await fetch('https://shipping-api.com/rates', {
			body: JSON.stringify({ destination, weight }),
		})
		const data = await response.json()
		return Money.of(data.cost, Currency.USD)
	}
}
```

## Shared Database

### Description

Multiple bounded contexts accessing the same database tables. Changes in one context break others. No clear data ownership.

### Symptoms

- Multiple services querying the same tables
- Fear of schema changes because "something else might break"
- Unclear which service is authoritative for data
- Cross-context joins in queries
- Database triggers coordinating contexts

### Example

```typescript
// ANTI-PATTERN: Shared database
// Sales context
class SalesOrderService {
	async getOrder(orderId: string) {
		return this.db.query(
			`
      SELECT o.*, c.name, c.email, p.name as product_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      JOIN products p ON o.product_id = p.id
      WHERE o.id = ?
    `,
			[orderId],
		)
	}
}

// Shipping context - same tables!
class ShippingService {
	async getOrdersToShip() {
		return this.db.query(`
      SELECT o.*, c.address
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.status = 'PAID'
    `)
	}

	async markShipped(orderId: string) {
		// Directly modifying shared table
		await this.db.query("UPDATE orders SET status = 'SHIPPED' WHERE id = ?", [orderId])
	}
}
```

### Remediation

```typescript
// CORRECT: Each context owns its data
// Sales context - owns order creation
class SalesOrderRepository {
	async save(order: SalesOrder): Promise<void> {
		await this.salesDb.query('INSERT INTO sales_orders...')

		// Publish event for other contexts
		await this.eventPublisher.publish(new OrderPlaced(order.id, order.customerId, order.items))
	}
}

// Shipping context - owns its projection
class ShippingOrderProjection {
	// Handles events to build local projection
	async handleOrderPlaced(event: OrderPlaced): Promise<void> {
		await this.shippingDb.query(
			`
      INSERT INTO shipments (order_id, customer_id, status)
      VALUES (?, ?, 'PENDING')
    `,
			[event.orderId, event.customerId],
		)
	}
}

class ShipmentRepository {
	async findPendingShipments(): Promise<Shipment[]> {
		// Queries only shipping context's data
		return this.shippingDb.query("SELECT * FROM shipments WHERE status = 'PENDING'")
	}
}
```

## Premature Abstraction

### Description

Creating abstractions, interfaces, and frameworks before understanding the problem space. Often justified as "flexibility for the future."

### Symptoms

- Interfaces with single implementations
- Generic frameworks solving hypothetical problems
- Heavy use of design patterns without clear benefit
- Configuration systems for things that never change
- "We might need this someday"

### Example

```typescript
// ANTI-PATTERN: Premature abstraction
interface IOrderProcessor<TOrder, TResult> {
	process(order: TOrder): Promise<TResult>
}

interface IOrderValidator<TOrder> {
	validate(order: TOrder): ValidationResult
}

interface IOrderPersister<TOrder> {
	persist(order: TOrder): Promise<void>
}

abstract class AbstractOrderProcessor<TOrder, TResult> implements IOrderProcessor<TOrder, TResult> {
	constructor(
		protected validator: IOrderValidator<TOrder>,
		protected persister: IOrderPersister<TOrder>,
		protected notifier: INotificationService,
		protected logger: ILogger,
		protected metrics: IMetricsCollector,
	) {}

	async process(order: TOrder): Promise<TResult> {
		this.logger.log('Processing order')
		this.metrics.increment('orders.processed')

		const validation = this.validator.validate(order)
		if (!validation.isValid) {
			throw new ValidationException(validation.errors)
		}

		const result = await this.doProcess(order)
		await this.persister.persist(order)
		await this.notifier.notify(order)

		return result
	}

	protected abstract doProcess(order: TOrder): Promise<TResult>
}

// Only one concrete implementation ever created
class StandardOrderProcessor extends AbstractOrderProcessor<Order, OrderResult> {
	protected async doProcess(order: Order): Promise<OrderResult> {
		// The actual logic is trivial
		return new OrderResult(order.id)
	}
}
```

### Remediation

```typescript
// CORRECT: Concrete first, abstract when patterns emerge
class OrderService {
	async placeOrder(command: PlaceOrderCommand): Promise<OrderId> {
		const order = Order.create(command)

		if (!order.isValid()) {
			throw new InvalidOrderError(order.validationErrors())
		}

		await this.orderRepository.save(order)

		return order.id
	}
}

// Only add abstraction when you have multiple implementations
// and understand the variation points
```

### Heuristic

Wait until you have three similar implementations before abstracting. The right abstraction will be obvious then.

## Big Ball of Mud

### Description

A system without clear architectural boundaries. Everything depends on everything. Changes ripple unpredictably.

### Symptoms

- No clear module boundaries
- Circular dependencies
- Any change might break anything
- "Only Bob understands how this works"
- Integration tests are the only reliable tests
- Fear of refactoring

### Identification

```
# Circular dependency example
OrderService → CustomerService → PaymentService → OrderService
```

### Remediation Strategy

1. **Identify implicit contexts** - Find clusters of related functionality
2. **Define explicit boundaries** - Create modules/packages with clear interfaces
3. **Break cycles** - Introduce events or shared kernel for circular dependencies
4. **Enforce boundaries** - Use architectural tests, linting rules

```typescript
// Step 1: Identify boundaries
// sales/ - order creation, pricing
// fulfillment/ - shipping, tracking
// customer/ - customer management
// shared/ - shared kernel (Money, Address)

// Step 2: Define public interfaces
// sales/index.ts
export { OrderService } from './application/OrderService'
export { OrderPlaced, OrderCancelled } from './domain/events'
// Internal types not exported

// Step 3: Break cycles with events
class OrderService {
	async placeOrder(command: PlaceOrderCommand): Promise<OrderId> {
		const order = Order.create(command)
		await this.orderRepository.save(order)

		// Instead of calling PaymentService directly
		await this.eventPublisher.publish(new OrderPlaced(order))

		return order.id
	}
}

class PaymentEventHandler {
	async handleOrderPlaced(event: OrderPlaced): Promise<void> {
		await this.paymentService.collectPayment(event.orderId, event.total)
	}
}
```

## CRUD-Driven Development

### Description

Treating all domain operations as Create, Read, Update, Delete operations. Loses domain intent and behavior.

### Symptoms

- Endpoints like `PUT /orders/{id}` that accept any field changes
- Service methods like `updateOrder(orderId, updates)`
- Domain events named `OrderUpdated` instead of `OrderShipped`
- No validation of state transitions
- Business operations hidden behind generic updates

### Example

```typescript
// ANTI-PATTERN: CRUD-driven
class OrderController {
	@Put('/orders/:id')
	async updateOrder(id: string, body: Partial<Order>) {
		// Any field can be updated!
		return this.orderService.update(id, body)
	}
}

class OrderService {
	async update(id: string, updates: Partial<Order>): Promise<Order> {
		const order = await this.repo.findById(id)
		Object.assign(order, updates) // Blindly apply updates
		return this.repo.save(order)
	}
}
```

### Remediation

```typescript
// CORRECT: Intent-revealing operations
class OrderController {
	@Post('/orders/:id/ship')
	async shipOrder(id: string, body: ShipOrderRequest) {
		return this.orderService.ship(id, body.trackingNumber)
	}

	@Post('/orders/:id/cancel')
	async cancelOrder(id: string, body: CancelOrderRequest) {
		return this.orderService.cancel(id, body.reason)
	}
}

class OrderService {
	async ship(orderId: OrderId, trackingNumber: TrackingNumber): Promise<void> {
		const order = await this.repo.findById(orderId)
		order.ship(trackingNumber) // Domain logic with validation
		await this.repo.save(order)
		await this.publish(new OrderShipped(orderId, trackingNumber))
	}

	async cancel(orderId: OrderId, reason: CancellationReason): Promise<void> {
		const order = await this.repo.findById(orderId)
		order.cancel(reason) // Validates cancellation is allowed
		await this.repo.save(order)
		await this.publish(new OrderCancelled(orderId, reason))
	}
}
```

## Summary: Detection Checklist

| Anti-Pattern                  | Key Question                                      |
| ----------------------------- | ------------------------------------------------- |
| Anemic Domain Model           | Do entities have behavior or just data?           |
| God Aggregate                 | Does everything need immediate consistency?       |
| Aggregate Reference Violation | Are aggregates holding other aggregates?          |
| Smart UI                      | Would changing UI framework lose business logic?  |
| Database-Driven Design        | Does model match tables or domain concepts?       |
| Leaky Abstractions            | Does domain code import infrastructure?           |
| Shared Database               | Do multiple contexts write to same tables?        |
| Premature Abstraction         | Are there interfaces with single implementations? |
| Big Ball of Mud               | Can any change break anything?                    |
| CRUD-Driven Development       | Are operations generic updates or domain intents? |
