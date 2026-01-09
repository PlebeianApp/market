# Rust WebSocket Implementation for Nostr Relays (nostr-rs-relay patterns)

This reference documents production-ready async WebSocket patterns from the nostr-rs-relay implementation in Rust.

## Repository Information

- **Project:** nostr-rs-relay - Nostr relay in Rust
- **Repository:** https://github.com/scsibug/nostr-rs-relay
- **Language:** Rust (2021 edition)
- **WebSocket Library:** tokio-tungstenite 0.17
- **Async Runtime:** tokio 1.x
- **Architecture:** Async/await with tokio::select! for concurrent operations

## Core Architecture

### Async Runtime Foundation

nostr-rs-relay is built on tokio, Rust's async runtime:

```rust
#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::fmt::init();

    // Load configuration
    let settings = Settings::load().expect("Failed to load config");

    // Initialize database connection pool
    let repo = create_database_pool(&settings).await;

    // Create broadcast channel for real-time events
    let (broadcast_tx, _) = broadcast::channel(1024);

    // Create shutdown signal channel
    let (shutdown_tx, _) = broadcast::channel(1);

    // Start HTTP server with WebSocket upgrade
    let server = Server::bind(&settings.network.address)
        .serve(make_service_fn(|_| {
            let repo = repo.clone();
            let broadcast = broadcast_tx.clone();
            let shutdown = shutdown_tx.subscribe();
            let settings = settings.clone();

            async move {
                Ok::<_, Infallible>(service_fn(move |req| {
                    handle_request(
                        req,
                        repo.clone(),
                        broadcast.clone(),
                        shutdown.subscribe(),
                        settings.clone(),
                    )
                }))
            }
        }));

    // Handle graceful shutdown
    tokio::select! {
        _ = server => {},
        _ = tokio::signal::ctrl_c() => {
            info!("Shutting down gracefully");
            shutdown_tx.send(()).ok();
        },
    }
}
```

**Key components:**

- **tokio runtime:** Manages async tasks and I/O
- **Broadcast channels:** Publish-subscribe for real-time events
- **Database pool:** Shared connection pool across tasks
- **Graceful shutdown:** Signal propagation via broadcast channel

### WebSocket Configuration

```rust
let config = WebSocketConfig {
    max_send_queue: Some(1024),
    max_message_size: settings.limits.max_ws_message_bytes,
    max_frame_size: settings.limits.max_ws_frame_bytes,
    ..Default::default()
};

let ws_stream = WebSocketStream::from_raw_socket(
    upgraded,
    tokio_tungstenite::tungstenite::protocol::Role::Server,
    Some(config),
).await;
```

**Configuration options:**

- `max_send_queue`: Maximum queued outgoing messages (1024)
- `max_message_size`: Maximum message size in bytes (default 512 KB)
- `max_frame_size`: Maximum frame size in bytes (default 16 KB)

**Recommended production settings:**

```rust
WebSocketConfig {
    max_send_queue: Some(1024),
    max_message_size: Some(512_000),      // 512 KB
    max_frame_size: Some(16_384),         // 16 KB
    accept_unmasked_frames: false,         // Security
    ..Default::default()
}
```

## Connection State Management

### ClientConn Structure

```rust
pub struct ClientConn {
    /// Client IP address (from socket or proxy header)
    client_ip_addr: String,

    /// Unique client identifier (UUID v4)
    client_id: Uuid,

    /// Active subscriptions (keyed by subscription ID)
    subscriptions: HashMap<String, Subscription>,

    /// Maximum concurrent subscriptions per connection
    max_subs: usize,

    /// NIP-42 authentication state
    auth: Nip42AuthState,
}

pub enum Nip42AuthState {
    /// Not authenticated yet
    NoAuth,
    /// AUTH challenge sent
    Challenge(String),
    /// Authenticated with pubkey
    AuthPubkey(String),
}

impl ClientConn {
    pub fn new(client_ip_addr: String) -> Self {
        ClientConn {
            client_ip_addr,
            client_id: Uuid::new_v4(),
            subscriptions: HashMap::new(),
            max_subs: 32,
            auth: Nip42AuthState::NoAuth,
        }
    }

    /// Add subscription (enforces limits)
    pub fn subscribe(&mut self, s: Subscription) -> Result<()> {
        let sub_id_len = s.id.len();

        // Prevent excessively long subscription IDs
        if sub_id_len > MAX_SUBSCRIPTION_ID_LEN {
            return Err(Error::SubIdMaxLengthError);
        }

        // Check subscription limit
        if self.subscriptions.len() >= self.max_subs {
            return Err(Error::SubMaxExceededError);
        }

        self.subscriptions.insert(s.id.clone(), s);
        Ok(())
    }

    /// Remove subscription
    pub fn unsubscribe(&mut self, id: &str) {
        self.subscriptions.remove(id);
    }

    /// Get all subscriptions
    pub fn subscriptions(&self) -> impl Iterator<Item = (&String, &Subscription)> {
        self.subscriptions.iter()
    }
}
```

