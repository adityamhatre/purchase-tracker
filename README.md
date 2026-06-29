# Gmail Purchase Tracker Sync Engine

This repository hosts the backend sync engine for your personal purchase tracker. It runs on **Google Cloud Run** (Node.js/TypeScript), uses the **Google Gemini 1.5 Flash API** to parse receipt emails, and automatically saves them to **Supabase** (Postgres) with Row Level Security enabled.

---

## 🚀 Features
*   **Gmail Integration**: Automatically pulls purchase confirmation/invoice emails using a specific Gmail label.
*   **Gemini AI Parsing**: Fully extracts merchant name, date, total amount, currency, and line items using Gemini 1.5 Flash.
*   **Real-time sync**: Receives push notifications from Google Pub/Sub when a new email arrives.
*   **Supabase Database**: Stores purchases securely. Client apps can fetch data directly from Supabase.

---

## 🛠️ Step 1: Database Setup (Supabase)

1.  Create a free project on [Supabase](https://supabase.com).
2.  Go to the **SQL Editor** in your Supabase dashboard.
3.  Copy and run the contents of [supabase/migrations/20260629000000_init.sql](file:///Users/adityamhatre/projects/purchase-tracker/supabase/migrations/20260629000000_init.sql). This will:
    *   Create the `purchases` table.
    *   Enable Row Level Security (RLS).
    *   Allow authenticated client applications to read data while denying anonymous/public reads.

---

## 🔑 Step 2: Google Cloud Console Setup

To connect to Gmail and receive Pub/Sub messages, you must set up a Google Cloud project.

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project.
3.  **Enable APIs**: Enable both the **Gmail API** and **Pub/Sub API**.
4.  **OAuth Consent Screen**:
    *   Choose **External** (or Internal if you have a Google Workspace).
    *   Add your email address as a **Test User** (since the app remains in "Testing" mode).
    *   Add scope `https://www.googleapis.com/auth/gmail.readonly`.
5.  **Create Credentials**:
    *   Go to Credentials -> Create Credentials -> **OAuth Client ID**.
    *   Select **Web Application**.
    *   Add Authorized Redirect URI: `http://localhost:8080/auth/callback` (for local setup) and `https://<YOUR-CLOUD-RUN-URL>/auth/callback` (once deployed).
    *   Save the **Client ID** and **Client Secret**.

---

## 💻 Step 3: Local Setup & Authentication

1.  Clone this repository, then install dependencies:
    ```bash
    npm install
    ```
2.  Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```
3.  Fill in your `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY` (from Google AI Studio), and your Supabase credentials in the `.env` file.
4.  Start the development server:
    ```bash
    npm run dev
    ```
5.  Open your browser and navigate to **`http://localhost:8080/auth/google`**.
6.  Sign in with your Gmail account and grant the requested permissions.
7.  Upon redirect, you will see a success page displaying your `GOOGLE_REFRESH_TOKEN`.
8.  **Copy this token** and save it in your `.env` file as `GOOGLE_REFRESH_TOKEN`.
9.  Restart your server. You can now trigger a manual sync of recent emails with:
    ```bash
    curl -X POST "http://localhost:8080/sync?limit=5"
    ```

---

## 📦 Step 4: Deploying to Google Cloud Run

To host your server for free on Google Cloud Run:

1.  Make sure you have the [Google Cloud SDK (gcloud CLI)](https://cloud.google.com/sdk/docs/install) installed and logged in (`gcloud auth login`).
2.  Build and deploy the container:
    ```bash
    gcloud run deploy purchase-tracker-sync \
      --source . \
      --platform managed \
      --region us-central1 \
      --allow-unauthenticated
    ```
3.  Save the generated service URL (e.g., `https://purchase-tracker-sync-xxxxxx.a.run.app`).
4.  Update your OAuth credentials in the Google Cloud Console to add `https://purchase-tracker-sync-xxxxxx.a.run.app/auth/callback` to the **Authorized Redirect URIs**.
5.  Configure your environment variables in the Cloud Run service settings (or link Google Secret Manager for sensitive secrets like `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GEMINI_API_KEY`).

---

## 🔔 Step 5: Real-Time Gmail Notifications Setup

To trigger your deployed Cloud Run endpoint in real time whenever a purchase email arrives:

1.  **Create a Pub/Sub Topic**:
    *   Go to the Google Cloud Pub/Sub console.
    *   Create a topic named `gmail-notifications`.
2.  **Grant Gmail Permissions**:
    *   Gmail needs permission to publish to your topic. Grant the Pub/Sub Publisher role to Google's service account: `gmail-api-push@system.gserviceaccount.com`.
3.  **Create a Push Subscription**:
    *   Create a subscription on your `gmail-notifications` topic.
    *   Delivery Type: **Push**.
    *   Endpoint URL: `https://<YOUR-CLOUD-RUN-URL>/webhook/pubsub?secret=<YOUR_PUBSUB_SECRET>`
4.  **Register the Watch**:
    *   To start receiving notifications, call Gmail's `watch` API. We will implement a registration helper, or you can register it using Google API Explorer. The watch needs to be renewed every 7 days (GCP recommendation is to call `watch` daily or on every backend invocation).
