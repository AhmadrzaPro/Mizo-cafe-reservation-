// Shared types for JSDoc annotations in the Worker. Checked by `npm run typecheck`.

export interface Env {
  DB: D1Database;
  DEMO_MODE?: string;
  DEFAULT_CAFE_SLUG?: string;
  KAVENEGAR_API_KEY?: string;
  KAVENEGAR_TEMPLATE?: string;
  KAVENEGAR_CONFIRMATION_TEMPLATE?: string;
  KAVENEGAR_REMINDER_TEMPLATE?: string;
  OPENAI_API_KEY?: string;
  MAP_VISION_MODEL?: string;
  CLIENT_IP_HEADER?: string;
  /** "oai-header" only on a host that sets oai-authenticated-user-* itself. */
  SAAS_ADMIN_AUTH?: string;
  /** The platform's card for cafés paying their subscription card to card. */
  SUBSCRIPTION_CARD_NUMBER?: string;
  SUBSCRIPTION_CARD_HOLDER?: string;
  /** "zarinpal" to take deposits through ZarinPal. */
  PAYMENT_GATEWAY?: string;
  ZARINPAL_MERCHANT_ID?: string;
  /** "true" to use sandbox.zarinpal.com. */
  ZARINPAL_SANDBOX?: string;
  /** "all", or café slugs separated by commas, to offer the Virtual Cafe. */
  VIRTUAL_CAFE?: string;
  [limit: `RATE_LIMIT_${string}` | `${string}_PER_${string}`]: string | undefined;
}

/** A signed-in staff member, as returned by sessionStaff(). */
export interface Staff {
  id: string;
  cafe_id: string;
  branch_id: string | null;
  mobile: string;
  name: string;
  role: "owner" | "branch_manager" | "reception" | "barista";
  active: number;
  cafe_slug: string;
  session_id: string;
}

/** An active branch, as returned by branchRow(). */
export interface Branch {
  id: string;
  cafe_id: string;
  name: string;
  city: string;
  address: string;
  active: number;
  space_mode: string;
}