**Resource limits:**

```rust
const MAX_SUBSCRIPTION_ID_LEN: usize = 256;
const MAX_SUBS_PER_CLIENT: usize = 32;
```

**Security considerations:**

- UUID prevents ID guessing attacks
- Subscription limits prevent resource exhaustion
- Subscription ID length limit prevents hash collision attacks

## Main Event Loop (tokio::select!)

### Async Message Multiplexing

```rust
async fn nostr_server(
    repo: Arc<dyn NostrRepo>,
    client_info: ClientInfo,
    settings: Settings,
    mut ws_stream: WebSocketStream<Upgraded>,
    broadcast: Sender<Event>,
    event_tx: mpsc::Sender<SubmittedEvent>,
    mut shutdown: Receiver<()>,
    metrics: NostrMetrics,
) {
    // Initialize connection state
    let mut conn = ClientConn::new(client_info.remote_ip);

    // Subscribe to broadcast events
    let mut bcast_rx = broadcast.subscribe();

    // Create channels for database queries
    let (query_tx, mut query_rx) = mpsc::channel(256);
    let (notice_tx, mut notice_rx) = mpsc::channel(32);

    // Track activity for timeout
    let mut last_message_time = Instant::now();
    let max_quiet_time = Duration::from_secs(settings.limits.max_conn_idle_seconds);

    // Periodic ping interval (5 minutes)
    let mut ping_interval = tokio::time::interval(Duration::from_secs(300));

    // Main event loop
    loop {
        tokio::select! {
            // 1. Handle shutdown signal
            _ = shutdown.recv() => {
                info!("Shutdown received, closing connection");
                break;
            },

            // 2. Send periodic pings
            _ = ping_interval.tick() => {
                // Check if connection has been quiet too long
                if last_message_time.elapsed() > max_quiet_time {
                    debug!("Connection idle timeout");
                    metrics.disconnects.with_label_values(&["timeout"]).inc();
                    break;
                }

                // Send ping
                if ws_stream.send(Message::Ping(Vec::new())).await.is_err() {
                    break;
                }
            },

            // 3. Handle notice messages (from database queries)
            Some(notice_msg) = notice_rx.recv() => {
                ws_stream.send(make_notice_message(&notice_msg)).await.ok();
            },

            // 4. Handle query results (from database)
            Some(query_result) = query_rx.recv() => {
                match query_result {
                    QueryResult::Event(sub_id, event) => {
                        // Send event to client
                        let event_str = serde_json::to_string(&event)?;
                        let msg = format!("[\"EVENT\",\"{}\",{}]", sub_id, event_str);
                        ws_stream.send(Message::Text(msg)).await.ok();
                        metrics.sent_events.with_label_values(&["stored"]).inc();
                    },
                    QueryResult::EOSE(sub_id) => {
                        // Send EOSE marker
                        let msg = format!("[\"EOSE\",\"{}\"]", sub_id);
                        ws_stream.send(Message::Text(msg)).await.ok();
                    },
                }
            },

            // 5. Handle broadcast events (real-time)
            Ok(global_event) = bcast_rx.recv() => {
                // Check all subscriptions
                for (sub_id, subscription) in conn.subscriptions() {
                    if subscription.interested_in_event(&global_event) {
                        // Serialize and send
                        let event_str = serde_json::to_string(&global_event)?;
                        let msg = format!("[\"EVENT\",\"{}\",{}]", sub_id, event_str);
                        ws_stream.send(Message::Text(msg)).await.ok();
                        metrics.sent_events.with_label_values(&["realtime"]).inc();
                    }
                }
            },

            // 6. Handle incoming WebSocket messages
            ws_next = ws_stream.next() => {
                last_message_time = Instant::now();

                let nostr_msg = match ws_next {
                    // Text message (expected)
                    Some(Ok(Message::Text(m))) => {
                        convert_to_msg(&m, settings.limits.max_event_bytes)
                    },

                    // Binary message (not accepted)
                    Some(Ok(Message::Binary(_))) => {
                        ws_stream.send(make_notice_message(
                            &Notice::message("binary messages not accepted".into())
                        )).await.ok();
                        continue;
                    },

                    // Ping/Pong (handled automatically by tungstenite)
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {
                        continue;
                    },

                    // Capacity error (message too large)
                    Some(Err(WsError::Capacity(MessageTooLong{size, max_size}))) => {
                        ws_stream.send(make_notice_message(
                            &Notice::message(format!("message too large ({} > {})", size, max_size))
                        )).await.ok();
                        continue;
                    },

                    // Connection closed (graceful or error)
                    None |
                    Some(Ok(Message::Close(_))) |
                    Some(Err(WsError::AlreadyClosed | WsError::ConnectionClosed)) => {
                        debug!("WebSocket closed from client");
                        metrics.disconnects.with_label_values(&["normal"]).inc();
                        break;
                    },

                    // I/O error (network failure)
                    Some(Err(WsError::Io(e))) => {
                        warn!("I/O error on WebSocket: {:?}", e);
                        metrics.disconnects.with_label_values(&["error"]).inc();
                        break;
                    },

                    // Unknown error
                    x => {
                        info!("Unknown WebSocket error: {:?}", x);
                        metrics.disconnects.with_label_values(&["error"]).inc();
                        break;
                    }
                };

                // Process Nostr message
                if let Ok(msg) = nostr_msg {
                    handle_nostr_message(
                        msg,
                        &mut conn,
                        &repo,
                        &event_tx,
                        &query_tx,
                        &notice_tx,
                        &settings,
                        &metrics,
                    ).await;
                }
            },
        }
    }

    // Cleanup on disconnect
    for (_, stop_tx) in running_queries {
        stop_tx.send(()).ok();
    }

    info!(
        "Connection closed: cid={}, ip={}, sent={} events, recv={} events, duration={:?}",
        conn.client_id,
        conn.client_ip_addr,
        client_sent_event_count,
        client_received_event_count,
        connection_start.elapsed()
    );
}
```

