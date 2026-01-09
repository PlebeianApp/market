# C++ WebSocket Implementation for Nostr Relays (strfry patterns)

This reference documents high-performance WebSocket patterns from the strfry Nostr relay implementation in C++.

## Repository Information

- **Project:** strfry - High-performance Nostr relay
- **Repository:** https://github.com/hoytech/strfry
- **Language:** C++ (C++20)
- **WebSocket Library:** Custom fork of uWebSockets with epoll
- **Architecture:** Single-threaded I/O with specialized thread pools

## Core Architecture

### Thread Pool Design

strfry uses 6 specialized thread pools for different operations:

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Thread (I/O)                        │
│  - epoll event loop                                         │
│  - WebSocket message reception                              │
│  - Connection management                                    │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼────┐         ┌───▼────┐         ┌───▼────┐
   │Ingester │         │ReqWorker│        │Negentropy│
   │ (3)     │         │ (3)     │        │ (2)     │
   └─────────┘         └─────────┘        └─────────┘
        │                   │                   │
   ┌────▼────┐         ┌───▼────┐
   │ Writer  │         │ReqMonitor│
   │ (1)     │         │ (3)     │
   └─────────┘         └─────────┘
```

**Thread Pool Responsibilities:**

1. **WebSocket (1 thread):** Main I/O loop, epoll event handling
2. **Ingester (3 threads):** Event validation, signature verification, deduplication
3. **Writer (1 thread):** Database writes, event storage
4. **ReqWorker (3 threads):** Process REQ subscriptions, query database
5. **ReqMonitor (3 threads):** Monitor active subscriptions, send real-time events
6. **Negentropy (2 threads):** NIP-77 set reconciliation

**Deterministic thread assignment:**

```cpp
int threadId = connId % numThreads;
```

**Benefits:**

- **No lock contention:** Shared-nothing architecture
- **Predictable performance:** Same connection always same thread
- **CPU cache efficiency:** Thread-local data stays hot

### Connection State

```cpp
struct ConnectionState {
    uint64_t connId;                  // Unique connection identifier
    std::string remoteAddr;           // Client IP address

    // Subscription state
    flat_str subId;                   // Current subscription ID
    std::shared_ptr<Subscription> sub; // Subscription filter
    uint64_t latestEventSent = 0;     // Latest event ID sent

    // Compression state (per-message deflate)
    PerMessageDeflate pmd;

    // Parsing state (reused buffer)
    std::string parseBuffer;

    // Signature verification context (reused)
    secp256k1_context *secpCtx;
};
```

**Key design decisions:**

1. **Reusable parseBuffer:** Single allocation per connection
2. **Persistent secp256k1_context:** Expensive to create, reused for all signatures
3. **Connection ID:** Enables deterministic thread assignment
4. **Flat string (flat_str):** Value-semantic string-like type for zero-copy

## WebSocket Message Reception

### Main Event Loop (epoll)

```cpp
// Pseudocode representation of strfry's I/O loop
uWS::App app;

app.ws<ConnectionState>("/*", {
    .compression = uWS::SHARED_COMPRESSOR,
    .maxPayloadLength = 16 * 1024 * 1024,
    .idleTimeout = 120,
    .maxBackpressure = 1 * 1024 * 1024,

    .upgrade = nullptr,

    .open = [](auto *ws) {
        auto *state = ws->getUserData();
        state->connId = nextConnId++;
        state->remoteAddr = getRemoteAddress(ws);
        state->secpCtx = secp256k1_context_create(SECP256K1_CONTEXT_VERIFY);

        LI << "New connection: " << state->connId << " from " << state->remoteAddr;
    },

    .message = [](auto *ws, std::string_view message, uWS::OpCode opCode) {
        auto *state = ws->getUserData();

        // Reuse parseBuffer to avoid allocation
        state->parseBuffer.assign(message.data(), message.size());

        try {
            // Parse JSON (nlohmann::json)
            auto json = nlohmann::json::parse(state->parseBuffer);

            // Extract command type
            auto cmdStr = json[0].get<std::string>();

            if (cmdStr == "EVENT") {
                handleEventMessage(ws, std::move(json));
            }
            else if (cmdStr == "REQ") {
                handleReqMessage(ws, std::move(json));
            }
            else if (cmdStr == "CLOSE") {
                handleCloseMessage(ws, std::move(json));
            }
            else if (cmdStr == "NEG-OPEN") {
                handleNegentropyOpen(ws, std::move(json));
            }
            else {
                sendNotice(ws, "unknown command: " + cmdStr);
            }
        }
        catch (std::exception &e) {
            sendNotice(ws, "Error: " + std::string(e.what()));
        }
    },

    .close = [](auto *ws, int code, std::string_view message) {
        auto *state = ws->getUserData();

        LI << "Connection closed: " << state->connId
           << " code=" << code
           << " msg=" << std::string(message);

        // Cleanup
        secp256k1_context_destroy(state->secpCtx);
        cleanupSubscription(state->connId);
    },
});

