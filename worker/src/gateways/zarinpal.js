// ZarinPal payment gateway (REST API v4). Amounts are sent in rials (currency IRR).
// Flow: request() returns an authority and the StartPay URL the customer is sent to; ZarinPal
// redirects back to the callback with ?Authority=…&Status=OK|NOK; verify() then settles the
// payment. A payment that is never verified is returned to the customer by ZarinPal.

const hosts = {
  production: "https://payment.zarinpal.com",
  sandbox: "https://sandbox.zarinpal.com",
};

export class GatewayError extends Error {
  /** @param {string} message @param {number | string} [code] */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** @param {import("../types").Env} env */
export function zarinpalGateway(env) {
  if (!env.ZARINPAL_MERCHANT_ID) return null;
  const host = env.ZARINPAL_SANDBOX === "true" ? hosts.sandbox : hosts.production,
    merchantId = env.ZARINPAL_MERCHANT_ID;
  /** @param {string} path @param {Record<string, unknown>} body */
  async function post(path, body) {
    let response;
    try {
      response = await fetch(`${host}/pg/v4/payment/${path}.json`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ merchant_id: merchantId, ...body }),
      });
    } catch (error) {
      throw new GatewayError(`zarinpal_unreachable: ${error?.message || error}`);
    }
    const data = await response.json().catch(() => null);
    if (!data) throw new GatewayError(`zarinpal_bad_response: ${response.status}`);
    return data;
  }
  return {
    name: "zarinpal",
    sandbox: host === hosts.sandbox,
    /**
     * @param {{ amountRials: number, callbackUrl: string, description: string, mobile?: string }} payment
     * @returns {Promise<{ authority: string, url: string }>}
     */
    async request({ amountRials, callbackUrl, description, mobile }) {
      const result = await post("request", {
        amount: amountRials,
        currency: "IRR",
        callback_url: callbackUrl,
        description,
        ...(mobile ? { metadata: { mobile } } : {}),
      });
      if (result.data?.code !== 100 || !result.data.authority)
        throw new GatewayError("zarinpal_request_failed", result.errors?.code ?? result.data?.code);
      return {
        authority: result.data.authority,
        url: `${host}/pg/StartPay/${result.data.authority}`,
      };
    },
    /**
     * Settles a payment. 100 is a fresh verification and 101 one that was already verified.
     * @param {{ amountRials: number, authority: string }} payment
     * @returns {Promise<{ ok: true, reference: string, cardPan: string } | { ok: false, code: number | string }>}
     */
    async verify({ amountRials, authority }) {
      const result = await post("verify", { amount: amountRials, authority });
      const code = result.data?.code;
      if (code === 100 || code === 101)
        return {
          ok: true,
          reference: String(result.data.ref_id),
          cardPan: result.data.card_pan || "",
        };
      return { ok: false, code: result.errors?.code ?? code ?? "unknown" };
    },
  };
}
