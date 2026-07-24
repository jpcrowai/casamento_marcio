// ================================================================
// Casamento Márcio & Elisângela - Edge Function: pagbank-webhook
// Recebe a notificação do PagBank quando um PIX é pago e atualiza a
// linha correspondente em rsvps ou gift_payments. Cole este arquivo
// no Dashboard do Supabase em Edge Functions > New Function, e
// DESLIGUE "Verify JWT" nas configurações da function - é o PagBank
// quem chama esta URL, não o navegador.
// ================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Mesmo segredo configurado em create-pix-charge - vem embutido como o
// último pedaço do caminho da URL (/pagbank-webhook/<secret>) que
// registramos no PagBank via notification_urls. Usamos isso em vez do header
// x-authenticity-token porque esse header confirmadamente não chega no
// sandbox do PagBank (bug relatado por outros devs, e confirmado aqui via
// log de diagnóstico: headerPresente sempre false).
const WEBHOOK_SECRET = Deno.env.get("PAGBANK_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const url = new URL(req.url);
  const receivedSecret = url.pathname.split("/").filter(Boolean).pop();
  if (!WEBHOOK_SECRET || receivedSecret !== WEBHOOK_SECRET) {
    console.error("Webhook chamado sem o segredo correto na URL.");
    return new Response("invalid secret", { status: 401 });
  }

  const rawBody = await req.text();

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // CONFIRMAR estrutura exata do payload de notificação (charges[].status
  // etc.) contra o sandbox - a cobrança agora nasce de um Checkout (o
  // convidado escolhe PIX/cartão/boleto na página do PagBank), então a
  // notificação pode chegar em um formato ligeiramente diferente do que um
  // pedido criado direto via /orders. Se o reference_id não bater com nada,
  // dê uma olhada no payload real (console.error abaixo) pra ajustar.
  const referenceId = payload.reference_id;
  const charges = Array.isArray(payload.charges) ? payload.charges : [];
  const paidCharge = charges.find((c: any) => c.status === "PAID");

  if (!referenceId || !paidCharge) {
    // notificação de outro evento (pedido criado, charge cancelada etc.) - ignorar
    return new Response("ok", { status: 200 });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const updatePayload = {
    payment_status: "paid",
    pagbank_charge_id: paidCharge.id,
    payment_confirmed_at: new Date().toISOString(),
  };

  // Idempotente contra reenvio: só atualiza se ainda estava "pending".
  const { data: rsvpRows, error: rsvpErr } = await supabaseAdmin
    .from("rsvps")
    .update(updatePayload)
    .eq("id", referenceId)
    .eq("payment_status", "pending")
    .select("id");
  if (rsvpErr) {
    console.error("Erro ao atualizar rsvps:", rsvpErr);
    return new Response("db error", { status: 500 });
  }
  if (rsvpRows && rsvpRows.length > 0) return new Response("ok", { status: 200 });

  const { data: giftRows, error: giftErr } = await supabaseAdmin
    .from("gift_payments")
    .update(updatePayload)
    .eq("id", referenceId)
    .eq("payment_status", "pending")
    .select("id");
  if (giftErr) {
    console.error("Erro ao atualizar gift_payments:", giftErr);
    return new Response("db error", { status: 500 });
  }
  if (!giftRows || giftRows.length === 0) {
    console.warn("Webhook recebido mas nenhuma linha pendente encontrada para reference_id:", referenceId, "payload:", JSON.stringify(payload));
  }

  return new Response("ok", { status: 200 });
});