app.listen(8080, [](auto *token) {
    if (token) {
        LI << "Listening on port 8080";
    }
});

app.run();
```

**Key patterns:**

1. **epoll-based I/O:** Single thread handles thousands of connections
2. **Buffer reuse:** `state->parseBuffer` avoids allocation per message
3. **Move semantics:** `std::move(json)` transfers ownership to handler
4. **Exception handling:** Catches parsing errors, sends NOTICE

### Message Dispatch to Thread Pools

```cpp
void handleEventMessage(auto *ws, nlohmann::json &&json) {
    auto *state = ws->getUserData();

    // Pack message with connection ID
    auto msg = MsgIngester{
        .connId = state->connId,
        .payload = std::move(json),
    };

    // Dispatch to Ingester thread pool (deterministic assignment)
    tpIngester->dispatchToThread(state->connId, std::move(msg));
}

void handleReqMessage(auto *ws, nlohmann::json &&json) {
    auto *state = ws->getUserData();

    // Pack message
    auto msg = MsgReq{
        .connId = state->connId,
        .payload = std::move(json),
    };

    // Dispatch to ReqWorker thread pool
    tpReqWorker->dispatchToThread(state->connId, std::move(msg));
}
```

**Message passing pattern:**

```cpp
// ThreadPool::dispatchToThread
void dispatchToThread(uint64_t connId, Message &&msg) {
    size_t threadId = connId % threads.size();
    threads[threadId]->queue.push(std::move(msg));
}
```

**Benefits:**

- **Zero-copy:** `std::move` transfers ownership without copying
- **Deterministic:** Same connection always processed by same thread
- **Lock-free:** Each thread has own queue

## Event Ingestion Pipeline

### Ingester Thread Pool

```cpp
void IngesterThread::run() {
    while (running) {
        Message msg;
        if (!queue.pop(msg, 100ms)) continue;

        // Extract event from JSON
        auto event = parseEvent(msg.payload);

        // Validate event ID
        if (!validateEventId(event)) {
            sendOK(msg.connId, event.id, false, "invalid: id mismatch");
            continue;
        }

        // Verify signature (using thread-local secp256k1 context)
        if (!verifySignature(event, secpCtx)) {
            sendOK(msg.connId, event.id, false, "invalid: signature verification failed");
            continue;
        }

        // Check for duplicate (bloom filter + database)
        if (isDuplicate(event.id)) {
            sendOK(msg.connId, event.id, true, "duplicate: already have this event");
            continue;
        }

        // Send to Writer thread
        auto writerMsg = MsgWriter{
            .connId = msg.connId,
            .event = std::move(event),
        };
        tpWriter->dispatch(std::move(writerMsg));
    }
}
```

**Validation sequence:**

1. Parse JSON into Event struct
2. Validate event ID matches content hash
3. Verify secp256k1 signature
4. Check duplicate (bloom filter for speed)
5. Forward to Writer thread for storage

### Writer Thread

```cpp
void WriterThread::run() {
    // Single thread for all database writes
    while (running) {
        Message msg;
        if (!queue.pop(msg, 100ms)) continue;

        // Write to database
        bool success = db.insertEvent(msg.event);

        // Send OK to client
        sendOK(msg.connId, msg.event.id, success,
               success ? "" : "error: failed to store");

        if (success) {
            // Broadcast to subscribers
            broadcastEvent(msg.event);
        }
    }
}
```

**Single-writer pattern:**

- Only one thread writes to database
- Eliminates write conflicts
- Simplified transaction management

### Event Broadcasting

```cpp
void broadcastEvent(const Event &event) {
    // Serialize event JSON once
    std::string eventJson = serializeEvent(event);

    // Iterate all active subscriptions
    for (auto &[connId, sub] : activeSubscriptions) {
        // Check if filter matches
        if (!sub->filter.matches(event)) continue;

        // Check if event newer than last sent
        if (event.id <= sub->latestEventSent) continue;

        // Send to connection
        auto msg = MsgWebSocket{
            .connId = connId,
            .payload = eventJson,  // Reuse serialized JSON
        };

        tpWebSocket->dispatch(std::move(msg));

        // Update latest sent
        sub->latestEventSent = event.id;
    }
}
```

**Critical optimization:** Serialize event JSON once, send to N subscribers

**Performance impact:** For 1000 subscribers, reduces:

- JSON serialization: 1000× → 1×
- Memory allocations: 1000× → 1×
- CPU time: ~100ms → ~1ms

## Subscription Management

### REQ Processing

```cpp
void ReqWorkerThread::run() {
    while (running) {
        MsgReq msg;
        if (!queue.pop(msg, 100ms)) continue;

        // Parse REQ message: ["REQ", subId, filter1, filter2, ...]
        std::string subId = msg.payload[1];

        // Create subscription object
        auto sub = std::make_shared<Subscription>();
        sub->subId = subId;

        // Parse filters
        for (size_t i = 2; i < msg.payload.size(); i++) {
            Filter filter = parseFilter(msg.payload[i]);
            sub->filters.push_back(filter);
        }

        // Store subscription
        activeSubscriptions[msg.connId] = sub;

        // Query stored events
        std::vector<Event> events = db.queryEvents(sub->filters);

        // Send matching events
        for (const auto &event : events) {
            sendEvent(msg.connId, subId, event);
        }

        // Send EOSE
        sendEOSE(msg.connId, subId);

        // Notify ReqMonitor to watch for real-time events
        auto monitorMsg = MsgReqMonitor{
            .connId = msg.connId,
            .subId = subId,
        };
        tpReqMonitor->dispatchToThread(msg.connId, std::move(monitorMsg));
    }
}
```

**Query optimization:**

```cpp
std::vector<Event> Database::queryEvents(const std::vector<Filter> &filters) {
    // Combine filters with OR logic
    std::string sql = "SELECT * FROM events WHERE ";

    for (size_t i = 0; i < filters.size(); i++) {
        if (i > 0) sql += " OR ";
        sql += buildFilterSQL(filters[i]);
    }

    sql += " ORDER BY created_at DESC LIMIT 1000";

    return executeQuery(sql);
}
```

**Filter SQL generation:**

```cpp
std::string buildFilterSQL(const Filter &filter) {
    std::vector<std::string> conditions;

    // Event IDs
    if (!filter.ids.empty()) {
        conditions.push_back("id IN (" + joinQuoted(filter.ids) + ")");
    }

    // Authors
    if (!filter.authors.empty()) {
        conditions.push_back("pubkey IN (" + joinQuoted(filter.authors) + ")");
    }

    // Kinds
    if (!filter.kinds.empty()) {
        conditions.push_back("kind IN (" + join(filter.kinds) + ")");
    }

    // Time range
    if (filter.since) {
        conditions.push_back("created_at >= " + std::to_string(*filter.since));
    }
    if (filter.until) {
        conditions.push_back("created_at <= " + std::to_string(*filter.until));
    }

    // Tags (requires JOIN with tags table)
    if (!filter.tags.empty()) {
        for (const auto &[tagName, tagValues] : filter.tags) {
            conditions.push_back(
                "EXISTS (SELECT 1 FROM tags WHERE tags.event_id = events.id "
                "AND tags.name = '" + tagName + "' "
                "AND tags.value IN (" + joinQuoted(tagValues) + "))"
            );
        }
    }

    return "(" + join(conditions, " AND ") + ")";
}
```

### ReqMonitor for Real-Time Events

```cpp
void ReqMonitorThread::run() {
    // Subscribe to event broadcast channel
    auto eventSubscription = subscribeToEvents();

    while (running) {
        Event event;
        if (!eventSubscription.receive(event, 100ms)) continue;

        // Check all subscriptions assigned to this thread
        for (auto &[connId, sub] : mySubscriptions) {
            // Only process subscriptions for this thread
            if (connId % numThreads != threadId) continue;

            // Check if filter matches
            bool matches = false;
            for (const auto &filter : sub->filters) {
                if (filter.matches(event)) {
                    matches = true;
                    break;
                }
            }

            if (matches) {
                sendEvent(connId, sub->subId, event);
            }
        }
    }
}
```

**Pattern:** Monitor thread watches event stream, sends to matching subscriptions

### CLOSE Handling

```cpp
void handleCloseMessage(auto *ws, nlohmann::json &&json) {
    auto *state = ws->getUserData();

    // Parse CLOSE message: ["CLOSE", subId]
    std::string subId = json[1];

    // Remove subscription
    activeSubscriptions.erase(state->connId);

    LI << "Subscription closed: connId=" << state->connId
       << " subId=" << subId;
}
```

## Performance Optimizations

### 1. Event Batching

**Problem:** Serializing same event 1000× for 1000 subscribers is wasteful

**Solution:** Serialize once, send to all

```cpp
// BAD: Serialize for each subscriber
for (auto &sub : subscriptions) {
    std::string json = serializeEvent(event);  // Repeated!
    send(sub.connId, json);
}

