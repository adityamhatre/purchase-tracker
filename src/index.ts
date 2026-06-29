import express, { Request, Response } from 'express';

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, checkConfig } from './config';
import { getAuthUrl, getTokensFromCode, fetchEmails, getGmailClient, verifyEmailProfile, getOAuthClient } from './gmail';
import { google } from 'googleapis';
import { parseEmailToPurchase } from './parser';
import { upsertPurchase, supabase } from './db';

const app = express();
const PORT = config.PORT;

// Rate limiting middleware: max 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});

// Middleware
app.use(helmet());
app.use(limiter);
app.use(express.json());

// API Key Verification Middleware
const verifyApiKey = (req: Request, res: Response, next: () => void) => {
  const path = req.path;
  // Exclude health, webhook (which has its own secret), and OAuth callback from general API key check
  if (path === '/health' || path === '/webhook/pubsub' || path === '/auth/callback') {
    next();
    return;
  }

  const providedKey = (req.headers['x-api-key'] || req.query.api_key) as string;
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    console.error('[Security Warning]: API_KEY environment variable is not configured! Blocking request.');
    res.status(500).json({ error: 'Internal Server Error: API key is not configured.' });
    return;
  }

  if (providedKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key.' });
    return;
  }

  next();
};

app.use(verifyApiKey);

// Log config status on startup
checkConfig();

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

/**
 * Step 1 of OAuth flow: Redirect user to Google sign-in page to get authorization code.
 */
app.get('/auth/google', (_req: Request, res: Response) => {
  try {
    const url = getAuthUrl();
    res.redirect(url);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate Auth URL', details: error.message });
  }
});

/**
 * Step 2 of OAuth flow: Google redirects here with authorization code.
 * Exchanges code for tokens and displays the Refresh Token to the user.
 */
app.get('/auth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('Missing code parameter in callback request.');
    return;
  }

  try {
    const tokens = await getTokensFromCode(code);
    
    // Verify email matches the restricted owner
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials(tokens);
    const gmailClientTemp = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmailClientTemp.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;
    
    if (!email || email.toLowerCase() !== 'aditya.r.mhatre@gmail.com') {
      res.status(403).send('Forbidden: This application is restricted to aditya.r.mhatre@gmail.com only.');
      return;
    }
    
    // Render a friendly HTML page showing the refresh token
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Google OAuth Success</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; background: #f9f9fb; color: #1e1e24; }
            .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); max-width: 600px; margin: 0 auto; }
            h1 { color: #3ecf8e; margin-top: 0; }
            code { background: #f1f3f5; padding: 6px 10px; border-radius: 6px; font-family: monospace; font-size: 14px; word-break: break-all; display: block; margin: 15px 0; border: 1px solid #e9ecef; }
            .warning { color: #e03131; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Authentication Successful!</h1>
            <p>You have successfully authorized your Gmail account. Copy the <strong>Refresh Token</strong> below and save it as your <code>GOOGLE_REFRESH_TOKEN</code> environment variable.</p>
            
            <p class="warning">⚠️ Keep this token secret! It allows persistent access to read your Gmail inbox.</p>
            
            <h3>Refresh Token:</h3>
            <code>${tokens.refresh_token || 'Not returned. (If you already authorized previously, you must go to your Google account settings and remove the app first to receive a new refresh token.)'}</code>

            <h3>Access Token (Expires soon):</h3>
            <code>${tokens.access_token}</code>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    res.status(500).send(`Failed to exchange authorization code: ${error.message}`);
  }
});

/**
 * Trigger manual sync of recent receipt emails.
 * Query parameters:
 *  - limit: number of messages to fetch (default: 10)
 */
app.all('/sync', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '10', 10);
  
  try {
    const query = `label:${config.GMAIL_LABEL_NAME}`;
    const emails = await fetchEmails(query, limit);
    const results = [];

    for (const email of emails) {
      try {
        console.log(`[Sync]: Parsing Gmail message: ${email.id} | Subject: ${email.subject}`);
        const purchase = await parseEmailToPurchase(
          email.id,
          email.subject,
          email.bodyText,
          email.bodyHtml,
          email.date
        );
        const data = await upsertPurchase(purchase);
        results.push({ emailId: email.id, status: 'synced', data });
      } catch (err: any) {
        console.error(`[Sync Error]: Skipping email ID ${email.id} due to error:`, err.message);
        results.push({ emailId: email.id, status: 'error', error: err.message });
      }
    }

    res.json({
      message: 'Sync completed',
      totalFound: emails.length,
      processed: results,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to execute sync', details: error.message });
  }
});

