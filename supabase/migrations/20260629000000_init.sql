-- Enable Row Level Security (RLS) on public schema
-- Create purchases table
CREATE TABLE IF NOT EXISTS public.purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    purchase_date TIMESTAMPTZ NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    gmail_message_id TEXT UNIQUE NOT NULL,
    raw_email_subject TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexing for performance and lookup
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_date ON public.purchases (purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_gmail_message_id ON public.purchases (gmail_message_id);

-- Enable RLS
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

-- Create Policy: Only the restricted owner can read records
CREATE POLICY "Allow only restricted owner read access" 
ON public.purchases 
FOR SELECT 
TO authenticated 
USING (auth.jwt() ->> 'email' = 'aditya.r.mhatre@gmail.com');

-- Create Policy: Deny all public anon reads (by default, but explicitly stated here)
-- (Users must log in to the client app to retrieve financial information)
CREATE POLICY "Deny anonymous access" 
ON public.purchases 
FOR ALL 
TO anon 
USING (false);
