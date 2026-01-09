# WebSocket Protocol (RFC 6455) - Complete Reference

## Connection Establishment

### HTTP Upgrade Handshake

The WebSocket protocol begins as an HTTP request that upgrades to WebSocket:

**Client Request:**

```http
GET /chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Origin: http://example.com
Sec-WebSocket-Protocol: chat, superchat
Sec-WebSocket-Version: 13
```

**Server Response:**

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
Sec-WebSocket-Protocol: chat
```

### Handshake Details

**Sec-WebSocket-Key Generation (Client):**

1. Generate 16 random bytes
2. Base64-encode the result
3. Send in `Sec-WebSocket-Key` header

**Sec-WebSocket-Accept Computation (Server):**

1. Concatenate client key with GUID: `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
2. Compute SHA-1 hash of concatenated string
3. Base64-encode the hash
4. Send in `Sec-WebSocket-Accept` header

**Example computation:**

```
Client Key: dGhlIHNhbXBsZSBub25jZQ==
Concatenated: dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11
SHA-1 Hash: b37a4f2cc0cb4e7e8cf769a5f3f8f2e8e4c9f7a3
Base64: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**Validation (Client):**

- Verify HTTP status is 101
- Verify `Sec-WebSocket-Accept` matches expected value
- If validation fails, do not establish connection

### Origin Header

The `Origin` header provides protection against cross-site WebSocket hijacking:

**Server-side validation:**

```go
func checkOrigin(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    allowedOrigins := []string{
        "https://example.com",
        "https://app.example.com",
    }
    for _, allowed := range allowedOrigins {
        if origin == allowed {
            return true
        }
    }
    return false
}
```

**Security consideration:** Browser-based clients MUST send Origin header. Non-browser clients MAY omit it. Servers SHOULD validate Origin for browser clients to prevent CSRF attacks.

## Frame Format

### Base Framing Protocol

WebSocket frames use a binary format with variable-length fields:

```
      0                   1                   2                   3
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
     +-+-+-+-+-------+-+-------------+-------------------------------+
     |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
     |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
     |N|V|V|V|       |S|             |   (if payload len==126/127)   |
     | |1|2|3|       |K|             |                               |
     +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
     |     Extended payload length continued, if payload len == 127  |
     + - - - - - - - - - - - - - - - +-------------------------------+
     |                               |Masking-key, if MASK set to 1  |
     +-------------------------------+-------------------------------+
     | Masking-key (continued)       |          Payload Data         |
     +-------------------------------- - - - - - - - - - - - - - - - +
     :                     Payload Data continued ...                :
     + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
     |                     Payload Data continued ...                |
     +---------------------------------------------------------------+
```

### Frame Header Fields

**FIN (1 bit):**

- `1` = Final fragment in message
- `0` = More fragments follow
- Used for message fragmentation

**RSV1, RSV2, RSV3 (1 bit each):**

- Reserved for extensions
- MUST be 0 unless extension negotiated
- Server MUST fail connection if non-zero with no extension

**Opcode (4 bits):**

- Defines interpretation of payload data
- See "Frame Opcodes" section below

**MASK (1 bit):**

- `1` = Payload is masked (required for client-to-server)
- `0` = Payload is not masked (required for server-to-client)
- Client MUST mask all frames sent to server
- Server MUST NOT mask frames sent to client

**Payload Length (7 bits, 7+16 bits, or 7+64 bits):**

- If 0-125: Actual payload length
- If 126: Next 2 bytes are 16-bit unsigned payload length
- If 127: Next 8 bytes are 64-bit unsigned payload length

**Masking-key (0 or 4 bytes):**

- Present if MASK bit is set
- 32-bit value used to mask payload
- MUST be unpredictable (strong entropy source)

### Frame Opcodes

**Data Frame Opcodes:**

- `0x0` - Continuation Frame
  - Used for fragmented messages
  - Must follow initial data frame (text/binary)
  - Carries same data type as initial frame

- `0x1` - Text Frame
  - Payload is UTF-8 encoded text
  - MUST be valid UTF-8
  - Endpoint MUST fail connection if invalid UTF-8

- `0x2` - Binary Frame
  - Payload is arbitrary binary data
  - Application interprets data

- `0x3-0x7` - Reserved for future non-control frames

**Control Frame Opcodes:**

- `0x8` - Connection Close
  - Initiates or acknowledges connection closure
  - MAY contain status code and reason
  - See "Close Handshake" section

- `0x9` - Ping
  - Heartbeat mechanism
  - MAY contain application data
  - Recipient MUST respond with Pong

- `0xA` - Pong
  - Response to Ping
  - MUST contain identical payload as Ping
  - MAY be sent unsolicited (unidirectional heartbeat)

- `0xB-0xF` - Reserved for future control frames

### Control Frame Constraints

**Control frames are subject to strict rules:**

1. **Maximum payload:** 125 bytes
   - Allows control frames to fit in single IP packet
   - Reduces fragmentation

2. **No fragmentation:** Control frames MUST NOT be fragmented
   - FIN bit MUST be 1
   - Ensures immediate processing

3. **Interleaving:** Control frames MAY be injected in middle of fragmented message
   - Enables ping/pong during long transfers
   - Close frames can interrupt any operation

4. **All control frames MUST be handled immediately**

### Masking

**Purpose of masking:**

- Prevents cache poisoning attacks
- Protects against misinterpretation by intermediaries
- Makes WebSocket traffic unpredictable to proxies

**Masking algorithm:**

```
j = i MOD 4
transformed-octet-i = original-octet-i XOR masking-key-octet-j
```

**Implementation:**

```go
func maskBytes(data []byte, mask [4]byte) {
    for i := range data {
        data[i] ^= mask[i%4]
    }
}
```

**Example:**

```
Original:     [0x48, 0x65, 0x6C, 0x6C, 0x6F]  // "Hello"
Masking Key:  [0x37, 0xFA, 0x21, 0x3D]
Masked:       [0x7F, 0x9F, 0x4D, 0x51, 0x58]

