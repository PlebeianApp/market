# Gamma Markets Event Kinds

## Product Listing (Kind: 30402)

Products are the core element in a marketplace. Each product listing MUST contain basic metadata and MAY contain additional details. Their configuration is the source of truth, overriding other possible configurations of other market elements such as collections.

**Content**: Product description, markdown is allowed

**Required tags**:

- `d`: Unique product identifier for referencing the listing
- `title`: Product name/title for display
- `price`: Price information array `[<amount>, <currency>, <optional frequency>]`
  - amount: Decimal number (e.g., "10.99")
  - currency: ISO 4217 code (e.g., "USD", "EUR")
  - frequency: Optional subscription interval using ISO 8601 duration units (e.g. 'D' for daily, 'W' for weekly, 'Y' for yearly).

**Optional tags**:

- Product Details:
  - `type`: Product classification `[<type>, <format>]`
    - type: "simple", "variable", or "variation"
    - format: "digital" or "physical"
    - Default/if not present: type: "simple", format: "digital"
  - `visibility`: Display status ("hidden", "on-sale", "pre-order"). Default: "on-sale"
  - `stock`: Available quantity as integer
  - `summary`: Short product description
  - `spec`: Product specifications `[<key>, <value>]`, can appear multiple times

- Media:
  - `image`: Product images `[<url>, <dimensions>, <sorting-order>]`, MAY appear multiple times
    - url: Direct image URL
    - dimensions: Optional, in pixels, "<width>x<height>" format
    - sorting order: Optional integer for order sorting

- Physical Properties:
  - `weight`: Product weight `[<value>, <unit>]` using ISO 80000-1
  - `dim`: Dimensions `[<l>x<w>x<h>, <unit>]` using ISO 80000-1

- Location:
  - `location`: Human-readable location string or collection coordinates
  - `g`: Geohash for precise location lookup

- Organization:
  - `t`: Product categories/tags, MAY appear multiple times
  - `a`: Product reference "30402:<pubkey>:<d-tag>" (for variations pointing to parent)
  - `a`: Collection reference "30405:<pubkey>:<d-tag>", MAY appear multiple times
  - `shipping_option`: Shipping options, MAY appear multiple times
    - Format: "30406:<pubkey>:<d-tag>" for direct options
    - Format: "30405:<pubkey>:<d-tag>" for collection shipping
    - `extra-cost`: Optional third element to add extra cost

```jsonc
{
  "kind": 30402,
  "created_at": <unix timestamp>,
  "content": "<product description in markdown>",
  "tags": [
    ["d", "<product identifier>"],
    ["title", "<product title>"],
    ["price", "<amount>", "<currency>", "<optional frequency>"],
    ["type", "<simple|variable|variation>", "<digital|physical>"],
    ["visibility", "<hidden|on-sale|pre-order>"],
    ["stock", "<integer>"],
    ["summary", "<short description>"],
    ["image", "<url>", "<dimensions>", "<sorting-order>"],
    ["spec", "<key>", "<value>"],
    ["weight", "<value>", "<unit>"],
    ["dim", "<l>x<w>x<h>", "<unit>"],
    ["location", "<address string>"],
    ["g", "<geohash>"],
    ["t", "<category>"],
    ["shipping_option", "<30406|30405>:<pubkey>:<d-tag>", "<extra-cost>"],
    ["a", "30405:<pubkey>:<d-tag>"]
  ]
}
```

### Variable Products

- Parent product uses `variable` as value for `type`
- Variations use `variation` as value for `type`
- Variations MUST include an `a` tag pointing to the `variable` parent product

---

## Product Collection (Kind: 30405)

A specialized event type using NIP-51 like list format to organize related products into groups.

**Content**: Optional collection description

**Required tags**:

- `d`: Unique collection identifier
- `title`: Collection display name/title
- `a`: Product references `["a", "30402:<pubkey>:<d-tag>"]` (multiple allowed)

**Optional tags**:

- Display:
  - `image`: Collection banner/thumbnail URL
  - `summary`: Brief collection description
