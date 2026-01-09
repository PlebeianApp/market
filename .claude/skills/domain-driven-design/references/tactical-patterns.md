# Tactical DDD Patterns

Tactical DDD patterns are code-level building blocks for implementing a rich domain model. They help express domain concepts in code that mirrors how domain experts think.

## Entity

### Definition

An object defined by its identity rather than its attributes. Two entities with the same attribute values but different identities are different things.

### Characteristics

- Has a unique identifier that persists through state changes
- Identity established at creation, immutable thereafter
- Equality based on identity, not attribute values
- Has a lifecycle (created, modified, potentially deleted)
- Contains behavior relevant to the domain concept it represents

### When to Use

- The object represents something tracked over time
- "Is this the same one?" is a meaningful question
- The object needs to be referenced from other parts of the system
- State changes are important to track

### Implementation

```typescript
// Entity with identity and behavior
class Order {
	private readonly _id: OrderId
	private _status: OrderStatus
	private _items: OrderItem[]
	private _shippingAddress: Address

	constructor(id: OrderId, items: OrderItem[], shippingAddress: Address) {
		this._id = id
		this._items = items
		this._shippingAddress = shippingAddress
		this._status = OrderStatus.Pending
	}

	get id(): OrderId {
		return this._id
	}

	// Behavior, not just data access
	confirm(): void {
		if (this._items.length === 0) {
			throw new EmptyOrderError(this._id)
		}
		this._status = OrderStatus.Confirmed
	}

	ship(trackingNumber: TrackingNumber): void {
		if (this._status !== OrderStatus.Confirmed) {
			throw new InvalidOrderStateError(this._id, this._status, 'ship')
		}
		this._status = OrderStatus.Shipped
		// Domain event raised
	}

	addItem(item: OrderItem): void {
		if (this._status !== OrderStatus.Pending) {
			throw new OrderModificationError(this._id)
		}
		this._items.push(item)
	}

	// Identity-based equality
	equals(other: Order): boolean {
		return this._id.equals(other._id)
	}
}

// Strongly-typed identity
class OrderId {
	constructor(private readonly value: string) {
		if (!value || value.trim() === '') {
			throw new InvalidOrderIdError()
		}
	}

	equals(other: OrderId): boolean {
		return this.value === other.value
	}

	toString(): string {
		return this.value
	}
}
```

### Entity vs Data Structure

```typescript
// Bad: Anemic entity (data structure)
class Order {
	id: string
	status: string
	items: Item[]

	// Only getters/setters, no behavior
}

// Good: Rich entity with behavior
class Order {
	private _id: OrderId
	private _status: OrderStatus
	private _items: OrderItem[]

	confirm(): void {
		/* enforces rules */
	}
	cancel(reason: CancellationReason): void {
		/* enforces rules */
	}
	addItem(item: OrderItem): void {
		/* enforces rules */
	}
}
```

## Value Object

### Definition

An object defined entirely by its attributes. Two value objects with the same attributes are interchangeable. Has no identity.

### Characteristics

- Immutable - once created, never changes
- Equality based on attributes, not identity
- Self-validating - always in a valid state
- Side-effect free - methods return new instances
- Conceptually whole - attributes form a complete concept

### When to Use

- The concept has no lifecycle or identity
- "Are these the same?" means "do they have the same values?"
- Measurement, description, or quantification
- Combinations of attributes that belong together

### Implementation

