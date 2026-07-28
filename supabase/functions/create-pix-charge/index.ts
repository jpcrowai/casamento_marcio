// ================================================================
// Casamento Márcio & Elisângela - Edge Function: create-pix-charge
// Cria um Checkout do PagBank (o convidado escolhe PIX, cartão ou
// boleto na própria página do PagBank) para RSVP (kind='rsvp') ou
// contribuição de presente (kind='gift'). Cole este arquivo no
// Dashboard do Supabase em Edge Functions > New Function.
// Manter "Verify JWT" LIGADO (comportamento padrão) - é chamada pelo
// anon key do navegador.
// ================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAGBANK_API_BASE = Deno.env.get("PAGBANK_API_BASE") ?? "https://sandbox.api.pagseguro.com";
const PAGBANK_TOKEN = Deno.env.get("PAGBANK_TOKEN") ?? "";
const PAGBANK_MOCK = Deno.env.get("PAGBANK_MOCK") === "true";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// URL pública do site (pra onde o PagBank manda o convidado de volta depois
// de pagar). Configure o secret PAGBANK_REDIRECT_URL com o domínio real do
// site assim que ele estiver publicado - até lá, usamos a URL do próprio
// projeto Supabase como fallback só pra não travar a criação do checkout.
const PAGBANK_REDIRECT_URL = Deno.env.get("PAGBANK_REDIRECT_URL") ?? SUPABASE_URL;
// Segredo nosso (não do PagBank) embutido no CAMINHO da URL do webhook
// (não como ?query= - o campo notification_urls do PagBank rejeitou query
// string e URL longa demais). Criado porque o header x-authenticity-token do
// PagBank confirmadamente não chega no sandbox (bug conhecido deles) - em
// vez de depender da assinatura deles, validamos que quem chamou o webhook
// conhece esse segredo.
const WEBHOOK_SECRET = Deno.env.get("PAGBANK_WEBHOOK_SECRET") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // restrinja ao domínio do site em produção
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Preço por pessoa na confirmação de presença (RSVP)
const RSVP_PRICE_PER_PERSON_CENTS = 13000; // R$130,00