- Location:
  - `location`: Human-readable location string
  - `g`: Geohash for precise location lookup
- Reference Options:
  - `shipping_option`: Available shipping options `["shipping_option", "30406:<pubkey>:<d-tag>"]`

```jsonc
{
  "kind": 30405,
  "created_at": <unix timestamp>,
  "content": "<optional collection description>",
  "tags": [
    ["d", "<collection identifier>"],
    ["title", "<collection name>"],
    ["a", "30402:<pubkey>:<d-tag>"],
    ["image", "<collection image URL>"],
    ["summary", "<collection description>"],
    ["location", "<location string>"],
    ["g", "<geohash>"],
    ["shipping_option", "30406:<pubkey>:<d-tag>"]
  ]
}
```

**Important**: Products MUST explicitly reference collection resources to inherit collection attributes. No automatic cascading of settings to products.

---

## Shipping Option (Kind: 30406)

A specialized event type for defining shipping methods, costs, and constraints.

**Content**: Optional human-friendly shipping description

**Required tags**:

- `d`: Unique shipping option identifier
- `title`: Display title for the shipping method
- `price`: Base cost array `[<base_cost>, <currency>]`
- `country`: Array of ISO 3166-1 alpha-2 country codes
- `service`: Service type ("standard", "express", "overnight", "pickup")

**Optional tags**:

- `carrier`: The name of the carrier
- `region`: Array of ISO 3166-2 region codes
- `duration`: Delivery window `[<min>, <max>, <unit>]` (H/D/W)
- `location`: Physical address for pickup
- `g`: Geohash for precise location
- `weight-min`/`weight-max`: Weight constraints `[<value>, <unit>]`
- `dim-min`/`dim-max`: Dimension constraints `[<l>x<w>x<h>, <unit>]`
- `price-weight`/`price-volume`/`price-distance`: Per-unit pricing

```jsonc
{
  "kind": 30406,
  "created_at": <unix timestamp>,
  "content": "<optional shipping description>",
  "tags": [
    ["d", "<shipping identifier>"],
    ["title", "<shipping method title>"],
    ["price", "<base_cost>", "<currency>"],
    ["country", "<ISO 3166-1 alpha-2>", "..."],
    ["service", "<service-type>"],
    ["carrier", "<name of the carrier>"],
    ["region", "<ISO 3166-2 code>", "..."],
    ["duration", "<min>", "<max>", "<unit>"],
    ["location", "<address string>"],
    ["g", "<geohash>"],
    ["weight-min", "<value>", "<unit>"],
    ["weight-max", "<value>", "<unit>"],
    ["dim-min", "<l>x<w>x<h>", "<unit>"],
    ["dim-max", "<l>x<w>x<h>", "<unit>"],
    ["price-weight", "<price>", "<unit>"],
    ["price-volume", "<price>", "<unit>"],
    ["price-distance", "<price>", "<unit>"]
  ]
}
```

---

## Product Reviews (Kind: 31555)

Product reviews follow NIP-85 and QTS guidelines.

**Content:** Detailed review text

**Required tags:**

- `d`: Reference to product `["d", "a:30402:<merchant-pubkey>:<product-d-tag>"]`
- `rating`: Primary rating `["rating", "<score>", "thumb"]` (score: 0-1)

**Optional rating categories:**

- `value`: Price vs quality
- `quality`: Product quality
- `delivery`: Shipping experience
- `communication`: Merchant responsiveness

```jsonc
{
  "kind": 31555,
  "created_at": <unix timestamp>,
  "tags": [
    ["d", "a:30402:<merchant-pubkey>:<product-d-tag>"],
    ["rating", "1", "thumb"],
    ["rating", "0.8", "value"],
    ["rating", "1.0", "quality"],
    ["rating", "0.6", "delivery"],
    ["rating", "0.9", "communication"]
  ],
  "content": "Detailed review text"
}
```

**Rating Calculation:**

```
Total Score = (Thumb × 0.5) + (0.5 × (∑(Category Ratings) ÷ Number of Categories))
```
