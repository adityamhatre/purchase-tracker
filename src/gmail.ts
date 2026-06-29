import { google } from 'googleapis';
import { config } from './config';

export function getOAuthClient() {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing Google OAuth client credentials in environment.');
  }
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state?: string) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Critical to get the refresh token
    prompt: 'consent',     // Force consent screen to guarantee refresh token is returned
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  });
}

/**
 * Exchanges the auth code from the callback URL for tokens.
 */
export async function getTokensFromCode(code: string) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Gets an authenticated Gmail client instance.
 * Refreshes the token automatically if it has expired.
 */
export function getGmailClient() {
  const oauth2Client = getOAuthClient();
  
  if (!config.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing GOOGLE_REFRESH_TOKEN. Run the auth flow first.');
  }

  oauth2Client.setCredentials({
    refresh_token: config.GOOGLE_REFRESH_TOKEN,
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface EmailData {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: Date;
  bodyText: string;
  bodyHtml: string;
}

/**
 * Helper to recursively extract body content from a Gmail message payload.
 */
function extractBody(payload: any): { text: string; html: string } {
  let text = '';
  let html = '';

  function parsePart(part: any) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text += Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        parsePart(subPart);
      }
    }
  }

  if (payload) {
    parsePart(payload);
  }
  
  return { text, html };
}

/**
 * Verifies that the authenticated Gmail account matches the restricted personal email.
 */
export async function verifyEmailProfile(): Promise<void> {
  const gmail = getGmailClient();
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.data.emailAddress;
  if (!email || email.toLowerCase() !== 'aditya.r.mhatre@gmail.com') {
    throw new Error(`Unauthorized: Authenticated Gmail account (${email}) does not match the restricted owner.`);
  }
}

/**
 * Fetches emails matching a query/label.
 */
export async function fetchEmails(query: string, maxResults = 10): Promise<EmailData[]> {
  await verifyEmailProfile();
  const gmail = getGmailClient();
  console.log(`[Gmail]: Fetching emails with query: "${query}"`);
  
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messages = response.data.messages || [];
  console.log(`[Gmail]: Found ${messages.length} matching emails.`);

  const fetchedEmails: EmailData[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    try {
      const msgDetails = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const payload = msgDetails.data.payload;
      const headers = payload?.headers || [];

      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '(No Subject)';
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || 'Unknown';
      const dateStr = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
      const date = dateStr ? new Date(dateStr) : new Date();

      const { text, html } = extractBody(payload);

      fetchedEmails.push({
        id: msg.id,
        threadId: msg.threadId || '',
        subject,
        from,
        date,
        bodyText: text,
        bodyHtml: html,
      });
    } catch (err) {
      console.error(`[Gmail Error]: Failed to fetch message details for ID ${msg.id}:`, err);
    }
  }

  return fetchedEmails;
}