Calculation:
0x48 XOR 0x37 = 0x7F
0x65 XOR 0xFA = 0x9F
0x6C XOR 0x21 = 0x4D
0x6C XOR 0x3D = 0x51
0x6F XOR 0x37 = 0x58  (wraps around to mask[0])
```

**Security requirement:** Masking key MUST be derived from strong source of entropy. Predictable masking keys defeat the security purpose.

## Message Fragmentation

### Why Fragment?

- Send message without knowing total size upfront
- Multiplex logical channels (interleave messages)
- Keep control frames responsive during large transfers

### Fragmentation Rules

**Sender rules:**

1. First fragment has opcode (text/binary)
2. Subsequent fragments have opcode 0x0 (continuation)
3. Last fragment has FIN bit set to 1
4. Control frames MAY be interleaved

**Receiver rules:**

1. Reassemble fragments in order
2. Final message type determined by first fragment opcode
3. Validate UTF-8 across all text fragments
4. Process control frames immediately (don't wait for FIN)

### Fragmentation Example

**Sending "Hello World" in 3 fragments:**

```
Frame 1 (Text, More Fragments):
  FIN=0, Opcode=0x1, Payload="Hello"

Frame 2 (Continuation, More Fragments):
  FIN=0, Opcode=0x0, Payload=" Wor"

Frame 3 (Continuation, Final):
  FIN=1, Opcode=0x0, Payload="ld"
```

**With interleaved Ping:**

```
Frame 1: FIN=0, Opcode=0x1, Payload="Hello"
Frame 2: FIN=1, Opcode=0x9, Payload=""        <- Ping (complete)
Frame 3: FIN=0, Opcode=0x0, Payload=" Wor"
Frame 4: FIN=1, Opcode=0x0, Payload="ld"
```

### Implementation Pattern

```go
type fragmentState struct {
    messageType int
    fragments   [][]byte
}

