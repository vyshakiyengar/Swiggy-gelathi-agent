# 🛒 Sahayaka — Household Swiggy WhatsApp Agents

An autonomous, multi-turn grocery and food ordering assistant for two household WhatsApp numbers, configurable from a private web desk. Each person can use their own Swiggy login, delivery address, language, voice behavior, preferences, and instructions. Powered by **Google Gemini AI**, **Meta WhatsApp Business Cloud API**, and Swiggy's official **Instamart and Food MCP servers**.

This release is intentionally household-scoped: it seeds `mother` and `self` profiles. The profile/store boundary is designed to support a future account system, but public signup, billing, and arbitrary tenant creation are not part of this version.

---

## 🌟 Key Features

- 🗣️ **Profile-specific language**: Understands Kannada script, Kanglish (Kannada in the English alphabet), and English. Each profile can reply in English, Kannada, dual-script Kanglish + Kannada, or match the sender.
- 🎙️ **Voice notes**: Send a voice note instead of typing - understood natively by Gemini, with an optional faster/more-accurate Kannada path via Gnani (trial, easily removable - see below). Replies to voice notes get a spoken Kannada voice note back too, alongside the usual text.
- 🛵 **Real Swiggy Integration**: Talks directly to Swiggy's official MCP servers for both Instamart (`mcp.swiggy.com/im`) and Food delivery (`mcp.swiggy.com/food`) - real product/restaurant search, real cart, real orders on a real account. No sandbox (Food orders are capped at ₹1000 while Swiggy's Food MCP is in beta).
- 💳 **Payment buttons**: Tap-to-choose Cash on Delivery / Google Pay / PhonePe buttons at the payment step.
- 📱 **Official Meta WhatsApp Cloud API**: Text and voice messaging, read receipts, and webhook-based conversation handling.
- 🔐 **Self-service session renewal**: Swiggy's auth doesn't issue refresh tokens, so a cron checks session validity and WhatsApps a relink link when it's about to expire - one tap from a phone, no laptop or code required.
- ☁️ **24/7 Cloud Architecture**: Dockerized production deployment on Render.
- 🏠 **Private household desk**: Switch between both WhatsApp numbers, configure each agent, connect separate Swiggy accounts, select saved addresses, and run safe diagnostics.
- 🔀 **Real profile isolation**: Persona, conversation memory, Swiggy token, address, capabilities, and ordering preferences resolve from the incoming WhatsApp number.
- 🧯 **Quick triage**: See WhatsApp, Gemini, Swiggy-session, address, custom-domain, and optional voice readiness without attempting an order.

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
    Owner[Private household desk] --> Profiles[Profile store]
    User[Household member on WhatsApp] <-->|Meta Cloud API| Webhook[Express Webhook Engine]
    Webhook --> Profiles
    Webhook -.->|voice note| Gnani[Gnani STT/TTS - optional]
    Webhook <--> Gemini[Gemini LLM Agent]
    Profiles --> Gemini
    Gemini <--> MCPim[Swiggy Instamart MCP]
    Gemini <--> MCPfood[Swiggy Food MCP]
    MCPim <--> SwiggyAPI[Real Swiggy Account]
    MCPfood <--> SwiggyAPI
    Cron[Relink Reminder Cron] -->|WhatsApp| User
    User -->|taps relink link| OAuthCallback[/swiggy/oauth/callback]
    OAuthCallback --> MCPim
```

---

## 🏠 Household configuration desk

Start the service and open `http://localhost:3000/`.

1. Choose **Sudha** or **Vyshak** in the profile switcher.
2. Add the WhatsApp number with country code.
3. Set the name, reply language, enabled services, preferences, and any extra instructions.
4. Connect that profile's Swiggy account.
5. Sync Swiggy's saved addresses and choose the one this agent should always use.
6. Run the readiness check. No diagnostic action places an order.

In production, `DASHBOARD_PASSWORD` is mandatory. The HTML shell can render a login screen, but all configuration, connection, and diagnostic APIs fail closed without an authenticated dashboard session. Passwordless local development is also disabled by default; it requires the explicit `DASHBOARD_ALLOW_LOCAL_AUTH_BYPASS=true` flag, a loopback client, no configured password, and a non-production `NODE_ENV`.