```typescript
// Value Object: Money
class Money {
	private constructor(
		private readonly amount: number,
		private readonly currency: Currency,
	) {}

	// Factory method with validation
	static of(amount: number, currency: Currency): Money {
		if (amount < 0) {
			throw new NegativeMoneyError(amount)
		}
		return new Money(amount, currency)
	}

	// Immutable operations - return new instances
	add(other: Money): Money {
		this.ensureSameCurrency(other)
		return Money.of(this.amount + other.amount, this.currency)
	}

	subtract(other: Money): Money {
		this.ensureSameCurrency(other)
		return Money.of(this.amount - other.amount, this.currency)
	}

	multiply(factor: number): Money {
		return Money.of(this.amount * factor, this.currency)
	}

	// Value-based equality
	equals(other: Money): boolean {
		return this.amount === other.amount && this.currency.equals(other.currency)
	}

	private ensureSameCurrency(other: Money): void {
		if (!this.currency.equals(other.currency)) {
			throw new CurrencyMismatchError(this.currency, other.currency)
		}
	}
}

// Value Object: Address
class Address {
	private constructor(
		readonly street: string,
		readonly city: string,
		readonly postalCode: string,
		readonly country: Country,
	) {}

	static create(street: string, city: string, postalCode: string, country: Country): Address {
		if (!street || !city || !postalCode) {
			throw new InvalidAddressError()
		}
		if (!country.validatePostalCode(postalCode)) {
			throw new InvalidPostalCodeError(postalCode, country)
		}
		return new Address(street, city, postalCode, country)
	}

	// Returns new instance with modified value
	withStreet(newStreet: string): Address {
		return Address.create(newStreet, this.city, this.postalCode, this.country)
	}

	equals(other: Address): boolean {
		return (
			this.street === other.street && this.city === other.city && this.postalCode === other.postalCode && this.country.equals(other.country)
		)
	}
}

// Value Object: DateRange
class DateRange {
	private constructor(
		readonly start: Date,
		readonly end: Date,
	) {}

	static create(start: Date, end: Date): DateRange {
		if (end < start) {
			throw new InvalidDateRangeError(start, end)
		}
		return new DateRange(start, end)
	}

	contains(date: Date): boolean {
		return date >= this.start && date <= this.end
	}

	overlaps(other: DateRange): boolean {
		return this.start <= other.end && this.end >= other.start
	}

	durationInDays(): number {
		return Math.floor((this.end.getTime() - this.start.getTime()) / (1000 * 60 * 60 * 24))
	}
}
```

### Common Value Objects

| Domain         | Value Objects                                     |
| -------------- | ------------------------------------------------- |
| **E-commerce** | Money, Price, Quantity, SKU, Address, PhoneNumber |
| **Healthcare** | BloodPressure, Dosage, DateRange, PatientId       |
| **Finance**    | AccountNumber, IBAN, TaxId, Percentage            |
| **Shipping**   | Weight, Dimensions, TrackingNumber, PostalCode    |
| **General**    | Email, URL, PhoneNumber, Name, Coordinates        |

## Aggregate

### Definition

A cluster of entities and value objects with defined boundaries. Has an aggregate root entity that serves as the single entry point. External objects can only reference the root.

### Characteristics

- Defines a transactional consistency boundary
- Aggregate root is the only externally accessible object
- Enforces invariants across the cluster
- Loaded and saved as a unit
- Other aggregates referenced by identity only

### Design Rules

1. **Protect invariants** - All rules that must be consistent are inside the boundary
2. **Small aggregates** - Prefer single-entity aggregates; add children only when invariants require
3. **Reference by identity** - Never hold direct references to other aggregates
4. **Update one per transaction** - Eventual consistency between aggregates
5. **Design around invariants** - Identify what must be immediately consistent

### Implementation

```typescript
// Aggregate: Order (root) with OrderItems (child entities)
class Order {
	private readonly _id: OrderId
	private _items: Map<ProductId, OrderItem>
	private _status: OrderStatus

	// Invariant: Order total cannot exceed credit limit
	private _creditLimit: Money

	private constructor(id: OrderId, creditLimit: Money) {
		this._id = id
		this._items = new Map()
		this._status = OrderStatus.Draft
		this._creditLimit = creditLimit
	}

	static create(id: OrderId, creditLimit: Money): Order {
		return new Order(id, creditLimit)
	}

	// All modifications go through aggregate root
	addItem(productId: ProductId, quantity: Quantity, unitPrice: Money): void {
		this.ensureCanModify()

		const newItem = OrderItem.create(productId, quantity, unitPrice)
		const projectedTotal = this.calculateTotalWith(newItem)

		// Invariant enforcement
		if (projectedTotal.isGreaterThan(this._creditLimit)) {
			throw new CreditLimitExceededError(projectedTotal, this._creditLimit)
		}

		this._items.set(productId, newItem)
	}

	removeItem(productId: ProductId): void {
		this.ensureCanModify()
		this._items.delete(productId)
	}

	updateItemQuantity(productId: ProductId, newQuantity: Quantity): void {
		this.ensureCanModify()

		const item = this._items.get(productId)
		if (!item) {
			throw new ItemNotFoundError(productId)
		}

		const updatedItem = item.withQuantity(newQuantity)
		const projectedTotal = this.calculateTotalWithUpdate(productId, updatedItem)

		if (projectedTotal.isGreaterThan(this._creditLimit)) {
			throw new CreditLimitExceededError(projectedTotal, this._creditLimit)
		}

		this._items.set(productId, updatedItem)
	}

	submit(): OrderSubmitted {
		if (this._items.size === 0) {
			throw new EmptyOrderError()
		}
		this._status = OrderStatus.Submitted

		return new OrderSubmitted(this._id, this.total(), new Date())
	}

	// Read-only access to child entities
	get items(): ReadonlyArray<OrderItem> {
		return Array.from(this._items.values())
	}

	total(): Money {
		return this.items.reduce((sum, item) => sum.add(item.subtotal()), Money.zero(Currency.USD))
	}

	private ensureCanModify(): void {
		if (this._status !== OrderStatus.Draft) {
			throw new OrderNotModifiableError(this._id, this._status)
		}
	}

	private calculateTotalWith(newItem: OrderItem): Money {
		return this.total().add(newItem.subtotal())
	}

	private calculateTotalWithUpdate(productId: ProductId, updatedItem: OrderItem): Money {
		const currentItem = this._items.get(productId)!
		return this.total().subtract(currentItem.subtotal()).add(updatedItem.subtotal())
	}
}

// Child entity - only accessible through aggregate root
class OrderItem {
	private constructor(
		private readonly _productId: ProductId,
		private _quantity: Quantity,
		private readonly _unitPrice: Money,
	) {}

	static create(productId: ProductId, quantity: Quantity, unitPrice: Money): OrderItem {
		return new OrderItem(productId, quantity, unitPrice)
	}

	get productId(): ProductId {
		return this._productId
	}
	get quantity(): Quantity {
		return this._quantity
	}
	get unitPrice(): Money {
		return this._unitPrice
	}

	subtotal(): Money {
		return this._unitPrice.multiply(this._quantity.value)
	}

	withQuantity(newQuantity: Quantity): OrderItem {
		return new OrderItem(this._productId, newQuantity, this._unitPrice)
	}
}
```

