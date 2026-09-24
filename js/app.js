import { supabase } from './supabase-client.js';

const $ = (sel) => document.querySelector(sel);
const fmt = (n, digits = 2) =>
  (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

let currentUser = null;
let accountsCache = [];
let assetsCache = [];

// ============================================================
// 인증
// ============================================================

let previousUserId = null;

async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  currentUser = session?.user ?? null;
  previousUserId = currentUser?.id ?? null;
  render();

  supabase.auth.onAuthStateChange((_event, session) => {
    const newUser = session?.user ?? null;
    const newId = newUser?.id ?? null;
    // 창 포커스 복귀 시 세션 재확인 등으로 이벤트가 반복 발생하는데,
    // 실제 로그인 사용자가 바뀐 게 아니면 화면을 다시 그리지 않는다 (탭 상태 유지)
    if (newId === previousUserId) return;
    previousUserId = newId;
    currentUser = newUser;
    render();
  });
}

async function sendMagicLink(email) {
  // location.pathname 까지 포함해야 GitHub Pages의 하위 경로(예: /portfolio-web/)로 정확히 돌아옵니다.
  // window.location.origin 만 쓰면 경로가 빠져 루트로 리다이렉트되어 404가 납니다.
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  return error;
}

async function signOut() {
  await supabase.auth.signOut();
}

// ============================================================
// 렌더링 — 최상위
// ============================================================

function render() {
  const app = $('#app');
  if (!currentUser) {
    app.innerHTML = loginTemplate();
    bindLoginEvents();
  } else {
    app.innerHTML = shellTemplate();
    bindShellEvents();
    loadReferenceData().then(() => switchTab('dashboard'));
  }
}

function loginTemplate() {
  return `
    <div class="login-wrap">
      <h1>포트폴리오 원장</h1>
      <p class="sub">이메일로 받는 로그인 링크로 접속합니다.</p>
      <form id="login-form">
        <div class="field">
          <label for="login-email">이메일</label>
          <input type="email" id="login-email" required placeholder="you@example.com" />
        </div>
        <button type="submit" class="primary" style="width:100%">로그인 링크 받기</button>
      </form>
      <p id="login-msg" class="msg"></p>
    </div>
  `;
}

function bindLoginEvents() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const msg = $('#login-msg');
    msg.textContent = '전송 중...';
    msg.className = 'msg';
    const error = await sendMagicLink(email);
    if (error) {
      msg.textContent = '전송 실패: ' + error.message;
      msg.className = 'msg error';
    } else {
      msg.textContent = '메일함을 확인하세요. 로그인 링크를 보냈습니다.';
      msg.className = 'msg success';
    }
  });
}

function shellTemplate() {
  return `
    <header class="ledger-head">
      <h1>포트폴리오 원장</h1>
      <p class="subtitle">${currentUser.email} · <a href="#" id="signout-link" style="color:inherit">로그아웃</a></p>
      <nav class="tabs">
        <button data-tab="dashboard" class="active">대시보드</button>
        <button data-tab="transactions">거래입력</button>
        <button data-tab="settings">계좌·종목</button>
      </nav>
    </header>
    <main id="tab-content"></main>
  `;
}