Incoming WhatsApp routing is fail-closed. Only an exact normalized phone number saved on a profile can select that profile; a blank, malformed, or unknown number is rejected and never inherits another person's Swiggy session, address, cart, preferences, or instructions.

Meta webhook POSTs are verified against the exact raw request bytes using `WHATSAPP_APP_SECRET`. Missing or invalid signatures fail closed before any profile, Gemini, WhatsApp, Gnani, or Swiggy work begins.

The default profile store is `.agent-data/agent-profiles.json` with restrictive filesystem permissions. Set `AGENT_PROFILE_STORE_PATH` to a persistent-disk location in deployment. It is a local-household store, not a substitute for encrypted tenant credentials and a real identity system when this becomes a public product.

## 🔑 Linking Swiggy (per profile)

Swiggy's Instamart MCP uses OAuth (phone + OTP), and its auth server does not issue refresh tokens - access tokens last ~5 days. To link (or relink):

1. Deploy the app first (`PUBLIC_BASE_URL` must point at a real, reachable HTTPS URL - Swiggy redirects back to `{PUBLIC_BASE_URL}/swiggy/oauth/callback`).
2. Open the private desk, select a profile, and choose **Connect Swiggy**.
3. Log in with that person's phone + OTP (or approve an existing browser session).
4. The callback stores the access token server-side for that profile and returns to the desk. Tokens are never rendered in HTML or returned by the profile API.
5. Sync and select one of that account's saved Swiggy addresses.

After that, a profile-scoped cron checks each linked session every 6 hours and sends its configured WhatsApp number a fresh relink link when under 48 hours remain or a live read-only MCP probe fails.

> **Current Swiggy OAuth constraint:** Swiggy has been rejecting `*.onrender.com` callback URLs. Attach `swiggy.vyshak.me` to the Render service, add Render's DNS record, wait for the domain to verify, and then set `PUBLIC_BASE_URL=https://swiggy.vyshak.me` before relying on dashboard relinking.

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
WHATSAPP_APP_SECRET=your_meta_app_secret
WHATSAPP_API_VERSION=v21.0

PUBLIC_BASE_URL=https://your-app.onrender.com
DASHBOARD_PASSWORD=choose_a_long_unique_password
# Optional for passwordless loopback-only local development; never enable in deployment.
DASHBOARD_ALLOW_LOCAL_AUTH_BYPASS=false
AGENT_PROFILE_STORE_PATH=/var/data/agent-profiles.json

MOTHER_WHATSAPP_NUMBER=919876543210
SELF_WHATSAPP_NUMBER=919876543211

SWIGGY_ACCESS_TOKEN=          # obtained via the linking flow above
SWIGGY_DEFAULT_ADDRESS_ID=    # Swiggy's ID for the one saved delivery address

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

# Open the private household desk
open http://localhost:3000/

# Safe, network-free profile isolation test
npm run test:profiles

# Safe dashboard/auth smoke test; blocks all non-loopback fetches
npm run test:dashboard

# Safe offline OAuth, webhook-signature, and payment-state tests
npm run test:swiggy-auth
npm run test:webhook-auth
npm run test:payment-safety

# Live integration scripts (read the warning below first)
npm run test:agent   # Multi-turn Kanglish agent conversation (stops before checkout - no real order)
npm run test:cloud   # Meta webhook simulation
```

`test:agent`, `test:cloud`, `/api/chat`, and the WhatsApp test action can reach real external services when credentials are present. There is no Swiggy sandbox. Never automate a confirmed checkout flow: a successful checkout test is a real paid order.

---

## 📦 Deployment

This service includes a production-ready `Dockerfile` and is designed for deployment on **Render**, **Railway**, or **Google Cloud Run**.

```bash
docker build -t swiggy-instamart-agent .
docker run -p 3000:3000 --env-file .env swiggy-instamart-agent
```

For Render, attach a persistent disk and point `AGENT_PROFILE_STORE_PATH` at it before using the dashboard as the source of truth. Otherwise profile changes and renewed Swiggy sessions disappear on restart.
