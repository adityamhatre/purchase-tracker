import { createClient } from '@supabase/supabase-js';
import { config } from './config';

if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export interface PurchaseItem {
  name: string;
  price: number;
  quantity: number;
}

export interface PurchaseInsert {
  merchant: string;
  amount: number;
  currency: string;
  purchase_date: Date | string;
  items: PurchaseItem[];
  gmail_message_id: string;
  raw_email_subject?: string;
}

/**
 * Inserts or updates a purchase record in Supabase.
 * By using the unique gmail_message_id, it avoids duplicates.
 */
export async function upsertPurchase(purchase: PurchaseInsert) {
  const { data, error } = await supabase
    .from('purchases')
    .upsert(
      {
        merchant: purchase.merchant,
        amount: purchase.amount,
        currency: purchase.currency,
        purchase_date: typeof purchase.purchase_date === 'string' ? purchase.purchase_date : purchase.purchase_date.toISOString(),
        items: purchase.items,
        gmail_message_id: purchase.gmail_message_id,
        raw_email_subject: purchase.raw_email_subject,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gmail_message_id' }
    )
    .select();

  if (error) {
    console.error(`[Supabase Error]: Failed to upsert purchase:`, error);
    throw error;
  }

  return data;
}
