// ================================================================
// Casamento Márcio & Elisângela - Edge Function: create-mp-checkout
// Cria uma Preferência de Checkout do Mercado Pago (o convidado escolhe
// PIX, cartão ou boleto na própria página do Mercado Pago) para RSVP
// (kind='rsvp') ou contribuição de presente (kind='gift'). Cole este
// arquivo no Dashboard do Supabase em Edge Functions > New Function.
// Manter "Verify JWT" LIGADO (comportamento padrão) - é chamada pelo
// anon key do navegador.
// ================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// URL pública do site (pra onde o Mercado Pago manda o convidado de volta
// depois de pagar). Configure o secret SITE_REDIRECT_URL com o domínio real
// do site assim que ele estiver publicado - até lá, usamos a URL do próprio
// projeto Supabase como fallback só pra não travar a criação do checkout.
const SITE_REDIRECT_URL = Deno.env.get("SITE_REDIRECT_URL") ?? SUPABASE_URL;

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
  "Teste de Pagamento": 100, // item temporário pra validar produção - remover depois (e tirar o card do index.html)
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function createMercadoPagoPreference(opts: {
  referenceId: string;
  amountCents: number;
  customerName: string;
  customerEmail?: string;
  customerTaxId?: string;
  itemName: string;
}) {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/mp-webhook`;
  const amount = opts.amountCents / 100;

  // Docs: mercadopago.com.br/developers - "Checkout Pro > Criar preferência".
  const payload = {
    items: [
      {
        id: opts.referenceId,
        title: opts.itemName,
        quantity: 1,
        unit_price: amount,
        currency_id: "BRL",
      },
    ],
    payer: {
      name: opts.customerName,
      email: opts.customerEmail || undefined,
      identification: opts.customerTaxId ? { type: "CPF", number: opts.customerTaxId } : undefined,
    },
    external_reference: opts.referenceId,
    notification_url: webhookUrl,
    back_urls: {
      success: SITE_REDIRECT_URL,
      pending: SITE_REDIRECT_URL,
      failure: SITE_REDIRECT_URL,
    },
  };

  const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Erro ao criar checkout no Mercado Pago: ${errText}`);
  }

  const preference = await resp.json();
  // Com token de teste (TEST-...) o link certo pra testar é sandbox_init_point;
  // com token de produção (APP_USR-...) é init_point.
  const checkoutUrl = MP_ACCESS_TOKEN.startsWith("TEST-")
    ? (preference.sandbox_init_point ?? preference.init_point)
    : (preference.init_point ?? preference.sandbox_init_point);
  if (!checkoutUrl) throw new Error("Mercado Pago não retornou o link de checkout (init_point).");

  return { preferenceId: preference.id as string, checkoutUrl: checkoutUrl as string };
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

      try {
        const checkout = await createMercadoPagoPreference({
          referenceId: rsvpId,
          amountCents,
          customerName: name,
          customerEmail: email,
          customerTaxId: cpf,
          itemName: "Reserva de presença - Casamento Márcio & Elisângela",
        });
        await supabaseAdmin.from("rsvps").update({ pagbank_order_id: checkout.preferenceId, checkout_url: checkout.checkoutUrl }).eq("id", rsvpId);
        return jsonResponse({ id: rsvpId, kind: "rsvp", amount: amountCents / 100, checkoutUrl: checkout.checkoutUrl });
      } catch (mpErr) {
        await supabaseAdmin.from("rsvps").update({ payment_status: "failed" }).eq("id", rsvpId);
        throw mpErr;
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

      try {
        const checkout = await createMercadoPagoPreference({
          referenceId: paymentId,
          amountCents,
          customerName: donorName,
          customerTaxId: donorCpf,
          itemName: `Presente: ${giftKey}`,
        });
        await supabaseAdmin.from("gift_payments").update({ pagbank_order_id: checkout.preferenceId, checkout_url: checkout.checkoutUrl }).eq("id", paymentId);
        return jsonResponse({ id: paymentId, kind: "gift", amount: amountCents / 100, checkoutUrl: checkout.checkoutUrl });
      } catch (mpErr) {
        await supabaseAdmin.from("gift_payments").update({ payment_status: "failed" }).eq("id", paymentId);
        throw mpErr;
      }
    }

    throw new Error("kind inválido - use 'rsvp' ou 'gift'.");
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
