import { z } from "zod";

// ===============================
// Product Review (Kind: 31555)
// ===============================

const ReviewReferenceTagSchema = z.tuple([
    z.literal("d"),
    z.string().regex(/^a:30402:[0-9a-f]{64}:[a-zA-Z0-9_-]+$/,
        "Must be in format a:30402:pubkey:d-identifier")
]);

const ReviewPrimaryRatingTagSchema = z.tuple([
    z.literal("rating"),
    z.string().regex(/^[01](\.\d+)?$/, "Must be a number between 0 and 1"),
    z.literal("thumb")
]);

const ReviewCategoryRatingTagSchema = z.tuple([
    z.literal("rating"),
    z.string().regex(/^[01](\.\d+)?$/, "Must be a number between 0 and 1"),
    z.string() // category name
]);

// Complete Product Review Schema
export const ProductReviewSchema = z.object({
    kind: z.literal(31555),
    created_at: z.number().int().positive(),
    tags: z.array(
        z.union([
            // Required tags
            ReviewReferenceTagSchema,
            ReviewPrimaryRatingTagSchema,

            // Optional tags
            ReviewCategoryRatingTagSchema
        ])
    ).refine(
        (tags) => {
            // Verify required tags are present
            return tags.some(tag => tag[0] === "d") &&
                tags.some(tag => tag[0] === "rating" && tag[2] === "thumb");
        },
        {
            message: "Missing required tags: d (product reference), rating with thumb category"
        }
    ),
    content: z.string()
});