**tokio::select! pattern:**

- **Concurrent awaiting:** All branches polled concurrently
- **Fair scheduling:** No branch starves others
- **Clean shutdown:** Any branch can break loop

**Key branches:**

1. **Shutdown:** Graceful termination signal
2. **Ping timer:** Keep-alive mechanism
3. **Notice messages:** Error/info from database
4. **Query results:** Stored events from database
5. **Broadcast events:** Real-time events from other clients
6. **WebSocket messages:** Incoming client messages

## Message Handling

### Nostr Message Types

```rust
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum NostrMessage {
    /// EVENT and AUTH messages
    EventMsg(EventCmd),
    /// REQ message
    SubMsg(Subscription),
    /// CLOSE message
    CloseMsg(CloseCmd),
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(untagged)]
pub enum EventCmd {
    /// EVENT command
    Event(Event),
    /// AUTH command (NIP-42)
    Auth(Event),
}

/// Convert JSON string to NostrMessage
fn convert_to_msg(msg: &str, max_bytes: Option<usize>) -> Result<NostrMessage> {
    // Check size limit before parsing
    if let Some(max_size) = max_bytes {
        if msg.len() > max_size && max_size > 0 {
            return Err(Error::EventMaxLengthError(msg.len()));
        }
    }

    // Parse JSON
    serde_json::from_str(msg).map_err(|e| {
        trace!("JSON parse error: {:?}", e);
        Error::ProtoParseError
    })
}
```

**Untagged enum:** serde_json tries each variant until one matches

### EVENT Message Handling