// Fonte da verdade dos valores dos presentes - precisa ser mantida em
// sincronia manualmente com os data-title/data-val de cada card em
// index.html. NUNCA aceitar o valor vindo do cliente.
const GIFT_PRICES_CENTS: Record<string, number> = {
  "Brinde de Boas-Vindas": 10000,
  "Jantar Romântico à Beira-Mar": 25000,
  "Cota Passagem Aérea": 50000,
  "Cota Alianças": 100000,
  "Geladeira Duplex Frost Free": 250000,
  "Fogão 5 Bocas": 120000,
  "Máquina de Lavar": 180000,
  "Smart TV 50 polegadas": 200000,
  "Ar-Condicionado Split": 150000,
  "Micro-ondas": 70000,
  "Air Fryer": 45000,
  "Cafeteira Elétrica": 30000,
  "Aspirador de Pó Robô": 90000,
  "Batedeira Planetária": 60000,
  "Liquidificador": 25000,
  "Torradeira": 20000,
  "Sanduicheira & Grill": 28000,
  "Ferro de Passar Roupas": 22000,
  "Chaleira Elétrica": 18000,
  "Panela de Pressão Elétrica": 50000,
  "Panela Elétrica de Arroz": 35000,
  "Multiprocessador de Alimentos": 40000,
  "Espremedor de Frutas": 25000,
  "Purificador de Água": 80000,
  "Adega Climatizada": 130000,
  "Máquina de Secar Roupas": 220000,
  "Lava-Louças": 280000,
  "Coifa / Depurador de Ar": 90000,
  "Ventilador": 35000,
  "Umidificador de Ar": 22000,
  "Churrasqueira Elétrica": 60000,
  "Som Ambiente / Home Theater": 140000,
  "Hospedagem na Lua de Mel": 80000,
  "Aluguel de Carro na Lua de Mel": 60000,
  "Passeio Turístico": 40000,
  "Day Spa a Dois": 35000,
  "Seguro Viagem": 20000,
  "Teste de Pagamento": 100, // ATENÇÃO: item temporário só pra validar produção - remover depois (e tirar o card correspondente do index.html)
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function createPagBankCheckout(opts: {
  referenceId: string;
  amountCents: number;
  customerName: string;
  customerEmail?: string;
  customerTaxId?: string;
  itemName: string;
}) {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/pagbank-webhook/${WEBHOOK_SECRET}`;

  // ATENÇÃO: confirmar contra o sandbox real assim que possível -
  // endpoint (/checkouts), formato de payment_methods aceito, obrigatoriedade
  // de customer.tax_id / items[].reference_id, e o "rel" exato do link de
  // pagamento na resposta (aqui assumimos "PAY", com fallback pro primeiro
  // link retornado). Docs: developer.pagbank.com.br - "Checkout".
  const payload = {
    reference_id: opts.referenceId,
    customer: {
      name: opts.customerName,
      email: opts.customerEmail,
      tax_id: opts.customerTaxId,
    },
    items: [
      { reference_id: opts.referenceId, name: opts.itemName, quantity: 1, unit_amount: opts.amountCents },
    ],
    // Deixa o convidado escolher a forma de pagamento na página do PagBank
    payment_methods: [
      { type: "PIX" },
      { type: "CREDIT_CARD" },
      { type: "BOLETO" },
    ],
    redirect_url: PAGBANK_REDIRECT_URL,
    notification_urls: [webhookUrl],
  };

  const resp = await fetch(`${PAGBANK_API_BASE}/checkouts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PAGBANK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erro ao criar checkout no PagBank: ${errText}`);
  }

  const checkout = await resp.json();
  const links = Array.isArray(checkout.links) ? checkout.links : [];
  const payLink = links.find((l: any) => l.rel === "PAY" || l.rel === "pay" || l.rel === "checkout")?.href
    ?? links[0]?.href;
  if (!payLink) throw new Error("PagBank não retornou o link de pagamento (links[].href).");

  return { checkoutId: checkout.id as string, checkoutUrl: payLink as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const kind = body.kind;

    if (kind === "rsvp") {
      const { name, email, phone, cpf, guests, diet, song, companions } = body;
      if (!name || !email || !phone) throw new Error("Dados do convidado principal incompletos.");

      const guestsNum = Number(guests);
      if (!Number.isInteger(guestsNum) || guestsNum < 0 || guestsNum > 3) {
        throw new Error("Quantidade de acompanhantes inválida.");
      }
      const companionsArr = Array.isArray(companions) ? companions : [];
      if (companionsArr.length !== guestsNum) {
        throw new Error("Lista de acompanhantes não confere com a quantidade selecionada.");
      }
      for (const c of companionsArr) {
        if (!c || !String(c.first_name || "").trim() || !String(c.last_name || "").trim()) {
          throw new Error("Preencha nome e sobrenome de todos os acompanhantes.");
        }
      }

      const totalPeople = 1 + guestsNum;
      const amountCents = totalPeople * RSVP_PRICE_PER_PERSON_CENTS;

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("rsvps")
        .insert([{
          name, email, phone,
          guests: guestsNum,
          attendance: "Sim",
          diet: diet || "Nenhuma",
          song: song || "Não informada",
          companions: companionsArr,
          payment_status: "pending",
          payment_amount: amountCents / 100,
        }])
        .select()
        .single();
      if (insertErr) throw insertErr;
      const rsvpId = inserted.id;

      if (PAGBANK_MOCK) {
        const fakeUrl = `https://sandbox.pagseguro.uol.com.br/checkout/mock?ref=rsvp-${rsvpId}`;
        await supabaseAdmin.from("rsvps").update({ pagbank_order_id: `MOCK_${rsvpId}`, checkout_url: fakeUrl }).eq("id", rsvpId);
        return jsonResponse({ id: rsvpId, kind: "rsvp", amount: amountCents / 100, checkoutUrl: fakeUrl });
      }

      try {
        const checkout = await createPagBankCheckout({
          referenceId: rsvpId,
          amountCents,
          customerName: name,
          customerEmail: email,
          customerTaxId: cpf,
          itemName: "Reserva de presença - Casamento Márcio & Elisângela",
        });
        await supabaseAdmin.from("rsvps").update({ pagbank_order_id: checkout.checkoutId, checkout_url: checkout.checkoutUrl }).eq("id", rsvpId);
        return jsonResponse({ id: rsvpId, kind: "rsvp", amount: amountCents / 100, checkoutUrl: checkout.checkoutUrl });
      } catch (pagbankErr) {
        await supabaseAdmin.from("rsvps").update({ payment_status: "failed" }).eq("id", rsvpId);
        throw pagbankErr;
      }
    }

    if (kind === "gift") {
      const { giftKey, donorName, donorCpf } = body;
      if (!giftKey || !donorName) throw new Error("Dados do doador incompletos.");

      const amountCents = GIFT_PRICES_CENTS[giftKey];
      if (!amountCents) throw new Error("Presente desconhecido.");

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("gift_payments")
        .insert([{
          gift_key: giftKey,
          donor_name: donorName,
          donor_cpf: donorCpf || null,
          amount: amountCents / 100,
          payment_status: "pending",
        }])
        .select()
        .single();
      if (insertErr) throw insertErr;
      const paymentId = inserted.id;

      if (PAGBANK_MOCK) {
        const fakeUrl = `https://sandbox.pagseguro.uol.com.br/checkout/mock?ref=gift-${paymentId}`;
        await supabaseAdmin.from("gift_payments").update({ pagbank_order_id: `MOCK_${paymentId}`, checkout_url: fakeUrl }).eq("id", paymentId);
        return jsonResponse({ id: paymentId, kind: "gift", amount: amountCents / 100, checkoutUrl: fakeUrl });
      }

      try {
        const checkout = await createPagBankCheckout({
          referenceId: paymentId,
          amountCents,
          customerName: donorName,
          customerTaxId: donorCpf,
          itemName: `Presente: ${giftKey}`,
        });
        await supabaseAdmin.from("gift_payments").update({ pagbank_order_id: checkout.checkoutId, checkout_url: checkout.checkoutUrl }).eq("id", paymentId);
        return jsonResponse({ id: paymentId, kind: "gift", amount: amountCents / 100, checkoutUrl: checkout.checkoutUrl });
      } catch (pagbankErr) {
        await supabaseAdmin.from("gift_payments").update({ payment_status: "failed" }).eq("id", paymentId);
        throw pagbankErr;
      }
    }

    throw new Error("kind inválido - use 'rsvp' ou 'gift'.");
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
