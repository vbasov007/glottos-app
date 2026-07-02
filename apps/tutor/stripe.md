# Stripe Payments Setup Guide

## Prerequisites

- A Stripe account ([dashboard.stripe.com](https://dashboard.stripe.com))
- The app deployed with a public HTTPS URL

## Step 1: Create a Product and Price

1. Go to **Stripe Dashboard > Product catalog > + Add product**
2. Name: `Pro Plan` (or whatever you prefer)
3. Add a recurring price:
   - Amount: your price (e.g. $9.99)
   - Billing period: **Every 3 months** (quarterly)
   - Currency: USD (or your preferred currency)
4. Save the product
5. You can add more prices later (monthly, yearly) — the app fetches all active prices dynamically

## Step 2: Get API Keys

1. Go to **Stripe Dashboard > Developers > API keys**
2. Copy the **Secret key** (starts with `sk_test_` for test mode, `sk_live_` for production)
3. Add to your `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   ```

## Step 3: Set Up the Webhook

1. Go to **Stripe Dashboard > Developers > Webhooks > + Add endpoint**
2. Endpoint URL: `https://your-domain.com/api/stripe/webhook`
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Click **Add endpoint**
5. Copy the **Signing secret** (starts with `whsec_`)
6. Add to your `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

## Step 4: Enable Customer Portal

1. Go to **Stripe Dashboard > Settings > Billing > Customer portal**
2. Enable the portal
3. Configure allowed actions:
   - Cancel subscription: **enabled**
   - Switch plans: **enabled** (if you have multiple prices)
   - Update payment method: **enabled**
4. Save

## Step 5: Deploy

1. Add both env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) to your hosting environment
2. Redeploy the app
3. The database migration runs automatically on startup (adds subscription columns and daily_usage table)

## Step 6: Test (Test Mode)

Use Stripe's test card numbers to verify the flow:

| Card Number        | Scenario              |
|--------------------|-----------------------|
| 4242 4242 4242 4242 | Successful payment   |
| 4000 0000 0000 3220 | Requires 3D Secure   |
| 4000 0000 0000 9995 | Payment declined     |

Expiry: any future date. CVC: any 3 digits.

**Test the full flow:**
1. Open the app, make 5+ explain requests to hit the free limit
2. The upgrade modal should appear on the 6th request
3. Click Subscribe — you'll be redirected to Stripe Checkout
4. Use test card `4242 4242 4242 4242`, any future expiry, any CVC
5. After payment, you're redirected back with unlimited access
6. Go to Settings > Manage billing — opens Stripe Customer Portal
7. Cancel the subscription in the portal — verify the app shows "Cancels on {date}"

**Test webhooks locally** with the Stripe CLI:
```bash
stripe listen --forward-to localhost:4000/api/stripe/webhook
```
This prints a temporary webhook secret — use it as `STRIPE_WEBHOOK_SECRET` in `.env` for local testing.

## Step 7: Go Live

1. Switch Stripe Dashboard from **Test mode** to **Live mode** (toggle in top-right)
2. Create the same product and price in live mode
3. Add a new webhook endpoint with the same events pointing to your production URL
4. Replace `.env` values with live keys (`sk_live_...`, `whsec_...`)
5. Redeploy

## How It Works

- **Free users**: limited to 5 explanations, 5 TTS requests, and 2 text generations per day (configurable in Admin > Settings: `free_daily_explains`, `free_daily_tts`, `free_daily_generates`)
- **Pro users**: unlimited usage
- **Dev mode**: if `STRIPE_SECRET_KEY` is not set, all users get unlimited access (no paywall)
- **Admins**: always bypass quota regardless of subscription status
- **Grace period**: `past_due` status (failed payment) is treated as active while Stripe retries (~2 weeks)
- **Cancellation**: user keeps access until the end of the billing period
