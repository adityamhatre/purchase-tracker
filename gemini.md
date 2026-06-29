# Project Guidelines & Code Standards

This document defines the code styles, architectural decisions, and system constraints for the Gmail Purchase Tracker Sync Engine. All development tools and AI coding assistants must strictly adhere to these rules when modifying the codebase.

---

## 1. Code Style Guidelines

* **Indentation**: Use **4-space indentation** for all TypeScript, JavaScript, and JSON files.
* **Quotes**: Use **double quotes (`"`)** for strings (unless single quotes are required to avoid escaping).
* **Type Safety**: Maintain strict TypeScript typing. Avoid using `any` unless absolutely necessary; declare precise interfaces for payloads and data models.
* **Imports**: Group imports systematically (external packages first, followed by internal absolute/relative modules).
* **Semicolons**: Always end statements with semicolons.

---

## 2. Architectural Decisions

* **Runtime Environment**: Node.js 22+ running on Express.
* **Database Layer**: Supabase (PostgreSQL) using the Supabase JS SDK client.
* **Gmail Parsing Engine**: Deterministic rules-based regex parser (layout-based extraction) that processes email bodies locally without external AI APIs or calls.
* **Webhook Event System**: Google Pub/Sub push subscription endpoint.
* **Security & Authentication**:
  * **API Key Protection**: All data endpoints are private and secured using a secure `API_KEY` validated via constant-time comparison (`crypto.timingSafeEqual`).
  * **Webhook Validation**: Pub/Sub push endpoint requires a secret token query parameter compared using constant-time verification.
  * **CORS Restrictions**: CORS is completely disabled. Requests are only accepted via direct browser navigation, server-to-server calls, or native widgets/mobile apps (KWGT).

---

## 3. Row Level Security (RLS) Rules

* All database tables must have RLS enabled.
* Permissive policies allowing read access to all authenticated users are forbidden.
* Read (`SELECT`) access must be strictly restricted to the authorized owner's email address by validating the JWT email claim:
  ```sql
  (auth.jwt() ->> 'email' = 'aditya.r.mhatre@gmail.com')
  ```

---

## 4. AI Assistant Coding Instructions

AI coding assistants (Gemini, Antigravity) must strictly follow these instructions:

1. **Email Restrictions Check**: Always verify that the sync, watch, and callback paths validate the authenticated user profile and strictly reject any Gmail account other than `aditya.r.mhatre@gmail.com`.
2. **Security Integrity**: Do not bypass or weaken any of the following:
   * Constant-time comparison checks on keys or secrets.
   * Helmet security header configurations.
   * Rate limiting thresholds.
3. **No Unstructured Parse Fallbacks**: Do not introduce non-deterministic or generative parsing methods into the primary parser pipeline. All parser logic must remain rules-based and layout-safe.
4. **Maintenance of Logs**: Ensure the backend outputs clear, structured server logs prefixing messages appropriately (e.g. `[Server]`, `[Gmail]`, `[Parser]`, `[Sync]`). Do not log sensitive user tokens or raw keys.
