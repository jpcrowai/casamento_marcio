-- ================================================================
-- CASAMENTO ELISÂNGELA & MÁRCIO - Privacidade (área administrativa)
-- Execute esse SQL no "SQL Editor" do Supabase DEPOIS de
-- supabase_setup.sql e supabase_pagamentos.sql
--
-- O que isso faz:
-- 1) Remove a leitura pública de rsvps e messages (hoje qualquer
--    visitante consegue ver nome/telefone/dieta de todo mundo e todas
--    as mensagens do mural - isso fecha essa brecha).
-- 2) Cria 3 funções (RPC) protegidas por senha que só retornam dados
--    se a senha bater - usadas pela página admin.html (que não tem
--    link nenhum no site público).
--
-- Pra trocar a senha depois, é só rodar de novo este arquivo com a
-- senha nova no lugar de '2444666668888888' (nas 3 funções abaixo).
-- ================================================================

-- Remove a leitura pública - só sobra INSERT público (RSVP "Não" e
-- confirmação de presença continuam funcionando normalmente).
DROP POLICY IF EXISTS "Allow public reads on rsvps" ON rsvps;
DROP POLICY IF EXISTS "Allow public reads on messages" ON messages;

-- --- Lista de convidados (RSVP) ---
CREATE OR REPLACE FUNCTION public.admin_list_rsvps(p_password TEXT)
RETURNS SETOF rsvps
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF p_password IS DISTINCT FROM '2444666668888888' THEN
    RAISE EXCEPTION 'senha incorreta';
  END IF;
  RETURN QUERY SELECT * FROM rsvps ORDER BY created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_rsvps(TEXT) TO anon;

-- --- Mural de recados (todas as mensagens) ---
CREATE OR REPLACE FUNCTION public.admin_list_messages(p_password TEXT)
RETURNS SETOF messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF p_password IS DISTINCT FROM '2444666668888888' THEN
    RAISE EXCEPTION 'senha incorreta';
  END IF;
  RETURN QUERY SELECT * FROM messages ORDER BY created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_messages(TEXT) TO anon;

-- --- Quem presenteou (nome + presente + valor + status) ---
CREATE OR REPLACE FUNCTION public.admin_list_gift_payments(p_password TEXT)
RETURNS TABLE (
  id UUID,
  gift_key TEXT,
  donor_name TEXT,
  amount NUMERIC,
  payment_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  payment_confirmed_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF p_password IS DISTINCT FROM '2444666668888888' THEN
    RAISE EXCEPTION 'senha incorreta';
  END IF;
  RETURN QUERY
    SELECT gp.id, gp.gift_key, gp.donor_name, gp.amount, gp.payment_status,
           gp.created_at, gp.payment_confirmed_at
    FROM gift_payments gp
    ORDER BY gp.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_list_gift_payments(TEXT) TO anon;
