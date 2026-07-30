// ================================================================
// Casamento Elisângela & Márcio - Edge Function: mp-webhook
// Recebe a notificação do Mercado Pago quando um pagamento muda de
// status e atualiza a linha correspondente em rsvps ou gift_payments.
// Cole este arquivo no Dashboard do Supabase em Edge Functions > New
// Function, e DESLIGUE "Verify JWT" nas configurações da function - é
// o Mercado Pago quem chama esta URL, não o navegador.
// ================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Validação da assinatura (x-signature), conforme
  // mercadopago.com.br/developers - "Checkout Pro > Notificações de pagamento".
  // Formato do header: "ts=1742505638683,v1=<hash hmac-sha256 hex>"
  const xSignature = req.headers.get("x-signature") ?? "";
  const xRequestId = req.headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k?.trim(), v?.trim()];
    }),
  );
  const ts = parts["ts"];
  const receivedHash = parts["v1"];
  const dataId = String(payload?.data?.id ?? "");

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expectedHash = await hmacSha256Hex(MP_WEBHOOK_SECRET, manifest);

  if (!receivedHash || receivedHash !== expectedHash) {
    console.error("Assinatura do webhook Mercado Pago inválida ou ausente.", { hasSignature: !!xSignature });
    return new Response("invalid signature", { status: 401 });
  }

  // O webhook só avisa QUE algo mudou - buscamos o pagamento de verdade na
  // API pra confirmar o status (nunca confiar só no corpo da notificação).
  if (payload.type !== "payment" || !dataId) {
    return new Response("ok", { status: 200 }); // outro tipo de evento - ignorar
  }

  const paymentResp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
    headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!paymentResp.ok) {
    console.error("Erro ao buscar pagamento no Mercado Pago:", await paymentResp.text());
    return new Response("mp fetch error", { status: 500 });
  }
  const payment = await paymentResp.json();

  if (payment.status !== "approved") {
    return new Response("ok", { status: 200 }); // pendente, recusado etc. - ignorar por ora
  }

  const referenceId = payment.external_reference;
  if (!referenceId) return new Response("ok", { status: 200 });

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const updatePayload = {
    payment_status: "paid",
    pagbank_charge_id: String(payment.id),
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
    console.warn("Webhook recebido mas nenhuma linha pendente encontrada para reference_id:", referenceId);
  }

  return new Response("ok", { status: 200 });
});