function bindShellEvents() {
  $('#signout-link').addEventListener('click', (e) => { e.preventDefault(); signOut(); });
  document.querySelectorAll('nav.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'transactions') renderTransactions();
  if (tab === 'settings') renderSettings();
}

// ============================================================
// 참조 데이터 (계좌·종목) 로드
// ============================================================

async function loadReferenceData() {
  const [{ data: accounts }, { data: assets }] = await Promise.all([
    supabase.from('accounts').select('*').order('created_at'),
    supabase.from('assets').select('*').order('ticker'),
  ]);
  accountsCache = accounts ?? [];
  assetsCache = assets ?? [];
}

// ============================================================
// 대시보드
// ============================================================

async function renderDashboard() {
  const el = $('#tab-content');
  el.innerHTML = `<div class="panel"><p class="empty-state">불러오는 중...</p></div>`;

  const [{ data: holdings }, { data: fxRows }] = await Promise.all([
    supabase.from('holdings').select('*'),
    supabase.from('fx_rates').select('*').order('rate_date', { ascending: false }).limit(1),
  ]);

  const fxRate = fxRows?.[0]?.rate ?? null; // USD/KRW

  // 종목별 최신 종가 조회
  const assetIds = (holdings ?? []).map((h) => h.asset_id);
  let latestPrices = {};
  if (assetIds.length > 0) {
    const { data: prices } = await supabase
      .from('prices_daily')
      .select('asset_id, close, price_date')
      .in('asset_id', assetIds)
      .order('price_date', { ascending: false });
    (prices ?? []).forEach((p) => {
      if (!(p.asset_id in latestPrices)) latestPrices[p.asset_id] = p.close;
    });
  }

  let totalUSD = 0, totalKRW = 0;
  const rows = (holdings ?? []).map((h) => {
    const price = latestPrices[h.asset_id] ?? h.avg_cost; // 시세 없으면 평단가로 대체 표시
    const marketValue = h.quantity * price;
    const gainAbs = marketValue - h.quantity * h.avg_cost;
    const gainPct = h.avg_cost > 0 ? (gainAbs / (h.quantity * h.avg_cost)) * 100 : 0;

    if (h.currency === 'USD') {
      totalUSD += marketValue;
      if (fxRate) totalKRW += marketValue * fxRate;
    } else {
      totalKRW += marketValue;
      if (fxRate) totalUSD += marketValue / fxRate;
    }

    return { ...h, price, marketValue, gainAbs, gainPct };
  });

  el.innerHTML = `
    <div class="panel">
      <div class="hero-label">총자산 (USD 환산)</div>
      <div class="hero-figure">$${fmt(totalUSD)}</div>
      <div class="hero-label" style="margin-top:14px">총자산 (KRW 환산)</div>
      <div class="hero-figure" style="font-size:24px">₩${fmt(totalKRW, 0)}</div>
      ${!fxRate ? '<p class="msg error" style="margin-top:10px">환율 데이터가 없어 통화 환산이 부정확할 수 있습니다.</p>' : ''}
    </div>

    <div class="panel">
      <h2>보유 종목</h2>
      ${rows.length === 0 ? '<p class="empty-state">거래를 입력하면 보유 종목이 여기 표시됩니다.</p>' : `
        <table class="ledger">
          <thead>
            <tr>
              <th>종목</th><th>시장</th>
              <th class="num">수량</th><th class="num">평단가</th><th class="num">현재가</th>
              <th class="num">평가금액</th><th class="num">평가손익</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${r.ticker}<br><span style="color:var(--ink-soft);font-size:12px">${r.asset_name}</span></td>
                <td>${r.market}</td>
                <td class="num">${fmt(r.quantity, 4)}</td>
                <td class="num">${fmt(r.avg_cost)}</td>
                <td class="num">${fmt(r.price)}</td>
                <td class="num">${r.currency === 'USD' ? '$' : '₩'}${fmt(r.marketValue, r.currency === 'USD' ? 2 : 0)}</td>
                <td class="num ${r.gainAbs >= 0 ? 'gain' : 'loss'}">${r.gainAbs >= 0 ? '+' : ''}${fmt(r.gainPct)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;
}

// ============================================================
// 거래입력
// ============================================================

async function renderTransactions() {
  const el = $('#tab-content');

  const accountOptions = accountsCache.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
  const assetOptions = assetsCache.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.ticker} · ${a.name}</option>`).join('');

  el.innerHTML = `
    <div class="panel">
      <h2>거래 입력</h2>
      ${accountsCache.length === 0 || assetsCache.length === 0 ? `
        <p class="empty-state">거래를 입력하려면 먼저 '계좌·종목' 탭에서 계좌와 종목을 등록하세요.</p>
      ` : `
        <form id="tx-form">
          <div class="field-row">
            <div class="field">
              <label>계좌</label>
              <select id="tx-account" required>${accountOptions}</select>
            </div>
            <div class="field">
              <label>종목</label>
              <select id="tx-asset" required>${assetOptions}</select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>거래 유형</label>
              <select id="tx-type" required>
                <option value="buy">매수</option>
                <option value="sell">매도</option>
                <option value="dividend">배당</option>
                <option value="deposit">입금</option>
                <option value="withdrawal">출금</option>
              </select>
            </div>
            <div class="field">
              <label>거래일</label>
              <input type="date" id="tx-date" required value="${new Date().toISOString().slice(0,10)}" />
            </div>
          </div>
          <div class="field-row">
            <div class="field" id="tx-quantity-field">
              <label>수량</label>
              <input type="number" step="any" id="tx-quantity" />
            </div>
            <div class="field">
              <label id="tx-price-label">단가</label>
              <input type="number" step="any" id="tx-price" required />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>수수료</label>
              <input type="number" step="any" id="tx-fee" value="0" />
            </div>
            <div class="field">
              <label>메모</label>
              <input type="text" id="tx-note" />
            </div>
          </div>
          <button type="submit" class="primary">저장</button>
          <p id="tx-msg" class="msg"></p>
        </form>
      `}
    </div>
    <div class="panel">
      <h2>최근 거래</h2>
      <div id="tx-list"><p class="empty-state">불러오는 중...</p></div>
    </div>
  `;

  if (accountsCache.length > 0 && assetsCache.length > 0) {
    $('#tx-form').addEventListener('submit', handleTxSubmit);
    $('#tx-type').addEventListener('change', updateTxFormFields);
    updateTxFormFields();
  }
  loadRecentTransactions();
}

function updateTxFormFields() {
  const type = $('#tx-type').value;
  const qtyField = $('#tx-quantity-field');
  const priceLabel = $('#tx-price-label');
  const needsQuantity = type === 'buy' || type === 'sell';
  qtyField.classList.toggle('hidden', !needsQuantity);
  if (!needsQuantity) $('#tx-quantity').value = '';
  priceLabel.textContent = { buy: '단가', sell: '단가', dividend: '배당 금액', deposit: '입금액', withdrawal: '출금액' }[type] ?? '단가';
}

async function handleTxSubmit(e) {
  e.preventDefault();
  const msg = $('#tx-msg');
  const assetSelect = $('#tx-asset');
  const currency = assetSelect.selectedOptions[0]?.dataset.currency ?? 'USD';
  const txType = $('#tx-type').value;
  const quantity = $('#tx-quantity').value ? parseFloat($('#tx-quantity').value) : null;
  const price = $('#tx-price').value ? parseFloat($('#tx-price').value) : null;
  const fee = parseFloat($('#tx-fee').value || '0');

  // amount 부호 규칙: 매수/출금 = 음수, 매도/입금/배당 = 양수
  // buy/sell 은 price=단가(수량과 곱함), dividend/deposit/withdrawal 은 price 필드를 총액으로 사용
  let amount = 0;
  if (txType === 'buy') amount = -((quantity ?? 0) * (price ?? 0) + fee);
  if (txType === 'sell') amount = (quantity ?? 0) * (price ?? 0) - fee;
  if (txType === 'dividend') amount = (price ?? 0) - fee;
  if (txType === 'deposit') amount = price ?? 0;
  if (txType === 'withdrawal') amount = -(price ?? 0);

  const payload = {
    user_id: currentUser.id,
    account_id: $('#tx-account').value,
    asset_id: ['deposit', 'withdrawal'].includes(txType) ? null : assetSelect.value,
    tx_type: txType,
    tx_date: $('#tx-date').value,
    quantity,
    price,
    amount,
    currency,
    fee,
    note: $('#tx-note').value || null,
  };

  msg.textContent = '저장 중...';
  msg.className = 'msg';
  const { error } = await supabase.from('transactions').insert(payload);
  if (error) {
    msg.textContent = '저장 실패: ' + error.message;
    msg.className = 'msg error';
  } else {
    msg.textContent = '저장했습니다.';
    msg.className = 'msg success';
    e.target.reset();
    loadRecentTransactions();
  }
}

async function loadRecentTransactions() {
  const { data } = await supabase
    .from('transactions')
    .select('*, assets(ticker)')
    .order('tx_date', { ascending: false })
    .limit(20);

  const listEl = $('#tx-list');
  if (!data || data.length === 0) {
    listEl.innerHTML = '<p class="empty-state">아직 입력한 거래가 없습니다.</p>';
    return;
  }

  const typeLabel = { buy: '매수', sell: '매도', dividend: '배당', deposit: '입금', withdrawal: '출금', fee: '수수료', tax: '세금' };

  listEl.innerHTML = `
    <table class="ledger">
      <thead><tr><th>날짜</th><th>구분</th><th>종목</th><th class="num">금액</th><th></th></tr></thead>
      <tbody>
        ${data.map((t) => `
          <tr>
            <td>${t.tx_date}</td>
            <td>${typeLabel[t.tx_type] ?? t.tx_type}</td>
            <td>${t.assets?.ticker ?? '—'}</td>
            <td class="num ${t.amount >= 0 ? 'gain' : 'loss'}">${t.currency === 'USD' ? '$' : '₩'}${fmt(Math.abs(t.amount), t.currency === 'USD' ? 2 : 0)}</td>
            <td><button class="ghost" data-delete-tx="${t.id}">삭제</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  listEl.querySelectorAll('[data-delete-tx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 거래를 삭제할까요?')) return;
      await supabase.from('transactions').delete().eq('id', btn.dataset.deleteTx);
      loadRecentTransactions();
    });
  });
}

// ============================================================
// 계좌 · 종목 관리
// ============================================================

async function renderSettings() {
  const el = $('#tab-content');
  el.innerHTML = `
    <div class="panel">
      <h2>계좌 추가</h2>
      <form id="account-form">
        <div class="field-row">
          <div class="field">
            <label>계좌 이름</label>
            <input type="text" id="acc-name" required placeholder="예: 나무증권 일반" />
          </div>
          <div class="field">
            <label>계좌 종류</label>
            <select id="acc-type">
              <option value="일반">일반</option>
              <option value="ISA">ISA</option>
              <option value="연금저축">연금저축</option>
              <option value="IRP">IRP</option>
              <option value="기타">기타</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>시장</label>
          <select id="acc-market">
            <option value="US">미국</option>
            <option value="KR">한국</option>
            <option value="KR+US">한국+미국 통합</option>
          </select>
        </div>
        <button type="submit" class="primary">계좌 추가</button>
        <p id="account-msg" class="msg"></p>
      </form>
      <div id="account-list" style="margin-top:20px"></div>
    </div>

    <div class="panel">
      <h2>종목 추가</h2>
      <form id="asset-form">
        <div class="field-row">
          <div class="field">
            <label>티커</label>
            <input type="text" id="asset-ticker" required placeholder="예: AAPL, 005930" />
          </div>
          <div class="field">
            <label>종목명</label>
            <input type="text" id="asset-name" required placeholder="예: Apple Inc." />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>시장</label>
            <select id="asset-market">
              <option value="US">미국</option>
              <option value="KR">한국</option>
            </select>
          </div>
          <div class="field">
            <label>통화</label>
            <select id="asset-currency">
              <option value="USD">USD</option>
              <option value="KRW">KRW</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>자산군</label>
          <select id="asset-class">
            <option value="stock">주식</option>
            <option value="etf">ETF</option>
            <option value="cash">현금성</option>
            <option value="crypto">코인</option>
          </select>
        </div>
        <button type="submit" class="primary">종목 추가</button>
        <p id="asset-msg" class="msg"></p>
      </form>
      <div id="asset-list" style="margin-top:20px"></div>
    </div>
  `;

  $('#account-form').addEventListener('submit', handleAccountSubmit);
  $('#asset-form').addEventListener('submit', handleAssetSubmit);
  renderAccountList();
  renderAssetList();
}

async function handleAccountSubmit(e) {
  e.preventDefault();
  const msg = $('#account-msg');
  const { error } = await supabase.from('accounts').insert({
    user_id: currentUser.id,
    name: $('#acc-name').value,
    account_type: $('#acc-type').value,
    market: $('#acc-market').value,
  });
  if (error) { msg.textContent = '실패: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = '추가했습니다.'; msg.className = 'msg success';
  e.target.reset();
  await loadReferenceData();
  renderAccountList();
}

async function handleAssetSubmit(e) {
  e.preventDefault();
  const msg = $('#asset-msg');
  const { error } = await supabase.from('assets').insert({
    ticker: $('#asset-ticker').value.trim().toUpperCase(),
    name: $('#asset-name').value.trim(),
    market: $('#asset-market').value,
    currency: $('#asset-currency').value,
    asset_class: $('#asset-class').value,
  });
  if (error) { msg.textContent = '실패: ' + error.message; msg.className = 'msg error'; return; }
  msg.textContent = '추가했습니다.'; msg.className = 'msg success';
  e.target.reset();
  await loadReferenceData();
  renderAssetList();
}

function renderAccountList() {
  const el = $('#account-list');
  if (!el) return;
  el.innerHTML = accountsCache.length === 0 ? '' : `
    <table class="ledger">
      <thead><tr><th>이름</th><th>종류</th><th>시장</th></tr></thead>
      <tbody>${accountsCache.map((a) => `<tr><td>${a.name}</td><td>${a.account_type}</td><td>${a.market}</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function renderAssetList() {
  const el = $('#asset-list');
  if (!el) return;
  el.innerHTML = assetsCache.length === 0 ? '' : `
    <table class="ledger">
      <thead><tr><th>티커</th><th>종목명</th><th>시장</th><th>통화</th></tr></thead>
      <tbody>${assetsCache.map((a) => `<tr><td>${a.ticker}</td><td>${a.name}</td><td>${a.market}</td><td>${a.currency}</td></tr>`).join('')}</tbody>
    </table>
  `;
}

// ============================================================
initAuth();
