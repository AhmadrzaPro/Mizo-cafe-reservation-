# Payments

There are two flows of money, and they use different channels:

- **Customers pay cafés deposits** through the payment gateway (ZarinPal). With many cafés, card transfers to each café could not be matched to who paid.
- **Cafés pay the platform a subscription** card to card, approved by hand in the SaaS console.

## Customer deposits (ZarinPal)

A branch can ask for a deposit on every booking or only at peak times, as a fixed amount or per person (booking settings). Configure the gateway:

| Variable | Value |
| --- | --- |
| `PAYMENT_GATEWAY` | `zarinpal` |
| `ZARINPAL_MERCHANT_ID` | The merchant ID from the ZarinPal panel (secret) |
| `ZARINPAL_SANDBOX` | `true` for `sandbox.zarinpal.com`; unset in production |

A configured gateway is used even with `DEMO_MODE=true`. Without one, demo mode simulates payments, and production refuses deposit bookings (`503 payment_not_configured`).

1. **Booking.** The reservation is `pending` with its deposit due, and the table is held until `payment.dueAt` (the branch's payment deadline).
2. **Start.** "Pay deposit" calls `POST /api/reservations/{code}/pay`. The Worker requests a payment for the deposit stored with the reservation (rials), records it in `payment_attempts` and returns `redirectUrl`. The page sends the customer to ZarinPal. The table stays held for at least 10 more minutes so they can finish at the bank.
3. **Return.** ZarinPal returns the customer to `GET /api/payments/zarinpal/callback?Authority=…&Status=OK|NOK`. The Worker claims the attempt once, then verifies the payment with the amount stored on the server, never one from the URL.
4. **Outcome.** A verified payment marks the deposit paid, records the ZarinPal reference, confirms the reservation (unless the branch confirms by hand) and sends the confirmation SMS. The customer lands on `/?cafe=…&code=…&payment=success|late|pending|failed`, where the tracking dialog shows the result.

When it goes wrong:

| Case | Result |
| --- | --- |
| Cancelled at the bank, or rejected by ZarinPal | Not verified, so no money is taken or ZarinPal returns it by itself (`failed`). The customer can pay again while the hold lasts |
| The hold expired while the customer was at the bank | Not verified, so ZarinPal returns the money (`failed`) |
| ZarinPal unreachable while verifying | `pending`; opening the same callback URL again retries |
| The hold was released while the money was being verified | `late`: the payment is recorded on the cancelled reservation so staff can refund it |
| The same callback arrives again | The deposit is marked paid once; later arrivals change nothing |

**Refunds** are made in the ZarinPal panel. "Refund" in the payments dialog then records it (provider `manual`) and cancels the reservation.

### Before going live

Set `ZARINPAL_SANDBOX=true`, enable deposits for a branch, then book and pay end to end. Then remove `ZARINPAL_SANDBOX` and set the production merchant ID.

## Café subscriptions (card to card)

Every café pays a monthly subscription to the platform: active branches × the per-branch price. Set `SUBSCRIPTION_CARD_NUMBER` (16 digits, Luhn-checked) and optionally `SUBSCRIPTION_CARD_HOLDER`.

The subscription is required. A new café starts a 14-day trial at setup. Owners cannot switch it off; to make a café free, switch its subscription off in the SaaS console, or set it active without an end date.

1. **Paying.** The owner's subscription dialog shows the card and one month's fee. The owner transfers it and reports the bank reference (and optionally the card's last 4 digits). Only one transfer per café can wait for review at a time.
2. **Reviewing.** The SaaS console lists transfers awaiting review, and flags a bank reference used more than once.
   - **Approve:** the subscription becomes active and the paid period grows by 30 days, from today or from the current period's end if later.
   - **Reject:** recorded in the café's subscription history.

### When a period ends unpaid

A trial (14 days) or paid period (30 days) that ends unpaid makes the subscription `past_due` at once, and adds an "expired" entry to the café's history.

- **Grace, 3 days:** the owner's panel shows a warning with the grace end date and a "Pay subscription" button. Booking stays open.
- **After the grace:** public online booking pauses. The booking page says booking is temporarily paused, and `POST …/reservations` returns `409 online_booking_paused`. The staff panel, existing reservations, tracking, and phone and walk-in bookings keep working.
- **Reopening:** approving a payment reopens booking at once.

The SaaS console shows past-due and paused cafés.
