# 🛒 Swiggy Instamart WhatsApp Agent for Mom (Amma Sahayaka)

An autonomous, multi-turn AI grocery ordering assistant designed for Indian households to order groceries via WhatsApp in **Kannada, Kanglish, and English**. Powered by **Google Gemini AI**, **Meta WhatsApp Business Cloud API**, and Swiggy's official **Instamart MCP server**.

---

## 🌟 Key Features

- 🗣️ **Trilingual Natural Language Understanding**: Speaks and understands native Kannada script, Kanglish (Kannada in English alphabet), and English.
- 🛵 **Real Swiggy Instamart Integration**: Talks directly to Swiggy's official Instamart MCP server (`mcp.swiggy.com/im`) - real product search, real cart, real orders on a real account. No sandbox.
- 📱 **Official Meta WhatsApp Cloud API**: Text messaging, read receipts, and webhook-based conversation handling.
- 🔐 **Self-service session renewal**: Swiggy's auth doesn't issue refresh tokens, so a cron checks session validity and WhatsApps a relink link when it's about to expire - one tap from a phone, no laptop or code required.
- ☁️ **24/7 Cloud Architecture**: Dockerized production deployment on Render.

---

## 🛠️ Swiggy Instamart MCP Tools Used

The agent calls Swiggy's real MCP tools directly (schemas are fetched live from their server, not hand-transcribed - see `src/swiggy/gemini_tools.ts`). The delivery address is fixed to one saved household address and injected automatically; the agent never asks which address to use.

| Tool Name | Description |
| :--- | :--- |
| `search_products` | Search live Instamart inventory for the configured delivery address |
| `your_go_to_items` | Frequently/recently ordered items |
| `get_cart` | Itemized cart with real bill breakdown (fees, GST, total) |
| `update_cart` | Replaces the entire cart with the given items (not incremental - see agent system prompt) |
| `clear_cart` | Empty the cart |
| `checkout` | Place the order - **real order, real charge**, requires explicit user confirmation |
| `confirm_order` | Finalizes a pending order after payment |
| `get_payment_options` / `check_payment_status` | UPI payment flow |
| `get_orders` / `track_order` | Order history and live tracking |

`get_addresses`, `get_delivery_status`, and `report_error` are intentionally not exposed to the conversational agent (address is fixed; the other two aren't relevant to a WhatsApp bot).

---

## 🏛️ System Architecture

```mermaid
flowchart LR
    User[Mom on WhatsApp] <-->|Meta Cloud API| Webhook[Express Webhook Engine]
    Webhook <--> Gemini[Gemini LLM Agent]
    Gemini <--> MCP[Swiggy Instamart MCP]
    MCP <--> SwiggyAPI[Real Swiggy Account]
    Cron[Relink Reminder Cron] -->|WhatsApp| User
    User -->|taps relink link| OAuthCallback[/swiggy/oauth/callback]
    OAuthCallback --> MCP
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

DEFAULT_USER_NAME="Amma"
```

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
