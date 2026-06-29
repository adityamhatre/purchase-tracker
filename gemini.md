# Transitioning from Gemini AI to Rules-Based Parser

This document explains why the sync engine transitioned from the Gemini API parser to a rules-based regex parser, provides a comparative analysis, and outlines how to re-enable Gemini AI in the future if desired.

---

## 1. Why We Moved Away From Gemini AI
The initial version of this purchase tracker utilized Gemini (`@google/genai`) to parse the HTML bodies of Amex transaction emails. However, this approach faced several production bottlenecks:

1. **Strict Quota Limits (HTTP 429 Errors)**: The Google Gemini API free-tier has low rate limits (requests per minute and requests per day). Syncing historical transaction logs (e.g., pulling 10 or more emails at once) instantly exhausted the quota, causing the server to throw `429 Too Many Requests` errors and fail the sync.
2. **Latency**: Each Gemini API call took between 1.5 to 3 seconds to return a response. For a batch sync of 10 emails, this added 15–30 seconds of processing latency.
3. **Cost**: Running AI inference on every transaction becomes expensive at scale.
4. **Determinism**: Generative AI models are non-deterministic and can occasionally return poorly formatted JSON or hallucinate merchant details, requiring complex validation and retry logic.

---

## 2. Comparative Analysis

| Feature | Gemini AI Parser | Rules-Based Regex Parser |
| :--- | :--- | :--- |
| **Cost** | Paid (or restricted free-tier) | **100% Free** |
| **Latency** | High (1.5 - 3s per email) | **Instant (< 1ms per email)** |
| **Quota Limits** | Strict (causes 429 errors) | **None** |
| **Reliability** | Non-deterministic (hallucinations) | **100% Deterministic** |
| **Dependencies** | Requires `@google/genai` & API keys | Requires **No external APIs** |
| **Privacy** | Sends email body to external AI model | **Local processing** (data never leaves server) |

---

## 3. How the Rules-Based Parser Works
The current parser (`src/parser.ts`) extracts transaction details by scanning the email body line-by-line:
1. **Sanitizes HTML**: Converts HTML tags into clean, trimmed line arrays.
2. **Locates the Transaction Amount**: Matches standard decimal patterns (e.g., `$24.98`, `$1,234.56*`).
3. **Extracts the Merchant Name**: Identifies the line preceding the transaction amount and filters out static system notices (e.g., account numbers, threshold alerts) using an invalid-merchant list.
4. **Extracts the Transaction Date**: Identifies the date formatted on the line immediately following the amount. If formatting differs, it falls back to the email's headers timestamp.

This layout-based matching perfectly matches the standard American Express notification format.

---

## 4. How to Re-Enable Gemini AI in the Future
If you want to support more complex email templates (e.g., parsing confirmation emails from multiple different banks, airlines, or retail stores) and prefer to use Gemini's structural reasoning, you can re-enable the AI parser:

### Step 1: Add your API Key to the Environment
Add your Google Gemini API key to your `.env` (locally) and Render Environment variables:
```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

### Step 2: Update the Parser Code
Replace [`src/parser.ts`](file:///Users/adityamhatre/projects/purchase-tracker/src/parser.ts) with the following AI-powered parser:

```typescript
import { GoogleGenAI, Type } from '@google/genai';
import { PurchaseInsert } from './db';

// Initialize the Google Gen AI SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function parseEmailToPurchase(
  emailId: string,
  subject: string,
  bodyText: string,
  bodyHtml: string,
  emailDate: Date
): Promise<PurchaseInsert> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY. Set it to use the AI parser.');
  }

  // Use the HTML body if available, otherwise fallback to plain text
  const emailContent = bodyHtml || bodyText;

  const prompt = `
    Analyze this purchase confirmation email and extract the transaction details.
    Email Subject: "${subject}"
    Email Date: "${emailDate.toISOString()}"
    
    Email Content:
    ${emailContent}
  `;

  // Request a structured JSON response matching our schema
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          merchant: { type: Type.STRING, description: 'The name of the store or merchant.' },
          amount: { type: Type.NUMBER, description: 'The total transaction amount in decimal format.' },
          currency: { type: Type.STRING, description: 'The currency code (e.g., USD).' },
          purchase_date: { type: Type.STRING, description: 'The purchase date in YYYY-MM-DD or ISO format.' },
        },
        required: ['merchant', 'amount', 'currency', 'purchase_date'],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  const parsed = JSON.parse(text);

  return {
    merchant: parsed.merchant,
    amount: parsed.amount,
    currency: parsed.currency || 'USD',
    purchase_date: new Date(parsed.purchase_date),
    items: [
      {
        name: `${parsed.merchant} Purchase`,
        price: parsed.amount,
        quantity: 1,
      },
    ],
    gmail_message_id: emailId,
    raw_email_subject: subject,
  };
}
```

### Step 3: Add `@google/genai` back to dependencies
Ensure the library is active in your packages:
```bash
npm install @google/genai
```