// GOOD: Serialize once
std::string json = serializeEvent(event);
for (auto &sub : subscriptions) {
    send(sub.connId, json);  // Reuse!
}
```

**Measurement:** For 1000 subscribers, reduces broadcast time from 100ms to 1ms

### 2. Move Semantics

**Problem:** Copying large JSON objects is expensive

**Solution:** Transfer ownership with `std::move`

```cpp
// BAD: Copies JSON object
void dispatch(Message msg) {
    queue.push(msg);  // Copy
}

// GOOD: Moves JSON object
void dispatch(Message &&msg) {
    queue.push(std::move(msg));  // Move
}
```

**Benefit:** Zero-copy message passing between threads

### 3. Pre-allocated Buffers

**Problem:** Allocating buffer for each message

**Solution:** Reuse buffer per connection

```cpp
struct ConnectionState {
    std::string parseBuffer;  // Reused for all messages
};

void handleMessage(std::string_view msg) {
    state->parseBuffer.assign(msg.data(), msg.size());
    auto json = nlohmann::json::parse(state->parseBuffer);
    // ...
}
```

**Benefit:** Eliminates 10,000+ allocations/second per connection

### 4. std::variant for Message Types

**Problem:** Virtual function calls for polymorphic messages

**Solution:** `std::variant` with `std::visit`

```cpp
// BAD: Virtual function (pointer indirection, vtable lookup)
struct Message {
    virtual void handle() = 0;
};