func (ws *WebSocket) handleFrame(fin bool, opcode int, payload []byte) {
    switch opcode {
    case 0x1, 0x2: // Text or Binary (first fragment)
        if fin {
            ws.handleCompleteMessage(opcode, payload)
        } else {
            ws.fragmentState = &fragmentState{
                messageType: opcode,
                fragments:   [][]byte{payload},
            }
        }

    case 0x0: // Continuation
        if ws.fragmentState == nil {
            ws.fail("Unexpected continuation frame")
            return
        }
        ws.fragmentState.fragments = append(ws.fragmentState.fragments, payload)
        if fin {
            complete := bytes.Join(ws.fragmentState.fragments, nil)
            ws.handleCompleteMessage(ws.fragmentState.messageType, complete)
            ws.fragmentState = nil
        }

    case 0x8, 0x9, 0xA: // Control frames
        ws.handleControlFrame(opcode, payload)
    }
}
```

## Ping and Pong Frames

### Purpose

1. **Keep-alive:** Detect broken connections
2. **Latency measurement:** Time round-trip
3. **NAT traversal:** Maintain mapping in stateful firewalls

### Protocol Rules

**Ping (0x9):**

- MAY be sent by either endpoint at any time
- MAY contain application data (≤125 bytes)
- Application data arbitrary (often empty or timestamp)

**Pong (0xA):**

- MUST be sent in response to Ping
- MUST contain identical payload as Ping
- MUST be sent "as soon as practical"
- MAY be sent unsolicited (one-way heartbeat)

**No Response:**

- If Pong not received within timeout, connection assumed dead
- Application should close connection

### Implementation Patterns

**Pattern 1: Automatic Pong (most WebSocket libraries)**

```go
// Library handles pong automatically
ws.SetPingHandler(func(appData string) error {
    // Custom handler if needed
    return nil  // Library sends pong automatically
})
```

**Pattern 2: Manual Pong**

```go
func (ws *WebSocket) handlePing(payload []byte) {
    pongFrame := Frame{
        FIN:     true,
        Opcode:  0xA,
        Payload: payload,  // Echo same payload
    }
    ws.writeFrame(pongFrame)
}
```

**Pattern 3: Periodic Client Ping**

```go
func (ws *WebSocket) pingLoop() {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            if err := ws.writePing([]byte{}); err != nil {
                return  // Connection dead
            }
        case <-ws.done:
            return
        }
    }
}
```

**Pattern 4: Timeout Detection**

```go
const pongWait = 60 * time.Second

ws.SetReadDeadline(time.Now().Add(pongWait))
ws.SetPongHandler(func(string) error {
    ws.SetReadDeadline(time.Now().Add(pongWait))
    return nil
})

// If no frame received in pongWait, ReadMessage returns timeout error
```

### Nostr Relay Recommendations

**Server-side:**

- Send ping every 30-60 seconds
- Close connection if no pong within 60-120 seconds
- Log timeout closures for monitoring

**Client-side:**

- Respond to pings automatically (use library handler)
- Consider sending unsolicited pongs every 30 seconds (some proxies)
- Reconnect if no frames received for 120 seconds

## Close Handshake

### Close Frame Structure

**Close frame (Opcode 0x8) payload:**

```
     0                   1                   2                   3
     0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
    +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    |         Status Code (16)      |  Reason (variable length)...  |
    +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**Status Code (2 bytes, optional):**

- 16-bit unsigned integer
- Network byte order (big-endian)
- See "Status Codes" section below

**Reason (variable length, optional):**

- UTF-8 encoded text
- MUST be valid UTF-8
- Typically human-readable explanation

### Close Handshake Sequence

**Initiator (either endpoint):**

1. Send Close frame with optional status/reason
2. Stop sending data frames
3. Continue processing received frames until Close frame received
4. Close underlying TCP connection

**Recipient:**

1. Receive Close frame
2. Send Close frame in response (if not already sent)
3. Close underlying TCP connection

### Status Codes

**Normal Closure Codes:**

- `1000` - Normal Closure
  - Successful operation complete
  - Default if no code specified

- `1001` - Going Away
  - Endpoint going away (server shutdown, browser navigation)
  - Client navigating to new page

**Error Closure Codes:**

- `1002` - Protocol Error
  - Endpoint terminating due to protocol error
  - Invalid frame format, unexpected opcode, etc.

- `1003` - Unsupported Data
  - Endpoint cannot accept data type
  - Server received binary when expecting text

- `1007` - Invalid Frame Payload Data
  - Inconsistent data (e.g., non-UTF-8 in text frame)

- `1008` - Policy Violation
  - Message violates endpoint policy
  - Generic code when specific code doesn't fit

- `1009` - Message Too Big
  - Message too large to process

- `1010` - Mandatory Extension
  - Client expected server to negotiate extension
  - Server didn't respond with extension

- `1011` - Internal Server Error
  - Server encountered unexpected condition
  - Prevents fulfilling request

**Reserved Codes:**

- `1004` - Reserved
- `1005` - No Status Rcvd (internal use only, never sent)
- `1006` - Abnormal Closure (internal use only, never sent)
- `1015` - TLS Handshake (internal use only, never sent)

**Custom Application Codes:**

- `3000-3999` - Library/framework use
- `4000-4999` - Application use (e.g., Nostr-specific)

### Implementation Patterns

**Graceful close (initiator):**

```go
func (ws *WebSocket) Close() error {
    // Send close frame
    closeFrame := Frame{
        FIN:     true,
        Opcode:  0x8,
        Payload: encodeCloseStatus(1000, "goodbye"),
    }
    ws.writeFrame(closeFrame)

    // Wait for close frame response (with timeout)
    ws.SetReadDeadline(time.Now().Add(5 * time.Second))
    for {
        frame, err := ws.readFrame()
        if err != nil || frame.Opcode == 0x8 {
            break
        }
        // Process other frames
    }

    // Close TCP connection
    return ws.conn.Close()
}
```

