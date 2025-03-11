import { z } from "zod";
import { geohash, iso3166Country, iso3166Region, iso4217Currency, iso8601Duration } from "./common";

// ===============================
// Shipping Option (Kind: 30406)
// ===============================

// Required Tags
const ShippingIdTagSchema = z.tuple([z.literal("d"), z.string()]);
const ShippingTitleTagSchema = z.tuple([z.literal("title"), z.string()]);
const ShippingPriceTagSchema = z.tuple([
    z.literal("price"),
    z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number"),
    iso4217Currency
]);
const ShippingCountryTagSchema = z.tuple([
    z.literal("country"),
    iso3166Country,
    z.array(iso3166Country).optional()
]);
const ShippingServiceTagSchema = z.tuple([
    z.literal("service"),
    z.enum(["standard", "express", "overnight", "pickup"])
]);

// Optional Tags
const ShippingCarrierTagSchema = z.tuple([
    z.literal("carrier"),
    z.string()
]);
const ShippingRegionTagSchema = z.tuple([
    z.literal("region"),
    iso3166Region,
    z.array(iso3166Region).optional()
]);
const ShippingDurationTagSchema = z.tuple([
    z.literal("duration"),
    z.string().regex(/^\d+$/, "Must be an integer"), // min
    z.string().regex(/^\d+$/, "Must be an integer"), // max
    iso8601Duration // unit
]);
const ShippingLocationTagSchema = z.tuple([
    z.literal("location"),
    z.string()
]);
const ShippingGeohashTagSchema = z.tuple([
    z.literal("g"),
    geohash
]);

// Weight and Dimension Constraints
const ShippingWeightMinTagSchema = z.tuple([
    z.literal("weight-min"),
    z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number"),
    z.string() // unit
]);
const ShippingWeightMaxTagSchema = z.tuple([
    z.literal("weight-max"),
    z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number"),
    z.string() // unit
]);
const ShippingDimMinTagSchema = z.tuple([
    z.literal("dim-min"),
    z.string().regex(/^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/, "Must be in format LxWxH"),
    z.string() // unit
]);
const ShippingDimMaxTagSchema = z.tuple([
    z.literal("dim-max"),
    z.string().regex(/^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/, "Must be in format LxWxH"),
    z.string() // unit
]);

// Price Calculations
const ShippingPriceWeightTagSchema = z.tuple([
    z.literal("price-weight"),
    z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number"),
    z.string() // unit
]);
const ShippingPriceVolumeTagSchema = z.tuple([
    z.literal("price-volume"),
    z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number"),
    z.string() // unit
]);
const ShippingPriceDistanceTagSchema = z.tuple([
    z.literal("price-distance"),
    z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number"),
    z.string() // unit
]);

// Complete Shipping Option Schema
export const ShippingOptionSchema = z.object({
    kind: z.literal(30406),
    created_at: z.number().int().positive(),
    content: z.string(),
    tags: z.array(
        z.union([
            // Required tags
            ShippingIdTagSchema,
            ShippingTitleTagSchema,
            ShippingPriceTagSchema,
            ShippingCountryTagSchema,
            ShippingServiceTagSchema,

            // Optional tags
            ShippingCarrierTagSchema,
            ShippingRegionTagSchema,
            ShippingDurationTagSchema,
            ShippingLocationTagSchema,
            ShippingGeohashTagSchema,
            ShippingWeightMinTagSchema,
            ShippingWeightMaxTagSchema,
            ShippingDimMinTagSchema,
            ShippingDimMaxTagSchema,
            ShippingPriceWeightTagSchema,
            ShippingPriceVolumeTagSchema,
            ShippingPriceDistanceTagSchema
        ])
    ).refine(
        (tags) => {
            // Verify required tags are present
            return tags.some(tag => tag[0] === "d") &&
                tags.some(tag => tag[0] === "title") &&
                tags.some(tag => tag[0] === "price") &&
                tags.some(tag => tag[0] === "country") &&
                tags.some(tag => tag[0] === "service");
        },
        {
            message: "Missing required tags: d, title, price, country, service"
        }
    )
});