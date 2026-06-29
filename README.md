# Gmail Purchase Tracker Sync Engine

This repository hosts the backend sync engine for your personal purchase tracker. It is deployed to Render at https://purchase-tracker-mon2.onrender.com, uses a fast, rules-based regex parser to extract purchase details from Amex transaction emails, and automatically saves them to Supabase (Postgres) with Row Level Security enabled.

For security, this application is restricted to process emails for aditya.r.mhatre@gmail.com only.

---

## Features
* Gmail Integration: Automatically pulls purchase confirmation/invoice emails using the expenses-from-amex Gmail label.
* Rules-Based Parser: Deterministically extracts merchant name, transaction amount, and purchase date from Amex notification emails. No external AI APIs or keys needed.
* Running Monthly Totals: Automatically maintains and updates running monthly totals in a dedicated database table via PostgreSQL triggers.
* Monthly Totals API: Exposes a /monthly endpoint to retrieve running monthly totals directly as a JSON response.
* Real-time Sync: Receives push notifications from Google Pub/Sub when a new email arrives.
* Supabase Database: Stores purchases securely. Client apps can fetch data directly from Supabase.

---

## Step 1: Database Setup (Supabase)

1. Create a project on Supabase.
2. Go to the SQL Editor in your Supabase dashboard.
3. Run the migrations in order:
   * First: Run the table initialization from supabase/migrations/20260629000000_init.sql to create the purchases table.
   * Second: Run the monthly totals setup from supabase/migrations/20260629000001_monthly_totals.sql to create the trigger and running totals table.

---

## Step 2: Google Cloud Console Setup

To connect to Gmail and receive Pub/Sub messages, you must set up a Google Cloud project.

1. Go to the Google Cloud Console.
2. Create a new project.
3. Enable APIs: Enable both the Gmail API and Pub/Sub API.
4. OAuth Consent Screen:
   * Choose External (or Internal if you have a Google Workspace).
   * Add aditya.r.mhatre@gmail.com as a Test User.
   * Add scope https://www.googleapis.com/auth/gmail.readonly.
5. Create Credentials:
   * Go to Credentials -> Create Credentials -> OAuth Client ID.
   * Select Web Application.
   * Add Authorized Redirect URI: http://localhost:8080/auth/callback (for local setup) and https://purchase-tracker-mon2.onrender.com/auth/callback (for production).
   * Save the Client ID and Client Secret.

---

## Step 3: Local Setup & Authentication

1. Clone this repository, then install dependencies:
   ```bash
   npm install
   ```
2. Copy .env.example to .env:
   ```bash
   cp .env.example .env
   ```
3. Fill in your GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and your Supabase credentials in the .env file.
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to http://localhost:8080/auth/google.
6. Sign in with your Gmail account and grant the requested permissions.
7. Upon redirect, you will see a page displaying your GOOGLE_REFRESH_TOKEN.
8. Copy this token and save it in your .env file as GOOGLE_REFRESH_TOKEN.
9. Restart your server. You can now trigger a manual sync of recent emails with:
   ```bash
   curl -X POST "http://localhost:8080/sync?limit=5"
   ```

---

## Step 4: Deployed on Render

This service is deployed to Render at:
https://purchase-tracker-mon2.onrender.com

The build uses the multi-stage Dockerfile which runs on Node 22 (providing native WebSocket support for the Supabase client connection).

Render environment variables:
* PORT = 8080
* GMAIL_LABEL_NAME = expenses-from-amex
* GOOGLE_CLIENT_ID = [Your Client ID]
* GOOGLE_CLIENT_SECRET = [Your Client Secret]
* GOOGLE_REFRESH_TOKEN = [Your Refresh Token]
* SUPABASE_URL = [Your Supabase URL]
* SUPABASE_SERVICE_ROLE_KEY = [Your Service Role Role Key]
* GOOGLE_PUBSUB_TOPIC = projects/aditya-89b0e/topics/gmail-notifications
* PUBSUB_SECRET = [Your Webhook Secret]

