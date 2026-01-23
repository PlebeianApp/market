# Relay Configuration

This document describes how the Plebeian Market application connects to Nostr relays based on the deployment environment.

## Overview

The application supports three deployment stages, each with different relay behavior:

| Stage | Main Relay | Default Relays | Behavior |
|-------|-----------|----------------|----------|
| **Production** | `wss://relay.plebeian.market` | ✅ | Read & write to all |
| **Staging** | `wss://relay.staging.plebeian.market` | ✅ | Read all, **write only to staging** |
| **Development** | `ws://localhost:10547` | Configurable | See below |

## Architecture

```mermaid
flowchart TB
    subgraph Config["Configuration"]
        ENV[/Environment Variables/]
        API["/api/config endpoint"]
        ENV --> API
    end

    subgraph Stages["Deployment Stages"]
        PROD[Production]
        STAGING[Staging]
        DEV[Development]
    end

    API --> PROD
    API --> STAGING
    API --> DEV

    subgraph Production
        PROD_MAIN["wss://relay.plebeian.market"]
        PROD_DEFAULT["Default Public Relays"]
        PROD --> PROD_MAIN
        PROD --> PROD_DEFAULT
    end

    subgraph Staging
        STG_MAIN["wss://relay.staging.plebeian.market"]
        STG_DEFAULT["Default Public Relays"]
        STAGING --> STG_MAIN
        STAGING --> STG_DEFAULT
    end

    subgraph Development
        DEV_MAIN["ws://localhost:10547"]
        DEV_DEFAULT["Default Public Relays (optional)"]
        DEV --> DEV_MAIN
        DEV --> DEV_DEFAULT
    end
```

## Relay Connection Flow

```mermaid
sequenceDiagram
    participant App as Application
    participant Config as Config Store
    participant NDK as NDK Store
    participant Relays as Nostr Relays

    App->>Config: Fetch /api/config
    Config-->>App: { appRelay, stage, ... }
    App->>NDK: initialize()
    NDK->>NDK: getRelayUrls(stage)
    
    alt Development + LOCAL_RELAY_ONLY=true
        NDK->>Relays: Connect to localhost only
    else Development + LOCAL_RELAY_ONLY=false
        NDK->>Relays: Connect to localhost + defaults
    else Production or Staging
        NDK->>Relays: Connect to main + defaults
    end

    Relays-->>NDK: Connected
```

## Staging Write Restriction

Staging has special behavior: it reads from all connected relays but **only writes to the staging relay**. This prevents staging data from polluting production relays.

```mermaid
flowchart LR
    subgraph Staging["Staging Environment"]
        APP[Application]
    end

    subgraph ReadRelays["READ from All"]
        R1["relay.staging.plebeian.market"]
        R2["relay.nostr.band"]
        R3["nos.lol"]
        R4["relay.damus.io"]
        R5["...other defaults"]
    end

    subgraph WriteRelay["WRITE to Staging Only"]
        W1["relay.staging.plebeian.market"]
    end

    APP -->|"subscribe()"| R1
    APP -->|"subscribe()"| R2
    APP -->|"subscribe()"| R3
    APP -->|"subscribe()"| R4
    APP -->|"subscribe()"| R5
    
    APP -->|"publish()"| W1
```

## Development Mode

Development mode supports two configurations via the `LOCAL_RELAY_ONLY` environment variable:

```mermaid
flowchart TB
    DEV[Development Mode]
    
    DEV --> CHECK{LOCAL_RELAY_ONLY?}
    
    CHECK -->|true| LOCAL["Connect to localhost only<br/>ws://localhost:10547"]
    CHECK -->|false| FULL["Connect to localhost + default relays"]
    
    LOCAL --> ISOLATED["Isolated testing<br/>No external network"]
    FULL --> INTEGRATED["Integrated testing<br/>Read from public network"]
```

### When to use each mode

| Mode | Use Case |
|------|----------|
| `LOCAL_RELAY_ONLY=true` | Isolated testing, no internet, fast iteration |
| `LOCAL_RELAY_ONLY=false` | Testing with real data, integration testing |

## Configuration Files

### Environment Variables

```bash
# .env.dev (local development)
NODE_ENV=development
APP_RELAY_URL=ws://localhost:10547
LOCAL_RELAY_ONLY=true  # Set to 'false' to include default relays

# Production
NODE_ENV=production
APP_RELAY_URL=wss://relay.plebeian.market

# Staging
NODE_ENV=production
APP_RELAY_URL=wss://relay.staging.plebeian.market
```

## Default Public Relays

These relays are used in addition to the main relay (unless `LOCAL_RELAY_ONLY=true` in development):

- `wss://relay.nostr.band`
- `wss://nos.lol`
- `wss://relay.nostr.net`
- `wss://relay.damus.io`
- `wss://relay.minibits.cash`

## Code References

- **Stage Type & Constants**: [constants.ts](file:///Users/schlaus/workspace/market/src/lib/constants.ts)
- **NDK Store & Relay Logic**: [ndk.ts](file:///Users/schlaus/workspace/market/src/lib/stores/ndk.ts)
- **Config Store**: [config.ts](file:///Users/schlaus/workspace/market/src/lib/stores/config.ts)
- **Server Config API**: [index.tsx](file:///Users/schlaus/workspace/market/src/index.tsx)