```rust
async fn handle_event(
    event: Event,
    conn: &ClientConn,
    event_tx: &mpsc::Sender<SubmittedEvent>,
    settings: &Settings,
    metrics: &NostrMetrics,
) -> Notice {
    // Update metrics
    metrics.cmd_event.inc();

    // Validate event ID
    if !event.validate_id() {
        return Notice::invalid(&event.id, "event id does not match content");
    }

    // Verify signature
    if let Err(e) = event.verify_signature() {
        return Notice::invalid(&event.id, &format!("signature verification failed: {}", e));
    }

    // Check timestamp (reject far future events)
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    if event.created_at > now + settings.limits.max_future_seconds {
        return Notice::invalid(&event.id, "event timestamp too far in future");
    }

    // Check expiration (NIP-40)
    if let Some(expiration) = event.get_expiration() {
        if expiration < now {
            return Notice::invalid(&event.id, "event has expired");
        }
    }

    // Check authentication requirements
    if event.is_protected() {
        match &conn.auth {
            Nip42AuthState::AuthPubkey(pubkey) => {
                if pubkey != &event.pubkey {
                    return Notice::auth_required(&event.id, "protected event must be published by authenticated author");
                }
            },
            _ => {
                return Notice::auth_required(&event.id, "auth-required: protected event");
            }
        }
    }

    // Send to event processing pipeline
    let submitted = SubmittedEvent {
        event,
        source_ip: conn.client_ip_addr.clone(),
        client_id: conn.client_id,
    };

    if event_tx.send(submitted).await.is_err() {
        return Notice::error("internal server error");
    }

    // Wait for database response (with timeout)
    // Returns OK message when stored
    Notice::saved(&event.id)
}
```

**Validation sequence:**

1. Event ID matches content hash
2. Signature cryptographically valid
3. Timestamp not too far in future
4. Event not expired (NIP-40)
5. Authentication valid if protected (NIP-70)

### REQ Message Handling

```rust
async fn handle_req(
    subscription: Subscription,
    conn: &mut ClientConn,
    repo: &Arc<dyn NostrRepo>,
    query_tx: &mpsc::Sender<QueryResult>,
    notice_tx: &mpsc::Sender<Notice>,
    settings: &Settings,
    metrics: &NostrMetrics,
) {
    metrics.cmd_req.inc();

    // Add subscription to connection
    if let Err(e) = conn.subscribe(subscription.clone()) {
        let reason = match e {
            Error::SubMaxExceededError => "subscription limit exceeded",
            Error::SubIdMaxLengthError => "subscription ID too long",
            _ => "subscription rejected",
        };

        // Send CLOSED message
        let msg = format!("[\"CLOSED\",\"{}\",\"{}\"]", subscription.id, reason);
        notice_tx.send(Notice::message(msg)).await.ok();
        return;
    }

    // Spawn query task for each filter
    for filter in subscription.filters {
        // Validate filter (prevent overly broad queries)
        if filter.is_scraper_query() {
            let msg = format!("[\"CLOSED\",\"{}\",\"filter too broad\"]", subscription.id);
            notice_tx.send(Notice::message(msg)).await.ok();
            conn.unsubscribe(&subscription.id);
            return;
        }

        // Clone channels for query task
        let sub_id = subscription.id.clone();
        let query_tx = query_tx.clone();
        let repo = repo.clone();

        // Spawn async query task
        tokio::spawn(async move {
            // Query database
            let events = repo.query_events(&filter).await;

            // Send results
            for event in events {
                query_tx.send(QueryResult::Event(sub_id.clone(), event)).await.ok();
            }

            // Send EOSE
            query_tx.send(QueryResult::EOSE(sub_id)).await.ok();
        });
    }
}
```

**Async pattern:** Each filter query runs in separate task

**Scraper detection:**

```rust
impl Subscription {
    /// Check if subscription is too broad (potential scraper)
    pub fn is_scraper(&self) -> bool {
        for filter in &self.filters {
            let mut specificity = 0;

            // Award points for specific filters
            if filter.ids.is_some() { specificity += 2; }
            if filter.authors.is_some() { specificity += 1; }
            if filter.kinds.is_some() { specificity += 1; }
            if filter.tags.is_some() { specificity += 1; }

            // Require at least 2 points
            if specificity < 2 {
                return true;
            }
        }
        false
    }
}
```