/**
 * Register a watch with Gmail to start sending push notifications to our Pub/Sub topic.
 */
app.all('/watch', async (_req: Request, res: Response) => {
  try {
    await verifyEmailProfile();
    const gmail = getGmailClient();
    console.log(`[Gmail]: Registering watch for topic: ${config.GOOGLE_PUBSUB_TOPIC}`);
    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: config.GOOGLE_PUBSUB_TOPIC,
      },
    });
    res.json({
      message: 'Watch registered successfully',
      data: response.data,
    });
  } catch (error: any) {
    console.error('[Gmail Watch Error]:', error.message);
    res.status(500).json({ error: 'Failed to register watch', details: error.message });
  }
});

/**
 * Real-time Pub/Sub Webhook Trigger
 * Called by Google Pub/Sub when Gmail pushes mailbox updates.
 */
app.post('/webhook/pubsub', async (req: Request, res: Response) => {
  console.log('[Pub/Sub Webhook]: Received push notification.');
  
  // 1. Optional security token check
  const webhookSecret = process.env.PUBSUB_SECRET;
  if (webhookSecret && req.query.secret !== webhookSecret) {
    res.status(401).json({ error: 'Unauthorized webhook request' });
    return;
  }

  try {
    // Pub/Sub messages are base64 encoded inside the message object
    const message = req.body?.message;
    if (!message) {
      res.status(400).json({ error: 'Invalid Pub/Sub message payload' });
      return;
    }

    // Decode message data to log or inspect if needed
    if (message.data) {
      const dataString = Buffer.from(message.data, 'base64').toString('utf-8');
      console.log(`[Pub/Sub Webhook]: Decoded data payload:`, dataString);
      // Example payload format: {"emailAddress": "user@gmail.com", "historyId": 987654}
    }

    // Trigger sync for the last 5 messages under the target label
    console.log('[Pub/Sub Webhook]: Triggering mailbox sync...');
    const query = `label:${config.GMAIL_LABEL_NAME}`;
    const emails = await fetchEmails(query, 5);
    const results = [];

    for (const email of emails) {
      try {
        const purchase = await parseEmailToPurchase(
          email.id,
          email.subject,
          email.bodyText,
          email.bodyHtml,
          email.date
        );
        const data = await upsertPurchase(purchase);
        results.push({ emailId: email.id, status: 'synced', data });
      } catch (err: any) {
        // Skip errors for individual messages to not block other records
        console.error(`[Pub/Sub Sync Error]: Failed to sync ${email.id}:`, err.message);
      }
    }

    // Acknowledge the Pub/Sub message by returning a 200/204 response
    res.status(200).json({
      message: 'Pub/Sub event processed successfully',
      syncedCount: results.length,
    });
  } catch (error: any) {
    console.error('[Pub/Sub Webhook Error]: Failed to handle notification:', error);
    // Returning a 500 will make Pub/Sub retry the delivery, 
    // so we only return it on severe system/database failures.
    res.status(500).json({ error: 'Internal server error processing push notification', details: error.message });
  }
});

/**
 * Retrieve monthly running totals from Supabase
 */
app.all('/monthly', async (req: Request, res: Response) => {
  try {
    const targetMonth = req.query.month as string; // Format: YYYY-MM
    
    if (targetMonth) {
      // Validate targetMonth format YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
        res.status(400).json({ error: 'Invalid month format. Expected YYYY-MM (e.g., 2026-06).' });
        return;
      }
      
      const { data, error } = await supabase
        .from('monthly_totals')
        .select('*')
        .eq('month', targetMonth);
        
      if (error) throw error;
      
      res.json({
        data: data || [],
        hasMore: false
      });
      return;
    }

    // Default: Fetch last 5 records, query 6 to check if there are more
    const { data, error } = await supabase
      .from('monthly_totals')
      .select('*')
      .order('month', { ascending: false })
      .limit(6);

    if (error) throw error;

    const hasMore = data && data.length > 5;
    const finalData = hasMore ? data.slice(0, 5) : (data || []);

    res.json({
      data: finalData,
      hasMore
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve monthly totals', details: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server]: Purchase tracker backend listening on port ${PORT}`);
});