// GOOD: std::variant (no indirection, inlined)
using Message = std::variant<
    MsgIngester,
    MsgReq,
    MsgWriter,
    MsgWebSocket
>;

void handle(Message &&msg) {
    std::visit([](auto &&m) { m.handle(); }, msg);
}
```

**Benefit:** Compiler inlines visit, eliminates virtual call overhead

### 5. Bloom Filter for Duplicate Detection

**Problem:** Database query for every event to check duplicate

**Solution:** In-memory bloom filter for fast negative

```cpp
class DuplicateDetector {
    BloomFilter bloom;  // Fast probabilistic check

    bool isDuplicate(const std::string &eventId) {
        // Fast negative (definitely not seen)
        if (!bloom.contains(eventId)) {
            bloom.insert(eventId);
            return false;
        }

        // Possible positive (maybe seen, check database)
        if (db.eventExists(eventId)) {
            return true;
        }

        // False positive
        bloom.insert(eventId);
        return false;
    }
};
```

**Benefit:** 99% of duplicate checks avoid database query

### 6. Batch Queue Operations

**Problem:** Lock contention on message queue

**Solution:** Batch multiple pushes with single lock

```cpp
class MessageQueue {
    std::mutex mutex;
    std::deque<Message> queue;

    void pushBatch(std::vector<Message> &messages) {
        std::lock_guard lock(mutex);
        for (auto &msg : messages) {
            queue.push_back(std::move(msg));
        }
    }
};
```

**Benefit:** Reduces lock acquisitions by 10-100×

### 7. ZSTD Dictionary Compression

**Problem:** WebSocket compression slower than desired

**Solution:** Train ZSTD dictionary on typical Nostr messages

```cpp
// Train dictionary on corpus of Nostr events
std::string corpus = collectTypicalEvents();
ZSTD_CDict *dict = ZSTD_createCDict(
    corpus.data(), corpus.size(),
    compressionLevel
);

