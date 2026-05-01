#!/usr/bin/env bash
set -euo pipefail

RELAY_URL="${RELAY_URL:-ws://localhost:10547}"
BASE_URL="${BASE_URL:-http://localhost:34567}"
MERCHANT_SK="${MERCHANT_SK:-5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0}"
MERCHANT_PK="${MERCHANT_PK:-86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0}"

TITLE="$1"
D_TAG="$2"
CONTENT="$3"
shift 3
SHIPPING_TAGS=("$@")

NOW=$(date +%s)
END=$((NOW + 86400))

TAGS_JSON="["
TAGS_JSON+="[\"d\",\"$D_TAG\"],"
TAGS_JSON+="[\"title\",\"$TITLE\"],"
TAGS_JSON+="[\"summary\",\"Manual E2E test auction\"],"
TAGS_JSON+="[\"auction_type\",\"english\"],"
TAGS_JSON+="[\"start_at\",\"$NOW\"],"
TAGS_JSON+="[\"end_at\",\"$END\"],"
TAGS_JSON+="[\"currency\",\"SAT\"],"
TAGS_JSON+="[\"price\",\"1000\",\"SAT\"],"
TAGS_JSON+="[\"starting_bid\",\"1000\",\"SAT\"],"
TAGS_JSON+="[\"bid_increment\",\"100\"],"
TAGS_JSON+="[\"reserve\",\"0\"],"
TAGS_JSON+="[\"mint\",\"https://nofees.testnut.cashu.space\"],"
TAGS_JSON+="[\"escrow_pubkey\",\"020000000000000000000000000000000000000000000000000000000000000000\"],"
TAGS_JSON+="[\"key_scheme\",\"hd_p2pk\"],"
TAGS_JSON+="[\"p2pk_xpub\",\"xpub$(printf '%0*s' 100 '0')\"],"
TAGS_JSON+="[\"settlement_policy\",\"cashu_p2pk_v1\"],"
TAGS_JSON+="[\"schema\",\"auction_v1\"],"
TAGS_JSON+="[\"image\",\"https://cdn.satellite.earth/f8f1513ec22f966626dc05342a3bb1f36096d28dd0e6eeae640b5df44f2c7c84.png\"],"
TAGS_JSON+="[\"t\",\"Bitcoin\"]"

for tag in "${SHIPPING_TAGS[@]}"; do
    TAGS_JSON+=",$tag"
done

TAGS_JSON+="]"

EVENT_JSON=$(jq -n \
    --arg kind "30408" \
    --arg content "$CONTENT" \
    --argjson tags "$TAGS_JSON" \
    '{kind: ($kind|tonumber), content: $content, tags: $tags}')

NAK_OUTPUT=$(echo "$EVENT_JSON" | nak event --sec "$MERCHANT_SK" "$RELAY_URL" 2>&1)
EVENT_ID=$(echo "$NAK_OUTPUT" | grep -o '{".*}' | jq -r '.id' 2>/dev/null || true)

if [ -z "$EVENT_ID" ]; then
    echo ""
    echo "  ERROR: Failed to publish or extract event ID."
    echo "  Raw output above may have details."
    exit 1
fi

echo ""
echo "  Auction published: $EVENT_ID"
echo "  URL: $BASE_URL/auctions/$EVENT_ID"
echo ""
