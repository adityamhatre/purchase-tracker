-- Create monthly_totals table
CREATE TABLE IF NOT EXISTS public.monthly_totals (
    month TEXT PRIMARY KEY, -- Format: YYYY-MM (e.g. '2026-06')
    total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.monthly_totals ENABLE ROW LEVEL SECURITY;

-- Create Policy: Only the restricted owner can read records
CREATE POLICY "Allow only restricted owner read access to monthly totals" 
ON public.monthly_totals 
FOR SELECT 
TO authenticated 
USING (auth.jwt() ->> 'email' = 'aditya.r.mhatre@gmail.com');

-- Create Policy: Deny all public anon access
CREATE POLICY "Deny anonymous access to monthly totals" 
ON public.monthly_totals 
FOR ALL 
TO anon 
USING (false);

-- Trigger function to automatically maintain monthly totals
CREATE OR REPLACE FUNCTION public.update_monthly_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_month TEXT;
    v_old_month TEXT;
BEGIN
    -- Determine the month of the affected row
    IF TG_OP = 'DELETE' THEN
        v_month := TO_CHAR(OLD.purchase_date, 'YYYY-MM');
    ELSE
        v_month := TO_CHAR(NEW.purchase_date, 'YYYY-MM');
        -- Check if update changed the month
        IF TG_OP = 'UPDATE' AND TO_CHAR(OLD.purchase_date, 'YYYY-MM') <> v_month THEN
            v_old_month := TO_CHAR(OLD.purchase_date, 'YYYY-MM');
        END IF;
    END IF;

    -- Recalculate and upsert for the primary month
    INSERT INTO public.monthly_totals (month, total_amount, updated_at)
    VALUES (
        v_month,
        COALESCE((SELECT SUM(amount) FROM public.purchases WHERE TO_CHAR(purchase_date, 'YYYY-MM') = v_month), 0),
        now()
    )
    ON CONFLICT (month) DO UPDATE
    SET total_amount = EXCLUDED.total_amount,
        updated_at = EXCLUDED.updated_at;

    -- Recalculate for the old month if the month was changed during an update
    IF v_old_month IS NOT NULL THEN
        INSERT INTO public.monthly_totals (month, total_amount, updated_at)
        VALUES (
            v_old_month,
            COALESCE((SELECT SUM(amount) FROM public.purchases WHERE TO_CHAR(purchase_date, 'YYYY-MM') = v_old_month), 0),
            now()
        )
        ON CONFLICT (month) DO UPDATE
        SET total_amount = EXCLUDED.total_amount,
            updated_at = EXCLUDED.updated_at;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition
CREATE OR REPLACE TRIGGER trg_update_monthly_totals
AFTER INSERT OR UPDATE OR DELETE ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.update_monthly_totals();

-- Backfill existing data into monthly_totals
INSERT INTO public.monthly_totals (month, total_amount, updated_at)
SELECT 
    TO_CHAR(purchase_date, 'YYYY-MM') AS month,
    SUM(amount) AS total_amount,
    now() AS updated_at
FROM public.purchases
GROUP BY TO_CHAR(purchase_date, 'YYYY-MM')
ON CONFLICT (month) DO UPDATE
SET total_amount = EXCLUDED.total_amount,
    updated_at = EXCLUDED.updated_at;