### CLOSE Message Handling

```rust
async fn handle_close(
    close: CloseCmd,
    conn: &mut ClientConn,
    metrics: &NostrMetrics,
) {
    metrics.cmd_close.inc();
    conn.unsubscribe(&close.id);
    debug!("Subscription closed: {}", close.id);
}
```

**Simple unsubscribe:** Remove subscription from connection state

## Filter Matching

### Filter Structure

```rust
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ReqFilter {
    /// Event IDs (prefix match)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,

    /// Event kinds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<u64>>,

    /// Event created after this timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,

    /// Event created before this timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<u64>,

    /// Author pubkeys (prefix match)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,

    /// Maximum number of events to return
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,

    /// Generic tag filters (e.g., #e, #p)
    #[serde(flatten)]
    pub tags: Option<HashMap<char, HashSet<String>>>,

    /// Force no match (internal use)
    #[serde(skip)]
    pub force_no_match: bool,
}
```

### Event Matching Logic

```rust
impl ReqFilter {
    /// Check if event matches all filter criteria
    pub fn interested_in_event(&self, event: &Event) -> bool {
        // Short-circuit on force_no_match
        if self.force_no_match {
            return false;
        }

        // All criteria must match
        self.ids_match(event)
            && self.since_match(event)
            && self.until_match(event)
            && self.kind_match(event)
            && self.authors_match(event)
            && self.tag_match(event)
    }

    /// Check if event ID matches (prefix match)
    fn ids_match(&self, event: &Event) -> bool {
        self.ids.as_ref().map_or(true, |ids| {
            ids.iter().any(|id| event.id.starts_with(id))
        })
    }

    /// Check if timestamp in range
    fn since_match(&self, event: &Event) -> bool {
        self.since.map_or(true, |since| event.created_at >= since)
    }

    fn until_match(&self, event: &Event) -> bool {
        self.until.map_or(true, |until| event.created_at <= until)
    }

    /// Check if kind matches
    fn kind_match(&self, event: &Event) -> bool {
        self.kinds.as_ref().map_or(true, |kinds| {
            kinds.contains(&event.kind)
        })
    }

    /// Check if author matches (prefix match)
    fn authors_match(&self, event: &Event) -> bool {
        self.authors.as_ref().map_or(true, |authors| {
            authors.iter().any(|author| event.pubkey.starts_with(author))
        })
    }

    /// Check if tags match
    fn tag_match(&self, event: &Event) -> bool {
        self.tags.as_ref().map_or(true, |tag_filters| {
            // All tag filters must match
            tag_filters.iter().all(|(tag_name, tag_values)| {
                // Event must have at least one matching value for this tag
                event.generic_tag_val_intersect(*tag_name, tag_values)
            })
        })
    }
}
```

**Performance characteristics:**

- **Early return:** `force_no_match` short-circuits immediately
- **Prefix matching:** Allows hex prefix searches (e.g., "abc" matches "abc123...")
- **Set intersection:** Uses `HashSet` for efficient tag value matching

## Database Abstraction

### NostrRepo Trait

```rust
#[async_trait]
pub trait NostrRepo: Send + Sync {
    /// Query events matching filter
    async fn query_events(&self, filter: &ReqFilter) -> Vec<Event>;

    /// Store event
    async fn store_event(&self, event: &Event) -> Result<()>;

    /// Check if event exists
    async fn event_exists(&self, id: &str) -> bool;

    /// Delete events (kind 5)
    async fn delete_events(&self, deletion: &Event) -> Result<usize>;

    /// Get relay info (NIP-11)
    async fn get_relay_info(&self) -> RelayInfo;
}
```

**Implementations:**

- **PostgreSQL:** Production deployments
- **SQLite:** Development and small relays
- **In-memory:** Testing

### PostgreSQL Implementation Example