### Aggregate Reference Patterns

```typescript
// Bad: Direct object reference across aggregates
class Order {
	private customer: Customer // Holds the entire aggregate!
}

// Good: Reference by identity
class Order {
	private customerId: CustomerId

	// If customer data needed, load separately
	getCustomerAddress(customerRepository: CustomerRepository): Address {
		const customer = customerRepository.findById(this.customerId)
		return customer.shippingAddress
	}
}
```

## Domain Event

### Definition

A record of something significant that happened in the domain. Captures state changes that domain experts care about.

### Characteristics

- Named in past tense (OrderPlaced, PaymentReceived)
- Immutable - records historical fact
- Contains all relevant data about what happened
- Published after state change is committed
- May trigger reactions in same or different bounded contexts

### When to Use

- Domain experts talk about "when X happens, Y should happen"
- Need to communicate changes across aggregate boundaries
- Maintaining an audit trail
- Implementing eventual consistency
- Integration with other bounded contexts

### Implementation

```typescript
// Base domain event
abstract class DomainEvent {
	readonly occurredAt: Date
	readonly eventId: string

	constructor() {
		this.occurredAt = new Date()
		this.eventId = generateUUID()
	}

	abstract get eventType(): string
}

// Specific domain events
class OrderPlaced extends DomainEvent {
	constructor(
		readonly orderId: OrderId,
		readonly customerId: CustomerId,
		readonly totalAmount: Money,
		readonly items: ReadonlyArray<OrderItemSnapshot>,
	) {
		super()
	}

	get eventType(): string {
		return 'order.placed'
	}
}

class OrderShipped extends DomainEvent {
	constructor(
		readonly orderId: OrderId,
		readonly trackingNumber: TrackingNumber,
		readonly carrier: string,
		readonly estimatedDelivery: Date,
	) {
		super()
	}

	get eventType(): string {
		return 'order.shipped'
	}
}

class PaymentReceived extends DomainEvent {
	constructor(
		readonly orderId: OrderId,
		readonly amount: Money,
		readonly paymentMethod: PaymentMethod,
		readonly transactionId: string,
	) {
		super()
	}

	get eventType(): string {
		return 'payment.received'
	}
}

// Entity raising events
class Order {
	private _domainEvents: DomainEvent[] = []

	submit(): void {
		// State change
		this._status = OrderStatus.Submitted

		// Raise event
		this._domainEvents.push(new OrderPlaced(this._id, this._customerId, this.total(), this.itemSnapshots()))
	}

	pullDomainEvents(): DomainEvent[] {
		const events = [...this._domainEvents]
		this._domainEvents = []
		return events
	}
}

// Event handler
class OrderPlacedHandler {
	constructor(
		private inventoryService: InventoryService,
		private emailService: EmailService,
	) {}

	async handle(event: OrderPlaced): Promise<void> {
		// Reserve inventory (different aggregate)
		await this.inventoryService.reserveItems(event.items)

		// Send confirmation email
		await this.emailService.sendOrderConfirmation(event.customerId, event.orderId, event.totalAmount)
	}
}
```