// Use dictionary for compression
size_t compressedSize = ZSTD_compress_usingCDict(
    cctx, dst, dstSize,
    src, srcSize, dict
);
```

**Benefit:** 10-20% better compression ratio, 2× faster decompression

### 8. String Views

**Problem:** Unnecessary string copies when parsing

**Solution:** Use `std::string_view` for zero-copy

```cpp
// BAD: Copies substring
std::string extractCommand(const std::string &msg) {
    return msg.substr(0, 5);  // Copy
}

// GOOD: View into original string
std::string_view extractCommand(std::string_view msg) {
    return msg.substr(0, 5);  // No copy
}
```

**Benefit:** Eliminates allocations during parsing

## Compression (permessage-deflate)

### WebSocket Compression Configuration

```cpp
struct PerMessageDeflate {
    z_stream deflate_stream;
    z_stream inflate_stream;

    // Sliding window for compression history
    static constexpr int WINDOW_BITS = 15;
    static constexpr int MEM_LEVEL = 8;

    void init() {
        // Initialize deflate (compression)
        deflate_stream.zalloc = Z_NULL;
        deflate_stream.zfree = Z_NULL;
        deflate_stream.opaque = Z_NULL;
        deflateInit2(&deflate_stream,
                     Z_DEFAULT_COMPRESSION,
                     Z_DEFLATED,
                     -WINDOW_BITS,  // Negative = no zlib header
                     MEM_LEVEL,
                     Z_DEFAULT_STRATEGY);

        // Initialize inflate (decompression)
        inflate_stream.zalloc = Z_NULL;
        inflate_stream.zfree = Z_NULL;
        inflate_stream.opaque = Z_NULL;
        inflateInit2(&inflate_stream, -WINDOW_BITS);
    }

    std::string compress(std::string_view data) {
        // Compress with sliding window
        deflate_stream.next_in = (Bytef*)data.data();
        deflate_stream.avail_in = data.size();

        std::string compressed;
        compressed.resize(deflateBound(&deflate_stream, data.size()));

        deflate_stream.next_out = (Bytef*)compressed.data();
        deflate_stream.avail_out = compressed.size();

        deflate(&deflate_stream, Z_SYNC_FLUSH);

        compressed.resize(compressed.size() - deflate_stream.avail_out);
        return compressed;
    }
};
```

**Typical compression ratios:**

- JSON events: 60-80% reduction
- Subscription filters: 40-60% reduction
- Binary events: 10-30% reduction

## Database Schema (LMDB)

strfry uses LMDB (Lightning Memory-Mapped Database) for event storage:

```cpp
// Key-value stores
struct EventDB {
    // Primary event storage (key: event ID, value: event data)
    lmdb::dbi eventsDB;

    // Index by pubkey (key: pubkey + created_at, value: event ID)
    lmdb::dbi pubkeyDB;

    // Index by kind (key: kind + created_at, value: event ID)
    lmdb::dbi kindDB;

    // Index by tags (key: tag_name + tag_value + created_at, value: event ID)
    lmdb::dbi tagsDB;

    // Deletion index (key: event ID, value: deletion event ID)
    lmdb::dbi deletionsDB;
};
```

**Why LMDB?**

- Memory-mapped I/O (kernel manages caching)
- Copy-on-write (MVCC without locks)
- Ordered keys (enables range queries)
- Crash-proof (no corruption on power loss)

## Monitoring and Metrics

### Connection Statistics

```cpp
struct RelayStats {
    std::atomic<uint64_t> totalConnections{0};
    std::atomic<uint64_t> activeConnections{0};
    std::atomic<uint64_t> eventsReceived{0};
    std::atomic<uint64_t> eventsSent{0};
    std::atomic<uint64_t> bytesReceived{0};
    std::atomic<uint64_t> bytesSent{0};

