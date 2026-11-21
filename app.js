// Ecomvision Finances - Core Application Logic
(function () {
  'use strict';

  // --- Initial / Default State ---
  const DEFAULT_STATE = {
    accounts: [],
    transactions: [],
    plans: [],
    goals: [],
    monthlyPayments: [],
    settings: {
      privacyMode: false,
      payday: 25,
      currency: '₽',
      demoLoaded: false,
      githubToken: '',
      gistId: '',
      autoSync: true,
      lastSyncTime: ''
    },
    activeTab: 'today',
    goalFilter: 'all'
  };

  // --- State Store ---
  let state = loadState();
  let autoSyncDebounceTimer = null;
  let isSyncing = false;

  function loadState() {
    try {
      const saved = localStorage.getItem('ecomvision_finances_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { 
          ...DEFAULT_STATE, 
          ...parsed, 
          monthlyPayments: parsed.monthlyPayments || [],
          settings: { ...DEFAULT_STATE.settings, ...parsed.settings } 
        };
      }
    } catch (e) {
      console.error('Failed to load state', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveState(triggerSync = true) {
    try {
      localStorage.setItem('ecomvision_finances_state', JSON.stringify(state));
      // Trigger background cloud sync ONLY if requested and not in the middle of syncing
      if (triggerSync && !isSyncing && state.settings && state.settings.githubToken && state.settings.autoSync) {
        clearTimeout(autoSyncDebounceTimer);
        autoSyncDebounceTimer = setTimeout(() => {
          pushToGitHub(true);
        }, 4000);
      }
    } catch (e) {
      console.error('Failed to save state', e);
    }
  }

  // --- Formatters & Helpers ---
  function formatMoney(amount, showSign = false) {
    if (state.settings.privacyMode) {
      return '•••• ' + state.settings.currency;
    }
    const num = Number(amount) || 0;
    const formatted = Math.abs(num).toLocaleString('ru-RU');
    const currency = state.settings.currency;
    if (showSign) {
      return (num >= 0 ? '+ ' : '- ') + formatted + ' ' + currency;
    }
    return (num < 0 ? '-' : '') + formatted + ' ' + currency;
  }

  function getDaysUntilPayday() {
    const today = new Date();
    const paydayDay = state.settings.payday || 25;
    let payDate = new Date(today.getFullYear(), today.getMonth(), paydayDay);
    if (today.getDate() >= paydayDay) {
      payDate = new Date(today.getFullYear(), today.getMonth() + 1, paydayDay);
    }
    const diffTime = payDate - today;
    return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }

  function getTargetAccountingDateStr() {
    const today = new Date();
    const target = new Date(today.getTime() + 13 * 24 * 60 * 60 * 1000);
    const months = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
    return `${target.getDate()} ${months[target.getMonth()]}`;
  }

  function getRussianCurrentDate() {
    const today = new Date();
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${days[today.getDay()]}, ${today.getDate()} ${months[today.getMonth()]}`;
  }

  // --- Smart Natural Language Transaction Parser ---
  // e.g. "Кофе 350", "Зарплата 150000", "Такси 450", "Обед 600 карта"
  const CATEGORY_MAP = {
    'кофе': { name: 'Кофе и кафе', icon: '☕', type: 'expense' },
    'обед': { name: 'Кафе и рестораны', icon: '🍲', type: 'expense' },
    'ужин': { name: 'Кафе и рестораны', icon: '🍽️', type: 'expense' },
    'завтрак': { name: 'Кафе и рестораны', icon: '🥐', type: 'expense' },
    'бургер': { name: 'Фастфуд', icon: '🍔', type: 'expense' },
    'пицца': { name: 'Кафе и доставка', icon: '🍕', type: 'expense' },
    'продукты': { name: 'Супермаркеты', icon: '🛒', type: 'expense' },
    'магазин': { name: 'Супермаркеты', icon: '🛒', type: 'expense' },
    'супермаркет': { name: 'Супермаркеты', icon: '🛒', type: 'expense' },
    'вкусвилл': { name: 'Супермаркеты', icon: '🥑', type: 'expense' },
    'такси': { name: 'Такси', icon: '🚕', type: 'expense' },
    'яндекс': { name: 'Такси и сервисы', icon: '🚕', type: 'expense' },
    'метро': { name: 'Общественный транспорт', icon: '🚇', type: 'expense' },
    'автобус': { name: 'Транспорт', icon: '🚌', type: 'expense' },
    'бензин': { name: 'Авто и заправки', icon: '⛽', type: 'expense' },
    'азс': { name: 'Авто и заправки', icon: '⛽', type: 'expense' },
    'аптека': { name: 'Аптека и здоровье', icon: '💊', type: 'expense' },
    'врач': { name: 'Медицина', icon: '🩺', type: 'expense' },
    'аренда': { name: 'Жилье и аренда', icon: '🏠', type: 'expense' },
    'жкх': { name: 'Коммунальные услуги', icon: '💡', type: 'expense' },
    'интернет': { name: 'Связь и интернет', icon: '🌐', type: 'expense' },
    'телефон': { name: 'Мобильная связь', icon: '📱', type: 'expense' },
    'кино': { name: 'Развлечения', icon: '🍿', type: 'expense' },
    'игры': { name: 'Игры и софт', icon: '🎮', type: 'expense' },
    'одежда': { name: 'Одежда и обувь', icon: '👕', type: 'expense' },
    'кроссовки': { name: 'Одежда и обувь', icon: '👟', type: 'expense' },
    'спорт': { name: 'Фитнес и спорт', icon: '🏋️', type: 'expense' },
    'зал': { name: 'Фитнес', icon: '💪', type: 'expense' },
    'перевод': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'перевел': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'перевела': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'скинул': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'скинула': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'маме': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'папе': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'другу': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'людям': { name: 'Перевод людям', icon: '👤', type: 'expense' },
    'зарплата': { name: 'Зарплата', icon: '💰', type: 'income' },
    'аванс': { name: 'Аванс', icon: '💵', type: 'income' },
    'премия': { name: 'Премия', icon: '🎁', type: 'income' },
    'фриланс': { name: 'Фриланс', icon: '💻', type: 'income' },
    'возврат': { name: 'Возврат средств', icon: '🔄', type: 'income' }
  };

  function getLocalDateString(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatTxDate(dateVal) {
    if (!dateVal) return 'Сегодня';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'Сегодня';
    const now = new Date();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return 'Сегодня';
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
      return 'Вчера';
    }
    const monthsShort = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const day = d.getDate();
    const month = monthsShort[d.getMonth()];
    if (d.getFullYear() === now.getFullYear()) {
      return `${day} ${month}`;
    }
    return `${day} ${month} ${d.getFullYear()}`;
  }

  function parseSmartEntry(text) {
    if (!text || !text.trim()) return null;
    let clean = text.trim();

    // Date detection
    let detectedDate = new Date();
    let hasCustomDate = false;

    // 1. Relative keywords
    if (/\bпозавчера\b/i.test(clean)) {
      detectedDate = new Date(Date.now() - 2 * 86400000);
      clean = clean.replace(/\bпозавчера\b/gi, '');
      hasCustomDate = true;
    } else if (/\bвчера\b/i.test(clean)) {
      detectedDate = new Date(Date.now() - 86400000);
      clean = clean.replace(/\bвчера\b/gi, '');
      hasCustomDate = true;
    } else if (/\bсегодня\b/i.test(clean)) {
      detectedDate = new Date();
      clean = clean.replace(/\bсегодня\b/gi, '');
      hasCustomDate = true;
    }

    // 2. Year detection (e.g. 2026, 2027, "26 года", "27 года")
    let targetYear = detectedDate.getFullYear();
    const fullYearMatch = clean.match(/\b(202[5-9]|2030)\b/i);
    const shortYearMatch = clean.match(/\b(2[5-9])\s*(?:г|года|году)?\b/i);
    if (fullYearMatch) {
      targetYear = parseInt(fullYearMatch[1], 10);
      clean = clean.replace(fullYearMatch[0], '');
      hasCustomDate = true;
    } else if (shortYearMatch) {
      targetYear = 2000 + parseInt(shortYearMatch[1], 10);
      clean = clean.replace(shortYearMatch[0], '');
      hasCustomDate = true;
    }

    // 3. Month detection
    const MONTH_MAP = [
      { re: /янв[а-я]*/i, idx: 0 },
      { re: /фев[а-я]*/i, idx: 1 },
      { re: /мар[а-я]*/i, idx: 2 },
      { re: /апр[а-я]*/i, idx: 3 },
      { re: /ма[еяй]/i, idx: 4 },
      { re: /июн[а-я]*/i, idx: 5 },
      { re: /июл[а-я]*/i, idx: 6 },
      { re: /авг[а-я]*/i, idx: 7 },
      { re: /сен[а-я]*/i, idx: 8 },
      { re: /окт[а-я]*/i, idx: 9 },
      { re: /ноя[а-я]*/i, idx: 10 },
      { re: /дек[а-я]*/i, idx: 11 }
    ];

    let targetMonth = detectedDate.getMonth();
    for (const m of MONTH_MAP) {
      if (m.re.test(clean)) {
        targetMonth = m.idx;
        clean = clean.replace(m.re, '');
        hasCustomDate = true;
        break;
      }
    }

    // 4. Amount detection (first number found)
    const numMatch = clean.match(/(\d+([\.,]\d+)?)/);
    const amount = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : 0;
    if (numMatch) {
      clean = clean.replace(numMatch[0], '');
    }

    // 5. Day detection (if another small number remains between 1 and 31)
    let targetDay = 15;
    const dayMatch = clean.match(/\b([1-9]|[12]\d|3[01])\b/);
    if (dayMatch) {
      targetDay = parseInt(dayMatch[1], 10);
      clean = clean.replace(dayMatch[0], '');
    } else if (!hasCustomDate) {
      targetDay = detectedDate.getDate();
    }

    let dateStr = null;
    if (hasCustomDate) {
      const yStr = targetYear;
      const mStr = String(targetMonth + 1).padStart(2, '0');
      const dStr = String(targetDay).padStart(2, '0');
      dateStr = `${yStr}-${mStr}-${dStr}`;
    }

    let words = clean.replace(/р|руб|₽/gi, '').replace(/\bза\b/gi, '').trim();
    words = words.replace(/\s+/g, ' ');
    if (!words) words = 'Покупка';

    let matchedCategory = { name: 'Другое', icon: '🏷️', type: 'expense' };
    const lowerWords = words.toLowerCase();
    for (const key in CATEGORY_MAP) {
      if (lowerWords.includes(key)) {
        matchedCategory = CATEGORY_MAP[key];
        break;
      }
    }

    return {
      title: words.charAt(0).toUpperCase() + words.slice(1),
      amount: amount,
      category: matchedCategory.name,
      icon: matchedCategory.icon,
      type: matchedCategory.type,
      dateStr: dateStr
    };
  }

  // --- SVG Icons Helper ---
  const ICONS = {
    cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    card: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="5" width="20" height="14" rx="3"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    pie: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>`,
    flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    bank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="12 2 2 7 22 7 12 2"/><rect x="4" y="10" width="3" height="8"/><rect x="10.5" y="10" width="3" height="8"/><rect x="17" y="10" width="3" height="8"/><rect x="2" y="18" width="20" height="4"/></svg>`
  };

  // --- Render Functions ---

  function renderApp() {
    const root = document.getElementById('app-root');
    if (!root) return;

    root.innerHTML = `
      <!-- iOS Status Bar Replica -->
      <div class="status-bar">
        <span class="time">${getCurrentTimeString()}</span>
        <div class="dynamic-island">
          <svg class="wave" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="status-bar-icons">
          <span>LTE</span>
          <svg width="18" height="12" viewBox="0 0 24 14" fill="currentColor">
            <rect x="1" y="1" width="19" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
            <rect x="3" y="3" width="13" height="8" rx="1.5" fill="currentColor"/>
            <path d="M22 5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <!-- Page Header -->
      <header class="page-header">
        <div class="page-title-group">
          <h1 class="page-title">${getHeaderTitle()}</h1>
          <span class="page-subtitle">${getHeaderSubtitle()}</span>
        </div>
        <div class="header-actions">
          <button class="icon-button" id="btn-sync" title="Синхронизация с iPhone (GitHub Cloud)" style="position:relative;">
            ${ICONS.cloud}
            ${state.settings.githubToken ? '<span style="position:absolute; top:8px; right:8px; width:7px; height:7px; border-radius:50%; background:#30d158; box-shadow:0 0 6px #30d158;"></span>' : ''}
          </button>
          <button class="icon-button" id="btn-privacy" title="Режим скрытия сумм">
            ${state.settings.privacyMode ? ICONS.eyeOff : ICONS.eye}
          </button>
          <button class="icon-button" id="btn-assistant" title="AI-Помощник">
            ${ICONS.sparkles}
          </button>
          <button class="icon-button" id="btn-profile" title="Профиль и настройки">
            ${ICONS.user}
          </button>
          <button class="icon-button icon-btn-blue" id="btn-quick-add" title="Быстрое действие">
            ${ICONS.plus}
          </button>
        </div>
      </header>

      <!-- Main Scrollable Content -->
      <main class="main-content" id="main-scrollable">
        ${renderActiveTabContent()}
      </main>

      <!-- Bottom Floating Navigation Dock -->
      <nav class="floating-dock-container">
        <div class="dock-pill">
          <div class="dock-item ${state.activeTab === 'today' ? 'active' : ''}" data-tab="today">
            ${ICONS.home}
            <span>Сегодня</span>
          </div>
          <div class="dock-item ${state.activeTab === 'operations' ? 'active' : ''}" data-tab="operations">
            ${ICONS.list}
            <span>Операции</span>
          </div>
          <div class="dock-item ${state.activeTab === 'plan' ? 'active' : ''}" data-tab="plan">
            ${ICONS.pie}
            <span>План</span>
          </div>
          <div class="dock-item ${state.activeTab === 'goals' ? 'active' : ''}" data-tab="goals">
            ${ICONS.flag}
            <span>Цели</span>
          </div>
        </div>
        <button class="dock-search-btn" id="btn-dock-search" title="Поиск и действия">
          ${ICONS.search}
        </button>
      </nav>

      <!-- Modals Container -->
      <div id="modal-container"></div>
    `;

    attachGlobalEvents();
  }

  function getCurrentTimeString() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  function getHeaderTitle() {
    switch (state.activeTab) {
      case 'today': return 'Сегодня';
      case 'operations': return 'Операции';
      case 'plan': return 'План';
      case 'goals': return 'Цели';
      default: return 'Сегодня';
    }
  }

  function getHeaderSubtitle() {
    if (state.activeTab === 'today') {
      return getRussianCurrentDate();
    }
    return '';
  }

  // --- TAB CONTENT RENDERING ---

  function renderActiveTabContent() {
    switch (state.activeTab) {
      case 'today':
        return renderTodayTab();
      case 'operations':
        return renderOperationsTab();
      case 'plan':
        return renderPlanTab();
      case 'goals':
        return renderGoalsTab();
      default:
        return renderTodayTab();
    }
  }

  // 1. TODAY TAB
  function renderTodayTab() {
    const totalBalance = state.accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    const hasAccounts = state.accounts.length > 0;
    const daysUntilPayday = getDaysUntilPayday();
    const safePerDay = daysUntilPayday > 0 ? Math.max(0, Math.round(totalBalance / daysUntilPayday)) : totalBalance;

    let html = '';

    if (!hasAccounts) {
      // Empty / onboarding state
      html += `
        <!-- Onboarding Primary Card -->
        <div class="card">
          <div class="card-icon-square">
            ${ICONS.card}
          </div>
          <h2 class="card-title">Начните со счёта</h2>
          <p class="card-desc">
            Карта, наличные или вклад — и сколько на нём сейчас. Дальше записывайте траты одной строкой, а «Сегодня» покажет, сколько можно тратить до зарплаты.
          </p>
          <div class="card-actions">
            <button class="btn-primary" id="btn-add-account-card">
              ${ICONS.plus} Добавить счёт
            </button>
            <button class="btn-secondary" id="btn-demo-data">
              ${ICONS.download} Загрузить демо-данные (или перенести копию)
            </button>
          </div>
        </div>
      `;
    } else {
      // Populated Today View with Safe-to-spend calculation
      html += `
        <!-- Safe-to-Spend Dashboard Block -->
        <div class="card" style="background: linear-gradient(145deg, #18181c 0%, #111114 100%);">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <span style="font-size: 13px; color: var(--text-secondary);">Можно тратить в день</span>
            <span style="font-size: 12px; color: var(--accent-blue);">до зарплаты (${daysUntilPayday} дн.)</span>
          </div>
          <div style="font-size: 38px; font-weight: 800; color: #fff; letter-spacing: -0.5px; margin: 4px 0;">
            ${formatMoney(safePerDay)}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 10px; border-top: 1px solid var(--border-color); font-size: 13px;">
            <span style="color: var(--text-secondary);">Всего на счетах:</span>
            <span style="font-weight: 700; color: #fff;">${formatMoney(totalBalance)}</span>
          </div>
        </div>

        <!-- Smart Natural Language Entry Input -->
        <div class="smart-entry-card">
          <input type="text" id="smart-input" class="smart-entry-input" placeholder="«Кофе 350» одной строкой..." />
          <button class="smart-entry-btn" id="btn-smart-submit">Записать</button>
        </div>

        <!-- Accounts List -->
        <div class="section-header">
          <h3 class="section-title">Счета</h3>
          <span class="section-action" id="btn-add-account-section">+ Новый счёт</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${state.accounts.map(acc => `
            <div class="tx-item" style="cursor: pointer;" onclick="window.editAccount('${acc.id}')">
              <div class="tx-left">
                <div class="tx-icon-circle" style="background: ${acc.color || '#222227'};">
                  ${acc.icon || '💳'}
                </div>
                <div class="tx-details">
                  <span class="tx-title">${escapeHtml(acc.name)}</span>
                  <span class="tx-meta">${escapeHtml(acc.type || 'Карта')}</span>
                </div>
              </div>
              <div class="tx-amount">${formatMoney(acc.balance)}</div>
            </div>
          `).join('')}
        </div>

        <!-- Tinkoff Financial Analysis Entry Card -->
        <div class="card" id="card-open-analytics" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #19191d 0%, #121215 100%); margin-top: 10px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; border-radius: 12px; background: rgba(0, 122, 255, 0.15); display: flex; align-items: center; justify-content: center; font-size: 20px;">
              📊
            </div>
            <div>
              <div style="font-weight: 700; font-size: 15px; color: #fff;">Анализ финансов</div>
              <div style="font-size: 12px; color: var(--text-secondary);">Графики трат и зачислений по категориям</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; color: var(--accent-blue); font-size: 13px; font-weight: 600;">
            <span>Смотреть &gt;</span>
          </div>
        </div>

        <!-- Recent Operations -->
        <div class="section-header" style="margin-top: 6px;">
          <h3 class="section-title">Сегодняшние траты</h3>
          <span class="section-action" onclick="window.switchTab('operations')">Все операции ></span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${state.transactions.slice(0, 4).map(tx => renderTransactionItem(tx)).join('') || `
            <div style="text-align: center; padding: 18px; color: var(--text-muted); font-size: 13px;">
              Сегодня трат пока не было. Напишите, например: «Кофе 350».
            </div>
          `}
        </div>
      `;
    }

    const totalMonthlySpend = state.monthlyPayments.reduce((s, m) => s + (Number(m.amount) || 0), 0);

    // Monthly Recurring Payments Section (replacing the Pro banner)
    html += `
      <!-- Monthly Recurring Payments Section -->
      <div class="monthly-card" id="card-monthly-widget">
        <div class="monthly-header">
          <div class="monthly-title-group">
            <div class="monthly-icon-badge">📱</div>
            <div>
              <h3 class="monthly-title">Ежемесячные платежи</h3>
              <span style="font-size:12px; color:var(--text-secondary);">Связь, интернет, подписки, ЖКХ</span>
            </div>
          </div>
          <span class="monthly-total-badge">${formatMoney(totalMonthlySpend)}/мес</span>
        </div>

        ${state.monthlyPayments.length > 0 ? `
          <div class="monthly-list">
            ${state.monthlyPayments.slice(0, 4).map(m => `
              <div class="monthly-item ${m.paidThisMonth ? 'is-paid' : ''}" style="cursor:pointer;" onclick="window.openMonthlyPayments()">
                <div class="monthly-item-left">
                  <div class="monthly-item-icon">${m.icon || '📱'}</div>
                  <div class="monthly-item-info">
                    <span class="monthly-item-name">${escapeHtml(m.title)}</span>
                    <span class="monthly-item-meta">${m.dayOfMonth ? `${m.dayOfMonth}-е число` : 'Ежемесячно'} • ${escapeHtml(m.category || 'Связь')}</span>
                  </div>
                </div>
                <div class="monthly-item-right">
                  <span class="monthly-item-amount">${formatMoney(m.amount)}</span>
                  <button class="btn-pay-status ${m.paidThisMonth ? 'paid' : ''}" onclick="event.stopPropagation(); window.toggleMonthlyPaid('${m.id}')">
                    ${m.paidThisMonth ? '✓ Оплачено' : 'Оплатить'}
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <button class="btn-secondary" style="font-size:13px; color:var(--accent-blue);" onclick="window.openMonthlyPayments()">
              Все платежи (${state.monthlyPayments.length}) &gt;
            </button>
            <button class="btn-secondary" style="font-size:13px; color:var(--text-primary);" onclick="window.openAddMonthly()">
              + Добавить
            </button>
          </div>
        ` : `
          <p style="font-size:13px; color:var(--text-secondary); line-height:1.45; margin-top:2px;">
            Записывайте расходы на связь, интернет, подписки и коммуналку, чтобы всегда знать фиксированные траты в месяц.
          </p>
          <div class="quick-templates-scroll">
            <div class="template-chip" onclick="window.openAddMonthly('phone')">📱 Связь</div>
            <div class="template-chip" onclick="window.openAddMonthly('internet')">🌐 Интернет</div>
            <div class="template-chip" onclick="window.openAddMonthly('plus')">🎬 Подписки</div>
            <div class="template-chip" onclick="window.openAddMonthly('utilities')">💡 ЖКХ</div>
          </div>
          <button class="btn-pill-dark" style="margin-top:6px;" onclick="window.openAddMonthly()">
            + Добавить ежемесячный платёж
          </button>
        `}
      </div>

      <!-- Footer Info -->
      <footer class="app-footer">
        <span class="footer-hint">Бюджет хранится в этом браузере</span>
        <div class="footer-links">
          <a href="#" id="link-privacy">Конфиденциальность</a> •
          <a href="#" id="link-support">Поддержка</a> •
          <a href="#" id="link-about">О приложении</a>
        </div>
      </footer>
    `;

    return html;
  }

  // 2. OPERATIONS TAB (Screenshot 4)
  function renderOperationsTab() {
    const hasAccounts = state.accounts.length > 0;
    const hasTransactions = state.transactions.length > 0;
    let html = '';

    if (!hasTransactions) {
      if (!hasAccounts) {
        // No accounts at all -> prompt to add an account
        html += `
          <div class="empty-state-box">
            <div class="empty-state-icon">
              ${ICONS.wallet}
            </div>
            <h3 class="empty-state-title">Операций пока нет</h3>
            <p class="empty-state-desc">
              Сначала добавьте счёт — карту, наличные или вклад. Потом записывайте траты одной строкой, например «Кофе 350».
            </p>
            <button class="btn-pill-dark" id="btn-ops-add-account">
              Добавить счёт
            </button>
          </div>
        `;
      } else {
        // Accounts exist -> show smart entry and button to record transaction
        html += `
          <div class="smart-entry-card" style="margin-bottom: 16px;">
            <input type="text" id="smart-input-ops" class="smart-entry-input" placeholder="«Кофе 350» одной строкой..." />
            <button class="smart-entry-btn" id="btn-smart-submit-ops">Записать</button>
          </div>

          <div class="empty-state-box">
            <div class="empty-state-icon">
              ${ICONS.wallet}
            </div>
            <h3 class="empty-state-title">Операций пока нет</h3>
            <p class="empty-state-desc">
              Запишите расход одной строкой выше или добавьте вручную с выбором категории и счёта:
            </p>
            <button class="btn-primary" id="btn-ops-record-tx" style="margin-top: 14px; width: auto; padding: 10px 22px; font-size: 14px;">
              + Записать операцию
            </button>
          </div>
        `;
      }
    } else {
      // Operations List with Filters
      html += `
        <div class="smart-entry-card" style="margin-bottom: 14px;">
          <input type="text" id="smart-input-ops" class="smart-entry-input" placeholder="Быстро: «Такси 450»..." />
          <button class="smart-entry-btn" id="btn-smart-submit-ops">Записать</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${state.transactions.map(tx => renderTransactionItem(tx)).join('')}
        </div>
      `;
    }

    // Footer
    html += `
      <footer class="app-footer" style="margin-top: 24px;">
        <span class="footer-hint">Бюджет хранится в этом браузере</span>
        <div class="footer-links">
          <a href="#" id="link-privacy">Конфиденциальность</a> •
          <a href="#" id="link-support">Поддержка</a> •
          <a href="#" id="link-about">О приложении</a>
        </div>
      </footer>
    `;

    return html;
  }

  function renderTransactionItem(tx) {
    const isExpense = tx.type === 'expense';
    const acc = state.accounts.find(a => a.id === tx.accountId);
    const accName = acc ? acc.name : 'Основной счёт';
    const dateFormatted = formatTxDate(tx.date);

    return `
      <div class="tx-item" data-id="${tx.id}" style="cursor: pointer;" onclick="window.editTransaction('${tx.id}')">
        <div class="tx-left">
          <div class="tx-icon-circle">${tx.icon || '💳'}</div>
          <div class="tx-details">
            <span class="tx-title">${escapeHtml(tx.title)}</span>
            <span class="tx-meta">${escapeHtml(tx.category || 'Расход')} • ${dateFormatted} • ${escapeHtml(accName)}</span>
          </div>
        </div>
        <div class="tx-amount ${isExpense ? 'expense' : 'income'}">
          ${isExpense ? '- ' : '+ '}${formatMoney(tx.amount)}
        </div>
      </div>
    `;
  }

  // 3. PLAN TAB (Screenshots 5 & 6)
  function renderPlanTab() {
    const targetDateStr = getTargetAccountingDateStr();
    const plannedExpenses = state.plans.filter(p => p.type === 'expense');
    const plannedIncome = state.plans.filter(p => p.type === 'income');
    const totalPlannedExpenses = plannedExpenses.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    let html = `
      <!-- Top 3 Metrics Cards (Screenshots 5 & 6) -->
      <div class="metrics-row">
        <div class="metric-card">
          <span class="metric-label">Учтено до ${targetDateStr}</span>
          <span class="metric-value">${formatMoney(totalPlannedExpenses)}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Защищённый резерв</span>
          <span class="metric-value">${formatMoney(0)}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">Платежей впереди</span>
          <span class="metric-value">${plannedExpenses.length}</span>
        </div>
      </div>

      <!-- Section: Обязательные платежи -->
      <div class="section-header" style="margin-top: 10px;">
        <h3 class="section-title">Обязательные платежи</h3>
        <span class="section-action" id="btn-reserve-info">Резерв</span>
      </div>

      ${plannedExpenses.length === 0 ? `
        <!-- Empty Plan Card -->
        <div class="empty-state-box">
          <div class="empty-state-icon">${ICONS.wallet}</div>
          <h3 class="empty-state-title">План пока чистый</h3>
          <p class="empty-state-desc">
            Подписки, аренда, кредит — добавьте платежи, которые важно учесть.
          </p>
          <button class="btn-pill-dark" id="btn-add-plan-expense">
            Добавить платёж
          </button>
        </div>
        <p class="explanatory-note">
          План не списывает деньги. Факт записывается после подтверждения. Просроченные неоплаченные платежи остаются в расчёте.
        </p>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${plannedExpenses.map(p => `
            <div class="tx-item">
              <div class="tx-left">
                <div class="tx-icon-circle">${p.icon || '📅'}</div>
                <div class="tx-details">
                  <span class="tx-title">${escapeHtml(p.title)}</span>
                  <span class="tx-meta">Срок: ${p.dueDate || 'каждый месяц'}</span>
                </div>
              </div>
              <div class="tx-amount expense">- ${formatMoney(p.amount)}</div>
            </div>
          `).join('')}
          <button class="btn-pill-dark" style="align-self: center;" id="btn-add-plan-expense">+ Добавить платёж</button>
        </div>
      `}

      <!-- Section: Ожидаемые доходы (Screenshot 6) -->
      <div class="card" style="margin-top: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-size: 18px; font-weight: 700;">Ожидаемые доходы</h3>
          <span class="section-action" id="btn-add-plan-income">Добавить доход</span>
        </div>
        <p class="card-desc">
          Зарплата или другое поступление — чтобы видеть, когда придут деньги. На остаток не влияет, пока вы не запишете доход.
        </p>
        ${plannedIncome.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
            ${plannedIncome.map(p => `
              <div class="tx-item">
                <div class="tx-left">
                  <div class="tx-icon-circle">💵</div>
                  <div class="tx-details">
                    <span class="tx-title">${escapeHtml(p.title)}</span>
                    <span class="tx-meta">${p.dueDate || 'В этом месяце'}</span>
                  </div>
                </div>
                <div class="tx-amount income">+ ${formatMoney(p.amount)}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Footer -->
      <footer class="app-footer" style="margin-top: 14px;">
        <span class="footer-hint">Бюджет хранится в этом браузере</span>
        <div class="footer-links">
          <a href="#" id="link-privacy">Конфиденциальность</a> •
          <a href="#" id="link-support">Поддержка</a> •
          <a href="#" id="link-about">О приложении</a>
        </div>
      </footer>
    `;

    return html;
  }

  // 4. GOALS TAB (Screenshot 7)
  function renderGoalsTab() {
    let filteredGoals = state.goals;
    if (state.goalFilter === 'in_progress') {
      filteredGoals = state.goals.filter(g => (g.currentAmount || 0) < (g.targetAmount || 1));
    } else if (state.goalFilter === 'completed') {
      filteredGoals = state.goals.filter(g => (g.currentAmount || 0) >= (g.targetAmount || 1));
    }

    let html = `
      <!-- Segmented Control (Screenshot 7) -->
      <div class="segmented-control">
        <div class="segment-item ${state.goalFilter === 'all' ? 'active' : ''}" data-filter="all">Все цели</div>
        <div class="segment-item ${state.goalFilter === 'in_progress' ? 'active' : ''}" data-filter="in_progress">В процессе</div>
        <div class="segment-item ${state.goalFilter === 'completed' ? 'active' : ''}" data-filter="completed">Достигнуты</div>
      </div>

      <div class="count-badge">Найдено: ${filteredGoals.length}</div>

      ${filteredGoals.length === 0 ? `
        <!-- Empty Goals Card -->
        <div class="empty-state-box">
          <div class="empty-state-icon">${ICONS.wallet}</div>
          <h3 class="empty-state-title">Начните с важного</h3>
          <p class="empty-state-desc">
            Выберите цель, сумму и подходящую дату.
          </p>
          <button class="btn-pill-dark" id="btn-create-goal">
            Создать цель
          </button>
        </div>
        <p class="explanatory-note">
          Взнос отмечает прогресс, не переводит и не резервирует деньги. Удаление цели не меняет счета и операции.
        </p>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${filteredGoals.map(goal => {
            const current = Number(goal.currentAmount) || 0;
            const target = Number(goal.targetAmount) || 1;
            const percent = Math.min(100, Math.round((current / target) * 100));
            return `
              <div class="goal-card">
                <div class="goal-header">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">${goal.icon || '🎯'}</span>
                    <div>
                      <h4 class="goal-title">${escapeHtml(goal.title)}</h4>
                      <span style="font-size: 12px; color: var(--text-secondary);">До ${goal.targetDate || 'бессрочно'}</span>
                    </div>
                  </div>
                  <button class="btn-pill-dark" style="padding: 6px 14px; font-size: 12px; margin-top: 0;" onclick="window.topUpGoal('${goal.id}')">
                    + Взнос
                  </button>
                </div>
                <div class="goal-progress-bar-bg">
                  <div class="goal-progress-bar-fill" style="width: ${percent}%;"></div>
                </div>
                <div class="goal-footer">
                  <span>${formatMoney(current)} из ${formatMoney(target)}</span>
                  <span style="font-weight: 700; color: #fff;">${percent}%</span>
                </div>
              </div>
            `;
          }).join('')}
          <button class="btn-pill-dark" style="align-self: center;" id="btn-create-goal">+ Новая цель</button>
        </div>
      `}

      <!-- Footer -->
      <footer class="app-footer" style="margin-top: 24px;">
        <span class="footer-hint">Бюджет хранится в этом браузере</span>
        <div class="footer-links">
          <a href="#" id="link-privacy">Конфиденциальность</a> •
          <a href="#" id="link-support">Поддержка</a> •
          <a href="#" id="link-about">О приложении</a>
        </div>
      </footer>
    `;

    return html;
  }

  // --- MODALS & BOTTOM SHEETS ---

  // 1. Search & Action Sheet (Screenshots 8 & 9)
  function openSearchSheet() {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay open" id="search-overlay">
        <div class="bottom-sheet" id="search-sheet">
          <div class="sheet-handle"></div>
          
          <!-- Search input header -->
          <div class="sheet-search-bar">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" id="sheet-search-input" class="sheet-search-input" placeholder="Операция, раздел или действие..." autofocus />
            <button class="sheet-close-btn" id="btn-sheet-close">✕</button>
          </div>

          <!-- Dynamic Action / Navigation Menu List -->
          <div class="action-menu-list" id="action-menu-items">
            <div class="action-menu-item" data-action="nav-today">
              <span class="menu-icon">${ICONS.home}</span>
              <span>Сегодня</span>
            </div>
            <div class="action-menu-item" data-action="nav-operations">
              <span class="menu-icon">${ICONS.list}</span>
              <span>Операции</span>
            </div>
            <div class="action-menu-item" data-action="nav-plan">
              <span class="menu-icon">${ICONS.pie}</span>
              <span>План</span>
            </div>
            <div class="action-menu-item" data-action="nav-goals">
              <span class="menu-icon">${ICONS.flag}</span>
              <span>Цели</span>
            </div>
            <div class="action-menu-item" data-action="open-monthly">
              <span class="menu-icon">📱</span>
              <span>Ежемесячные платежи (связь, интернет...)</span>
            </div>
            <div class="action-menu-item" data-action="open-analytics">
              <span class="menu-icon">${ICONS.chart}</span>
              <span>Аналитика</span>
            </div>
            <div class="action-menu-item" data-action="open-assistant">
              <span class="menu-icon">${ICONS.sparkles}</span>
              <span>Помощник</span>
            </div>
            <div class="action-menu-item" data-action="open-settings">
              <span class="menu-icon">${ICONS.settings}</span>
              <span>Настройки</span>
            </div>
            <div class="action-menu-item" data-action="quick-tx">
              <span class="menu-icon">${ICONS.plus}</span>
              <span>Записать операцию</span>
            </div>
            <div class="action-menu-item" data-action="quick-account">
              <span class="menu-icon">${ICONS.bank}</span>
              <span>Новый счёт</span>
            </div>
            <div class="action-menu-item" data-action="quick-plan">
              <span class="menu-icon">${ICONS.calendar}</span>
              <span>Добавить платёж</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const input = document.getElementById('sheet-search-input');
    const menuList = document.getElementById('action-menu-items');

    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const items = menuList.querySelectorAll('.action-menu-item');
      items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? 'flex' : 'none';
      });
    });

    document.getElementById('btn-sheet-close').addEventListener('click', closeModal);
    document.getElementById('search-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'search-overlay') closeModal();
    });

    menuList.addEventListener('click', (e) => {
      const item = e.target.closest('.action-menu-item');
      if (!item) return;
      const action = item.getAttribute('data-action');
      closeModal();
      handleMenuAction(action);
    });
  }

  function handleMenuAction(action) {
    switch (action) {
      case 'nav-today':
        window.switchTab('today');
        break;
      case 'nav-operations':
        window.switchTab('operations');
        break;
      case 'nav-plan':
        window.switchTab('plan');
        break;
      case 'nav-goals':
        window.switchTab('goals');
        break;
      case 'open-monthly':
        openMonthlyPaymentsModal();
        break;
      case 'open-analytics':
        openAnalyticsModal();
        break;
      case 'open-assistant':
        openAssistantModal();
        break;
      case 'open-settings':
        openSettingsModal();
        break;
      case 'quick-tx':
        openAddTransactionModal();
        break;
      case 'quick-account':
        openAddAccountModal();
        break;
      case 'quick-plan':
        openAddPlanModal('expense');
        break;
    }
  }

  // 2. Add Account Modal
  function openAddAccountModal(existingId = null) {
    const existing = existingId ? state.accounts.find(a => a.id === existingId) : null;
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay open" id="account-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:20px; font-weight:700;">${existing ? 'Редактировать счёт' : 'Новый счёт'}</h3>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>
          
          <div class="form-group">
            <label class="form-label">Название счёта</label>
            <input type="text" id="acc-name" class="form-input" placeholder="Например: Сбербанк, Tinkoff, Наличные..." value="${existing ? escapeHtml(existing.name) : ''}" />
          </div>

          <div class="form-group">
            <label class="form-label">Тип счёта</label>
            <select id="acc-type" class="form-select">
              <option value="Карта" ${existing && existing.type === 'Карта' ? 'selected' : ''}>Дебетовая карта</option>
              <option value="Наличные" ${existing && existing.type === 'Наличные' ? 'selected' : ''}>Наличные</option>
              <option value="Вклад" ${existing && existing.type === 'Вклад' ? 'selected' : ''}>Вклад или накопительный счёт</option>
              <option value="Кредитная карта" ${existing && existing.type === 'Кредитная карта' ? 'selected' : ''}>Кредитная карта</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Текущий баланс (₽)</label>
            <input type="number" id="acc-balance" class="form-input" placeholder="0" value="${existing ? existing.balance : ''}" />
          </div>

          <div class="form-group">
            <label class="form-label">Иконка</label>
            <div class="quick-category-pills" id="acc-icon-selector">
              ${['💳', '💵', '🏦', '🪙', '💼', '🐖'].map(icon => `
                <div class="cat-pill ${existing && existing.icon === icon ? 'active' : ''}" data-icon="${icon}">${icon}</div>
              `).join('')}
            </div>
          </div>

          <div style="display:flex; gap:10px; margin-top:10px;">
            <button class="btn-primary" style="flex:1;" id="btn-save-account">Сохранить</button>
            ${existing ? `<button class="btn-pill-dark" style="color:var(--accent-red); margin-top:0;" id="btn-del-account">Удалить</button>` : ''}
          </div>
        </div>
      </div>
    `;

    let selectedIcon = existing ? existing.icon : '💳';
    document.querySelectorAll('#acc-icon-selector .cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#acc-icon-selector .cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        selectedIcon = pill.getAttribute('data-icon');
      });
    });

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('account-overlay').addEventListener('click', e => { if (e.target.id === 'account-overlay') closeModal(); });

    document.getElementById('btn-save-account').addEventListener('click', () => {
      const name = document.getElementById('acc-name').value.trim();
      const type = document.getElementById('acc-type').value;
      const balance = parseFloat(document.getElementById('acc-balance').value) || 0;

      if (!name) {
        alert('Пожалуйста, укажите название счёта');
        return;
      }

      if (existing) {
        existing.name = name;
        existing.type = type;
        existing.balance = balance;
        existing.icon = selectedIcon;
      } else {
        state.accounts.push({
          id: 'acc_' + Date.now(),
          name,
          type,
          balance,
          icon: selectedIcon,
          color: '#1e88e5'
        });
      }

      saveState();
      closeModal();
      renderApp();
    });

    if (existing) {
      document.getElementById('btn-del-account').addEventListener('click', () => {
        if (confirm(`Удалить счёт "${existing.name}"?`)) {
          state.accounts = state.accounts.filter(a => a.id !== existing.id);
          saveState();
          closeModal();
          renderApp();
        }
      });
    }
  }

  // 3. Add Transaction Modal
  function openAddTransactionModal(initialText = '', defaultDateStr = null, fromAnalytics = false) {
    const modal = document.getElementById('modal-container');
    const parsed = initialText ? parseSmartEntry(initialText) : null;
    const initialDateStr = defaultDateStr || (parsed && parsed.dateStr) || getLocalDateString();

    modal.innerHTML = `
      <div class="modal-overlay open" id="tx-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:20px; font-weight:700;">Записать операцию</h3>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <div class="segmented-control" id="tx-type-selector">
            <div class="segment-item active" data-type="expense">Расход</div>
            <div class="segment-item" data-type="income">Доход</div>
          </div>

          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label class="form-label" style="margin-bottom:0;">Дата операции</label>
              <div style="display:flex; gap:6px;">
                <button type="button" class="date-chip-btn" id="chip-date-today">Сегодня</button>
                <button type="button" class="date-chip-btn" id="chip-date-yesterday">Вчера</button>
              </div>
            </div>
            <input type="date" id="tx-date" class="form-input" value="${initialDateStr}" style="color-scheme:dark; font-size:15px;" />
          </div>

          <div class="form-group">
            <label class="form-label">Сумма (₽)</label>
            <input type="number" id="tx-amount" class="form-input" style="font-size:24px; font-weight:700;" placeholder="0" value="${parsed ? parsed.amount : ''}" autofocus />
          </div>

          <div class="form-group">
            <label class="form-label">Описание / Назначение</label>
            <input type="text" id="tx-title" class="form-input" placeholder="Например: Кофе, Продукты, Такси..." value="${parsed ? escapeHtml(parsed.title) : ''}" />
          </div>

          <div class="form-group">
            <label class="form-label">Счёт</label>
            <select id="tx-account" class="form-select">
              ${state.accounts.map(acc => `<option value="${acc.id}">${escapeHtml(acc.name)} (${formatMoney(acc.balance)})</option>`).join('') || '<option value="">Нет счетов (будет создан по умолчанию)</option>'}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Категория</label>
            <div class="quick-category-pills" id="tx-cat-pills">
              ${[
                { name: 'Кафе и кофе', icon: '☕' },
                { name: 'Супермаркеты', icon: '🛒' },
                { name: 'Транспорт', icon: '🚕' },
                { name: 'Перевод людям', icon: '👤' },
                { name: 'Подписки', icon: '📱' },
                { name: 'Аптека', icon: '💊' },
                { name: 'Одежда', icon: '👕' },
                { name: 'Развлечения', icon: '🍿' },
                { name: 'Зарплата', icon: '💰' }
              ].map(c => `
                <div class="cat-pill ${parsed && parsed.category.includes(c.name.split(' ')[0]) ? 'active' : ''}" data-cat="${c.name}" data-icon="${c.icon}">${c.icon} ${c.name}</div>
              `).join('')}
            </div>
          </div>

          <button class="btn-primary" style="width:100%; margin-top:10px;" id="btn-save-tx">Записать операцию</button>
        </div>
      </div>
    `;

    let txType = parsed && parsed.type ? parsed.type : 'expense';
    let selectedCategory = parsed ? parsed.category : 'Другое';
    let selectedIcon = parsed ? parsed.icon : '💳';

    const chipToday = document.getElementById('chip-date-today');
    const chipYesterday = document.getElementById('chip-date-yesterday');
    const txDateInput = document.getElementById('tx-date');

    const todayStr = getLocalDateString(new Date());
    const yesterdayStr = getLocalDateString(new Date(Date.now() - 86400000));

    if (initialDateStr === todayStr && chipToday) {
      chipToday.classList.add('active');
    } else if (initialDateStr === yesterdayStr && chipYesterday) {
      chipYesterday.classList.add('active');
    }

    if (chipToday && txDateInput) {
      chipToday.addEventListener('click', () => {
        txDateInput.value = todayStr;
        chipToday.classList.add('active');
        if (chipYesterday) chipYesterday.classList.remove('active');
      });
    }

    if (chipYesterday && txDateInput) {
      chipYesterday.addEventListener('click', () => {
        txDateInput.value = yesterdayStr;
        chipYesterday.classList.add('active');
        if (chipToday) chipToday.classList.remove('active');
      });
    }

    if (txDateInput) {
      txDateInput.addEventListener('change', () => {
        if (chipToday) chipToday.classList.toggle('active', txDateInput.value === todayStr);
        if (chipYesterday) chipYesterday.classList.toggle('active', txDateInput.value === yesterdayStr);
      });
    }

    // Type selector
    document.querySelectorAll('#tx-type-selector .segment-item').forEach(seg => {
      seg.addEventListener('click', () => {
        document.querySelectorAll('#tx-type-selector .segment-item').forEach(s => s.classList.remove('active'));
        seg.classList.add('active');
        txType = seg.getAttribute('data-type');
      });
    });

    // Cat pills
    document.querySelectorAll('#tx-cat-pills .cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#tx-cat-pills .cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        selectedCategory = pill.getAttribute('data-cat');
        selectedIcon = pill.getAttribute('data-icon');
      });
    });

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('tx-overlay').addEventListener('click', e => { if (e.target.id === 'tx-overlay') closeModal(); });

    document.getElementById('btn-save-tx').addEventListener('click', () => {
      const amount = parseFloat(document.getElementById('tx-amount').value);
      const title = document.getElementById('tx-title').value.trim() || 'Операция';
      let accId = document.getElementById('tx-account').value;
      const rawDate = document.getElementById('tx-date').value;

      if (!amount || amount <= 0) {
        alert('Введите корректную сумму');
        return;
      }

      // If no account exists, create a default one
      if (!accId || state.accounts.length === 0) {
        const defaultAcc = {
          id: 'acc_' + Date.now(),
          name: 'Основная карта',
          type: 'Карта',
          balance: 50000,
          icon: '💳',
          color: '#007aff'
        };
        state.accounts.push(defaultAcc);
        accId = defaultAcc.id;
      }

      const acc = state.accounts.find(a => a.id === accId);
      if (acc) {
        if (txType === 'expense') {
          acc.balance -= amount;
        } else {
          acc.balance += amount;
        }
      }

      let txIsoDate;
      if (rawDate) {
        const parts = rawDate.split('-').map(Number);
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          const now = new Date();
          const isToday = (parts[0] === now.getFullYear() && parts[1] === (now.getMonth() + 1) && parts[2] === now.getDate());
          const h = isToday ? now.getHours() : 12;
          const m = isToday ? now.getMinutes() : 0;
          txIsoDate = new Date(parts[0], parts[1] - 1, parts[2], h, m, 0).toISOString();
        } else {
          txIsoDate = new Date().toISOString();
        }
      } else {
        txIsoDate = new Date().toISOString();
      }

      state.transactions.unshift({
        id: 'tx_' + Date.now(),
        title,
        amount,
        type: txType,
        category: selectedCategory,
        icon: selectedIcon,
        accountId: accId,
        date: txIsoDate
      });

      // Keep sorted by date descending
      state.transactions.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      const shouldReturnToAnalytics = fromAnalytics || !!document.getElementById('analytics-overlay');

      saveState();
      closeModal();
      renderApp();

      if (shouldReturnToAnalytics) {
        const txDateObj = new Date(txIsoDate);
        const now = new Date();
        const targetOffset = (txDateObj.getFullYear() - now.getFullYear()) * 12 + (txDateObj.getMonth() - now.getMonth());
        openAnalyticsModal(txType, targetOffset);
      }
    });
  }

  // 3b. Edit / Delete Transaction Modal
  function openEditTransactionModal(txId) {
    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) return;

    const modal = document.getElementById('modal-container');
    const txDateStr = getLocalDateString(new Date(tx.date || Date.now()));

    modal.innerHTML = `
      <div class="modal-overlay open" id="tx-edit-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:20px; font-weight:700;">Редактировать операцию</h3>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <div class="segmented-control" id="tx-edit-type-selector">
            <div class="segment-item ${tx.type === 'expense' ? 'active' : ''}" data-type="expense">Расход</div>
            <div class="segment-item ${tx.type === 'income' ? 'active' : ''}" data-type="income">Доход</div>
          </div>

          <div class="form-group">
            <label class="form-label">Дата операции</label>
            <input type="date" id="tx-edit-date" class="form-input" value="${txDateStr}" style="color-scheme:dark; font-size:15px;" />
          </div>

          <div class="form-group">
            <label class="form-label">Сумма (₽)</label>
            <input type="number" id="tx-edit-amount" class="form-input" style="font-size:24px; font-weight:700;" value="${tx.amount}" />
          </div>

          <div class="form-group">
            <label class="form-label">Описание / Назначение</label>
            <input type="text" id="tx-edit-title" class="form-input" value="${escapeHtml(tx.title)}" />
          </div>

          <div class="form-group">
            <label class="form-label">Счёт</label>
            <select id="tx-edit-account" class="form-select">
              ${state.accounts.map(acc => `<option value="${acc.id}" ${acc.id === tx.accountId ? 'selected' : ''}>${escapeHtml(acc.name)} (${formatMoney(acc.balance)})</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Категория</label>
            <div class="quick-category-pills" id="tx-edit-cat-pills">
              ${[
                { name: 'Кафе и кофе', icon: '☕' },
                { name: 'Супермаркеты', icon: '🛒' },
                { name: 'Транспорт', icon: '🚕' },
                { name: 'Перевод людям', icon: '👤' },
                { name: 'Подписки', icon: '📱' },
                { name: 'Аптека', icon: '💊' },
                { name: 'Одежда', icon: '👕' },
                { name: 'Развлечения', icon: '🍿' },
                { name: 'Зарплата', icon: '💰' }
              ].map(c => `
                <div class="cat-pill ${tx.category === c.name ? 'active' : ''}" data-cat="${c.name}" data-icon="${c.icon}">${c.icon} ${c.name}</div>
              `).join('')}
            </div>
          </div>

          <div style="display:flex; gap:10px; margin-top:10px;">
            <button class="btn-primary" style="flex:1;" id="btn-save-edit-tx">Сохранить</button>
            <button class="btn-pill-dark" style="color:var(--accent-red); margin-top:0;" id="btn-delete-tx">Удалить</button>
          </div>
        </div>
      </div>
    `;

    let editType = tx.type;
    let editCategory = tx.category || 'Другое';
    let editIcon = tx.icon || '💳';

    document.querySelectorAll('#tx-edit-type-selector .segment-item').forEach(seg => {
      seg.addEventListener('click', () => {
        document.querySelectorAll('#tx-edit-type-selector .segment-item').forEach(s => s.classList.remove('active'));
        seg.classList.add('active');
        editType = seg.getAttribute('data-type');
      });
    });

    document.querySelectorAll('#tx-edit-cat-pills .cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#tx-edit-cat-pills .cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        editCategory = pill.getAttribute('data-cat');
        editIcon = pill.getAttribute('data-icon');
      });
    });

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('tx-edit-overlay').addEventListener('click', e => {
      if (e.target.id === 'tx-edit-overlay') closeModal();
    });

    document.getElementById('btn-delete-tx').addEventListener('click', () => {
      if (confirm(`Удалить операцию "${tx.title}" на сумму ${formatMoney(tx.amount)}?`)) {
        const acc = state.accounts.find(a => a.id === tx.accountId);
        if (acc) {
          if (tx.type === 'expense') {
            acc.balance += Number(tx.amount) || 0;
          } else {
            acc.balance -= Number(tx.amount) || 0;
          }
        }
        state.transactions = state.transactions.filter(t => t.id !== tx.id);
        const wasInAnalytics = !!document.getElementById('analytics-overlay');
        saveState();
        closeModal();
        renderApp();
        if (wasInAnalytics) {
          openAnalyticsModal(analyticsActiveType, analyticsMonthOffset);
        }
      }
    });

    document.getElementById('btn-save-edit-tx').addEventListener('click', () => {
      const amount = parseFloat(document.getElementById('tx-edit-amount').value);
      const title = document.getElementById('tx-edit-title').value.trim() || 'Операция';
      const newAccId = document.getElementById('tx-edit-account').value;
      const rawDate = document.getElementById('tx-edit-date').value;

      if (!amount || amount <= 0) {
        alert('Введите корректную сумму');
        return;
      }

      // Revert old account balance
      const oldAcc = state.accounts.find(a => a.id === tx.accountId);
      if (oldAcc) {
        if (tx.type === 'expense') oldAcc.balance += Number(tx.amount) || 0;
        else oldAcc.balance -= Number(tx.amount) || 0;
      }

      // Apply to new account balance
      const newAcc = state.accounts.find(a => a.id === newAccId);
      if (newAcc) {
        if (editType === 'expense') newAcc.balance -= amount;
        else newAcc.balance += amount;
      }

      let txIsoDate = tx.date;
      if (rawDate) {
        const parts = rawDate.split('-').map(Number);
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          txIsoDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0).toISOString();
        }
      }

      tx.title = title;
      tx.amount = amount;
      tx.type = editType;
      tx.category = editCategory;
      tx.icon = editIcon;
      tx.accountId = newAccId;
      tx.date = txIsoDate;

      state.transactions.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      const wasInAnalytics = !!document.getElementById('analytics-overlay');
      saveState();
      closeModal();
      renderApp();

      if (wasInAnalytics) {
        const txDateObj = new Date(txIsoDate);
        const now = new Date();
        const targetOffset = (txDateObj.getFullYear() - now.getFullYear()) * 12 + (txDateObj.getMonth() - now.getMonth());
        openAnalyticsModal(editType, targetOffset);
      }
    });
  }

  // 4. Add Planned Payment / Income Modal
  function openAddPlanModal(planType = 'expense') {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay open" id="plan-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:20px; font-weight:700;">${planType === 'expense' ? 'Добавить обязательный платёж' : 'Добавить ожидаемый доход'}</h3>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <div class="form-group">
            <label class="form-label">Название</label>
            <input type="text" id="plan-title" class="form-input" placeholder="${planType === 'expense' ? 'Например: Аренда, Яндекс Плюс, Кредит...' : 'Например: Зарплата, Аванс...'}" />
          </div>

          <div class="form-group">
            <label class="form-label">Сумма (₽)</label>
            <input type="number" id="plan-amount" class="form-input" placeholder="0" />
          </div>

          <div class="form-group">
            <label class="form-label">Дата списания / поступления</label>
            <input type="text" id="plan-date" class="form-input" placeholder="Например: 25-е число каждого месяца" value="25-е число" />
          </div>

          <button class="btn-primary" style="width:100%; margin-top:10px;" id="btn-save-plan">Сохранить в план</button>
        </div>
      </div>
    `;

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('plan-overlay').addEventListener('click', e => { if (e.target.id === 'plan-overlay') closeModal(); });

    document.getElementById('btn-save-plan').addEventListener('click', () => {
      const title = document.getElementById('plan-title').value.trim();
      const amount = parseFloat(document.getElementById('plan-amount').value);
      const dueDate = document.getElementById('plan-date').value.trim();

      if (!title || !amount) {
        alert('Заполните название и сумму');
        return;
      }

      state.plans.push({
        id: 'plan_' + Date.now(),
        title,
        amount,
        type: planType,
        dueDate: dueDate || 'Ежемесячно',
        icon: planType === 'expense' ? '📅' : '💵'
      });

      saveState();
      closeModal();
      renderApp();
    });
  }

  // 5. Create Goal Modal
  function openCreateGoalModal() {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay open" id="goal-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:20px; font-weight:700;">Создать финансовую цель</h3>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <div class="form-group">
            <label class="form-label">Название цели</label>
            <input type="text" id="goal-title" class="form-input" placeholder="Например: Отпуск, MacBook Pro, Подушка безопасности..." />
          </div>

          <div class="form-group">
            <label class="form-label">Целевая сумма (₽)</label>
            <input type="number" id="goal-target" class="form-input" placeholder="100 000" />
          </div>

          <div class="form-group">
            <label class="form-label">Уже накоплено (₽)</label>
            <input type="number" id="goal-current" class="form-input" placeholder="0" value="0" />
          </div>

          <div class="form-group">
            <label class="form-label">Срок / Дата</label>
            <input type="text" id="goal-date" class="form-input" placeholder="Например: Август 2027" />
          </div>

          <div class="form-group">
            <label class="form-label">Иконка</label>
            <div class="quick-category-pills" id="goal-icon-pills">
              ${['🎯', '✈️', '💻', '🚗', '🏠', '💍', '🛡️'].map(i => `<div class="cat-pill" data-icon="${i}">${i}</div>`).join('')}
            </div>
          </div>

          <button class="btn-primary" style="width:100%; margin-top:10px;" id="btn-save-goal">Создать цель</button>
        </div>
      </div>
    `;

    let selectedIcon = '🎯';
    document.querySelectorAll('#goal-icon-pills .cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#goal-icon-pills .cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        selectedIcon = pill.getAttribute('data-icon');
      });
    });

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('goal-overlay').addEventListener('click', e => { if (e.target.id === 'goal-overlay') closeModal(); });

    document.getElementById('btn-save-goal').addEventListener('click', () => {
      const title = document.getElementById('goal-title').value.trim();
      const targetAmount = parseFloat(document.getElementById('goal-target').value);
      const currentAmount = parseFloat(document.getElementById('goal-current').value) || 0;
      const targetDate = document.getElementById('goal-date').value.trim();

      if (!title || !targetAmount) {
        alert('Заполните название и целевую сумму');
        return;
      }

      state.goals.push({
        id: 'goal_' + Date.now(),
        title,
        targetAmount,
        currentAmount,
        targetDate: targetDate || 'Бессрочно',
        icon: selectedIcon
      });

      saveState();
      closeModal();
      renderApp();
    });
  }

  // 6. AI Assistant Modal ("Помощник")
  function openAssistantModal() {
    const modal = document.getElementById('modal-container');
    const totalBalance = state.accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const totalExpenses = state.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const daysUntilPayday = getDaysUntilPayday();

    modal.innerHTML = `
      <div class="modal-overlay open" id="assistant-overlay">
        <div class="bottom-sheet" style="max-height:90vh;">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="color:var(--accent-blue);">${ICONS.sparkles}</span>
              <h3 style="font-size:20px; font-weight:700;">Финансовый помощник</h3>
            </div>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <div id="chat-messages" style="display:flex; flex-direction:column; gap:12px; margin-top:8px; max-height:360px; overflow-y:auto; padding-right:4px;">
            <div class="card" style="background:#1d1d22; border-color:rgba(0,122,255,0.2);">
              <span style="font-weight:700; color:var(--accent-blue); font-size:13px;">AI Ассистент</span>
              <p style="font-size:14px; line-height:1.45; color:#fff; margin-top:4px;">
                Привет! Я ваш персональный финансовый ассистент. 
                <br><br>
                📊 <b>Сводка:</b><br>
                • Текущий баланс: <b>${formatMoney(totalBalance)}</b><br>
                • Дней до зарплаты: <b>${daysUntilPayday}</b><br>
                • Безопасный лимит в день: <b>${formatMoney(Math.round(totalBalance / daysUntilPayday))}</b><br>
                • Расходов записано: <b>${formatMoney(totalExpenses)}</b>
                <br><br>
                Вы можете спросить меня: <i>«Как накопить на цель?»</i>, <i>«Где я трачу больше всего?»</i> или <i>«Сколько откладывать в месяц?»</i>
              </p>
            </div>
          </div>

          <!-- Quick prompts -->
          <div style="display:flex; gap:6px; overflow-x:auto; padding-bottom:4px;" id="quick-prompts">
            <div class="cat-pill" data-prompt="Как снизить расходы?">Снизить расходы</div>
            <div class="cat-pill" data-prompt="Сколько можно потратить на выходных?">Траты на выходных</div>
            <div class="cat-pill" data-prompt="Оцени мой финансовый план">Оценить бюджет</div>
          </div>

          <!-- Input bar -->
          <div class="sheet-search-bar" style="margin-top:6px;">
            <input type="text" id="assistant-input" class="sheet-search-input" placeholder="Задайте вопрос по финансам..." />
            <button class="smart-entry-btn" id="btn-send-assistant">Отправить</button>
          </div>
        </div>
      </div>
    `;

    const chatContainer = document.getElementById('chat-messages');
    const input = document.getElementById('assistant-input');

    function sendUserMessage(text) {
      if (!text || !text.trim()) return;
      const userMsg = text.trim();
      input.value = '';

      // User bubble
      const uDiv = document.createElement('div');
      uDiv.className = 'card';
      uDiv.style.alignSelf = 'flex-end';
      uDiv.style.background = '#007aff';
      uDiv.style.maxWidth = '85%';
      uDiv.style.padding = '10px 14px';
      uDiv.innerHTML = `<p style="font-size:14px; color:#fff;">${escapeHtml(userMsg)}</p>`;
      chatContainer.appendChild(uDiv);
      chatContainer.scrollTop = chatContainer.scrollHeight;

      // Smart Assistant response generator
      setTimeout(() => {
        let reply = '';
        const lower = userMsg.toLowerCase();
        if (lower.includes('выходн') || lower.includes('трат')) {
          reply = `Исходя из вашего баланса ${formatMoney(totalBalance)}, на выходные комфортно выделить не более 20-25% от недельного лимита (примерно ${formatMoney(Math.round(totalBalance * 0.15))}). Это позволит не выбиться из графика до зарплаты.`;
        } else if (lower.includes('снизить') || lower.includes('расход') || lower.includes('оптимиз')) {
          reply = `Советую проверить подписки и спонтанные траты на кофе/перекусы вне дома. Привычка записывать каждую трату одной строкой снижает импульсивные покупки в среднем на 18% за первый же месяц!`;
        } else if (lower.includes('цель') || lower.includes('накоп')) {
          reply = `Лучшая стратегия — «Заплати сначала себе»: переводите 10-15% от любого дохода на накопительный счёт или в Цели сразу в день зарплаты, а не в конце месяца.`;
        } else {
          reply = `Отличный вопрос! При текущих вводных ваш ежедневный комфортный ориентир составляет ${formatMoney(Math.round(totalBalance / daysUntilPayday))}. Если удерживать траты в этих рамках, к концу месяца у вас останется надежный резерв.`;
        }

        const bDiv = document.createElement('div');
        bDiv.className = 'card';
        bDiv.style.background = '#1d1d22';
        bDiv.innerHTML = `
          <span style="font-weight:700; color:var(--accent-blue); font-size:13px;">AI Ассистент</span>
          <p style="font-size:14px; line-height:1.45; color:#fff; margin-top:4px;">${reply}</p>
        `;
        chatContainer.appendChild(bDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }, 400);
    }

    document.getElementById('btn-send-assistant').addEventListener('click', () => sendUserMessage(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendUserMessage(input.value); });

    document.querySelectorAll('#quick-prompts .cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        sendUserMessage(pill.getAttribute('data-prompt'));
      });
    });

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('assistant-overlay').addEventListener('click', e => { if (e.target.id === 'assistant-overlay') closeModal(); });
  }

  // 7. Tinkoff-Style Financial Analysis ("Анализ финансов")
  let analyticsActiveType = 'expense';
  let analyticsMonthOffset = 0;

  const TINKOFF_CATEGORY_THEMES = {
    'Переводы людям': { icon: '👥', color: '#84cc16', bg: 'rgba(132, 204, 22, 0.18)' },
    'Супермаркеты': { icon: '🧺', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.18)' },
    'Электроника и бытовая техника': { icon: '💻', color: '#14b8a6', bg: 'rgba(20, 184, 166, 0.18)' },
    'Аптеки': { icon: '➕', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.18)' },
    'Аптека': { icon: '➕', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.18)' },
    'Подписки': { icon: '📅', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.18)' },
    'Кафе, рестораны, фастфуд': { icon: '🍴', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.18)' },
    'Кафе и кофе': { icon: '☕', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.18)' },
    'Кофе и кафе': { icon: '☕', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.18)' },
    'Транспорт': { icon: '🚌', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.18)' },
    'Такси': { icon: '🚕', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.18)' },
    'Бизнес-услуги': { icon: '💼', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.18)' },
    'Снятие наличных': { icon: '💵', color: '#10b981', bg: 'rgba(16, 185, 129, 0.18)' },
    'Благотворительность': { icon: '🤲', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.18)' },
    'ЖКХ, связь, интернет': { icon: '🏠', color: '#f97316', bg: 'rgba(249, 115, 22, 0.18)' },
    'Связь': { icon: '📱', color: '#f97316', bg: 'rgba(249, 115, 22, 0.18)' },
    'Интернет': { icon: '🌐', color: '#f97316', bg: 'rgba(249, 115, 22, 0.18)' },
    'ЖКХ': { icon: '💡', color: '#f97316', bg: 'rgba(249, 115, 22, 0.18)' },
    'Товары для дома': { icon: '🛋️', color: '#eab308', bg: 'rgba(234, 179, 8, 0.18)' },
    'Одежда и обувь': { icon: '👕', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.18)' },
    'Одежда': { icon: '👕', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.18)' },
    'Развлечения': { icon: '🍿', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.18)' },
    'Зарплата': { icon: '💰', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.18)' },
    'Аванс': { icon: '💵', color: '#10b981', bg: 'rgba(16, 185, 129, 0.18)' },
    'Премия': { icon: '🎁', color: '#eab308', bg: 'rgba(234, 179, 8, 0.18)' },
    'Фриланс': { icon: '💻', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.18)' },
    'Другое': { icon: '🏷️', color: '#64748b', bg: 'rgba(100, 116, 139, 0.18)' }
  };

  function getCategoryTheme(catName) {
    if (TINKOFF_CATEGORY_THEMES[catName]) return TINKOFF_CATEGORY_THEMES[catName];
    const lower = (catName || '').toLowerCase();
    for (const k in TINKOFF_CATEGORY_THEMES) {
      if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) {
        return TINKOFF_CATEGORY_THEMES[k];
      }
    }
    return { icon: '🏷️', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.18)' };
  }

  function getRussianMonthName(date) {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return months[date.getMonth()];
  }

  function getRussianMonthPrepositional(date) {
    const prep = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
    return prep[date.getMonth()];
  }

  function formatOperationsCount(count) {
    const n = Math.abs(count) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return `${count} операций`;
    if (n1 > 1 && n1 < 5) return `${count} операции`;
    if (n1 === 1) return `${count} операция`;
    return `${count} операций`;
  }

  function openMonthPickerModal(currentOffset, onSelect) {
    const now = new Date();
    const currTargetDate = new Date(now.getFullYear(), now.getMonth() + currentOffset, 1);
    let selectedYear = currTargetDate.getFullYear();
    const selectedMonth = currTargetDate.getMonth();

    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const modal = document.getElementById('modal-container');

    function renderPicker() {
      modal.innerHTML = `
        <div class="modal-overlay open" id="month-picker-overlay">
          <div class="bottom-sheet">
            <div class="sheet-handle"></div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
              <h3 style="font-size:20px; font-weight:700;">Выберите месяц</h3>
              <button class="sheet-close-btn" id="btn-month-picker-close">✕</button>
            </div>

            <div class="segmented-control" id="year-selector">
              <div class="segment-item ${selectedYear === 2026 ? 'active' : ''}" data-year="2026">2026 год</div>
              <div class="segment-item ${selectedYear === 2027 ? 'active' : ''}" data-year="2027">2027 год</div>
            </div>

            <div class="month-picker-grid">
              ${months.map((m, idx) => {
                const isActive = (selectedYear === currTargetDate.getFullYear() && idx === selectedMonth);
                return `
                  <button type="button" class="month-picker-item ${isActive ? 'active' : ''}" data-month="${idx}">
                    ${m}
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;

      document.querySelectorAll('#year-selector .segment-item').forEach(seg => {
        seg.addEventListener('click', () => {
          selectedYear = parseInt(seg.getAttribute('data-year'), 10);
          renderPicker();
        });
      });

      document.querySelectorAll('.month-picker-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const mIdx = parseInt(btn.getAttribute('data-month'), 10);
          const newOffset = (selectedYear - now.getFullYear()) * 12 + (mIdx - now.getMonth());
          onSelect(newOffset);
        });
      });

      document.getElementById('btn-month-picker-close').addEventListener('click', () => {
        openAnalyticsModal(analyticsActiveType, currentOffset);
      });

      document.getElementById('month-picker-overlay').addEventListener('click', e => {
        if (e.target.id === 'month-picker-overlay') {
          openAnalyticsModal(analyticsActiveType, currentOffset);
        }
      });
    }

    renderPicker();
  }

  function openAnalyticsModal(type = null, offset = null) {
    if (type !== null) analyticsActiveType = type;
    if (offset !== null) analyticsMonthOffset = offset;

    const modal = document.getElementById('modal-container');
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() + analyticsMonthOffset, 1);
    const targetMonth = targetDate.getMonth();
    const targetYear = targetDate.getFullYear();
    const monthName = getRussianMonthName(targetDate);
    const monthPrep = getRussianMonthPrepositional(targetDate);

    // Filter transactions for target month and selected type
    const matchingTx = state.transactions.filter(t => {
      const d = t.date ? new Date(t.date) : new Date();
      return (t.type === analyticsActiveType) &&
             (d.getMonth() === targetMonth) &&
             (d.getFullYear() === targetYear);
    });

    const totalAmount = matchingTx.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // Group by category
    const catGroups = {};
    matchingTx.forEach(t => {
      const c = t.category || 'Другое';
      if (!catGroups[c]) {
        catGroups[c] = { name: c, amount: 0, count: 0, txs: [] };
      }
      catGroups[c].amount += Number(t.amount) || 0;
      catGroups[c].count += 1;
      catGroups[c].txs.push(t);
    });

    const sortedCats = Object.values(catGroups).sort((a, b) => b.amount - a.amount);

    // Build colorful donut conic gradient
    let gradientStops = [];
    let currentPct = 0;
    if (sortedCats.length > 0 && totalAmount > 0) {
      sortedCats.forEach(item => {
        const theme = getCategoryTheme(item.name);
        item.color = theme.color;
        item.icon = theme.icon;
        item.bg = theme.bg;
        const pct = (item.amount / totalAmount) * 100;
        const nextPct = currentPct + pct;
        gradientStops.push(`${theme.color} ${currentPct.toFixed(1)}% ${nextPct.toFixed(1)}%`);
        currentPct = nextPct;
      });
    }

    const donutBackground = gradientStops.length > 0
      ? `conic-gradient(${gradientStops.join(', ')})`
      : '#27272a';

    const isCurrentMonth = (targetMonth === now.getMonth() && targetYear === now.getFullYear());
    const subtitleText = analyticsActiveType === 'expense'
      ? (isCurrentMonth ? 'из 100 000 ₽ по плану' : `Всего трат за ${monthName.toLowerCase()} ${targetYear}`)
      : `Всего зачислений за ${monthName.toLowerCase()} ${targetYear}`;

    const defMonthStr = String(targetMonth + 1).padStart(2, '0');
    const defDayStr = isCurrentMonth ? String(now.getDate()).padStart(2, '0') : '15';
    const prefillDate = `${targetYear}-${defMonthStr}-${defDayStr}`;

    modal.innerHTML = `
      <div class="analytics-page-overlay" id="analytics-overlay">
        <div class="analytics-container">
          
          <!-- Top Navigation Bar -->
          <div class="analytics-top-nav">
            <button class="analytics-back-btn" id="btn-analytics-back" title="Назад">‹</button>
            <span class="analytics-nav-title">Анализ финансов</span>
            <button class="analytics-more-btn" id="btn-analytics-more" title="Опции">•••</button>
          </div>

          <!-- Switcher: Filters Icon & [Расходы | Зачисления] -->
          <div class="analytics-switcher-row">
            <button class="analytics-filter-icon-btn" id="btn-analytics-filter" title="Фильтры">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>
                <circle cx="4" cy="12" r="2"></circle><circle cx="12" cy="10" r="2"></circle><circle cx="20" cy="14" r="2"></circle>
              </svg>
            </button>
            <div class="analytics-pills-wrap">
              <button class="analytics-type-pill ${analyticsActiveType === 'expense' ? 'active' : ''}" id="pill-analytics-expense">Расходы</button>
              <button class="analytics-type-pill ${analyticsActiveType === 'income' ? 'active' : ''}" id="pill-analytics-income">Зачисления</button>
            </div>
          </div>

          <!-- Large Amount & Plan Subtitle -->
          <div class="analytics-hero-amount" id="btn-analytics-amount">
            <span>${formatMoney(totalAmount)}</span>
            <span class="analytics-hero-chevron">&gt;</span>
          </div>
          <div class="analytics-hero-subtitle">${subtitleText}</div>

          <!-- Donut Wheel with Month Switcher in Center -->
          <div class="donut-chart-box">
            <div class="donut-ring" style="background: ${donutBackground};">
              <div class="donut-hole">
                <div class="donut-month-nav">
                  <button class="donut-arrow" id="btn-month-prev" title="Предыдущий месяц">‹</button>
                  <div style="display:flex; flex-direction:column; align-items:center; cursor:pointer;" id="donut-month-click" title="Выбрать месяц и год">
                    <span class="donut-month-text">${monthName}</span>
                    <span class="donut-year-text" style="font-size:11px; color:#8e8e93; font-weight:600; margin-top:1px;">${targetYear}</span>
                  </div>
                  <button class="donut-arrow" id="btn-month-next" title="Следующий месяц">›</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Categories List -->
          <div class="analytics-cat-list">
            ${sortedCats.length > 0 ? `
              ${sortedCats.map(cat => {
                const theme = getCategoryTheme(cat.name);
                return `
                  <div class="analytics-cat-row" data-cat="${escapeHtml(cat.name)}" title="Нажмите, чтобы посмотреть операции">
                    <div class="analytics-cat-left">
                      <div class="analytics-cat-icon" style="background: ${theme.bg}; color: ${theme.color};">
                        ${theme.icon}
                      </div>
                      <div>
                        <div class="analytics-cat-name">${escapeHtml(cat.name)}</div>
                        <div class="analytics-cat-count">${formatOperationsCount(cat.count)}</div>
                      </div>
                    </div>
                    <div class="analytics-cat-amount">${formatMoney(cat.amount)}</div>
                  </div>
                  <div class="analytics-sub-tx-list" style="display:none;">
                    ${cat.txs.map(t => `
                      <div class="analytics-sub-tx-item" onclick="window.editTransaction('${t.id}')">
                        <div>
                          <div style="color:#fff; font-weight:500;">${escapeHtml(t.title)}</div>
                          <div style="color:var(--text-secondary); font-size:11px;">${formatTxDate(t.date)}</div>
                        </div>
                        <div style="font-weight:600; color:${t.type === 'expense' ? 'var(--text-primary)' : 'var(--success)'};">
                          ${t.type === 'expense' ? '- ' : '+ '}${formatMoney(t.amount)}
                        </div>
                      </div>
                    `).join('')}
                  </div>
                `;
              }).join('')}
              <div style="margin-top:20px; padding-bottom:16px;">
                <button class="btn-secondary" id="btn-analytics-add-more" style="width:100%; padding:12px; border-radius:14px; font-size:14px; font-weight:600; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,255,255,0.1); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                  <span>+</span> <span>Добавить операцию за ${monthName} ${targetYear}</span>
                </button>
              </div>
            ` : `
              <div style="text-align:center; padding:32px 16px; color:var(--text-muted); font-size:14px;">
                В ${monthPrep} ${targetYear} операций пока нет.<br>
                <span style="font-size:12px; color:var(--text-secondary); margin-top:6px; display:inline-block;">
                  Запишите операцию, и она сразу появится здесь!
                </span>
                <div style="margin-top:18px;">
                  <button class="btn-primary" id="btn-analytics-add-empty" style="padding:10px 22px; font-size:14px; border-radius:24px; display:inline-flex; align-items:center; gap:8px;">
                    <span>+</span> <span>Добавить за ${monthName.toLowerCase()} ${targetYear}</span>
                  </button>
                </div>
              </div>
            `}
          </div>

        </div>
      </div>
    `;

    // Event listeners
    document.getElementById('btn-analytics-back').addEventListener('click', closeModal);
    
    document.getElementById('pill-analytics-expense').addEventListener('click', () => {
      openAnalyticsModal('expense', analyticsMonthOffset);
    });

    document.getElementById('pill-analytics-income').addEventListener('click', () => {
      openAnalyticsModal('income', analyticsMonthOffset);
    });

    document.getElementById('btn-month-prev').addEventListener('click', () => {
      openAnalyticsModal(analyticsActiveType, analyticsMonthOffset - 1);
    });

    document.getElementById('btn-month-next').addEventListener('click', () => {
      openAnalyticsModal(analyticsActiveType, analyticsMonthOffset + 1);
    });

    const monthClicker = document.getElementById('donut-month-click');
    if (monthClicker) {
      monthClicker.addEventListener('click', () => {
        openMonthPickerModal(analyticsMonthOffset, (newOffset) => {
          openAnalyticsModal(analyticsActiveType, newOffset);
        });
      });
    }

    const btnEmptyAdd = document.getElementById('btn-analytics-add-empty');
    if (btnEmptyAdd) {
      btnEmptyAdd.addEventListener('click', () => {
        openAddTransactionModal('', prefillDate, true);
      });
    }

    const btnAddMore = document.getElementById('btn-analytics-add-more');
    if (btnAddMore) {
      btnAddMore.addEventListener('click', () => {
        openAddTransactionModal('', prefillDate, true);
      });
    }

    // Toggle sub-transaction lists
    document.querySelectorAll('.analytics-cat-row').forEach(row => {
      row.addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next && next.classList.contains('analytics-sub-tx-list')) {
          const isOpen = next.style.display !== 'none';
          next.style.display = isOpen ? 'none' : 'block';
        }
      });
    });

    const btnMore = document.getElementById('btn-analytics-more');
    if (btnMore) {
      btnMore.addEventListener('click', () => {
        alert(`Анализ финансов за ${monthName} ${targetYear}: статистика трат и зачислений.`);
      });
    }

    const btnFilter = document.getElementById('btn-analytics-filter');
    if (btnFilter) {
      btnFilter.addEventListener('click', () => {
        openMonthPickerModal(analyticsMonthOffset, (newOffset) => {
          openAnalyticsModal(analyticsActiveType, newOffset);
        });
      });
    }
  }

  // --- GITHUB GIST CLOUD SYNC & TWO-WAY MERGE ---
  const GIST_FILENAME = 'ecomvision_finances_data.json';

  function mergeArraysById(localArr = [], remoteArr = []) {
    const map = new Map();
    (remoteArr || []).forEach(item => {
      if (item && item.id) map.set(item.id, item);
    });
    (localArr || []).forEach(item => {
      if (item && item.id) {
        map.set(item.id, { ...(map.get(item.id) || {}), ...item });
      }
    });
    return Array.from(map.values());
  }

  async function getOrFindGistId(token) {
    try {
      const listRes = await fetch('https://api.github.com/gists?per_page=100', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      if (listRes.ok) {
        const gists = await listRes.json();
        const matchingGists = gists.filter(g => g.files && g.files[GIST_FILENAME]);
        if (matchingGists.length > 0) {
          if (matchingGists.length === 1) {
            state.settings.gistId = matchingGists[0].id;
            return matchingGists[0].id;
          }

          // If multiple gists exist, inspect each to find the one with actual financial data
          let bestGistId = matchingGists[0].id;
          let bestDataScore = -1;

          for (const mg of matchingGists) {
            try {
              const dRes = await fetch(`https://api.github.com/gists/${mg.id}`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Accept': 'application/vnd.github+json'
                }
              });
              if (dRes.ok) {
                const gData = await dRes.json();
                const fileObj = gData.files && gData.files[GIST_FILENAME];
                if (fileObj && fileObj.content) {
                  const parsed = JSON.parse(fileObj.content);
                  const accCount = (parsed.accounts && parsed.accounts.length) || 0;
                  const txCount = (parsed.transactions && parsed.transactions.length) || 0;
                  const payCount = (parsed.monthlyPayments && parsed.monthlyPayments.length) || 0;
                  const score = accCount * 100 + txCount * 10 + payCount;
                  if (score > bestDataScore) {
                    bestDataScore = score;
                    bestGistId = mg.id;
                  }
                }
              }
            } catch (err) {
              console.warn('Error reading gist detail:', err);
            }
          }

          state.settings.gistId = bestGistId;
          return bestGistId;
        }
      }
    } catch (e) {
      console.warn('Gist lookup error:', e);
    }
    return state.settings.gistId || '';
  }

  async function syncSmart(silent = false) {
    if (isSyncing || !state.settings || !state.settings.githubToken) return false;
    const token = state.settings.githubToken.trim();
    if (!token) return false;

    isSyncing = true;
    try {
      let gistId = await getOrFindGistId(token);
      let remoteData = null;

      if (gistId) {
        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json'
          }
        });
        if (res.ok) {
          const gist = await res.json();
          const file = gist.files && gist.files[GIST_FILENAME];
          if (file && file.content) {
            try {
              remoteData = JSON.parse(file.content);
            } catch (err) {
              console.warn('JSON parse error in Gist content:', err);
            }
          }
        } else if (res.status === 404) {
          gistId = '';
          state.settings.gistId = '';
        } else if (res.status === 403) {
          const errJson = await res.json().catch(() => ({}));
          if ((errJson.message || '').toLowerCase().includes('rate limit')) {
            throw new Error('Лимит запросов к GitHub API временно исчерпан. Пожалуйста, подождите несколько минут.');
          }
        }
      }

      const hasLocalData = (state.accounts && state.accounts.length > 0) ||
                           (state.transactions && state.transactions.length > 0) ||
                           (state.monthlyPayments && state.monthlyPayments.length > 0);

      const hasRemoteData = remoteData && (
        (remoteData.accounts && remoteData.accounts.length > 0) ||
        (remoteData.transactions && remoteData.transactions.length > 0) ||
        (remoteData.monthlyPayments && remoteData.monthlyPayments.length > 0)
      );

      // Case 1: Remote has data, but local is empty -> PULL from remote
      if (hasRemoteData && !hasLocalData) {
        state.accounts = remoteData.accounts || [];
        state.transactions = remoteData.transactions || [];
        state.plans = remoteData.plans || [];
        state.goals = remoteData.goals || [];
        state.monthlyPayments = remoteData.monthlyPayments || [];
        if (remoteData.settings && remoteData.settings.payday) {
          state.settings.payday = remoteData.settings.payday;
        }
      }
      // Case 2: Both local and remote have data -> MERGE intelligently
      else if (hasRemoteData && hasLocalData) {
        state.accounts = mergeArraysById(state.accounts, remoteData.accounts);
        state.transactions = mergeArraysById(state.transactions, remoteData.transactions);
        state.plans = mergeArraysById(state.plans, remoteData.plans);
        state.goals = mergeArraysById(state.goals, remoteData.goals);
        state.monthlyPayments = mergeArraysById(state.monthlyPayments, remoteData.monthlyPayments);
      }
      // Case 3: Local has data, remote is empty -> will be pushed below
      // Case 4: Neither has data -> initial empty state

      // Save merged/latest state to GitHub Gist
      const payloadData = {
        accounts: state.accounts,
        transactions: state.transactions,
        plans: state.plans,
        goals: state.goals,
        monthlyPayments: state.monthlyPayments,
        settings: {
          payday: state.settings.payday,
          currency: state.settings.currency,
          updatedAt: new Date().toISOString()
        }
      };

      let saveUrl = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists';
      let saveMethod = gistId ? 'PATCH' : 'POST';

      const saveRes = await fetch(saveUrl, {
        method: saveMethod,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: 'EcomVision Finances - Private Cloud Sync',
          public: false,
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(payloadData, null, 2)
            }
          }
        })
      });

      if (!saveRes.ok) {
        const errJson = await saveRes.json().catch(() => ({}));
        if (saveRes.status === 404) {
          throw new Error('У вашего токена GitHub не отмечена галочка «gist». В настройках токена на github.com/settings/tokens отметьте галочку «gist» и нажмите «Update token».');
        }
        if (saveRes.status === 403 && (errJson.message || '').toLowerCase().includes('rate limit')) {
          throw new Error('Лимит запросов к GitHub API временно исчерпан. Пожалуйста, подождите несколько минут.');
        }
        throw new Error(errJson.message || `HTTP ${saveRes.status}`);
      }

      const savedGist = await saveRes.json();
      state.settings.gistId = savedGist.id;
      state.settings.lastSyncTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveState(false);
      renderApp();

      if (!silent) {
        const count = state.accounts.length;
        const shortId = state.settings.gistId ? state.settings.gistId.slice(0, 8) : '—';
        alert(`✅ Синхронизация завершена!\nДоступно счетов: ${count}\n(Резервная копия: ${shortId})`);
      }
      return true;
    } catch (e) {
      console.error('Smart sync error:', e);
      if (!silent) {
        alert('❌ Ошибка синхронизации: ' + e.message);
      }
      return false;
    } finally {
      isSyncing = false;
    }
  }

  async function pushToGitHub(silent = false) {
    if (isSyncing || !state.settings || !state.settings.githubToken) return false;
    
    // Safety check: if local has no data, prefer smart sync so we never wipe cloud
    const hasLocalData = (state.accounts && state.accounts.length > 0) ||
                         (state.transactions && state.transactions.length > 0) ||
                         (state.monthlyPayments && state.monthlyPayments.length > 0);
    if (!hasLocalData) {
      return syncSmart(silent);
    }

    const token = state.settings.githubToken.trim();
    if (!token) return false;

    isSyncing = true;
    const payloadData = {
      accounts: state.accounts,
      transactions: state.transactions,
      plans: state.plans,
      goals: state.goals,
      monthlyPayments: state.monthlyPayments,
      settings: {
        payday: state.settings.payday,
        currency: state.settings.currency,
        updatedAt: new Date().toISOString()
      }
    };

    try {
      let gistId = await getOrFindGistId(token);
      let url = 'https://api.github.com/gists';
      let method = 'POST';

      if (gistId) {
        url = `https://api.github.com/gists/${gistId}`;
        method = 'PATCH';
      }

      let res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: 'EcomVision Finances - Private Cloud Sync',
          public: false,
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(payloadData, null, 2)
            }
          }
        })
      });

      // If PATCH failed with 404, reset gistId and create a new Gist with POST
      if (!res.ok && method === 'PATCH' && res.status === 404) {
        state.settings.gistId = '';
        url = 'https://api.github.com/gists';
        method = 'POST';
        res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            description: 'EcomVision Finances - Private Cloud Sync',
            public: false,
            files: {
              [GIST_FILENAME]: {
                content: JSON.stringify(payloadData, null, 2)
              }
            }
          })
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 404) {
          throw new Error('У вашего токена GitHub не отмечена галочка «gist». В настройках токена на github.com/settings/tokens отметьте галочку «gist» и нажмите «Update token».');
        }
        if (res.status === 403 && (errJson.message || '').toLowerCase().includes('rate limit')) {
          throw new Error('Лимит запросов к GitHub API временно исчерпан. Пожалуйста, подождите несколько минут.');
        }
        throw new Error(errJson.message || `HTTP ${res.status}`);
      }

      const gist = await res.json();
      state.settings.gistId = gist.id;
      state.settings.lastSyncTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveState(false); // DO NOT re-trigger sync!

      if (!silent) {
        alert('✅ Данные успешно сохранены в облако GitHub!');
      }
      renderApp();
      return true;
    } catch (e) {
      console.error('Push to GitHub error:', e);
      if (!silent) {
        alert('❌ Ошибка синхронизации с GitHub: ' + e.message);
      }
      return false;
    } finally {
      isSyncing = false;
    }
  }

  async function pullFromGitHub(silent = false) {
    if (isSyncing || !state.settings || !state.settings.githubToken) return false;
    const token = state.settings.githubToken.trim();
    if (!token) return false;

    isSyncing = true;
    try {
      let gistId = await getOrFindGistId(token);

      if (!gistId) {
        if (!silent) alert('В облаке пока нет сохраненных данных. Нажмите «Отправить в облако» на первом устройстве.');
        return false;
      }

      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('У вашего токена GitHub не отмечена галочка «gist». В настройках токена на github.com/settings/tokens отметьте галочку «gist» и нажмите «Update token».');
        }
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 403 && (errJson.message || '').toLowerCase().includes('rate limit')) {
          throw new Error('Лимит запросов к GitHub API временно исчерпан. Пожалуйста, подождите несколько минут.');
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const gist = await res.json();
      const file = gist.files && gist.files[GIST_FILENAME];
      if (!file || !file.content) throw new Error('Файл данных не найден в Gist');

      const remoteData = JSON.parse(file.content);
      if (remoteData.accounts) state.accounts = remoteData.accounts;
      if (remoteData.transactions) state.transactions = remoteData.transactions;
      if (remoteData.plans) state.plans = remoteData.plans;
      if (remoteData.goals) state.goals = remoteData.goals;
      if (remoteData.monthlyPayments) state.monthlyPayments = remoteData.monthlyPayments;
      if (remoteData.settings && remoteData.settings.payday) {
        state.settings.payday = remoteData.settings.payday;
      }

      state.settings.lastSyncTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      saveState(false); // DO NOT re-trigger sync!

      if (!silent) {
        alert('✅ Данные успешно загружены из облака GitHub!');
      }
      renderApp();
      return true;
    } catch (e) {
      console.error('Pull from GitHub error:', e);
      if (!silent) {
        alert('❌ Ошибка загрузки из GitHub: ' + e.message);
      }
      return false;
    } finally {
      isSyncing = false;
    }
  }

  // 8. Settings & Profile Modal
  function openSettingsModal() {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay open" id="settings-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:20px; font-weight:700;">Настройки и профиль</h3>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <!-- Cloud Sync Card -->
          <div class="card" style="border: 1px solid rgba(0, 122, 255, 0.35); background: linear-gradient(145deg, #181824 0%, #111116 100%);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:22px;">☁️</span>
                <span style="font-weight:700; font-size:16px;">Синхронизация с iPhone</span>
              </div>
              <span style="font-size:12px; font-weight:600; color:${state.settings.githubToken ? '#30d158' : 'var(--text-muted)'};">
                ${state.settings.githubToken ? '● Подключено' : '○ Не настроено'}
              </span>
            </div>
            
            <p style="font-size:13px; color:var(--text-secondary); line-height:1.45; margin-top:4px;">
              Автоматически сохраняет все ваши счета, траты и платежи в защищенный секретный бэкап на вашем личном GitHub. Чтобы синхронизировать iPhone, просто вставьте этот же токен в настройки на телефоне!
            </p>

            <div class="form-group" style="margin-top:6px;">
              <label class="form-label">Ваш GitHub Token (ghp_...)</label>
              <div style="display:flex; gap:6px;">
                <input type="password" id="input-gh-token" class="form-input" style="flex:1; font-family:monospace; font-size:13px;" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" value="${state.settings.githubToken || ''}" />
                <button class="btn-primary" id="btn-save-gh-token" style="padding:8px 14px; font-size:13px; margin:0; width:auto;">Сохранить</button>
              </div>
            </div>

            <!-- Short instruction inside modal -->
            <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px; margin-top: 8px; font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
              <div style="font-weight: 700; color: #fff; margin-bottom: 6px; display:flex; align-items:center; gap:6px;">
                📖 Краткая инструкция по настройке:
              </div>
              <ol style="padding-left: 18px; margin: 0; display:flex; flex-direction:column; gap:4px;">
                <li>Откройте страницу создания токена: <a href="https://github.com/settings/tokens/new" target="_blank" style="color:var(--accent-blue); text-decoration:none;">github.com/settings/tokens/new</a></li>
                <li>В поле <b>Note</b> напишите <code>finances</code>, отметьте галочки ☑️ <b>repo</b> и обязательно ☑️ <b>gist</b>, затем нажмите <b>Generate token</b>.</li>
                <li>Скопируйте ключ <code>ghp_...</code>, вставьте в поле выше и нажмите <b>«Сохранить»</b>.</li>
                <li>На <b>iPhone</b> откройте этот сайт, зайдите в Настройки и вставьте тот же ключ — данные сразу начнут синхронизироваться!</li>
              </ol>
            </div>

            ${state.settings.githubToken ? `
              <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px; padding-top:8px; border-top:1px solid var(--border-color);">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--text-secondary);">
                  <span>Последняя синхронизация:</span>
                  <span style="font-weight:600; color:#fff;">${state.settings.lastSyncTime || 'Только что'}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-muted);">
                  <span>Облачный бэкап:</span>
                  <span style="font-family:monospace; color:var(--accent-blue);">${state.settings.gistId ? state.settings.gistId.slice(0, 8) + '...' : 'Авто-поиск'}</span>
                </div>
                <div style="display:flex; gap:8px;">
                  <button class="btn-primary" style="flex:1; padding:9px 12px; font-size:13px; width:auto;" id="btn-sync-push">Отправить в облако</button>
                  <button class="btn-pill-dark" style="flex:1; margin-top:0; padding:9px 12px; font-size:13px;" id="btn-sync-pull">Загрузить на iPhone</button>
                </div>
                <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-secondary); cursor:pointer; margin-top:4px;">
                  <input type="checkbox" id="chk-auto-sync" ${state.settings.autoSync ? 'checked' : ''} />
                  Авто-синхронизация при любых изменениях
                </label>
              </div>
            ` : ''}
          </div>

          <div class="card">
            <span style="font-weight:700; font-size:16px;">Локальное хранилище данных</span>
            <p style="font-size:13px; color:var(--text-secondary);">
              Все данные сохраняются локально в вашем браузере. Вы можете экспортировать резервную копию или импортировать её на другое устройство.
            </p>
            <div style="display:flex; gap:10px; margin-top:8px;">
              <button class="btn-pill-dark" id="btn-export-json">Экспорт JSON</button>
              <button class="btn-pill-dark" id="btn-import-json">Импорт JSON</button>
              <input type="file" id="file-input-json" accept=".json" style="display:none;" />
            </div>
          </div>

          <div class="card">
            <span style="font-weight:700; font-size:16px;">День зарплаты</span>
            <p style="font-size:13px; color:var(--text-secondary);">Число месяца для автоматического расчёта «до зарплаты»</p>
            <input type="number" id="setting-payday" class="form-input" min="1" max="31" value="${state.settings.payday || 25}" style="margin-top:6px;" />
          </div>

          <div class="card">
            <span style="font-weight:700; font-size:16px;">Демо-данные</span>
            <p style="font-size:13px; color:var(--text-secondary);">Заполнить приложение готовыми счетами, операциями и планами для проверки всех возможностей.</p>
            <div style="display:flex; gap:10px; margin-top:8px;">
              <button class="btn-primary" id="btn-load-demo-full">Загрузить демо</button>
              <button class="btn-pill-dark" style="color:var(--accent-red);" id="btn-reset-data">Очистить всё</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('settings-overlay').addEventListener('click', e => { if (e.target.id === 'settings-overlay') closeModal(); });

    // Cloud sync event listeners
    const btnSaveGhToken = document.getElementById('btn-save-gh-token');
    if (btnSaveGhToken) {
      btnSaveGhToken.addEventListener('click', () => {
        const val = document.getElementById('input-gh-token').value.trim();
        state.settings.githubToken = val;
        saveState();
        if (val) {
          syncSmart();
        } else {
          renderApp();
        }
      });
    }

    const btnSyncPush = document.getElementById('btn-sync-push');
    if (btnSyncPush) {
      btnSyncPush.addEventListener('click', () => pushToGitHub());
    }

    const btnSyncPull = document.getElementById('btn-sync-pull');
    if (btnSyncPull) {
      btnSyncPull.addEventListener('click', () => pullFromGitHub());
    }

    const chkAutoSync = document.getElementById('chk-auto-sync');
    if (chkAutoSync) {
      chkAutoSync.addEventListener('change', (e) => {
        state.settings.autoSync = e.target.checked;
        saveState();
      });
    }

    document.getElementById('setting-payday').addEventListener('change', (e) => {
      state.settings.payday = parseInt(e.target.value) || 25;
      saveState();
    });

    document.getElementById('btn-export-json').addEventListener('click', () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `ecomvision_finances_backup_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });

    const fileInput = document.getElementById('file-input-json');
    document.getElementById('btn-import-json').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (imported.accounts && Array.isArray(imported.accounts)) {
            state = imported;
            saveState();
            closeModal();
            renderApp();
            alert('Данные успешно импортированы!');
          }
        } catch (err) {
          alert('Ошибка чтения файла JSON');
        }
      };
      reader.readAsText(file);
    });

    document.getElementById('btn-load-demo-full').addEventListener('click', () => {
      loadFullDemoData();
      closeModal();
      renderApp();
    });

    document.getElementById('btn-reset-data').addEventListener('click', () => {
      if (confirm('Вы уверены, что хотите сбросить все данные?')) {
        state = JSON.parse(JSON.stringify(DEFAULT_STATE));
        saveState();
        closeModal();
        renderApp();
      }
    });
  }

  // 9. Monthly Recurring Payments Modals (Связь, Интернет, Подписки, ЖКХ)
  const MONTHLY_PRESETS = {
    phone: { title: 'Мобильная связь', amount: 650, dayOfMonth: 15, category: 'Связь', icon: '📱' },
    internet: { title: 'Домашний интернет', amount: 800, dayOfMonth: 1, category: 'Интернет', icon: '🌐' },
    plus: { title: 'Яндекс Плюс', amount: 399, dayOfMonth: 20, category: 'Подписки', icon: '🎬' },
    utilities: { title: 'ЖКХ и коммуналка', amount: 4800, dayOfMonth: 10, category: 'ЖКХ', icon: '💡' },
    rent: { title: 'Аренда квартиры', amount: 45000, dayOfMonth: 1, category: 'Жилье', icon: '🏠' },
    gym: { title: 'Фитнес и спортзал', amount: 3500, dayOfMonth: 5, category: 'Спорт', icon: '🏋️' }
  };

  function openMonthlyPaymentsModal() {
    const modal = document.getElementById('modal-container');
    const totalMonthly = state.monthlyPayments.reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const paidCount = state.monthlyPayments.filter(m => m.paidThisMonth).length;
    const unpaidSum = state.monthlyPayments.filter(m => !m.paidThisMonth).reduce((s, m) => s + (Number(m.amount) || 0), 0);

    modal.innerHTML = `
      <div class="modal-overlay open" id="monthly-overlay">
        <div class="bottom-sheet" style="max-height: 90vh;">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:24px;">📱</span>
              <div>
                <h3 style="font-size:20px; font-weight:700;">Ежемесячные платежи</h3>
                <span style="font-size:12px; color:var(--text-secondary);">Связь, интернет, коммуналка, подписки</span>
              </div>
            </div>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <!-- Total metrics card -->
          <div class="card" style="background: linear-gradient(145deg, #18181e 0%, #111114 100%);">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:13px; color:var(--text-secondary);">Всего постоянных трат в месяц</span>
              <span style="font-size:12px; color:var(--accent-blue);">Оплачено ${paidCount} из ${state.monthlyPayments.length}</span>
            </div>
            <div style="font-size:32px; font-weight:800; color:#fff; margin:4px 0;">
              ${formatMoney(totalMonthly)}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; padding-top:8px; border-top:1px solid var(--border-color); font-size:13px;">
              <span style="color:var(--text-secondary);">Осталось оплатить в этом месяце:</span>
              <span style="font-weight:700; color:${unpaidSum > 0 ? 'var(--accent-orange)' : 'var(--accent-green)'};">${formatMoney(unpaidSum)}</span>
            </div>
          </div>

          <!-- Quick Templates -->
          <div>
            <span style="font-size:12px; color:var(--text-secondary); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Быстрый выбор шаблона:</span>
            <div class="quick-templates-scroll" style="margin-top:6px;">
              <div class="template-chip" data-tpl="phone">📱 Связь</div>
              <div class="template-chip" data-tpl="internet">🌐 Интернет</div>
              <div class="template-chip" data-tpl="plus">🎬 Яндекс Плюс</div>
              <div class="template-chip" data-tpl="utilities">💡 ЖКХ</div>
              <div class="template-chip" data-tpl="rent">🏠 Аренда</div>
              <div class="template-chip" data-tpl="gym">🏋️ Спортзал</div>
            </div>
          </div>

          <!-- List of payments -->
          <div class="section-header" style="margin-top:4px;">
            <h4 style="font-size:16px; font-weight:700;">Ваши платежи (${state.monthlyPayments.length})</h4>
            <span class="section-action" id="btn-open-add-monthly">+ Добавить</span>
          </div>

          <div class="monthly-list">
            ${state.monthlyPayments.length === 0 ? `
              <div style="text-align:center; padding:24px 14px; color:var(--text-muted); font-size:14px; background:#18181c; border-radius:14px; border:1px dashed var(--border-color);">
                У вас пока нет ежемесячных платежей.<br>
                Нажмите на один из шаблонов вверху или на кнопку «+ Добавить».
              </div>
            ` : state.monthlyPayments.map(m => `
              <div class="monthly-item ${m.paidThisMonth ? 'is-paid' : ''}" data-id="${m.id}">
                <div class="monthly-item-left">
                  <div class="monthly-item-icon">${m.icon || '📱'}</div>
                  <div class="monthly-item-info">
                    <span class="monthly-item-name">${escapeHtml(m.title)}</span>
                    <span class="monthly-item-meta">${m.dayOfMonth ? `${m.dayOfMonth}-е число каждого месяца` : 'Ежемесячно'} • ${escapeHtml(m.category || 'Связь')}</span>
                  </div>
                </div>
                <div class="monthly-item-right">
                  <span class="monthly-item-amount">${formatMoney(m.amount)}</span>
                  <button class="btn-pay-status ${m.paidThisMonth ? 'paid' : ''}" onclick="window.toggleMonthlyPaid('${m.id}')">
                    ${m.paidThisMonth ? '✓ Оплачено' : 'Оплатить'}
                  </button>
                  <button style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:16px; padding:4px;" onclick="window.deleteMonthlyPayment('${m.id}')" title="Удалить">
                    🗑️
                  </button>
                </div>
              </div>
            `).join('')}
          </div>

          <button class="btn-primary" style="width:100%; margin-top:8px;" id="btn-modal-add-monthly-full">
            + Новый ежемесячный платёж
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('monthly-overlay').addEventListener('click', e => { if (e.target.id === 'monthly-overlay') closeModal(); });

    // Quick templates
    document.querySelectorAll('.template-chip[data-tpl]').forEach(chip => {
      chip.addEventListener('click', () => {
        const tpl = chip.getAttribute('data-tpl');
        openAddMonthlyPaymentModal(tpl);
      });
    });

    const btnOpenAdd = document.getElementById('btn-open-add-monthly');
    if (btnOpenAdd) btnOpenAdd.addEventListener('click', () => openAddMonthlyPaymentModal());

    const btnModalAddFull = document.getElementById('btn-modal-add-monthly-full');
    if (btnModalAddFull) btnModalAddFull.addEventListener('click', () => openAddMonthlyPaymentModal());
  }

  function openAddMonthlyPaymentModal(presetKey = null) {
    const preset = presetKey && MONTHLY_PRESETS[presetKey] ? MONTHLY_PRESETS[presetKey] : null;
    const modal = document.getElementById('modal-container');

    modal.innerHTML = `
      <div class="modal-overlay open" id="add-monthly-overlay">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="font-size:20px; font-weight:700;">Новый ежемесячный платёж</h3>
            <button class="sheet-close-btn" id="btn-modal-close">✕</button>
          </div>

          <div class="form-group">
            <label class="form-label">Название (связь, интернет, подписка...)</label>
            <input type="text" id="monthly-title" class="form-input" placeholder="Например: Мобильная связь МТС, Домашний интернет..." value="${preset ? escapeHtml(preset.title) : ''}" autofocus />
          </div>

          <div class="form-group">
            <label class="form-label">Сумма в месяц (₽)</label>
            <input type="number" id="monthly-amount" class="form-input" placeholder="650" value="${preset ? preset.amount : ''}" />
          </div>

          <div class="form-group">
            <label class="form-label">День списания (число месяца: 1-31)</label>
            <input type="number" id="monthly-day" class="form-input" min="1" max="31" placeholder="15" value="${preset ? preset.dayOfMonth : '15'}" />
          </div>

          <div class="form-group">
            <label class="form-label">Категория и иконка</label>
            <div class="quick-category-pills" id="monthly-cat-pills">
              ${[
                { name: 'Связь', icon: '📱' },
                { name: 'Интернет', icon: '🌐' },
                { name: 'Подписки', icon: '🎬' },
                { name: 'ЖКХ', icon: '💡' },
                { name: 'Жилье', icon: '🏠' },
                { name: 'Спорт', icon: '🏋️' },
                { name: 'Кредит', icon: '💳' },
                { name: 'Другое', icon: '🏷️' }
              ].map(c => `
                <div class="cat-pill ${(preset && preset.category === c.name) || (!preset && c.name === 'Связь') ? 'active' : ''}" data-cat="${c.name}" data-icon="${c.icon}">${c.icon} ${c.name}</div>
              `).join('')}
            </div>
          </div>

          <button class="btn-primary" style="width:100%; margin-top:10px;" id="btn-save-monthly">Сохранить платёж</button>
        </div>
      </div>
    `;

    let selectedCategory = preset ? preset.category : 'Связь';
    let selectedIcon = preset ? preset.icon : '📱';

    document.querySelectorAll('#monthly-cat-pills .cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#monthly-cat-pills .cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        selectedCategory = pill.getAttribute('data-cat');
        selectedIcon = pill.getAttribute('data-icon');
      });
    });

    document.getElementById('btn-modal-close').addEventListener('click', openMonthlyPaymentsModal);
    document.getElementById('add-monthly-overlay').addEventListener('click', e => { if (e.target.id === 'add-monthly-overlay') openMonthlyPaymentsModal(); });

    document.getElementById('btn-save-monthly').addEventListener('click', () => {
      const title = document.getElementById('monthly-title').value.trim();
      const amount = parseFloat(document.getElementById('monthly-amount').value);
      const dayOfMonth = parseInt(document.getElementById('monthly-day').value) || 15;

      if (!title || !amount || amount <= 0) {
        alert('Пожалуйста, укажите название и сумму платежа');
        return;
      }

      state.monthlyPayments.push({
        id: 'monthly_' + Date.now(),
        title,
        amount,
        dayOfMonth,
        category: selectedCategory,
        icon: selectedIcon,
        paidThisMonth: false
      });

      saveState();
      openMonthlyPaymentsModal();
      renderApp();
    });
  }

  function closeModal() {
    const modal = document.getElementById('modal-container');
    if (modal) modal.innerHTML = '';
  }

  // --- DEMO DATA LOADER ---
  function loadFullDemoData() {
    state.accounts = [
      { id: 'acc_1', name: 'Тинькофф Black', type: 'Карта', balance: 64250, icon: '💳', color: '#ffdd2d' },
      { id: 'acc_2', name: 'Сбербанк Премьер', type: 'Карта', balance: 35000, icon: '💳', color: '#21a038' },
      { id: 'acc_3', name: 'Наличные', type: 'Наличные', balance: 7500, icon: '💵', color: '#30d158' }
    ];

    state.transactions = [
      { id: 'tx_1', title: 'Кофе и круассан', amount: 350, type: 'expense', category: 'Кофе и кафе', icon: '☕', accountId: 'acc_1', date: new Date().toISOString() },
      { id: 'tx_2', title: 'Продукты во ВкусВилл', amount: 1420, type: 'expense', category: 'Супермаркеты', icon: '🛒', accountId: 'acc_1', date: new Date().toISOString() },
      { id: 'tx_3', title: 'Яндекс Такси (Комфорт)', amount: 560, type: 'expense', category: 'Такси', icon: '🚕', accountId: 'acc_1', date: new Date().toISOString() },
      { id: 'tx_4', title: 'Аптека «Планета Здоровья»', amount: 890, type: 'expense', category: 'Аптека', icon: '💊', accountId: 'acc_2', date: new Date().toISOString() }
    ];

    state.monthlyPayments = [
      { id: 'm_1', title: 'Мобильная связь (МТС)', amount: 650, dayOfMonth: 15, category: 'Связь', icon: '📱', paidThisMonth: true },
      { id: 'm_2', title: 'Домашний интернет', amount: 800, dayOfMonth: 1, category: 'Интернет', icon: '🌐', paidThisMonth: true },
      { id: 'm_3', title: 'Яндекс Плюс Мульти', amount: 399, dayOfMonth: 20, category: 'Подписки', icon: '🎬', paidThisMonth: false },
      { id: 'm_4', title: 'ЖКХ и коммуналка', amount: 4800, dayOfMonth: 10, category: 'ЖКХ', icon: '💡', paidThisMonth: false }
    ];

    state.plans = [
      { id: 'plan_1', title: 'Аренда квартиры', amount: 45000, type: 'expense', dueDate: '1-е число каждого месяца', icon: '🏠' },
      { id: 'plan_2', title: 'Фитнес-клуб World Class', amount: 4500, type: 'expense', dueDate: '20-е число', icon: '💪' },
      { id: 'plan_3', title: 'Зарплата', amount: 160000, type: 'income', dueDate: '25-е число', icon: '💰' }
    ];

    state.goals = [
      { id: 'goal_1', title: 'Поездка на Бали', targetAmount: 250000, currentAmount: 145000, targetDate: 'Октябрь 2027', icon: '🌴' },
      { id: 'goal_2', title: 'MacBook Pro 16 M4', targetAmount: 280000, currentAmount: 210000, targetDate: 'Июнь 2027', icon: '💻' }
    ];

    state.settings.demoLoaded = true;
    saveState();
  }

  // --- GLOBAL EVENT BINDING ---
  function attachGlobalEvents() {
    // Navigation items
    document.querySelectorAll('.dock-item').forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.getAttribute('data-tab');
        window.switchTab(tab);
      });
    });

    // Search button in dock
    const searchBtn = document.getElementById('btn-dock-search');
    if (searchBtn) {
      searchBtn.addEventListener('click', openSearchSheet);
    }

    // Header buttons
    const btnPrivacy = document.getElementById('btn-privacy');
    if (btnPrivacy) {
      btnPrivacy.addEventListener('click', () => {
        state.settings.privacyMode = !state.settings.privacyMode;
        saveState();
        renderApp();
      });
    }

    const btnSync = document.getElementById('btn-sync');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        if (!state.settings.githubToken) {
          openSettingsModal();
        } else {
          syncSmart();
        }
      });
    }

    const btnAssistant = document.getElementById('btn-assistant');
    if (btnAssistant) btnAssistant.addEventListener('click', openAssistantModal);

    const btnProfile = document.getElementById('btn-profile');
    if (btnProfile) btnProfile.addEventListener('click', openSettingsModal);

    const btnQuickAdd = document.getElementById('btn-quick-add');
    if (btnQuickAdd) btnQuickAdd.addEventListener('click', () => openAddTransactionModal());

    const cardOpenAnalytics = document.getElementById('card-open-analytics');
    if (cardOpenAnalytics) cardOpenAnalytics.addEventListener('click', () => openAnalyticsModal());

    // Onboarding buttons
    const btnAddAcc = document.getElementById('btn-add-account-card');
    if (btnAddAcc) btnAddAcc.addEventListener('click', () => openAddAccountModal());

    const btnDemo = document.getElementById('btn-demo-data');
    if (btnDemo) {
      btnDemo.addEventListener('click', () => {
        loadFullDemoData();
        renderApp();
      });
    }

    // Section actions in Today tab
    const btnAddAccSec = document.getElementById('btn-add-account-section');
    if (btnAddAccSec) btnAddAccSec.addEventListener('click', () => openAddAccountModal());

    // Smart entry in Today tab
    const smartInput = document.getElementById('smart-input');
    const smartSubmit = document.getElementById('btn-smart-submit');
    if (smartInput && smartSubmit) {
      const handleSmart = () => {
        const val = smartInput.value;
        if (!val.trim()) return;
        openAddTransactionModal(val);
      };
      smartSubmit.addEventListener('click', handleSmart);
      smartInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSmart(); });
    }

    // Smart entry in Operations tab
    const smartInputOps = document.getElementById('smart-input-ops');
    const smartSubmitOps = document.getElementById('btn-smart-submit-ops');
    if (smartInputOps && smartSubmitOps) {
      const handleSmartOps = () => {
        const val = smartInputOps.value;
        if (!val.trim()) return;
        openAddTransactionModal(val);
      };
      smartSubmitOps.addEventListener('click', handleSmartOps);
      smartInputOps.addEventListener('keydown', e => { if (e.key === 'Enter') handleSmartOps(); });
    }

    const btnOpsAddAcc = document.getElementById('btn-ops-add-account');
    if (btnOpsAddAcc) btnOpsAddAcc.addEventListener('click', () => openAddAccountModal());

    const btnOpsRecordTx = document.getElementById('btn-ops-record-tx');
    if (btnOpsRecordTx) btnOpsRecordTx.addEventListener('click', () => openAddTransactionModal());

    // Plan tab buttons
    const btnAddPlanExp = document.getElementById('btn-add-plan-expense');
    if (btnAddPlanExp) btnAddPlanExp.addEventListener('click', () => openAddPlanModal('expense'));

    const btnAddPlanInc = document.getElementById('btn-add-plan-income');
    if (btnAddPlanInc) btnAddPlanInc.addEventListener('click', () => openAddPlanModal('income'));

    const btnReserveInfo = document.getElementById('btn-reserve-info');
    if (btnReserveInfo) {
      btnReserveInfo.addEventListener('click', () => {
        alert('Защищённый резерв — это неприкосновенная сумма (подушка безопасности), которая исключается из расчёта ежедневного лимита трат.');
      });
    }

    // Goals tab buttons
    const btnCreateGoal = document.getElementById('btn-create-goal');
    if (btnCreateGoal) btnCreateGoal.addEventListener('click', openCreateGoalModal);

    document.querySelectorAll('.segmented-control .segment-item[data-filter]').forEach(seg => {
      seg.addEventListener('click', () => {
        state.goalFilter = seg.getAttribute('data-filter');
        renderApp();
      });
    });

    // Monthly payments card listener
    const cardMonthlyWidget = document.getElementById('card-monthly-widget');
    if (cardMonthlyWidget) {
      cardMonthlyWidget.addEventListener('click', (e) => {
        if (!e.target.closest('button') && !e.target.closest('.template-chip')) {
          openMonthlyPaymentsModal();
        }
      });
    }

    // Footer links
    const linkPrivacy = document.getElementById('link-privacy');
    if (linkPrivacy) linkPrivacy.addEventListener('click', (e) => { e.preventDefault(); alert('Конфиденциальность: все ваши финансовые записи хранятся исключительно в LocalStorage вашего браузера и никогда не передаются на сторонние серверы.'); });

    const linkSupport = document.getElementById('link-support');
    if (linkSupport) linkSupport.addEventListener('click', (e) => { e.preventDefault(); alert('Служба поддержки: пишите на support@ecomvision.team или воспользуйтесь встроенным AI-помощником.'); });

    const linkAbout = document.getElementById('link-about');
    if (linkAbout) linkAbout.addEventListener('click', (e) => { e.preventDefault(); alert('EcomVision Финансы — локальное веб-приложение для умного управления личными деньгами со свободным бюджетом до зарплаты.'); });
  }

  // --- UTILS ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // --- WINDOW EXPORTS FOR INLINE ONCLICK HANDLERS ---
  window.switchTab = function (tab) {
    state.activeTab = tab;
    renderApp();
  };

  window.editAccount = function (id) {
    openAddAccountModal(id);
  };

  window.openMonthlyPayments = function () {
    openMonthlyPaymentsModal();
  };

  window.openAddMonthly = function (preset = null) {
    openAddMonthlyPaymentModal(preset);
  };

  window.toggleMonthlyPaid = function (id) {
    const item = state.monthlyPayments.find(m => m.id === id);
    if (!item) return;
    item.paidThisMonth = !item.paidThisMonth;
    saveState();
    // Re-render modal if open
    const overlay = document.getElementById('monthly-overlay');
    if (overlay) {
      openMonthlyPaymentsModal();
    }
    renderApp();
  };

  window.deleteMonthlyPayment = function (id) {
    const item = state.monthlyPayments.find(m => m.id === id);
    if (!item) return;
    if (confirm(`Удалить платёж "${item.title}"?`)) {
      state.monthlyPayments = state.monthlyPayments.filter(m => m.id !== id);
      saveState();
      // Re-render modal if open
      const overlay = document.getElementById('monthly-overlay');
      if (overlay) {
        openMonthlyPaymentsModal();
      }
      renderApp();
    }
  };

  window.topUpGoal = function (id) {
    const goal = state.goals.find(g => g.id === id);
    if (!goal) return;
    const amountStr = prompt(`Внести сумму в цель "${goal.title}" (₽):`, '5000');
    if (amountStr) {
      const amt = parseFloat(amountStr);
      if (amt && amt > 0) {
        goal.currentAmount = (goal.currentAmount || 0) + amt;
        saveState();
        renderApp();
      }
    }
  };

  window.editTransaction = openEditTransactionModal;
  window.openAnalytics = openAnalyticsModal;

  // Initial load with quiet cloud sync check
  document.addEventListener('DOMContentLoaded', () => {
    renderApp();
    if (state.settings && state.settings.githubToken && state.settings.autoSync) {
      syncSmart(true);
    }
  });
})();