### Event Publishing Patterns

```typescript
// Pattern 1: Collect and dispatch after save
class OrderApplicationService {
	async placeOrder(command: PlaceOrderCommand): Promise<OrderId> {
		const order = Order.create(command)

		await this.orderRepository.save(order)

		// Dispatch events after successful save
		const events = order.pullDomainEvents()
		await this.eventDispatcher.dispatchAll(events)

		return order.id
	}
}

// Pattern 2: Outbox pattern (reliable publishing)
class OrderApplicationService {
	async placeOrder(command: PlaceOrderCommand): Promise<OrderId> {
		await this.unitOfWork.transaction(async () => {
			const order = Order.create(command)
			await this.orderRepository.save(order)

			// Save events to outbox in same transaction
			const events = order.pullDomainEvents()
			await this.outbox.saveEvents(events)
		})

		// Separate process publishes from outbox
		return order.id
	}
}
```

## Repository

### Definition

Mediates between the domain and data mapping layers. Provides collection-like interface for accessing aggregates.

### Characteristics

- One repository per aggregate root
- Interface defined in domain layer, implementation in infrastructure
- Returns fully reconstituted aggregates
- Abstracts persistence concerns from domain

### Interface Design

```typescript
// Domain layer interface
interface OrderRepository {
	findById(id: OrderId): Promise<Order | null>
	save(order: Order): Promise<void>
	delete(order: Order): Promise<void>

	// Domain-specific queries
	findPendingOrdersFor(customerId: CustomerId): Promise<Order[]>
	findOrdersToShipBefore(deadline: Date): Promise<Order[]>
}

// Infrastructure implementation
class PostgresOrderRepository implements OrderRepository {
	constructor(private db: Database) {}

	async findById(id: OrderId): Promise<Order | null> {
		const row = await this.db.query('SELECT * FROM orders WHERE id = $1', [id.toString()])

		if (!row) return null

		const items = await this.db.query('SELECT * FROM order_items WHERE order_id = $1', [id.toString()])

		return this.reconstitute(row, items)
	}

	async save(order: Order): Promise<void> {
		await this.db.transaction(async (tx) => {
			await tx.query('INSERT INTO orders (id, status, customer_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET status = $2', [
				order.id.toString(),
				order.status,
				order.customerId.toString(),
			])

			// Save items
			for (const item of order.items) {
				await tx.query(
					'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4) ON CONFLICT DO UPDATE...',
					[order.id.toString(), item.productId.toString(), item.quantity.value, item.unitPrice.amount],
				)
			}
		})
	}

	private reconstitute(orderRow: any, itemRows: any[]): Order {
		// Rebuild aggregate from persistence data
		return Order.reconstitute({
			id: OrderId.from(orderRow.id),
			status: OrderStatus[orderRow.status],
			customerId: CustomerId.from(orderRow.customer_id),
			items: itemRows.map((row) =>
				OrderItem.reconstitute({
					productId: ProductId.from(row.product_id),
					quantity: Quantity.of(row.quantity),
					unitPrice: Money.of(row.unit_price, Currency.USD),
				}),
			),
		})
	}
}
```

### Repository vs DAO

```typescript
// DAO: Data-centric, returns raw data
interface OrderDao {
	findById(id: string): Promise<OrderRow>
	findItems(orderId: string): Promise<OrderItemRow[]>
	insert(row: OrderRow): Promise<void>
}

// Repository: Domain-centric, returns aggregates
interface OrderRepository {
	findById(id: OrderId): Promise<Order | null>
	save(order: Order): Promise<void>
}
```

## Domain Service

### Definition

Stateless operations that represent domain concepts but don't naturally belong to any entity or value object.

### When to Use

- The operation involves multiple aggregates
- The operation represents a domain concept
- Putting the operation on an entity would create awkward dependencies
- The operation is stateless

### Examples