**Handling received close:**

```go
func (ws *WebSocket) handleCloseFrame(payload []byte) {
    status, reason := decodeClosePayload(payload)
    log.Printf("Close received: %d %s", status, reason)

    // Send close response
    closeFrame := Frame{
        FIN:     true,
        Opcode:  0x8,
        Payload: payload,  // Echo same status/reason
    }
    ws.writeFrame(closeFrame)

    // Close connection
    ws.conn.Close()
}
```

**Nostr relay close examples:**

```go
// Client subscription limit exceeded
ws.SendClose(4000, "subscription limit exceeded")

// Invalid message format
ws.SendClose(1002, "protocol error: invalid JSON")

// Relay shutting down
ws.SendClose(1001, "relay shutting down")

// Client rate limit exceeded
ws.SendClose(4001, "rate limit exceeded")
```

## Security Considerations

### Origin-Based Security Model

**Threat:** Malicious web page opens WebSocket to victim server using user's credentials

**Mitigation:**

1. Server checks `Origin` header
2. Reject connections from untrusted origins
3. Implement same-origin or allowlist policy

**Example:**

```go
func validateOrigin(r *http.Request) bool {
    origin := r.Header.Get("Origin")

    // Allow same-origin
    if origin == "https://"+r.Host {
        return true
    }

    // Allowlist trusted origins
    trusted := []string{
        "https://app.example.com",
        "https://mobile.example.com",
    }
    for _, t := range trusted {
        if origin == t {
            return true
        }
    }

    return false
}
```

### Masking Attacks

**Why masking is required:**

- Without masking, attacker can craft WebSocket frames that look like HTTP requests
- Proxies might misinterpret frame data as HTTP
- Could lead to cache poisoning or request smuggling

**Example attack (without masking):**

```
WebSocket payload: "GET /admin HTTP/1.1\r\nHost: victim.com\r\n\r\n"
Proxy might interpret as separate HTTP request
```

**Defense:** Client MUST mask all frames. Server MUST reject unmasked frames from client.

### Connection Limits

**Prevent resource exhaustion:**

```go
type ConnectionLimiter struct {
    connections map[string]int
    maxPerIP    int
    mu          sync.Mutex
}

func (cl *ConnectionLimiter) Allow(ip string) bool {
    cl.mu.Lock()
    defer cl.mu.Unlock()

    if cl.connections[ip] >= cl.maxPerIP {
        return false
    }
    cl.connections[ip]++
    return true
}

func (cl *ConnectionLimiter) Release(ip string) {
    cl.mu.Lock()
    defer cl.mu.Unlock()
    cl.connections[ip]--
}
```

### TLS (WSS)

**Use WSS (WebSocket Secure) for:**

- Authentication credentials
- Private user data
- Financial transactions
- Any sensitive information

**WSS connection flow:**

1. Establish TLS connection
2. Perform TLS handshake
3. Verify server certificate
4. Perform WebSocket handshake over TLS

**URL schemes:**

- `ws://` - Unencrypted WebSocket (default port 80)
- `wss://` - Encrypted WebSocket over TLS (default port 443)

### Message Size Limits

**Prevent memory exhaustion:**

```go
const maxMessageSize = 512 * 1024  // 512 KB

ws.SetReadLimit(maxMessageSize)

// Or during frame reading:
if payloadLength > maxMessageSize {
    ws.SendClose(1009, "message too large")
    ws.Close()
}
```

### Rate Limiting

**Prevent abuse:**

```go
type RateLimiter struct {
    limiter *rate.Limiter
}

func (rl *RateLimiter) Allow() bool {
    return rl.limiter.Allow()
}

// Per-connection limiter
limiter := rate.NewLimiter(10, 20)  // 10 msgs/sec, burst 20

if !limiter.Allow() {
    ws.SendClose(4001, "rate limit exceeded")
}
```

## Error Handling

### Connection Errors

**Types of errors:**

1. **Network errors:** TCP connection failure, timeout
2. **Protocol errors:** Invalid frame format, wrong opcode
3. **Application errors:** Invalid message content

**Handling strategy:**