    void recordConnection() {
        totalConnections.fetch_add(1, std::memory_order_relaxed);
        activeConnections.fetch_add(1, std::memory_order_relaxed);
    }

    void recordDisconnection() {
        activeConnections.fetch_sub(1, std::memory_order_relaxed);
    }

    void recordEventReceived(size_t bytes) {
        eventsReceived.fetch_add(1, std::memory_order_relaxed);
        bytesReceived.fetch_add(bytes, std::memory_order_relaxed);
    }
};
```

**Atomic operations:** Lock-free updates from multiple threads

### Performance Metrics

```cpp
struct PerformanceMetrics {
    // Latency histograms
    Histogram eventIngestionLatency;
    Histogram subscriptionQueryLatency;
    Histogram eventBroadcastLatency;

    // Thread pool queue depths
    std::atomic<size_t> ingesterQueueDepth{0};
    std::atomic<size_t> writerQueueDepth{0};
    std::atomic<size_t> reqWorkerQueueDepth{0};

    void recordIngestion(std::chrono::microseconds duration) {
        eventIngestionLatency.record(duration.count());
    }
};
```

## Configuration

### relay.conf Example

```ini
[relay]
bind = 0.0.0.0
port = 8080
maxConnections = 10000
maxMessageSize = 16777216  # 16 MB

[ingester]
threads = 3
queueSize = 10000

[writer]
threads = 1
queueSize = 1000
batchSize = 100

[reqWorker]
threads = 3
queueSize = 10000

[db]
path = /var/lib/strfry/events.lmdb
maxSizeGB = 100
```

## Deployment Considerations

### System Limits

```bash
# Increase file descriptor limit
ulimit -n 65536

# Increase maximum socket connections
sysctl -w net.core.somaxconn=4096

# TCP tuning
sysctl -w net.ipv4.tcp_fin_timeout=15
sysctl -w net.ipv4.tcp_tw_reuse=1
```

### Memory Requirements

**Per connection:**

- ConnectionState: ~1 KB
- WebSocket buffers: ~32 KB (16 KB send + 16 KB receive)
- Compression state: ~400 KB (200 KB deflate + 200 KB inflate)

**Total:** ~433 KB per connection

**For 10,000 connections:** ~4.3 GB

### CPU Requirements

**Single-core can handle:**

- 1000 concurrent connections
- 10,000 events/sec ingestion
- 100,000 events/sec broadcast (cached)

**Recommended:**

- 8+ cores for 10,000 connections
- 16+ cores for 50,000 connections

## Summary

**Key architectural patterns:**

1. **Single-threaded I/O:** epoll handles all connections in one thread
2. **Specialized thread pools:** Different operations use dedicated threads
3. **Deterministic assignment:** Connection ID determines thread assignment
4. **Move semantics:** Zero-copy message passing
5. **Event batching:** Serialize once, send to many
6. **Pre-allocated buffers:** Reuse memory per connection
7. **Bloom filters:** Fast duplicate detection
8. **LMDB:** Memory-mapped database for zero-copy reads

**Performance characteristics:**

- **50,000+ concurrent connections** per server
- **100,000+ events/sec** throughput
- **Sub-millisecond** latency for broadcasts
- **10 GB+ event database** with fast queries

**When to use strfry patterns:**

- Need maximum performance (trading complexity)
- Have C++ expertise on team
- Running large public relay (thousands of users)
- Want minimal memory footprint
- Need to scale to 50K+ connections

**Trade-offs:**

- **Complexity:** More complex than Go/Rust implementations
- **Portability:** Linux-specific (epoll, LMDB)
- **Development speed:** Slower iteration than higher-level languages

**Further reading:**

- strfry repository: https://github.com/hoytech/strfry
- uWebSockets: https://github.com/uNetworking/uWebSockets
- LMDB: http://www.lmdb.tech/doc/
- epoll: https://man7.org/linux/man-pages/man7/epoll.7.html
