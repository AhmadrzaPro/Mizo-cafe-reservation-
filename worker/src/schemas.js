import * as z from "zod/mini";
import { readJson } from "./http.js";
// Request-body shapes for the public endpoints. They check types and sizes only; each handler
// still applies its own business rules and answers them with its specific error codes.
// looseObject keeps fields a schema does not list, so handlers see the body unchanged.
// zod/mini keeps the Worker bundle small: only the validators used here are included.
/** @param {number} max */
const text = (max) => z.optional(z.string().check(z.maxLength(max)));
const mobile = z.optional(z.union([z.string().check(z.maxLength(20)), z.number()]));
export const schemas = {
  otpRequest: z.looseObject({ cafeSlug: text(64), mobile }),
  otpVerify: z.looseObject({
    cafeSlug: text(64),
    challengeId: text(100),
    mobile,
    code: z.optional(z.union([z.string().check(z.maxLength(12)), z.number()])),
    name: text(70),
  }),
  setup: z.looseObject({
    cafeName: text(200),
    city: text(200),
    branchName: text(200),
    branchSlug: text(64),
    address: text(500),
    ownerMobile: mobile,
    ownerName: text(200),
    structure: text(20),
  }),
  publicReservation: z.looseObject({
    customerName: text(200),
    mobile,
    notes: text(1000),
    date: text(10),
    time: text(5),
    partySize: z.optional(z.union([z.number(), z.string().check(z.maxLength(3))])),
    tableIds: z.optional(
      z.array(z.union([z.string().check(z.maxLength(120)), z.number()])).check(z.maxLength(10)),
    ),
    source: text(20),
    holdToken: text(80),
  }),
  hold: z.looseObject({
    date: text(10),
    time: text(5),
    partySize: z.optional(z.union([z.number(), z.string().check(z.maxLength(3))])),
    tableId: text(160),
  }),
  holdRelease: z.looseObject({ token: text(80) }),
  trackingAction: z.looseObject({ mobile }),
  cardTransfer: z.looseObject({
    reference: z.optional(z.union([z.string().check(z.maxLength(60)), z.number()])),
    cardLast4: z.optional(z.union([z.string().check(z.maxLength(8)), z.number()])),
  }),
};
// Thrown for a JSON body that does not match its schema; the API answers it with 400.
export class InvalidBodyError extends Error {
  /** @param {string[]} fields */
  constructor(fields) {
    super("invalid_request");
    this.fields = fields;
  }
}
/**
 * Reads the request body as JSON and checks it against `schema`.
 * @template T
 * @param {Request} request
 * @param {z.ZodMiniType<T>} schema
 * @returns {Promise<T>}
 */
export async function readBody(request, schema) {
  const result = schema.safeParse(await readJson(request));
  if (!result.success)
    throw new InvalidBodyError([
      ...new Set(result.error.issues.map((issue) => issue.path.join(".") || "body")),
    ]);
  return result.data;
}