```go
for {
    frame, err := ws.ReadFrame()
    if err != nil {
        // Check error type
        if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
            // Timeout - connection likely dead
            log.Println("Connection timeout")
            ws.Close()
            return
        }

        if err == io.EOF || err == io.ErrUnexpectedEOF {
            // Connection closed
            log.Println("Connection closed")
            return
        }

        if protocolErr, ok := err.(*ProtocolError); ok {
            // Protocol violation
            log.Printf("Protocol error: %v", protocolErr)
            ws.SendClose(1002, protocolErr.Error())
            ws.Close()
            return
        }

        // Unknown error
        log.Printf("Unknown error: %v", err)
        ws.Close()
        return
    }

    // Process frame
}
```

### UTF-8 Validation

**Text frames MUST contain valid UTF-8:**

```go
func validateUTF8(data []byte) bool {
    return utf8.Valid(data)
}

func handleTextFrame(payload []byte) error {
    if !validateUTF8(payload) {
        return fmt.Errorf("invalid UTF-8 in text frame")
    }
    // Process valid text
    return nil
}
```

**For fragmented messages:** Validate UTF-8 across all fragments when reassembled.

## Implementation Checklist

### Client Implementation

- [ ] Generate random Sec-WebSocket-Key
- [ ] Compute and validate Sec-WebSocket-Accept
- [ ] MUST mask all frames sent to server
- [ ] Handle unmasked frames from server
- [ ] Respond to Ping with Pong
- [ ] Implement close handshake (both initiating and responding)
- [ ] Validate UTF-8 in text frames
- [ ] Handle fragmented messages
- [ ] Set reasonable timeouts
- [ ] Implement reconnection logic

### Server Implementation

- [ ] Validate Sec-WebSocket-Key format
- [ ] Compute correct Sec-WebSocket-Accept
- [ ] Validate Origin header
- [ ] MUST NOT mask frames sent to client
- [ ] Reject masked frames from server (protocol error)
- [ ] Respond to Ping with Pong
- [ ] Implement close handshake (both initiating and responding)
- [ ] Validate UTF-8 in text frames
- [ ] Handle fragmented messages
- [ ] Implement connection limits (per IP, total)
- [ ] Implement message size limits
- [ ] Implement rate limiting
- [ ] Log connection statistics
- [ ] Graceful shutdown (close all connections)

### Both Client and Server

- [ ] Handle concurrent read/write safely
- [ ] Process control frames immediately (even during fragmentation)
- [ ] Implement proper timeout mechanisms
- [ ] Log errors with appropriate detail
- [ ] Handle unexpected close gracefully
- [ ] Validate frame structure
- [ ] Check RSV bits (must be 0 unless extension)
- [ ] Support standard close status codes
- [ ] Implement proper error handling for all operations

## Common Implementation Mistakes

### 1. Concurrent Writes

**Mistake:** Writing to WebSocket from multiple goroutines without synchronization

**Fix:** Use mutex or single-writer goroutine

```go
type WebSocket struct {
    conn  *websocket.Conn
    mutex sync.Mutex
}

func (ws *WebSocket) WriteMessage(data []byte) error {
    ws.mutex.Lock()
    defer ws.mutex.Unlock()
    return ws.conn.WriteMessage(websocket.TextMessage, data)
}
```

### 2. Not Handling Pong

**Mistake:** Sending Ping but not updating read deadline on Pong

**Fix:**

```go
ws.SetPongHandler(func(string) error {
    ws.SetReadDeadline(time.Now().Add(pongWait))
    return nil
})
```

### 3. Forgetting Close Handshake

**Mistake:** Just calling `conn.Close()` without sending Close frame

**Fix:** Send Close frame first, wait for response, then close TCP

### 4. Not Validating UTF-8

**Mistake:** Accepting any bytes in text frames

**Fix:** Validate UTF-8 and fail connection on invalid text

### 5. No Message Size Limit

**Mistake:** Allowing unlimited message sizes

**Fix:** Set `SetReadLimit()` to reasonable value (e.g., 512 KB)

### 6. Blocking on Write

**Mistake:** Blocking indefinitely on slow clients

**Fix:** Set write deadline before each write

```go
ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
```

### 7. Memory Leaks

**Mistake:** Not cleaning up resources on disconnect

**Fix:** Use defer for cleanup, ensure all goroutines terminate

### 8. Race Conditions in Close

**Mistake:** Multiple goroutines trying to close connection

**Fix:** Use `sync.Once` for close operation

```go
type WebSocket struct {
    conn      *websocket.Conn
    closeOnce sync.Once
}

func (ws *WebSocket) Close() error {
    var err error
    ws.closeOnce.Do(func() {
        err = ws.conn.Close()
    })
    return err
}
```
