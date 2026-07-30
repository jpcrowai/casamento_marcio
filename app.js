// ================================================================
// Casamento Márcio & Elisângela - app.js
// Integrado com Supabase para persistência de dados em nuvem
// ================================================================

// Configuração do Supabase
const SUPABASE_URL = 'https://ooqzpcuymddylvtsoqmo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_v_Bk6PkdPAFYH1_cnAW0Fw_s_L_rMB9';

// Inicializa o cliente Supabase (via CDN no index.html)
// Obs: usamos "supabaseClient" (não "supabase") porque o script do CDN já
// cria um global chamado "supabase" - declarar outro com o mesmo nome aqui
// causaria um SyntaxError ("Identifier 'supabase' has already been
// declared") que impediria o arquivo inteiro de rodar.
let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.warn('Supabase não disponível, usando localStorage como fallback.', e);
}

// ================================================================
// Helpers: RSVP com Supabase + fallback localStorage
// ================================================================
async function saveRSVP(data) {
  if (supabaseClient) {
    const { error } = await supabaseClient.from('rsvps').insert([data]);
    if (error) throw error;
  } else {
    const list = JSON.parse(localStorage.getItem('casamento_rsvp_list') || '[]');
    list.unshift({ ...data, created_at: new Date().toISOString() });
    localStorage.setItem('casamento_rsvp_list', JSON.stringify(list));
  }
}

// ================================================================
// Helpers: Mensagens com Supabase + fallback localStorage
// ================================================================
async function saveMessage(data) {
  if (supabaseClient) {
    const { error } = await supabaseClient.from('messages').insert([data]);
    if (error) throw error;
  } else {
    const list = JSON.parse(localStorage.getItem('casamento_messages') || '[]');
    list.unshift({ ...data, created_at: new Date().toISOString() });
    localStorage.setItem('casamento_messages', JSON.stringify(list));
  }
}

// ================================================================
// Helpers: Pagamentos (Checkout Mercado Pago) via Supabase Edge Functions
// ================================================================
async function createCheckout(payload) {
  if (!supabaseClient) throw new Error('Pagamento indisponível no momento (Supabase não conectado).');
  const { data, error } = await supabaseClient.functions.invoke('create-mp-checkout', { body: payload });
  if (error) {
    // Quando a function responde com status de erro (400/500), o supabase-js
    // joga um FunctionsHttpError genérico em "error" e NÃO lê o corpo JSON
    // automaticamente - o motivo real (nossa mensagem de erro) fica em
    // error.context (a Response crua). Sem isso, o usuário só via "Edge
    // Function returned a non-2xx status code", sem nenhuma pista do motivo.
    let detail = error.message;
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body && body.error) detail = body.error;
      }
    } catch (_) { /* mantém a mensagem genérica se não der pra ler o corpo */ }
    throw new Error(detail);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

function pollPaymentStatus(id, kind, onPaid, onTimeout) {
  const startedAt = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000;
  const intervalId = setInterval(async () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      clearInterval(intervalId);
      if (onTimeout) onTimeout();
      return;
    }
    try {
      const { data, error } = await supabaseClient.rpc('payment_status', { p_id: id, p_kind: kind });
      if (!error && data === 'paid') {
        clearInterval(intervalId);
        onPaid();
      }
    } catch (e) {
      console.error('Erro ao consultar status do pagamento', e);
    }
  }, 3000);
  return { stop: () => clearInterval(intervalId) };
}