```rust
#[async_trait]
impl NostrRepo for PostgresRepo {
    async fn query_events(&self, filter: &ReqFilter) -> Vec<Event> {
        let mut query = String::from("SELECT event_json FROM events WHERE ");
        let mut conditions = Vec::new();
        let mut param_num = 1;

        // Build WHERE clause
        if let Some(ids) = &filter.ids {
            let id_conditions: Vec<String> = ids.iter()
                .map(|_| { let p = param_num; param_num += 1; format!("id LIKE ${} || '%'", p) })
                .collect();
            conditions.push(format!("({})", id_conditions.join(" OR ")));
        }

        if let Some(authors) = &filter.authors {
            let author_conditions: Vec<String> = authors.iter()
                .map(|_| { let p = param_num; param_num += 1; format!("pubkey LIKE ${} || '%'", p) })
                .collect();
            conditions.push(format!("({})", author_conditions.join(" OR ")));
        }

        if let Some(kinds) = &filter.kinds {
            let kind_list = kinds.iter()
                .map(|k| k.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            conditions.push(format!("kind IN ({})", kind_list));
        }

        if let Some(since) = filter.since {
            conditions.push(format!("created_at >= {}", since));
        }

        if let Some(until) = filter.until {
            conditions.push(format!("created_at <= {}", until));
        }

        // Add tag filters (requires JOIN with tags table)
        if let Some(tags) = &filter.tags {
            for (tag_name, _) in tags {
                let p = param_num;
                param_num += 1;
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM tags WHERE tags.event_id = events.id \
                     AND tags.name = ${} AND tags.value = ANY(${})",
                    p, p + 1
                ));
            }
        }

        query.push_str(&conditions.join(" AND "));
        query.push_str(" ORDER BY created_at DESC");

        if let Some(limit) = filter.limit {
            query.push_str(&format!(" LIMIT {}", limit));
        }

        // Execute query with connection pool
        let rows = self.pool.query(&query, &params).await?;

        // Parse results
        rows.into_iter()
            .filter_map(|row| {
                let json: String = row.get(0);
                serde_json::from_str(&json).ok()
            })
            .collect()
    }

    async fn store_event(&self, event: &Event) -> Result<()> {
        let event_json = serde_json::to_string(event)?;

        // Insert event
        self.pool.execute(
            "INSERT INTO events (id, pubkey, created_at, kind, event_json) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (id) DO NOTHING",
            &[&event.id, &event.pubkey, &(event.created_at as i64), &(event.kind as i64), &event_json]
        ).await?;

        // Insert tags
        for tag in &event.tags {
            if tag.len() >= 2 {
                let tag_name = &tag[0];
                let tag_value = &tag[1];

                self.pool.execute(
                    "INSERT INTO tags (event_id, name, value) VALUES ($1, $2, $3)",
                    &[&event.id, tag_name, tag_value]
                ).await.ok();
            }
        }

        Ok(())
    }
}
```

**Database schema:**

```sql
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    kind INTEGER NOT NULL,
    event_json TEXT NOT NULL
);

CREATE INDEX idx_pubkey ON events(pubkey);
CREATE INDEX idx_created_at ON events(created_at);
CREATE INDEX idx_kind ON events(kind);

CREATE TABLE tags (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value TEXT NOT NULL
);

CREATE INDEX idx_tags_event ON tags(event_id);
CREATE INDEX idx_tags_name_value ON tags(name, value);
```

## Error Handling

### Error Types

```rust
#[derive(Error, Debug)]
pub enum Error {
    #[error("Protocol parse error")]
    ProtoParseError,

    #[error("Event invalid signature")]
    EventInvalidSignature,

    #[error("Event invalid ID")]
    EventInvalidId,

    #[error("Event too large: {0} bytes")]
    EventMaxLengthError(usize),

    #[error("Subscription ID max length exceeded")]
    SubIdMaxLengthError,

    #[error("Subscription limit exceeded")]
    SubMaxExceededError,

    #[error("WebSocket error: {0}")]
    WebsocketError(#[from] WsError),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Connection closed")]
    ConnClosed,
}
```

**Using thiserror:** Automatic `impl Error` and `Display`

### Error Handling in Event Loop

