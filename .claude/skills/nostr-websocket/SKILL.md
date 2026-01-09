---
name: nostr-websocket
description: This skill should be used when implementing, debugging, or discussing WebSocket connections for Nostr relays. Provides comprehensive knowledge of RFC 6455 WebSocket protocol, production-ready implementation patterns in Go (khatru), C++ (strfry), and Rust (nostr-rs-relay), including connection lifecycle, message framing, subscription management, and performance optimization techniques specific to Nostr relay operations.
---

# Nostr WebSocket Programming

## Overview

Implement robust, high-performance WebSocket connections for Nostr relays following RFC 6455 specifications and battle-tested production patterns. This skill provides comprehensive guidance on WebSocket protocol fundamentals, connection management, message handling, and language-specific implementation strategies using proven codebases.

## Core WebSocket Protocol (RFC 6455)

### Connection Upgrade Handshake

The WebSocket connection begins with an HTTP upgrade request:

**Client Request Headers:**

- `Upgrade: websocket` - Required
- `Connection: Upgrade` - Required
- `Sec-WebSocket-Key` - 16-byte random value, base64-encoded
- `Sec-WebSocket-Version: 13` - Required
- `Origin` - Required for browser clients (security)

**Server Response (HTTP 101):**

- `HTTP/1.1 101 Switching Protocols`
- `Upgrade: websocket`
- `Connection: Upgrade`
- `Sec-WebSocket-Accept` - SHA-1(client_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"), base64-encoded

**Security validation:** Always verify the `Sec-WebSocket-Accept` value matches expected computation. Reject connections with missing or incorrect values.

### Frame Structure

WebSocket frames use binary encoding with variable-length fields:

**Header (minimum 2 bytes):**

- **FIN bit** (1 bit) - Final fragment indicator
- **RSV1-3** (3 bits) - Reserved for extensions (must be 0)
- **Opcode** (4 bits) - Frame type identifier
- **MASK bit** (1 bit) - Payload masking indicator
- **Payload length** (7, 7+16, or 7+64 bits) - Variable encoding

**Payload length encoding:**

- 0-125: Direct 7-bit value
- 126: Next 16 bits contain length
- 127: Next 64 bits contain length

### Frame Opcodes

**Data Frames:**

- `0x0` - Continuation frame
- `0x1` - Text frame (UTF-8)
- `0x2` - Binary frame

**Control Frames:**

- `0x8` - Connection close
- `0x9` - Ping
- `0xA` - Pong

**Control frame constraints:**

- Maximum 125-byte payload
- Cannot be fragmented
- Must be processed immediately

### Masking Requirements

**Critical security requirement:**

- Client-to-server frames MUST be masked
- Server-to-client frames MUST NOT be masked
- Masking uses XOR with 4-byte random key
- Prevents cache poisoning and intermediary attacks

**Masking algorithm:**

```
transformed[i] = original[i] XOR masking_key[i MOD 4]
```

### Ping/Pong Keep-Alive

**Purpose:** Detect broken connections and maintain NAT traversal

**Pattern:**

1. Either endpoint sends Ping (0x9) with optional payload
2. Recipient responds with Pong (0xA) containing identical payload
3. Implement timeouts to detect unresponsive connections

**Nostr relay recommendations:**

- Send pings every 30-60 seconds
- Timeout after 60-120 seconds without pong response
- Close connections exceeding timeout threshold

### Close Handshake

**Initiation:** Either peer sends Close frame (0x8)

**Close frame structure:**

- Optional 2-byte status code
- Optional UTF-8 reason string

**Common status codes:**

- `1000` - Normal closure
- `1001` - Going away (server shutdown/navigation)
- `1002` - Protocol error
- `1003` - Unsupported data type
- `1006` - Abnormal closure (no close frame)
- `1011` - Server error

**Proper shutdown sequence:**

1. Initiator sends Close frame
2. Recipient responds with Close frame
3. Both close TCP connection

## Nostr Relay WebSocket Architecture

### Message Flow Overview

```
Client                    Relay
  |                         |
  |--- HTTP Upgrade ------->|
  |<-- 101 Switching -------|
  |                         |
  |--- ["EVENT", {...}] --->|  (Validate, store, broadcast)
  |<-- ["OK", id, ...] -----|
  |                         |
  |--- ["REQ", id, {...}]-->|  (Query + subscribe)
  |<-- ["EVENT", id, {...}]-|  (Stored events)
  |<-- ["EOSE", id] --------|  (End of stored)
  |<-- ["EVENT", id, {...}]-|  (Real-time events)
  |                         |
  |--- ["CLOSE", id] ------>|  (Unsubscribe)
  |                         |
  |--- Close Frame -------->|
  |<-- Close Frame ---------|
```

### Critical Concurrency Considerations

**Write concurrency:** WebSocket libraries panic/error on concurrent writes. Always protect writes with:

- Mutex locks (Go, C++)
- Single-writer goroutine/thread pattern
- Message queue with dedicated sender

**Read concurrency:** Concurrent reads generally allowed but not useful - implement single reader loop per connection.

**Subscription management:** Concurrent access to subscription maps requires synchronization or lock-free data structures.

## Language-Specific Implementation Patterns

### Go Implementation (khatru-style)

**Recommended library:** `github.com/fasthttp/websocket`

**Connection structure:**

```go
type WebSocket struct {
    conn   *websocket.Conn
    mutex  sync.Mutex          // Protects writes

    Request *http.Request      // Original HTTP request
    Context context.Context    // Cancellation context
    cancel  context.CancelFunc

    // NIP-42 authentication
    Challenge       string
    AuthedPublicKey string

    // Concurrent session management
    negentropySessions *xsync.MapOf[string, *NegentropySession]
}

// Thread-safe write
func (ws *WebSocket) WriteJSON(v any) error {
    ws.mutex.Lock()
    defer ws.mutex.Unlock()
    return ws.conn.WriteJSON(v)
}
```

**Lifecycle pattern (dual goroutines):**

```go
// Read goroutine
go func() {
    defer cleanup()

    ws.conn.SetReadLimit(maxMessageSize)
    ws.conn.SetReadDeadline(time.Now().Add(pongWait))
    ws.conn.SetPongHandler(func(string) error {
        ws.conn.SetReadDeadline(time.Now().Add(pongWait))
        return nil
    })

    for {
        typ, msg, err := ws.conn.ReadMessage()
        if err != nil {
            return  // Connection closed
        }

        if typ == websocket.PingMessage {
            ws.WriteMessage(websocket.PongMessage, nil)
            continue
        }

        // Parse and handle message in separate goroutine
        go handleMessage(msg)
    }
}()

// Write/ping goroutine
go func() {
    defer cleanup()
    ticker := time.NewTicker(pingPeriod)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
                return
            }
        }
    }
}()
```

**Key patterns:**

- **Mutex-protected writes** - Prevent concurrent write panics
- **Context-based lifecycle** - Clean cancellation hierarchy
- **Swap-delete for subscriptions** - O(1) removal from listener arrays
- **Zero-copy string conversion** - `unsafe.String()` for message parsing
- **Goroutine-per-message** - Sequential parsing, concurrent handling
- **Hook-based extensibility** - Plugin architecture without core modifications

**Configuration constants:**

```go
WriteWait:      10 * time.Second   // Write timeout
PongWait:       60 * time.Second   // Pong timeout
PingPeriod:     30 * time.Second   // Ping interval (< PongWait)
MaxMessageSize: 512000             // 512 KB limit
```

**Subscription management:**

```go
type listenerSpec struct {
    id       string
    cancel   context.CancelCauseFunc
    index    int
    subrelay *Relay
}

// Efficient removal with swap-delete
func (rl *Relay) removeListenerId(ws *WebSocket, id string) {
    rl.clientsMutex.Lock()
    defer rl.clientsMutex.Unlock()

    if specs, ok := rl.clients[ws]; ok {
        for i := len(specs) - 1; i >= 0; i-- {
            if specs[i].id == id {
                specs[i].cancel(ErrSubscriptionClosedByClient)
                specs[i] = specs[len(specs)-1]
                specs = specs[:len(specs)-1]
                rl.clients[ws] = specs
                break
            }
        }
    }
}
```

For detailed khatru implementation examples, see [references/khatru_implementation.md](references/khatru_implementation.md).

### C++ Implementation (strfry-style)

**Recommended library:** Custom fork of `uWebSockets` with epoll

**Architecture highlights:**

- Single-threaded I/O using epoll for connection multiplexing
- Thread pool architecture: 6 specialized pools (WebSocket, Ingester, Writer, ReqWorker, ReqMonitor, Negentropy)
- "Shared nothing" message-passing design eliminates lock contention
- Deterministic thread assignment: `connId % numThreads`

**Connection structure:**

```cpp
struct ConnectionState {
    uint64_t connId;
    std::string remoteAddr;
    flat_str subId;              // Subscription ID
    std::shared_ptr<Subscription> sub;
    PerMessageDeflate pmd;       // Compression state
    uint64_t latestEventSent = 0;

    // Message parsing state
    secp256k1_context *secpCtx;
    std::string parseBuffer;
};
```

**Message handling pattern:**

```cpp
// WebSocket message callback
ws->onMessage([=](std::string_view msg, uWS::OpCode opCode) {
    // Reuse buffer to avoid allocations
    state->parseBuffer.assign(msg.data(), msg.size());

    try {
        auto json = nlohmann::json::parse(state->parseBuffer);
        auto cmdStr = json[0].get<std::string>();

        if (cmdStr == "EVENT") {
            // Send to Ingester thread pool
            auto packed = MsgIngester::Message(connId, std::move(json));
            tpIngester->dispatchToThread(connId, std::move(packed));
        }
        else if (cmdStr == "REQ") {
            // Send to ReqWorker thread pool
            auto packed = MsgReq::Message(connId, std::move(json));
            tpReqWorker->dispatchToThread(connId, std::move(packed));
        }
    } catch (std::exception &e) {
        sendNotice("Error: " + std::string(e.what()));
    }
});
```

**Critical performance optimizations:**

1. **Event batching** - Serialize event JSON once, reuse for thousands of subscribers:

```cpp
// Single serialization
std::string eventJson = event.toJson();

// Broadcast to all matching subscriptions
for (auto &[connId, sub] : activeSubscriptions) {
    if (sub->matches(event)) {
        sendToConnection(connId, eventJson);  // Reuse serialized JSON
    }
}
```

2. **Move semantics** - Zero-copy message passing:

```cpp
tpIngester->dispatchToThread(connId, std::move(message));
```

3. **Pre-allocated buffers** - Single reusable buffer per connection:

```cpp
state->parseBuffer.assign(msg.data(), msg.size());
```

4. **std::variant dispatch** - Type-safe without virtual function overhead:

```cpp
std::variant<MsgReq, MsgIngester, MsgWriter> message;
std::visit([](auto&& msg) { msg.handle(); }, message);
```

For detailed strfry implementation examples, see [references/strfry_implementation.md](references/strfry_implementation.md).

### Rust Implementation (nostr-rs-relay-style)

**Recommended libraries:**

- `tokio-tungstenite 0.17` - Async WebSocket support
- `tokio 1.x` - Async runtime
- `serde_json` - Message parsing

**WebSocket configuration:**

```rust
let config = WebSocketConfig {
    max_send_queue: Some(1024),
    max_message_size: settings.limits.max_ws_message_bytes,
    max_frame_size: settings.limits.max_ws_frame_bytes,
    ..Default::default()
};

let ws_stream = WebSocketStream::from_raw_socket(
    upgraded,
    Role::Server,
    Some(config),
).await;
```

**Connection state:**

```rust
pub struct ClientConn {
    client_ip_addr: String,
    client_id: Uuid,
    subscriptions: HashMap<String, Subscription>,
    max_subs: usize,
    auth: Nip42AuthState,
}

pub enum Nip42AuthState {
    NoAuth,
    Challenge(String),
    AuthPubkey(String),
}
```

**Async message loop with tokio::select!:**

```rust
async fn nostr_server(
    repo: Arc<dyn NostrRepo>,
    mut ws_stream: WebSocketStream<Upgraded>,
    broadcast: Sender<Event>,
    mut shutdown: Receiver<()>,
) {
    let mut conn = ClientConn::new(client_ip);
    let mut bcast_rx = broadcast.subscribe();
    let mut ping_interval = tokio::time::interval(Duration::from_secs(300));

    loop {
        tokio::select! {
            // Handle shutdown
            _ = shutdown.recv() => { break; }

            // Send periodic pings
            _ = ping_interval.tick() => {
                ws_stream.send(Message::Ping(Vec::new())).await.ok();
            }

            // Handle broadcast events (real-time)
            Ok(event) = bcast_rx.recv() => {
                for (id, sub) in conn.subscriptions() {
                    if sub.interested_in_event(&event) {
                        let msg = format!("[\"EVENT\",\"{}\",{}]", id,
                                         serde_json::to_string(&event)?);
                        ws_stream.send(Message::Text(msg)).await.ok();
                    }
                }
            }

            // Handle incoming client messages
            Some(result) = ws_stream.next() => {
                match result {
                    Ok(Message::Text(msg)) => {
                        handle_nostr_message(&msg, &mut conn).await;
                    }
                    Ok(Message::Binary(_)) => {
                        send_notice("binary messages not accepted").await;
                    }
                    Ok(Message::Ping(_) | Message::Pong(_)) => {
                        continue;  // Auto-handled by tungstenite
                    }
                    Ok(Message::Close(_)) | Err(_) => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}
```

**Subscription filtering:**

```rust
pub struct ReqFilter {
    pub ids: Option<Vec<String>>,
    pub kinds: Option<Vec<u64>>,
    pub since: Option<u64>,
    pub until: Option<u64>,
    pub authors: Option<Vec<String>>,
    pub limit: Option<u64>,
    pub tags: Option<HashMap<char, HashSet<String>>>,
}

impl ReqFilter {
    pub fn interested_in_event(&self, event: &Event) -> bool {
        self.ids_match(event)
            && self.since.map_or(true, |t| event.created_at >= t)
            && self.until.map_or(true, |t| event.created_at <= t)
            && self.kind_match(event.kind)
            && self.authors_match(event)
            && self.tag_match(event)
    }

    fn ids_match(&self, event: &Event) -> bool {
        self.ids.as_ref()
            .map_or(true, |ids| ids.iter().any(|id| event.id.starts_with(id)))
    }
}
```

**Error handling:**

```rust
match ws_stream.next().await {
    Some(Ok(Message::Text(msg))) => { /* handle */ }

    Some(Err(WsError::Capacity(MessageTooLong{size, max_size}))) => {
        send_notice(&format!("message too large ({} > {})", size, max_size)).await;
        continue;
    }

    None | Some(Ok(Message::Close(_))) => {
        info!("client closed connection");
        break;
    }

    Some(Err(WsError::Io(e))) => {
        warn!("IO error: {:?}", e);
        break;
    }

    _ => { break; }
}
```

For detailed Rust implementation examples, see [references/rust_implementation.md](references/rust_implementation.md).

## Common Implementation Patterns

### Pattern 1: Dual Goroutine/Task Architecture

**Purpose:** Separate read and write concerns, enable ping/pong management

**Structure:**

- **Reader goroutine/task:** Blocks on `ReadMessage()`, handles incoming frames
- **Writer goroutine/task:** Sends periodic pings, processes outgoing message queue

**Benefits:**

- Natural separation of concerns
- Ping timer doesn't block message processing
- Clean shutdown coordination via context/channels

### Pattern 2: Subscription Lifecycle

**Create subscription (REQ):**

1. Parse filter from client message
2. Query database for matching stored events
3. Send stored events to client
4. Send EOSE (End of Stored Events)
5. Add subscription to active listeners for real-time events

**Handle real-time event:**

1. Check all active subscriptions
2. For each matching subscription:
   - Apply filter matching logic
   - Send EVENT message to client
3. Track broadcast count for monitoring

**Close subscription (CLOSE):**

1. Find subscription by ID
2. Cancel subscription context
3. Remove from active listeners
4. Clean up resources

### Pattern 3: Write Serialization

**Problem:** Concurrent writes cause panics/errors in WebSocket libraries

**Solutions:**

**Mutex approach (Go, C++):**

```go
func (ws *WebSocket) WriteJSON(v any) error {
    ws.mutex.Lock()
    defer ws.mutex.Unlock()
    return ws.conn.WriteJSON(v)
}
```

**Single-writer goroutine (Alternative):**

```go
type writeMsg struct {
    data []byte
    done chan error
}

go func() {
    for msg := range writeChan {
        msg.done <- ws.conn.WriteMessage(websocket.TextMessage, msg.data)
    }
}()
```

### Pattern 4: Connection Cleanup

**Essential cleanup steps:**

1. Cancel all subscription contexts
2. Stop ping ticker/interval
3. Remove connection from active clients map
4. Close WebSocket connection
5. Close TCP connection
6. Log connection statistics

**Go cleanup function:**

```go
kill := func() {
    // Cancel contexts
    cancel()
    ws.cancel()

    // Stop timers
    ticker.Stop()

    // Remove from tracking
    rl.removeClientAndListeners(ws)

    // Close connection
    ws.conn.Close()

    // Trigger hooks
    for _, ondisconnect := range rl.OnDisconnect {
        ondisconnect(ctx)
    }
}
defer kill()
```

### Pattern 5: Event Broadcasting Optimization

**Naive approach (inefficient):**

```go
// DON'T: Serialize for each subscriber
for _, listener := range listeners {
    if listener.filter.Matches(event) {
        json := serializeEvent(event)  // Repeated work!
        listener.ws.WriteJSON(json)
    }
}
```

**Optimized approach:**

```go
// DO: Serialize once, reuse for all subscribers
eventJSON, err := json.Marshal(event)
if err != nil {
    return
}

for _, listener := range listeners {
    if listener.filter.Matches(event) {
        listener.ws.WriteMessage(websocket.TextMessage, eventJSON)
    }
}
```

**Savings:** For 1000 subscribers, reduces 1000 JSON serializations to 1.

## Security Considerations

### Origin Validation

Always validate the `Origin` header for browser-based clients:

```go
upgrader := websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        origin := r.Header.Get("Origin")
        return isAllowedOrigin(origin)  // Implement allowlist
    },
}
```

**Default behavior:** Most libraries reject all cross-origin connections. Override with caution.

### Rate Limiting

Implement rate limits for:

- Connection establishment (per IP)
- Message throughput (per connection)
- Subscription creation (per connection)
- Event publication (per connection, per pubkey)

```go
// Example: Connection rate limiting
type rateLimiter struct {
    connections map[string]*rate.Limiter
    mu          sync.Mutex
}

func (rl *Relay) checkRateLimit(ip string) bool {
    limiter := rl.rateLimiter.getLimiter(ip)
    return limiter.Allow()
}
```

### Message Size Limits

Configure limits to prevent memory exhaustion:

```go
ws.conn.SetReadLimit(maxMessageSize)  // e.g., 512 KB
```

```rust
max_message_size: Some(512_000),
max_frame_size: Some(16_384),
```

### Subscription Limits

Prevent resource exhaustion:

- Max subscriptions per connection (typically 10-20)
- Max subscription ID length (prevent hash collision attacks)
- Require specific filters (prevent full database scans)

```rust
const MAX_SUBSCRIPTION_ID_LEN: usize = 256;
const MAX_SUBS_PER_CLIENT: usize = 20;

if subscriptions.len() >= MAX_SUBS_PER_CLIENT {
    return Err(Error::SubMaxExceededError);
}
```

### Authentication (NIP-42)

Implement challenge-response authentication:

1. **Generate challenge on connect:**

```go
challenge := make([]byte, 8)
rand.Read(challenge)
ws.Challenge = hex.EncodeToString(challenge)
```

2. **Send AUTH challenge when required:**

```json
["AUTH", "<challenge>"]
```

3. **Validate AUTH event:**

```go
func validateAuthEvent(event *Event, challenge, relayURL string) bool {
    // Check kind 22242
    if event.Kind != 22242 { return false }

    // Check challenge in tags
    if !hasTag(event, "challenge", challenge) { return false }

    // Check relay URL
    if !hasTag(event, "relay", relayURL) { return false }

    // Check timestamp (within 10 minutes)
    if abs(time.Now().Unix() - event.CreatedAt) > 600 { return false }

    // Verify signature
    return event.CheckSignature()
}
```

## Performance Optimization Techniques

### 1. Connection Pooling

Reuse connections for database queries:

```go
db, _ := sql.Open("postgres", dsn)
db.SetMaxOpenConns(25)
db.SetMaxIdleConns(5)
db.SetConnMaxLifetime(5 * time.Minute)
```

### 2. Event Caching

Cache frequently accessed events:

```go
type EventCache struct {
    cache *lru.Cache
    mu    sync.RWMutex
}

func (ec *EventCache) Get(id string) (*Event, bool) {
    ec.mu.RLock()
    defer ec.mu.RUnlock()
    if val, ok := ec.cache.Get(id); ok {
        return val.(*Event), true
    }
    return nil, false
}
```

### 3. Batch Database Queries

Execute queries concurrently for multi-filter subscriptions:

```go
var wg sync.WaitGroup
for _, filter := range filters {
    wg.Add(1)
    go func(f Filter) {
        defer wg.Done()
        events := queryDatabase(f)
        sendEvents(events)
    }(filter)
}
wg.Wait()
sendEOSE()
```

### 4. Compression (permessage-deflate)

Enable WebSocket compression for text frames:

```go
upgrader := websocket.Upgrader{
    EnableCompression: true,
}
```

**Typical savings:** 60-80% bandwidth reduction for JSON messages

**Trade-off:** Increased CPU usage (usually worthwhile)

### 5. Monitoring and Metrics

Track key performance indicators:

- Connections (active, total, per IP)
- Messages (received, sent, per type)
- Events (stored, broadcast, per second)
- Subscriptions (active, per connection)
- Query latency (p50, p95, p99)
- Database pool utilization

```go
// Prometheus-style metrics
type Metrics struct {
    Connections    prometheus.Gauge
    MessagesRecv   prometheus.Counter
    MessagesSent   prometheus.Counter
    EventsStored   prometheus.Counter
    QueryDuration  prometheus.Histogram
}
```

## Testing WebSocket Implementations

### Unit Testing

Test individual components in isolation:

```go
func TestFilterMatching(t *testing.T) {
    filter := Filter{
        Kinds: []int{1, 3},
        Authors: []string{"abc123"},
    }

    event := &Event{
        Kind: 1,
        PubKey: "abc123",
    }

    if !filter.Matches(event) {
        t.Error("Expected filter to match event")
    }
}
```

### Integration Testing

Test WebSocket connection handling:

```go
func TestWebSocketConnection(t *testing.T) {
    // Start test server
    server := startTestRelay(t)
    defer server.Close()

    // Connect client
    ws, _, err := websocket.DefaultDialer.Dial(server.URL, nil)
    if err != nil {
        t.Fatalf("Failed to connect: %v", err)
    }
    defer ws.Close()

    // Send REQ
    req := `["REQ","test",{"kinds":[1]}]`
    if err := ws.WriteMessage(websocket.TextMessage, []byte(req)); err != nil {
        t.Fatalf("Failed to send REQ: %v", err)
    }

    // Read EOSE
    _, msg, err := ws.ReadMessage()
    if err != nil {
        t.Fatalf("Failed to read message: %v", err)
    }

    if !strings.Contains(string(msg), "EOSE") {
        t.Errorf("Expected EOSE, got: %s", msg)
    }
}
```

### Load Testing

Use tools like `websocat` or custom scripts:

```bash
# Connect 1000 concurrent clients
for i in {1..1000}; do
    (websocat "ws://localhost:8080" <<< '["REQ","test",{"kinds":[1]}]' &)
done
```

Monitor server metrics during load testing:

- CPU usage
- Memory consumption
- Connection count
- Message throughput
- Database query rate

## Debugging and Troubleshooting

### Common Issues

**1. Concurrent write panic/error**

**Symptom:** `concurrent write to websocket connection` error

**Solution:** Ensure all writes protected by mutex or use single-writer pattern

**2. Connection timeouts**

**Symptom:** Connections close after 60 seconds

**Solution:** Implement ping/pong mechanism properly:

```go
ws.SetPongHandler(func(string) error {
    ws.SetReadDeadline(time.Now().Add(pongWait))
    return nil
})
```

**3. Memory leaks**

**Symptom:** Memory usage grows over time

**Common causes:**

- Subscriptions not removed on disconnect
- Event channels not closed
- Goroutines not terminated

**Solution:** Ensure cleanup function called on disconnect

**4. Slow subscription queries**

**Symptom:** EOSE delayed by seconds

**Solution:**

- Add database indexes on filtered columns
- Implement query timeouts
- Consider caching frequently accessed events

### Logging Best Practices

Log critical events with context:

```go
log.Printf(
    "connection closed: cid=%s ip=%s duration=%v sent=%d recv=%d",
    conn.ID,
    conn.IP,
    time.Since(conn.ConnectedAt),
    conn.EventsSent,
    conn.EventsRecv,
)
```

Use log levels appropriately:

- **DEBUG:** Message parsing, filter matching
- **INFO:** Connection lifecycle, subscription changes
- **WARN:** Rate limit violations, invalid messages
- **ERROR:** Database errors, unexpected panics

## Resources

This skill includes comprehensive reference documentation with production code examples:

### references/

- **websocket_protocol.md** - Complete RFC 6455 specification details including frame structure, opcodes, masking algorithm, and security considerations
- **khatru_implementation.md** - Go WebSocket patterns from khatru including connection lifecycle, subscription management, and performance optimizations (3000+ lines)
- **strfry_implementation.md** - C++ high-performance patterns from strfry including thread pool architecture, message batching, and zero-copy techniques (2000+ lines)
- **rust_implementation.md** - Rust async patterns from nostr-rs-relay including tokio::select! usage, error handling, and subscription filtering (2000+ lines)

Load these references when implementing specific language solutions or troubleshooting complex WebSocket issues.