// ================================================================
// Inicialização do App
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {

  // ---------------------------------------------------------------
  // 1. Theme Switcher
  // ---------------------------------------------------------------
  const themeToggleBtn = document.getElementById('theme-toggle');
  const htmlTag = document.documentElement;
  const savedTheme = localStorage.getItem('casamento_theme') || 'light';
  htmlTag.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  themeToggleBtn.addEventListener('click', () => {
    const current = htmlTag.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    htmlTag.setAttribute('data-theme', next);
    localStorage.setItem('casamento_theme', next);
    updateThemeIcon(next);
  });

  function updateThemeIcon(theme) {
    themeToggleBtn.querySelector('i').className =
      theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }

  // ---------------------------------------------------------------
  // 2. Mobile Navbar & Scroll Shadow
  // ---------------------------------------------------------------
  const mobileToggle = document.getElementById('mobile-toggle');
  const navLinks = document.getElementById('nav-links');
  const navbar = document.getElementById('navbar');

  mobileToggle.addEventListener('click', () => navLinks.classList.toggle('active'));
  navLinks.querySelectorAll('a').forEach(link =>
    link.addEventListener('click', () => navLinks.classList.remove('active'))
  );
  window.addEventListener('scroll', () =>
    navbar.classList.toggle('scrolled', window.scrollY > 50)
  );

  // ---------------------------------------------------------------
  // 3. Countdown Timer
  // ---------------------------------------------------------------
  const weddingDate = new Date('2026-10-31T16:30:00').getTime();

  function updateCountdown() {
    const distance = weddingDate - Date.now();
    if (distance < 0) {
      ['cd-days','cd-hours','cd-minutes','cd-seconds'].forEach(id => {
        document.getElementById(id).innerText = '00';
      });
      return;
    }
    document.getElementById('cd-days').innerText    = String(Math.floor(distance / 86400000)).padStart(2,'0');
    document.getElementById('cd-hours').innerText   = String(Math.floor((distance % 86400000) / 3600000)).padStart(2,'0');
    document.getElementById('cd-minutes').innerText = String(Math.floor((distance % 3600000) / 60000)).padStart(2,'0');
    document.getElementById('cd-seconds').innerText = String(Math.floor((distance % 60000) / 1000)).padStart(2,'0');
  }
  updateCountdown();
  setInterval(updateCountdown, 1000);

  // ---------------------------------------------------------------
  // 4. Toast Notification
  // ---------------------------------------------------------------
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');

  function showToast(msg, isError = false) {
    toastMessage.innerText = msg;
    toast.style.background = isError
      ? 'linear-gradient(135deg, #c0392b, #e74c3c)'
      : '';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  // ---------------------------------------------------------------
  // 5. RSVP Form
  // ---------------------------------------------------------------
  const rsvpForm = document.getElementById('rsvp-form');
  const rsvpSubmitBtn = rsvpForm.querySelector('button[type="submit"]');

  const rsvpGuestsSelect = document.getElementById('rsvp-guests');
  const rsvpCompanionsWrapper = document.getElementById('rsvp-companions-wrapper');
  const rsvpTotalWrapper = document.getElementById('rsvp-total-wrapper');
  const rsvpTotalAmount = document.getElementById('rsvp-total-amount');
  const rsvpAttendanceRadios = rsvpForm.querySelectorAll('input[name="attendance"]');

  const rsvpPaymentModal = document.getElementById('rsvp-payment-modal');
  const rsvpPaymentClose = document.getElementById('rsvp-payment-close');
  const rsvpPaymentSubtitle = document.getElementById('rsvp-payment-subtitle');
  const rsvpCheckoutLink = document.getElementById('rsvp-checkout-link');
  const btnCopyRsvpCheckout = document.getElementById('btn-copy-rsvp-checkout');
  const rsvpPaymentStatus = document.getElementById('rsvp-payment-status');
  let rsvpPollHandle = null;

  const RSVP_PRICE_PER_PERSON = 130;

  function renderCompanionInputs() {
    const attendance = rsvpForm.querySelector('input[name="attendance"]:checked').value;
    const guests = parseInt(rsvpGuestsSelect.value, 10);
    if (attendance !== 'Sim' || guests === 0) {
      rsvpCompanionsWrapper.innerHTML = '';
      return;
    }
    let html = '<label>Nome dos Acompanhantes *</label>';
    for (let i = 0; i < guests; i++) {
      html += `
        <div style="display:flex; gap:10px; margin-top:8px; flex-wrap:wrap;">
          <input type="text" class="form-control rsvp-comp-first" placeholder="Nome do acompanhante ${i + 1}" style="flex:1; min-width:140px;" required>
          <input type="text" class="form-control rsvp-comp-last" placeholder="Sobrenome" style="flex:1; min-width:140px;" required>
        </div>`;
    }
    rsvpCompanionsWrapper.innerHTML = html;
  }

  function updateTotalDisplay() {
    const attendance = rsvpForm.querySelector('input[name="attendance"]:checked').value;
    if (attendance !== 'Sim') {
      rsvpTotalWrapper.style.display = 'none';
      return;
    }
    const guests = parseInt(rsvpGuestsSelect.value, 10);
    const total = (1 + guests) * RSVP_PRICE_PER_PERSON;
    rsvpTotalAmount.innerText = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    rsvpTotalWrapper.style.display = 'block';
  }

  rsvpGuestsSelect.addEventListener('change', () => { renderCompanionInputs(); updateTotalDisplay(); });
  rsvpAttendanceRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked && radio.value === 'Não') rsvpGuestsSelect.value = '0';
      renderCompanionInputs();
      updateTotalDisplay();
    });
  });
  renderCompanionInputs();
  updateTotalDisplay();

  function openRsvpPaymentModal(result) {
    rsvpPaymentSubtitle.innerText = `Valor: R$ ${Number(result.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    rsvpCheckoutLink.href = result.checkoutUrl;
    rsvpPaymentStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Aguardando pagamento...';
    rsvpPaymentModal.classList.add('active');
    window.open(result.checkoutUrl, '_blank');

    rsvpPollHandle = pollPaymentStatus(result.id, 'rsvp', () => {
      rsvpPaymentStatus.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#0F5132;"></i> Pagamento confirmado!';
      showToast('Pagamento confirmado! Sua presença está garantida.');
      setTimeout(() => {
        rsvpPaymentModal.classList.remove('active');
        rsvpForm.reset();
        renderCompanionInputs();
        updateTotalDisplay();
      }, 2500);
    }, () => {
      rsvpPaymentStatus.innerHTML = 'Ainda não recebemos a confirmação do pagamento.';
    });
  }

  btnCopyRsvpCheckout.addEventListener('click', () => {
    navigator.clipboard.writeText(rsvpCheckoutLink.href)
      .then(() => showToast('Link do checkout copiado!'))
      .catch(() => {});
  });

  rsvpPaymentClose.addEventListener('click', () => {
    rsvpPaymentModal.classList.remove('active');
    if (rsvpPollHandle) rsvpPollHandle.stop();
  });

  rsvpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    rsvpSubmitBtn.disabled = true;
    rsvpSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

    const name     = document.getElementById('rsvp-name').value.trim();
    const email    = document.getElementById('rsvp-email').value.trim();
    const phone    = document.getElementById('rsvp-phone').value.trim();
    const cpf      = document.getElementById('rsvp-cpf').value.trim();
    const guests   = parseInt(rsvpGuestsSelect.value, 10);
    const attendance = rsvpForm.querySelector('input[name="attendance"]:checked').value;
    const diet     = document.getElementById('rsvp-diet').value.trim() || 'Nenhuma';
    const song     = document.getElementById('rsvp-song').value.trim() || 'Não informada';

    try {
      if (attendance === 'Não') {
        await saveRSVP({ name, email, phone, guests: 0, attendance, diet, song, companions: [] });
        rsvpForm.reset();
        renderCompanionInputs();
        updateTotalDisplay();
        showToast(`Obrigado, ${name}! Sentiremos sua falta!`);
      } else {
        const firstNames = rsvpCompanionsWrapper.querySelectorAll('.rsvp-comp-first');
        const lastNames = rsvpCompanionsWrapper.querySelectorAll('.rsvp-comp-last');
        const companions = Array.from(firstNames).map((el, i) => ({
          first_name: el.value.trim(),
          last_name: lastNames[i].value.trim(),
        }));
        const result = await createCheckout({ kind: 'rsvp', name, email, phone, cpf, guests, diet, song, companions });
        openRsvpPaymentModal(result);
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Ocorreu um erro ao salvar. Tente novamente.', true);
    } finally {
      rsvpSubmitBtn.disabled = false;
      rsvpSubmitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Confirmação';
    }
  });

  // ---------------------------------------------------------------
  // 6. PIX & Gifts (contribuições reais via Checkout Mercado Pago)
  // ---------------------------------------------------------------
  const btnCopyMainPix  = document.getElementById('btn-copy-main-pix');
  const pixKeyText = '8b1dea47-3989-425b-aae5-cd611e884b49';

  function copyPixKey() {
    navigator.clipboard.writeText(pixKeyText)
      .then(() => showToast('Chave PIX copiada!'))
      .catch(() => showToast(`Chave: ${pixKeyText}`));
  }
  btnCopyMainPix.addEventListener('click', copyPixKey);

  const giftPaymentModal = document.getElementById('gift-payment-modal');
  const giftPaymentClose = document.getElementById('gift-payment-close');
  const giftPaymentTitle = document.getElementById('gift-payment-title');
  const giftPaymentSubtitle = document.getElementById('gift-payment-subtitle');
  const giftDonorForm = document.getElementById('gift-donor-form');
  const giftDonorNameInput = document.getElementById('gift-donor-name');
  const giftDonorCpfInput = document.getElementById('gift-donor-cpf');
  const btnGiftGeneratePix = document.getElementById('btn-gift-generate-pix');
  const giftPixDetails = document.getElementById('gift-pix-details');
  const giftCheckoutLink = document.getElementById('gift-checkout-link');
  const btnCopyGiftCheckout = document.getElementById('btn-copy-gift-checkout');
  const giftPaymentStatus = document.getElementById('gift-payment-status');

  let currentGiftKey = null;
  let giftPollHandle = null;

  async function renderGiftCounts() {
    if (!supabaseClient) return;
    try {
      const { data, error } = await supabaseClient.rpc('gift_payment_counts');
      if (error || !data) return;
      const counts = {};
      data.forEach(row => { counts[row.gift_key] = row.paid_count; });
      document.querySelectorAll('.gift-card').forEach(card => {
        const btn = card.querySelector('.btn-gift-pix');
        if (!btn) return;
        const key = btn.getAttribute('data-title');
        const count = counts[key] || 0;
        let countEl = card.querySelector('.gift-count');
        if (!countEl) {
          countEl = document.createElement('p');
          countEl.className = 'gift-count';
          countEl.style.cssText = 'font-size:0.8rem;color:var(--text-muted);margin-top:8px;';
          card.insertBefore(countEl, btn);
        }
        countEl.innerHTML = `<i class="fa-solid fa-users"></i> ${count} ${count === 1 ? 'pessoa já contribuiu' : 'pessoas já contribuíram'}`;
      });
    } catch (e) {
      console.error('Erro ao carregar contadores de presentes', e);
    }
  }
  await renderGiftCounts();

  document.querySelectorAll('.btn-gift-pix').forEach(btn => {
    btn.addEventListener('click', () => {
      currentGiftKey = btn.getAttribute('data-title');
      const val = parseFloat(btn.getAttribute('data-val'));
      giftPaymentTitle.innerText = currentGiftKey;
      giftPaymentSubtitle.innerText = `Valor: R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      giftDonorForm.style.display = '';
      giftPixDetails.style.display = 'none';
      giftDonorNameInput.value = '';
      giftDonorCpfInput.value = '';
      giftPaymentModal.classList.add('active');
    });
  });

  btnGiftGeneratePix.addEventListener('click', async () => {
    const donorName = giftDonorNameInput.value.trim();
    const donorCpf = giftDonorCpfInput.value.trim();
    if (!donorName || !donorCpf) {
      showToast('Preencha seu nome e CPF para gerar o PIX.', true);
      return;
    }
    btnGiftGeneratePix.disabled = true;
    btnGiftGeneratePix.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando checkout...';
    try {
      const result = await createCheckout({ kind: 'gift', giftKey: currentGiftKey, donorName, donorCpf });
      giftCheckoutLink.href = result.checkoutUrl;
      giftPaymentStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Aguardando pagamento...';
      giftDonorForm.style.display = 'none';
      giftPixDetails.style.display = '';
      window.open(result.checkoutUrl, '_blank');

      giftPollHandle = pollPaymentStatus(result.id, 'gift', () => {
        giftPaymentStatus.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#0F5132;"></i> Pagamento confirmado! Muito obrigado!';
        showToast('Obrigado pelo carinho! Pagamento confirmado.');
        renderGiftCounts();
        setTimeout(() => giftPaymentModal.classList.remove('active'), 2500);
      }, () => {
        giftPaymentStatus.innerHTML = 'Ainda não recebemos a confirmação do pagamento.';
      });
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Erro ao gerar PIX. Tente novamente.', true);
    } finally {
      btnGiftGeneratePix.disabled = false;
      btnGiftGeneratePix.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i> Ir para o Checkout';
    }
  });

  btnCopyGiftCheckout.addEventListener('click', () => {
    navigator.clipboard.writeText(giftCheckoutLink.href)
      .then(() => showToast('Link do checkout copiado!'))
      .catch(() => {});
  });

  giftPaymentClose.addEventListener('click', () => {
    giftPaymentModal.classList.remove('active');
    if (giftPollHandle) giftPollHandle.stop();
  });

  // ---------------------------------------------------------------
  // 7. Mural dos Noivos (só escrita - leitura é privada, ver admin.html)
  // ---------------------------------------------------------------
  const msgForm = document.getElementById('msg-form');
  const msgSubmitBtn = msgForm.querySelector('button[type="submit"]');

  msgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgSubmitBtn.disabled = true;
    msgSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publicando...';

    const name    = document.getElementById('msg-name').value.trim();
    const message = document.getElementById('msg-text').value.trim();
    if (!name || !message) return;

    try {
      await saveMessage({ name, message });
      msgForm.reset();
      showToast('Sua mensagem foi publicada no mural!');
    } catch (err) {
      showToast('Erro ao publicar mensagem. Tente novamente.', true);
    } finally {
      msgSubmitBtn.disabled = false;
      msgSubmitBtn.innerHTML = '<i class="fa-solid fa-heart"></i> Publicar no Mural';
    }
  });

  // ---------------------------------------------------------------
  // 8. Lightbox Gallery
  // ---------------------------------------------------------------
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImg   = document.getElementById('lightbox-img');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxClose = document.getElementById('lightbox-close');

  document.querySelectorAll('.gallery-item').forEach(item => {
    item.addEventListener('click', () => {
      lightboxImg.src = item.getAttribute('data-img');
      lightboxCaption.innerText = item.getAttribute('data-caption');
      lightboxModal.classList.add('active');
    });
  });
  lightboxClose.addEventListener('click', () => lightboxModal.classList.remove('active'));

  // Fechar modais ao clicar fora
  window.addEventListener('click', (e) => {
    if (e.target === lightboxModal)  lightboxModal.classList.remove('active');
    if (e.target === rsvpPaymentModal) {
      rsvpPaymentModal.classList.remove('active');
      if (rsvpPollHandle) rsvpPollHandle.stop();
    }
    if (e.target === giftPaymentModal) {
      giftPaymentModal.classList.remove('active');
      if (giftPollHandle) giftPollHandle.stop();
    }
  });

});
