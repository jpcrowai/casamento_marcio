-- ================================================================
-- CASAMENTO ELISÂNGELA & MÁRCIO - Pagamentos via PIX (PagBank)
-- Execute esse SQL no "SQL Editor" do Supabase DEPOIS de supabase_setup.sql
-- ================================================================

-- --- RSVP: acompanhantes + status de pagamento ---
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS companions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2);
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS pagbank_order_id TEXT;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS pagbank_charge_id TEXT;
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT; -- não usado mais (era do fluxo só-PIX); mantido pra não quebrar linhas antigas
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS checkout_url TEXT; -- link do Checkout PagBank (PIX/cartão/boleto)
ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_rsvps_pagbank_order_id ON rsvps (pagbank_order_id);

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS payment_status_check;
ALTER TABLE rsvps ADD CONSTRAINT payment_status_check
  CHECK (payment_status IN ('not_required','pending','paid','failed','expired'));

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS companions_count_matches_guests;
ALTER TABLE rsvps ADD CONSTRAINT companions_count_matches_guests
  CHECK (jsonb_array_length(companions) = guests);

-- Inserts públicos (anon) só valem para o caminho "Não" (sem cobrança).
-- O caminho "Sim" insere via Edge Function usando a service_role key,
-- que ignora RLS - então não liberamos inserts com pagamento pendente/pago
-- para o público.
DROP POLICY IF EXISTS "Allow public inserts on rsvps" ON rsvps;
CREATE POLICY "Allow public inserts on rsvps" ON rsvps
  FOR INSERT
  WITH CHECK (
    payment_status = 'not_required'
    AND pagbank_order_id IS NULL
    AND pagbank_charge_id IS NULL
  );

-- "Allow public reads on rsvps" (criada em supabase_setup.sql) continua
-- igual - usada pelo botão admin "Ver Lista de Convidados".
-- Nenhuma policy de UPDATE é criada para anon/public: por padrão isso nega
-- todo UPDATE vindo do navegador, então só a service_role (Edge Functions)
-- pode alterar payment_status/pagbank_*.

-- --- Presentes: contribuições PIX ---
CREATE TABLE IF NOT EXISTS gift_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gift_key TEXT NOT NULL,          -- = data-title do card do presente
  donor_name TEXT NOT NULL,
  donor_cpf TEXT,
  amount NUMERIC(10,2) NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','failed','expired')),
  pagbank_order_id TEXT,
  pagbank_charge_id TEXT,
  checkout_url TEXT, -- link do Checkout PagBank (PIX/cartão/boleto)
  payment_confirmed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Se a tabela já existia de uma versão anterior (fluxo só-PIX), garante a
-- coluna nova também:
ALTER TABLE gift_payments ADD COLUMN IF NOT EXISTS checkout_url TEXT;

CREATE INDEX IF NOT EXISTS idx_gift_payments_gift_key ON gift_payments (gift_key);
CREATE INDEX IF NOT EXISTS idx_gift_payments_pagbank_order_id ON gift_payments (pagbank_order_id);

ALTER TABLE gift_payments ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy de SELECT/INSERT pública nesta tabela: toda escrita vem
-- da Edge Function (service_role); toda leitura pública passa pelas
-- funções abaixo, que nunca devolvem donor_name/donor_cpf.

-- Contador agregado por presente (público, sem dados pessoais)
CREATE OR REPLACE FUNCTION public.gift_payment_counts()
RETURNS TABLE(gift_key TEXT, paid_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT gift_key, COUNT(*) FROM gift_payments WHERE payment_status = 'paid' GROUP BY gift_key;
$$;
GRANT EXECUTE ON FUNCTION public.gift_payment_counts() TO anon;

-- Status de um pagamento específico (RSVP ou presente), usado pro polling
-- do modal de pagamento. Só devolve o status - nunca dados pessoais/valor.
CREATE OR REPLACE FUNCTION public.payment_status(p_id UUID, p_kind TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE result TEXT;
BEGIN
  IF p_kind = 'rsvp' THEN
    SELECT rsvps.payment_status INTO result FROM rsvps WHERE id = p_id;
  ELSIF p_kind = 'gift' THEN
    SELECT gift_payments.payment_status INTO result FROM gift_payments WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'kind inválido: %', p_kind;
  END IF;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.payment_status(UUID, TEXT) TO anon;
