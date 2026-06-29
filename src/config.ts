import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export const config = {
  PORT: process.env.PORT || '8080',
  GMAIL_LABEL_NAME: process.env.GMAIL_LABEL_NAME || 'Purchases',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/auth/callback',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  GOOGLE_PUBSUB_TOPIC: process.env.GOOGLE_PUBSUB_TOPIC || '',
  API_KEY: process.env.API_KEY || '',
};

// Simple configuration checker
export function checkConfig() {
  const missing: string[] = [];
  const criticalKeys = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'API_KEY',
  ];

  criticalKeys.forEach((key) => {
    if (!process.env[key]) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    console.warn(`[Config Warning]: Missing critical environment variables: ${missing.join(', ')}`);
    console.warn('Some features may not function properly until these are set.');
  } else {
    console.log('[Config]: All critical configuration environment variables are set.');
  }
}
