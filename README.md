# 🛒 Swiggy WhatsApp Agent for Sudha Akka

An autonomous, multi-turn AI grocery and food ordering assistant, built for Sudha Akka to order via WhatsApp in **Kannada, Kanglish, and English** - by voice note or text. Powered by **Google Gemini AI**, **Meta WhatsApp Business Cloud API**, and Swiggy's official **Instamart and Food MCP servers**.

---

## 🌟 Key Features

- 🗣️ **Trilingual Natural Language Understanding**: Speaks and understands native Kannada script, Kanglish (Kannada in English alphabet), and English. Every reply comes back in both Kanglish and pure Kannada script.
- 🎙️ **Voice notes**: Send a voice note instead of typing - understood natively by Gemini, with an optional faster/more-accurate Kannada path via Gnani (trial, easily removable - see below). Replies to voice notes get a spoken Kannada voice note back too, alongside the usual text.
- 🛵 **Real Swiggy Integration**: Talks directly to Swiggy's official MCP servers for both Instamart (`mcp.swiggy.com/im`) and Food delivery (`mcp.swiggy.com/food`) - real product/restaurant search, real cart, real orders on a real account. No sandbox (Food orders are capped at ₹1000 while Swiggy's Food MCP is in beta).
- 💳 **Payment buttons**: Tap-to-choose Cash on Delivery / Google Pay / PhonePe buttons at the payment step.
- 📱 **Official Meta WhatsApp Cloud API**: Text and voice messaging, read receipts, and webhook-based conversation handling.
- 🔐 **Self-service session renewal**: Swiggy's auth doesn't issue refresh tokens, so a cron checks session validity and WhatsApps a relink link when it's about to expire - one tap from a phone, no laptop or code required.
- ☁️ **24/7 Cloud Architecture**: Dockerized production deployment on Render.

---

## 🛠️ Swiggy MCP Tools Used

The agent calls Swiggy's real MCP tools directly on both servers (schemas fetched live, not hand-transcribed - see `src/swiggy/gemini_tools.ts`). The delivery address is fixed to one saved household address and injected automatically; the agent never asks which address to use.

**Instamart (groceries), `mcp.swiggy.com/im`:**

| Tool Name | Description |
| :--- | :--- |
| `search_products` | Search live Instamart inventory for the configured delivery address |
| `your_go_to_items` | Frequently/recently ordered items |
| `get_cart` | Itemized cart with real bill breakdown (fees, GST, total) |
| `update_cart` | Replaces the entire cart with the given items (not incremental - see agent system prompt) |
| `clear_cart` | Empty the cart |
| `checkout` | Place the order - **real order, real charge**, requires explicit user confirmation |
| `get_orders` / `track_order` | Order history and live tracking |

**Food delivery, `mcp.swiggy.com/food`:**