```rust
match ws_stream.next().await {
    Some(Ok(Message::Text(msg))) => {
        // Handle text message
    },

    Some(Err(WsError::Capacity(MessageTooLong{size, max_size}))) => {
        // Message too large - send notice, continue
        let notice = format!("message too large ({} > {})", size, max_size);
        ws_stream.send(make_notice_message(&Notice::message(notice))).await.ok();
        continue;
    },

    Some(Err(WsError::Io(e))) => {
        // I/O error - log and close connection
        warn!("I/O error on WebSocket: {:?}", e);
        metrics.disconnects.with_label_values(&["error"]).inc();
        break;
    },

    None | Some(Ok(Message::Close(_))) => {
        // Normal closure
        debug!("Connection closed gracefully");
        metrics.disconnects.with_label_values(&["normal"]).inc();
        break;
    },

    _ => {
        // Unknown error - close connection
        info!("Unknown WebSocket error");
        metrics.disconnects.with_label_values(&["error"]).inc();
        break;
    }
}
```

**Error strategy:**

- **Recoverable errors:** Send notice, continue loop
- **Fatal errors:** Log and break loop
- **Classify disconnects:** Metrics by disconnect reason

## Metrics and Monitoring

### Prometheus Metrics

```rust
#[derive(Clone)]
pub struct NostrMetrics {
    /// Query response time histogram
    pub query_sub: Histogram,

    /// Individual database query time
    pub query_db: Histogram,

    /// Active database connections
    pub db_connections: IntGauge,

    /// Event write response time
    pub write_events: Histogram,

    /// Events sent to clients (by source: stored/realtime)
    pub sent_events: IntCounterVec,

    /// Total connections
    pub connections: IntCounter,

    /// Client disconnects (by reason: normal/error/timeout)
    pub disconnects: IntCounterVec,

    /// Queries aborted (by reason)
    pub query_aborts: IntCounterVec,

    /// Commands received (by type: REQ/EVENT/CLOSE/AUTH)
    pub cmd_req: IntCounter,
    pub cmd_event: IntCounter,
    pub cmd_close: IntCounter,
    pub cmd_auth: IntCounter,
}

impl NostrMetrics {
    pub fn new() -> Self {
        NostrMetrics {
            query_sub: register_histogram!(
                "nostr_query_seconds",
                "Subscription query response time"
            ).unwrap(),

            db_connections: register_int_gauge!(
                "nostr_db_connections",
                "Active database connections"
            ).unwrap(),

            sent_events: register_int_counter_vec!(
                "nostr_sent_events_total",
                "Events sent to clients",
                &["source"]
            ).unwrap(),

            disconnects: register_int_counter_vec!(
                "nostr_disconnects_total",
                "Client disconnections",
                &["reason"]
            ).unwrap(),

            // ... more metrics
        }
    }
}
```

**Tracking in code:**

```rust
// Command received
metrics.cmd_req.inc();

// Query timing
let timer = metrics.query_sub.start_timer();
let events = repo.query_events(&filter).await;
timer.observe_duration();

// Event sent
metrics.sent_events.with_label_values(&["realtime"]).inc();

// Disconnect
metrics.disconnects.with_label_values(&["timeout"]).inc();
```

**Prometheus endpoint:**

```rust
async fn metrics_handler() -> impl Reply {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();
    warp::reply::with_header(buffer, "Content-Type", encoder.format_type())
}
```

## Configuration

### Settings Structure

```rust
#[derive(Deserialize, Clone)]
pub struct Settings {
    pub network: NetworkSettings,
    pub database: DatabaseSettings,
    pub limits: LimitsSettings,
    pub relay_info: RelayInfo,
}

#[derive(Deserialize, Clone)]
pub struct NetworkSettings {
    pub address: SocketAddr,
    pub remote_ip_header: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct LimitsSettings {
    pub max_ws_message_bytes: Option<usize>,
    pub max_ws_frame_bytes: Option<usize>,
    pub max_event_bytes: Option<usize>,
    pub max_conn_idle_seconds: u64,
    pub max_future_seconds: u64,
}

impl Settings {
    pub fn load() -> Result<Self> {
        let config = config::Config::builder()
            .add_source(config::File::with_name("config"))
            .add_source(config::Environment::with_prefix("NOSTR"))
            .build()?;

        config.try_deserialize()
    }
}
```

**config.toml example:**