```typescript
// Domain Service: Transfer money between accounts
class MoneyTransferService {
	transfer(from: Account, to: Account, amount: Money): TransferResult {
		// Involves two aggregates
		// Neither account should "own" this operation

		if (!from.canWithdraw(amount)) {
			return TransferResult.insufficientFunds()
		}

		from.withdraw(amount)
		to.deposit(amount)

		return TransferResult.success(new MoneyTransferred(from.id, to.id, amount))
	}
}

// Domain Service: Calculate shipping cost
class ShippingCostCalculator {
	constructor(private rateProvider: ShippingRateProvider) {}

	calculate(items: OrderItem[], destination: Address, shippingMethod: ShippingMethod): Money {
		const totalWeight = items.reduce((sum, item) => sum.add(item.weight), Weight.zero())

		const rate = this.rateProvider.getRate(destination.country, shippingMethod)

		return rate.calculateFor(totalWeight)
	}
}

// Domain Service: Check inventory availability
class InventoryAvailabilityService {
	constructor(private inventoryRepository: InventoryRepository) {}

	checkAvailability(items: Array<{ productId: ProductId; quantity: Quantity }>): AvailabilityResult {
		const unavailable: ProductId[] = []

		for (const { productId, quantity } of items) {
			const inventory = this.inventoryRepository.findByProductId(productId)
			if (!inventory || !inventory.hasAvailable(quantity)) {
				unavailable.push(productId)
			}
		}

		return unavailable.length === 0 ? AvailabilityResult.allAvailable() : AvailabilityResult.someUnavailable(unavailable)
	}
}
```

### Domain Service vs Application Service

```typescript
// Domain Service: Domain logic, domain types, stateless
class PricingService {
	calculateDiscountedPrice(product: Product, customer: Customer): Money {
		const basePrice = product.price
		const discount = customer.membershipLevel.discountPercentage
		return basePrice.applyDiscount(discount)
	}
}

// Application Service: Orchestration, use cases, transaction boundary
class OrderApplicationService {
	constructor(
		private orderRepository: OrderRepository,
		private pricingService: PricingService,
		private eventPublisher: EventPublisher,
	) {}

	async createOrder(command: CreateOrderCommand): Promise<OrderId> {
		const customer = await this.customerRepository.findById(command.customerId)
		const order = Order.create(command.orderId, customer.id)

		for (const item of command.items) {
			const product = await this.productRepository.findById(item.productId)
			const price = this.pricingService.calculateDiscountedPrice(product, customer)
			order.addItem(item.productId, item.quantity, price)
		}

		await this.orderRepository.save(order)
		await this.eventPublisher.publish(order.pullDomainEvents())

		return order.id
	}
}
```

## Factory

### Definition

Encapsulates complex object or aggregate creation logic. Creates objects in a valid state.

### When to Use

- Construction logic is complex
- Multiple ways to create the same type of object
- Creation involves other objects or services
- Need to enforce invariants at creation time

### Implementation

```typescript
// Factory as static method
class Order {
	static create(customerId: CustomerId, creditLimit: Money): Order {
		return new Order(OrderId.generate(), customerId, creditLimit, OrderStatus.Draft, [])
	}

	static reconstitute(data: OrderData): Order {
		// For rebuilding from persistence
		return new Order(data.id, data.customerId, data.creditLimit, data.status, data.items)
	}
}

// Factory as separate class
class OrderFactory {
	constructor(
		private creditLimitService: CreditLimitService,
		private idGenerator: IdGenerator,
	) {}

	async createForCustomer(customerId: CustomerId): Promise<Order> {
		const creditLimit = await this.creditLimitService.getLimit(customerId)
		const orderId = this.idGenerator.generate()

		return Order.create(orderId, customerId, creditLimit)
	}

	createFromQuote(quote: Quote): Order {
		const order = Order.create(this.idGenerator.generate(), quote.customerId, quote.creditLimit)

		for (const item of quote.items) {
			order.addItem(item.productId, item.quantity, item.agreedPrice)
		}

		return order
	}
}

// Builder pattern for complex construction
class OrderBuilder {
	private customerId?: CustomerId
	private items: OrderItemData[] = []
	private shippingAddress?: Address
	private billingAddress?: Address

	forCustomer(customerId: CustomerId): this {
		this.customerId = customerId
		return this
	}

	withItem(productId: ProductId, quantity: Quantity, price: Money): this {
		this.items.push({ productId, quantity, price })
		return this
	}

	shippingTo(address: Address): this {
		this.shippingAddress = address
		return this
	}

	billingTo(address: Address): this {
		this.billingAddress = address
		return this
	}

	build(): Order {
		if (!this.customerId) throw new Error('Customer required')
		if (!this.shippingAddress) throw new Error('Shipping address required')
		if (this.items.length === 0) throw new Error('At least one item required')

		const order = Order.create(this.customerId)
		order.setShippingAddress(this.shippingAddress)
		order.setBillingAddress(this.billingAddress ?? this.shippingAddress)

		for (const item of this.items) {
			order.addItem(item.productId, item.quantity, item.price)
		}

		return order
	}
}
```