Available Endpoints:
* GET or POST /sync - Sync recent emails from Gmail (optional query parameter: ?limit=10)
* GET or POST /monthly - Retrieve running monthly totals from Supabase (optional query parameter: ?month=YYYY-MM to get a specific month. Defaults to returning the last 5 months in a {data: [...], hasMore: boolean} format)
* GET or POST /watch - Register the push webhook watch subscription with Gmail API

---

## Step 5: Real-Time Gmail Notifications Setup

To trigger your deployed Render endpoint in real time whenever a purchase email arrives:

1. Create a Pub/Sub Topic:
   * Go to the Google Cloud Pub/Sub console.
   * Create a topic named gmail-notifications.
2. Grant Gmail Permissions:
   * Gmail needs permission to publish to your topic. Grant the Pub/Sub Publisher role to Google's service account: gmail-api-push@system.gserviceaccount.com.
3. Create a Push Subscription:
   * Create a push subscription on your gmail-notifications topic.
   * Delivery Type: Push.
   * Endpoint URL: https://purchase-tracker-mon2.onrender.com/webhook/pubsub?secret=YOUR_PUBSUB_SECRET
4. Register the Watch:
   * Call the watch registration endpoint to link Gmail notifications to the Pub/Sub topic:
     ```bash
     curl -X POST "https://purchase-tracker-mon2.onrender.com/watch"
     ```
5. Setup Daily Watch Renewal:
   * Gmail watches expire after 7 days. Configure a daily cron job (e.g. on cron-job.org) to send a daily POST request to:
     https://purchase-tracker-mon2.onrender.com/watch

---

## API Usage Examples

### 1. Sync Purchases
Sync recent emails with the target label from Gmail into Supabase.

* **URL**: `https://purchase-tracker-mon2.onrender.com/sync`
* **Method**: `GET` or `POST`
* **Query Parameters**:
  * `limit` (optional): Maximum number of emails to sync. Default is 10.
* **Example Request**:
  `GET https://purchase-tracker-mon2.onrender.com/sync?limit=2`
* **Example Response**:
  ```json
  {
    "message": "Sync completed",
    "totalFound": 2,
    "processed": [
      {
        "emailId": "19f148d66c4ec481",
        "status": "synced",
        "data": [
          {
            "id": "41b0ed8f-7cea-46dd-b83f-362a54e23969",
            "merchant": "Amazon",
            "amount": 97.41,
            "currency": "USD",
            "purchase_date": "2026-06-29T00:00:00+00:00",
            "gmail_message_id": "19f148d66c4ec481"
          }
        ]
      }
    ]
  }
  ```

### 2. Get Monthly Totals
Retrieve aggregated monthly running totals.

* **URL**: `https://purchase-tracker-mon2.onrender.com/monthly`
* **Method**: `GET` or `POST`
* **Query Parameters**:
  * `month` (optional): Retrieve a specific month in YYYY-MM format (e.g., `2026-06`).
* **Example Request (All months - returns up to 5)**:
  `GET https://purchase-tracker-mon2.onrender.com/monthly`
* **Example Response (All months)**:
  ```json
  {
    "data": [
      {
        "month": "2026-06",
        "total_amount": 219.00,
        "updated_at": "2026-06-29T19:51:30.790+00:00"
      }
    ],
    "hasMore": false
  }
  ```
* **Example Request (Specific month)**:
  `GET https://purchase-tracker-mon2.onrender.com/monthly?month=2026-06`
* **Example Response (Specific month)**:
  ```json
  {
    "data": [
      {
        "month": "2026-06",
        "total_amount": 219.00,
        "updated_at": "2026-06-29T19:51:30.790+00:00"
      }
    ],
    "hasMore": false
  }
  ```

### 3. Register Gmail Watch
Registers or renews the Gmail API watch subscription. Must be called every 7 days (recommended daily via cron-job.org).

* **URL**: `https://purchase-tracker-mon2.onrender.com/watch`
* **Method**: `GET` or `POST`
* **Example Request**:
  `GET https://purchase-tracker-mon2.onrender.com/watch`
* **Example Response**:
  ```json
  {
    "message": "Watch registered successfully",
    "data": {
      "historyId": "10633100",
      "expiration": "1783367167544"
    }
  }
  ```