| Tool Name | Description |
| :--- | :--- |
| `search_restaurants` / `search_menu` / `get_restaurant_menu` | Restaurant and dish discovery |
| `get_food_cart` / `update_food_cart` / `flush_food_cart` | Cart (additive, unlike Instamart's - always call `get_food_cart` after updating to see the result) |
| `place_food_order` | Place the order - **real order, real charge**, capped at ₹1000 while the Food MCP is in beta |
| `fetch_food_coupons` / `apply_food_coupon` | Coupons |
| `get_food_orders` / `get_food_order_details` / `track_food_order` | Order history and live tracking |

**Shared across both** (fetched once via the Instamart connection, since Gemini requires unique function names): `get_payment_options`, `check_payment_status`, `confirm_order`.

`get_addresses`, `get_delivery_status`/`get_food_delivery_status`, and `report_error` are intentionally not exposed to the conversational agent (address is fixed; the others aren't relevant to a WhatsApp bot). `executeSwiggyTool` enforces this as a real allowlist, not just a declaration-time filter - Gemini has occasionally tried calling `get_addresses` despite never being told about it (a known LLM failure mode), and that attempt is refused rather than silently executed against the real account.

---

## 🏛️ System Architecture

```mermaid
flowchart LR
    User[Sudha Akka on WhatsApp] <-->|Meta Cloud API| Webhook[Express Webhook Engine]
    Webhook -.->|voice note| Gnani[Gnani STT/TTS - optional]
    Webhook <--> Gemini[Gemini LLM Agent]
    Gemini <--> MCPim[Swiggy Instamart MCP]
    Gemini <--> MCPfood[Swiggy Food MCP]
    MCPim <--> SwiggyAPI[Real Swiggy Account]
    MCPfood <--> SwiggyAPI
    Cron[Relink Reminder Cron] -->|WhatsApp| User
    User -->|taps relink link| OAuthCallback[/swiggy/oauth/callback]
    OAuthCallback --> MCPim
```

---

## 🔑 Linking Swiggy (one-time, then self-renewing)

Swiggy's Instamart MCP uses OAuth (phone + OTP), and its auth server does not issue refresh tokens - access tokens last ~5 days. To link (or relink):

1. Deploy the app first (`PUBLIC_BASE_URL` must point at a real, reachable HTTPS URL - Swiggy redirects back to `{PUBLIC_BASE_URL}/swiggy/oauth/callback`).
2. Visit `{PUBLIC_BASE_URL}/swiggy/relogin-link`, open the returned URL, and log in (phone + OTP, or just approve if already logged in).
3. The callback exchanges the code for an access token server-side and the bot is live - no restart needed.

After that, a cron (`src/swiggy/relogin_reminder.ts`) checks session validity every 6 hours and WhatsApps a fresh relink link to the numbers in `SWIGGY_RELOGIN_REMINDER_NUMBERS` once under 48 hours of validity remain. Relinking is then just tapping that link and approving - no laptop or code involved.

---

## 🚀 Environment Configuration

See `.env.example` for the full list. Key pieces:

```env
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-flash-lite-latest

WHATSAPP_TOKEN=your_permanent_system_user_token
WHATSAPP_PHONE_NUMBER_ID=your_meta_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_meta_waba_id
WHATSAPP_VERIFY_TOKEN=your_webhook_verify_token
WHATSAPP_API_VERSION=v21.0

PUBLIC_BASE_URL=https://your-app.onrender.com
SWIGGY_ACCESS_TOKEN=          # obtained via the linking flow above
SWIGGY_DEFAULT_ADDRESS_ID=    # Swiggy's ID for the one saved delivery address
SWIGGY_RELOGIN_REMINDER_NUMBERS=919876543210,919876543211

GNANI_API_KEY=                 # optional, trial - see "Removing Gnani" below
```

---

## 🎙️ Gnani voice notes (trial - built to be removed in one command)

Voice notes work with just Gemini (native audio understanding) and no Gnani key at all - Gnani is a layered-on trial for faster/more-accurate Kannada transcription plus a spoken Kannada voice-note reply. It's on limited trial credit and may be turned off.

**How it's isolated:** all Gnani-specific code lives in `src/gnani/` (`stt.ts`, `tts.ts`) and nowhere else. The only integration points are a few clearly-commented lines in `src/whatsapp/webhook.ts` (search for "Gnani trial integration"). `src/gnani/stt.ts` fails soft to `null` on any error/timeout (2.5s budget), which `webhook.ts` treats as "fall back to Gemini's native audio path." `src/gnani/tts.ts` is pure best-effort - it runs *after* the text reply is already sent, and if translation, synthesis, or sending fails, it's skipped silently. Nothing about the core text/grocery/food flow depends on Gnani at all.

**Removing Gnani, two ways:**
1. **Instant, no redeploy**: delete the `GNANI_API_KEY` env var on Render. Every Gnani call checks for this first and no-ops immediately if it's missing - voice notes keep working via Gemini's native understanding, just without the spoken reply.
2. **Remove the code entirely**: find the commit that introduced `src/gnani/` (`git log --oneline -- src/gnani/`), then `git revert <that-sha>` and push. Because it landed as one self-contained commit, the revert cleanly removes `src/gnani/`, the `webhook.ts` integration lines, and the `uploadMedia`/`sendAudioMessage` additions to `cloud_api.ts`, with nothing else touched.

---

## 🧪 Local Development & Testing

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Run test suites
npm run test:agent   # Multi-turn Kanglish agent conversation (stops before checkout - no real order)
npm run test:cloud   # Meta webhook simulation
```

---

## 📦 Deployment

This service includes a production-ready `Dockerfile` and is designed for deployment on **Render**, **Railway**, or **Google Cloud Run**.

```bash
docker build -t swiggy-instamart-agent .
docker run -p 3000:3000 --env-file .env swiggy-instamart-agent
```
