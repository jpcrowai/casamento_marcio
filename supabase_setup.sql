-- ================================================================
-- CASAMENTO MÁRCIO & ELISÂNGELA - Setup do Banco de Dados Supabase
-- Execute esse SQL no "SQL Editor" do seu projeto no Supabase
-- ================================================================

-- Tabela para Confirmações de Presença (RSVP)
CREATE TABLE IF NOT EXISTS rsvps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  guests INTEGER DEFAULT 0,
  attendance TEXT NOT NULL,
  diet TEXT DEFAULT 'Nenhuma',
  song TEXT DEFAULT 'Não informada',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela para Mensagens do Mural dos Noivos
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ativar Row Level Security (RLS)
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Permitir leitura e inserção públicas (sem login)
CREATE POLICY "Allow public inserts on rsvps" ON rsvps FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public reads on rsvps" ON rsvps FOR SELECT USING (true);

CREATE POLICY "Allow public inserts on messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public reads on messages" ON messages FOR SELECT USING (true);