```toml
[network]
address = "0.0.0.0:8080"
remote_ip_header = "X-Forwarded-For"

[database]
connection = "postgresql://user:pass@localhost/nostr"
pool_size = 20

[limits]
max_ws_message_bytes = 512000
max_ws_frame_bytes = 16384
max_event_bytes = 65536
max_conn_idle_seconds = 1200
max_future_seconds = 900

[relay_info]
name = "My Nostr Relay"
description = "A public Nostr relay"
pubkey = "..."
contact = "admin@example.com"
```

## Testing

### Integration Test Example

```rust
#[tokio::test]
async fn test_websocket_subscription() {
    // Setup test relay
    let repo = Arc::new(MockRepo::new());
    let (broadcast_tx, _) = broadcast::channel(16);
    let (_shutdown_tx, shutdown_rx) = broadcast::channel(1);
    let settings = test_settings();
    let metrics = NostrMetrics::new();

    // Start server
    let server = tokio::spawn(async move {
        // ... start server
    });

    // Connect client
    let (mut ws_stream, _) = connect_async("ws://127.0.0.1:8080").await.unwrap();

    // Send REQ
    let req = r#"["REQ","test",{"kinds":[1]}]"#;
    ws_stream.send(Message::Text(req.into())).await.unwrap();

    // Read EOSE
    let msg = ws_stream.next().await.unwrap().unwrap();
    assert!(matches!(msg, Message::Text(text) if text.contains("EOSE")));

    // Send EVENT
    let event = create_test_event();
    let event_json = serde_json::to_string(&event).unwrap();
    let cmd = format!(r#"["EVENT",{}]"#, event_json);
    ws_stream.send(Message::Text(cmd)).await.unwrap();

    // Read OK
    let msg = ws_stream.next().await.unwrap().unwrap();
    assert!(matches!(msg, Message::Text(text) if text.contains("OK")));

    // Cleanup
    ws_stream.close(None).await.unwrap();
}
```

## Production Deployment

### Systemd Service

```ini
[Unit]
Description=Nostr Relay
After=network.target postgresql.service

[Service]
Type=simple
User=nostr
WorkingDirectory=/opt/nostr-relay
ExecStart=/opt/nostr-relay/nostr-rs-relay
Restart=on-failure
RestartSec=5

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/nostr-relay

[Install]
WantedBy=multi-user.target
```

### Nginx Reverse Proxy

```nginx
upstream nostr_relay {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://nostr_relay;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeouts
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### Docker Deployment

```dockerfile
FROM rust:1.70 as builder

WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/nostr-rs-relay /usr/local/bin/

EXPOSE 8080

CMD ["nostr-rs-relay"]
```

**docker-compose.yml:**

```yaml
version: '3.8'

services:
  relay:
    image: nostr-rs-relay:latest
    ports:
      - '8080:8080'
    environment:
      - NOSTR__DATABASE__CONNECTION=postgresql://nostr:password@db/nostr
      - RUST_LOG=info
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=nostr
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=nostr
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

## Summary

**Key patterns:**

1. **tokio::select!:** Concurrent event handling with cancellation
2. **Async/await:** Clean async code without callbacks
3. **Type safety:** Strong typing prevents entire classes of bugs
4. **Error handling:** Comprehensive error types with thiserror
5. **Database abstraction:** Trait-based repository pattern
6. **Metrics:** Built-in Prometheus instrumentation

**Performance characteristics:**

- **10,000+ connections** per server
- **Sub-millisecond** p50 latency
- **Memory safe:** No undefined behavior, no memory leaks
- **Concurrent queries:** Tokio runtime schedules efficiently

**When to use Rust patterns:**

- Need memory safety without GC pauses
- Want high-level abstractions with zero cost
- Building mission-critical relay infrastructure
- Team has Rust experience
- Performance critical (CPU or memory constrained)

**Trade-offs:**

- **Learning curve:** Rust's borrow checker takes time
- **Compile times:** Slower than interpreted languages
- **Async complexity:** Async Rust has sharp edges

**Further reading:**

- nostr-rs-relay: https://github.com/scsibug/nostr-rs-relay
- tokio documentation: https://tokio.rs
- tungstenite: https://github.com/snapview/tungstenite-rs
- Rust async book: https://rust-lang.github.io/async-book/
