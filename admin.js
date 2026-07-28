// ================================================================
// Casamento Márcio & Elisângela - admin.js
// Página privada (admin.html) - lista de convidados, presentes e
// mural de recados. Protegida por senha via RPCs do Supabase.
// ================================================================

const SUPABASE_URL = 'https://ooqzpcuymddylvtsoqmo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_v_Bk6PkdPAFYH1_cnAW0Fw_s_L_rMB9';

let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.warn('Supabase não disponível.', e);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  // ---------------------------------------------------------------
  // Theme Switcher
  // ---------------------------------------------------------------
  const themeToggleBtn = document.getElementById('theme-toggle');
  const htmlTag = document.documentElement;
  const savedTheme = localStorage.getItem('casamento_theme') || 'light';
  htmlTag.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  themeToggleBtn.addEventListener('click', () => {
    const next = htmlTag.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    htmlTag.setAttribute('data-theme', next);
    localStorage.setItem('casamento_theme', next);
    updateThemeIcon(next);
  });

  function updateThemeIcon(theme) {
    themeToggleBtn.querySelector('i').className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }

  // ---------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  function showToast(msg, isError = false) {
    toastMessage.innerText = msg;
    toast.style.background = isError ? 'linear-gradient(135deg, #c0392b, #e74c3c)' : '';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  // ---------------------------------------------------------------
  // Login (senha)
  // ---------------------------------------------------------------
  const loginBox = document.getElementById('admin-login');
  const contentBox = document.getElementById('admin-content');
  const passwordInput = document.getElementById('admin-password');
  const btnLogin = document.getElementById('btn-admin-login');
  const loginError = document.getElementById('admin-login-error');

  async function tryLogin(password) {
    loginError.style.display = 'none';
    btnLogin.disabled = true;
    btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Entrando...';
    try {
      const [rsvps, gifts, messages] = await Promise.all([
        supabaseClient.rpc('admin_list_rsvps', { p_password: password }),
        supabaseClient.rpc('admin_list_gift_payments', { p_password: password }),
        supabaseClient.rpc('admin_list_messages', { p_password: password }),
      ]);
      if (rsvps.error || gifts.error || messages.error) throw new Error('senha incorreta');

      sessionStorage.setItem('casamento_admin_pw', password);
      loginBox.style.display = 'none';
      contentBox.style.display = 'block';
      renderRsvpList(rsvps.data || []);
      renderGiftsList(gifts.data || []);
      renderMessagesList(messages.data || []);
    } catch (err) {
      loginError.style.display = 'block';
      sessionStorage.removeItem('casamento_admin_pw');
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Entrar';
    }
  }

  btnLogin.addEventListener('click', () => {
    const pw = passwordInput.value.trim();
    if (pw) tryLogin(pw);
  });
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnLogin.click();
  });

  // Tenta entrar sozinho se já tiver logado nesta aba/sessão
  const savedPw = sessionStorage.getItem('casamento_admin_pw');
  if (savedPw) tryLogin(savedPw);

  // ---------------------------------------------------------------
  // Renderização: Convidados (RSVP)
  // ---------------------------------------------------------------
  const PAYMENT_BADGES = {
    paid: { bg: '#D1E7DD', color: '#0F5132', label: '<i class="fa-solid fa-circle-check"></i> Pago' },
    pending: { bg: '#FFF3CD', color: '#664D03', label: '<i class="fa-solid fa-clock"></i> Pendente' },
    failed: { bg: '#F8D7DA', color: '#842029', label: '<i class="fa-solid fa-circle-exclamation"></i> Falhou' },
    expired: { bg: '#F8D7DA', color: '#842029', label: '<i class="fa-solid fa-circle-exclamation"></i> Expirado' },
  };

  function renderRsvpList(list) {
    const container = document.getElementById('admin-rsvp-list');
    const confirmed = list.filter(i => i.payment_status === 'paid');
    const totalPeople = confirmed.reduce((acc, cur) => acc + 1 + (cur.guests || 0), 0);

    let html = `
      <div class="admin-summary">
        <strong>Total de respostas:</strong> ${list.length} | <strong>Pagos/Confirmados:</strong> ${confirmed.length} | <strong>Pessoas:</strong> ${totalPeople}
      </div>`;

    if (!list.length) {
      html += '<p style="color:var(--text-muted);">Nenhuma resposta ainda.</p>';
    } else {
      list.forEach(item => {
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR') : '-';
        const paymentBadge = PAYMENT_BADGES[item.payment_status];
        const companionsList = Array.isArray(item.companions) && item.companions.length
          ? `<div style="font-size:0.8rem;margin-top:2px;"><i class="fa-solid fa-user-group"></i> Acompanhantes: ${item.companions.map(c => escapeHtml(`${c.first_name} ${c.last_name}`)).join(', ')}</div>`
          : '';
        html += `
          <div style="border-bottom:1px solid var(--border-gold);padding:10px 0;font-size:0.9rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
              <strong>${escapeHtml(item.name)}</strong>
              <span style="display:flex;gap:6px;flex-wrap:wrap;">
                <span class="admin-badge" style="background:${item.attendance==='Sim'?'#D1E7DD':'#F8D7DA'};color:${item.attendance==='Sim'?'#0F5132':'#842029'};">
                  ${item.attendance==='Sim'?'<i class="fa-solid fa-check"></i> Confirmado':'<i class="fa-solid fa-xmark"></i> Não irá'}
                </span>
                ${paymentBadge ? `<span class="admin-badge" style="background:${paymentBadge.bg};color:${paymentBadge.color};">${paymentBadge.label}</span>` : ''}
              </span>
            </div>
            <div style="color:var(--text-muted);font-size:0.82rem;margin-top:4px;">
              <i class="fa-solid fa-users"></i> Acompanhantes: ${item.guests} &nbsp;|&nbsp;
              <i class="fa-solid fa-envelope"></i> ${escapeHtml(item.email)} &nbsp;|&nbsp;
              <i class="fa-solid fa-phone"></i> ${escapeHtml(item.phone)} &nbsp;|&nbsp;
              <i class="fa-regular fa-calendar"></i> ${dateStr}
            </div>
            ${companionsList}
            ${item.diet && item.diet !== 'Nenhuma' ? `<div style="font-size:0.8rem;margin-top:2px;"><i class="fa-solid fa-leaf"></i> Dieta: ${escapeHtml(item.diet)}</div>` : ''}
            ${item.song && item.song !== 'Não informada' ? `<div style="font-size:0.8rem;color:var(--gold-primary);margin-top:2px;"><i class="fa-solid fa-music"></i> Música: ${escapeHtml(item.song)}</div>` : ''}
          </div>`;
      });
    }
    container.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // Renderização: Quem Presenteou
  // ---------------------------------------------------------------
  function renderGiftsList(list) {
    const container = document.getElementById('admin-gifts-list');
    const paid = list.filter(i => i.payment_status === 'paid');
    const totalAmount = paid.reduce((acc, cur) => acc + Number(cur.amount || 0), 0);

    let html = `
      <div class="admin-summary">
        <strong>Contribuições pagas:</strong> ${paid.length} | <strong>Total arrecadado:</strong> R$ ${totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
      </div>`;

    if (!list.length) {
      html += '<p style="color:var(--text-muted);">Nenhuma contribuição ainda.</p>';
    } else {
      html += '<p class="scroll-hint"><i class="fa-solid fa-arrows-left-right"></i> Arraste a tabela pro lado pra ver mais colunas</p>';
      html += '<div class="admin-table-wrapper"><table class="admin-table"><thead><tr><th>Nome</th><th>Presente</th><th>Valor</th><th>Status</th><th>Data</th></tr></thead><tbody>';
      list.forEach(item => {
        const badge = PAYMENT_BADGES[item.payment_status];
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR') : '-';
        html += `
          <tr>
            <td>${escapeHtml(item.donor_name)}</td>
            <td>${escapeHtml(item.gift_key)}</td>
            <td>R$ ${Number(item.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
            <td>${badge ? `<span class="admin-badge" style="background:${badge.bg};color:${badge.color};">${badge.label}</span>` : escapeHtml(item.payment_status)}</td>
            <td>${dateStr}</td>
          </tr>`;
      });
      html += '</tbody></table></div>';
    }
    container.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // Renderização: Mural de Recados
  // ---------------------------------------------------------------
  function renderMessagesList(list) {
    const container = document.getElementById('admin-messages-list');
    if (!list.length) {
      container.innerHTML = '<p style="color:var(--text-muted);">Nenhum recado ainda.</p>';
      return;
    }
    let html = '';
    list.forEach(m => {
      const dateStr = m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR') : '-';
      html += `
        <div style="border-bottom:1px solid var(--border-gold);padding:12px 0;">
          <div style="display:flex;justify-content:space-between;">
            <strong><i class="fa-solid fa-quote-left" style="color:var(--gold-primary);margin-right:6px;"></i>${escapeHtml(m.name)}</strong>
            <span style="color:var(--text-muted);font-size:0.82rem;">${dateStr}</span>
          </div>
          <p style="margin-top:6px;">"${escapeHtml(m.message)}"</p>
        </div>`;
    });
    container.innerHTML = html;
  }
});
