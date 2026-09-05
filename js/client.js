(function () {
  'use strict';
  window.addEventListener('error', e => console.error('PAGEERR:', e.message, '@' + (e.lineno || '?')));
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  let G = null;            // gamedata
  let S = null;            // 对局快照
  let ws = null;
  let OFFLINE = false;
  let local = null;
  let view = 'home';
  let mode = 'pve';
  let team = [];           // 已选角色 id，按顺序
  let deck = {};           // { cardId: count }
  let deckFilter = 'all';
  let codexTab = 'char';
  let deckFilter2 = 'all';
  let pendingAction = null;
  let mulliganDone = false;
  let loading = false;
  let openChar = null;
  let openCard = null;
  let openInfo = null;

  const TYPE_NAME = { weapon: '武器', artifact: '饰品', talent: '天赋', resonance: '共鸣', scene: '场景', support: '支援', food: '料理' };
  const TYPE_ORDER = ['weapon', 'artifact', 'talent', 'resonance', 'scene', 'support', 'food'];
  const MAX_DECK = 30, MAX_COPY = 2, TEAM_SIZE = 3;

  const REACTIONS = [
    { key: '中和反应', combo: '文 + 理', text: '该次伤害 +2；使打出该反应的角色充能 +1（每回合仅限 1 次）' },
    { key: '应激反应', combo: '理 + 理', text: '使该名角色本回合无法行动；下次攻击该角色伤害 +2 并移除该效果与所附着的元素' },
    { key: '失忆反应', combo: '文 + 文', text: '施加流血：每回合结束 -2 血，持续 2 回合，不叠加可刷新（护盾可抵挡）' }
  ];
  const SUMMON_DATA = [
    { key: 'zuowen', name: '作文', icon: 'icon_zuowen.png', el: '文', dmg: 1, dur: 2, text: '回合结束时造成 1 点文元素伤害（持续 2 回合）' },
    { key: 'jiexijihe', name: '解析几何', icon: 'icon_jiexijihe.png', el: '理', dmg: 1, dur: 2, text: '回合结束时造成 1 点理元素伤害（持续 2 回合）' },
    { key: 'qixing', name: '奇行种', icon: 'icon_qixing.png', el: '理', dmg: 1, dur: 2, text: '回合结束时造成 1 点理元素伤害（持续 2 回合，可存在多个）' },
    { key: 'minglang', name: '明朗之气', icon: 'icon_minglang.png', el: '理', dmg: 2, uses: 3, text: '我方角色攻击时协同攻击，造成 2 点理元素伤害（可用 3 次）' },
    { key: 'leibao', name: '雷暴之法', icon: 'icon_leibao.png', el: '文', dmg: 3, dur: 2, text: '己方角色造成伤害时协同攻击，造成 3 点文元素伤害（持续 2 回合）' },
    { key: 'zhaohuan', name: '召唤师召唤物', icon: 'icon_zhaohuan_wen.png', el: '文', dmg: 2, dur: 2, text: '回合结束时造成 2 点对应元素伤害（持续 2 回合）' }
  ];
  const CARD_DMG = {
    t_yuwen: { dmg: 2, el: '文', note: '造成 2 点文元素伤害并生成强化作文' },
    t_wuli: { dmg: 1, el: '文', note: '触发元素反应时伤害 +1 并附加 1 点穿透' }
  };

  // ---------- 工具 ----------
  function cardMeta(id) { return G && G.cards.find(c => c.id === id); }
  function charMeta(id) { return G && G.chars[id]; }
  function cardImg(id) { return 'assets/cards/card_' + id + '.png'; }
  function charImg(id) { return 'assets/characters/char_' + id + '.png'; }
  function elIcon(el) { return 'assets/icons/icon_' + (el === '文' ? 'wen' : 'li') + '.png'; }
  function deckTotal() { return Object.values(deck).reduce((a, b) => a + b, 0); }
  function deckArray() {
    const arr = [];
    G.cards.forEach(c => { for (let i = 0; i < (deck[c.id] || 0); i++) arr.push(c.id); });
    return arr;
  }

  function send(obj) {
    if (OFFLINE) { if (local) local.handle(obj); return; }
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function transportReady() { return OFFLINE ? !!local : !!(ws && ws.readyState === 1); }
  function setConn(on, msg) {
    const b = $('#connBadge');
    b.textContent = on ? '已连接' : (msg || '离线');
    b.className = 'conn-badge ' + (on ? 'on' : 'off');
  }

  // ---------- 启动 ----------
  async function init() {
    loadLocal();
    bindNav();
    bindHome();
    OFFLINE = location.protocol === 'file:'
      || new URLSearchParams(location.search).get('offline') === '1'
      || (location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname));
    if (window.XuekeData) G = window.XuekeData;
    if (!OFFLINE) connect();
    renderAll();
    const look = new URLSearchParams(location.search).get('view');
    showView(['deck', 'codex', 'home', 'game'].includes(look) ? look : 'home');
    const tab = new URLSearchParams(location.search).get('tab');
    if (['char', 'card', 'react', 'summon'].includes(tab)) codexTab = tab;
    if (OFFLINE) {
      setConn(false, G ? '离线 · 可玩' : '离线数据缺失');
      if (!G) $('#homeMsg').textContent = '⚠ 离线数据缺失：请重新生成 web/js/offline-bundle.js';
    } else {
      loadData();
    }
    if (new URLSearchParams(location.search).get('fixture')) runFixture();
    if (new URLSearchParams(location.search).get('demo')) runDemo();
  }

  function runFixture() {
    const iv = setInterval(() => {
      if (!G) return;
      clearInterval(iv);
      const mk = (id, idx, active) => {
        const m = G.chars[id];
        return { id, name: m.name, element: m.element, body: m.body, maxHp: m.maxHp, hp: m.maxHp,
          charge: idx === 0 ? 1 : 0, chargeNeed: 3, shield: 0, attached: null, weapon: null,
          artifact: null, talent: null, buffs: [], active: !!active };
      };
      S = {
        you: 0, phase: 'round', round: 1, fatigue: false, winner: null, current: 0, firstThisRound: 0,
        me: { side: 0, name: '我', isAI: false, activeIndex: 0, ap: 6, hand: ['f_tiantianhua', 's_jiaoshi'],
          handCount: 2, deckCount: 25, discards: 0,
          team: [mk('yuwen', 0, true), mk('shuxue', 1), mk('yingyu', 2)],
          summons: [{ side: 0, key: 'zuowen', dmg: 1, el: '文', dur: 2, uses: null, owner: null }],
          scenes: [{ id: 's_jiaoshi', dur: 2 }], supports: [] },
        opp: { side: 1, name: 'AI', isAI: true, activeIndex: 0, ap: 6, hand: null,
          handCount: 5, deckCount: 25, discards: 0,
          team: [mk('shuxue', 0, true), mk('wuli', 1), mk('huaxue', 2)],
          summons: [], scenes: [], supports: [] },
        actions: []
      };
      showView('game'); renderGame();
    }, 200);
  }

  async function loadData() {
    try {
      const res = await fetch('/api/gamedata');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      G = await res.json();
      setConn(ws && ws.readyState === 1, '已连接');
      renderAll(); showView(view);
      if (G && !ws) setConn(false, '已加载数据');
    } catch (e) {
      if (window.XuekeData && !OFFLINE) {
        OFFLINE = true;
        G = window.XuekeData;
        setConn(false, '离线 · 可玩');
        renderAll(); showView(view);
        return;
      }
      G = null;
      $('#homeMsg').textContent = '⚠ 数据加载中/失败：请确认服务器已启动（npm start），并通过 http://localhost:8080 打开页面。正在自动重试…';
      setTimeout(loadData, 3000);
    }
  }

  function loadLocal() {
    try {
      team = JSON.parse(localStorage.getItem('xsk_team') || '[]');
      if (!Array.isArray(team)) team = [];
      deck = JSON.parse(localStorage.getItem('xsk_deck') || '{}');
      if (!deck || typeof deck !== 'object') deck = {};
    } catch (e) { team = []; deck = {}; }
  }
  function saveLocal() {
    try { localStorage.setItem('xsk_team', JSON.stringify(team)); localStorage.setItem('xsk_deck', JSON.stringify(deck)); } catch (e) {}
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { ws = new WebSocket(proto + '://' + location.host); } catch (e) { setConn(false, '连接失败'); return; }
    ws.onmessage = e => { try { handleMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onopen = () => setConn(true);
    ws.onclose = () => {
      setConn(false, '离线');
      if (!S) setTimeout(connect, 3000);
    };
    ws.onerror = () => setConn(false, '连接失败');
  }

  // ---------- 视图路由 ----------
  function showView(v) {
    view = v;
    ['home', 'deck', 'codex', 'game'].forEach(x => {
      const el = $('#view-' + x);
      if (el) el.classList.toggle('active', x === v);
    });
    $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    if (v === 'home') renderHome();
    if (v === 'deck') renderDeck();
    if (v === 'codex') renderCodex();
    window.scrollTo(0, 0);
  }

  function bindNav() {
    $$('.nav-tab').forEach(t => t.onclick = () => showView(t.dataset.view));
    $('#topStart').onclick = () => showView('home');
  }

  // ---------- 首页 ----------
  function bindHome() {
    $$('.mode-card').forEach(b => b.onclick = () => {
      mode = b.dataset.mode;
      $$('.mode-card').forEach(x => x.classList.toggle('active', x === b));
      $('#pvpRoomRow').style.display = mode === 'pvp' ? 'flex' : 'none';
    });
    $('#goDeck').onclick = () => showView('deck');
    $('#clearDeck').onclick = () => { deck = {}; saveLocal(); renderHome(); };
    $('#startBtn').onclick = startGame;
    $('.mode-card[data-mode="pve"]').classList.add('active');
  }

  function renderAll() {
    if (view === 'home') renderHome();
    else if (view === 'deck') renderDeck();
    else if (view === 'codex') renderCodex();
  }

  function renderHome() {
    renderTeamSlots();
    renderCharPicker();
    // 卡组概要
    const total = deckTotal();
    const name = total ? ('自定义卡组 · ' + total + '张') : '未装配';
    $('#deckName').textContent = name;
    $('#deckCount').textContent = total + ' / ' + MAX_DECK + ' 张';
    $('#homeMsg').textContent = '';
    if (!G) $('#homeMsg').textContent = '⚠ 正在加载或连接失败。请确认服务器已启动（npm start）。';
  }

  function renderTeamSlots() {
    const wrap = $('#teamSlots');
    wrap.innerHTML = '';
    for (let i = 0; i < TEAM_SIZE; i++) {
      const id = team[i];
      const slot = document.createElement('div');
      slot.className = 'team-slot ' + (id ? 'filled' : 'empty');
      if (id && G) {
        const m = charMeta(id);
        slot.innerHTML = `<div class="slot-num">${i + 1}</div>
          <div class="slot-actions">
            ${i > 0 ? '<button class="slot-act" data-i="' + i + '" data-d="-1">◀</button>' : ''}
            ${i < TEAM_SIZE - 1 ? '<button class="slot-act" data-i="' + i + '" data-d="1">▶</button>' : ''}
          </div>
          <div class="slot-char">
            <img src="${charImg(id)}"><div class="slot-name">${m.name}</div>
          </div>`;
      } else {
        slot.innerHTML = `<span>站位 ${i + 1}<br><small style="color:var(--muted)">待选择</small></span>`;
      }
      wrap.appendChild(slot);
    }
    wrap.querySelectorAll('.slot-act').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const i = parseInt(b.dataset.i), d = parseInt(b.dataset.d);
      const j = i + d;
      if (j >= 0 && j < team.length) { [team[i], team[j]] = [team[j], team[i]]; saveLocal(); renderHome(); }
    });
  }

  function renderCharPicker() {
    const wrap = $('#charPicker');
    if (!G) { wrap.innerHTML = '<div class="hand-empty">正在加载角色数据…</div>'; return; }
    wrap.innerHTML = '';
    Object.values(G.chars).forEach(c => {
      const idx = team.indexOf(c.id);
      const el = document.createElement('button');
      el.className = 'char-pick' + (idx >= 0 ? ' selected' : '');
      el.innerHTML = `<img src="${charImg(c.id)}">
        ${idx >= 0 ? '<span class="pick-order">' + (idx + 1) + '</span>' : ''}
        <img class="el-badge" src="${elIcon(c.element)}">
        <div class="cp-name">${c.name}</div>
        <div class="cp-tags">${c.element} · ${c.body} ${c.maxHp}血</div>`;
      el.onclick = () => {
        const p = team.indexOf(c.id);
        if (p >= 0) team.splice(p, 1);
        else if (team.length < TEAM_SIZE) team.push(c.id);
        saveLocal(); renderTeamSlots(); renderCharPicker();
      };
      wrap.appendChild(el);
    });
  }

  function startGame() {
    if (loading) return;
    $('#homeMsg').textContent = '';
    if (!G) { $('#homeMsg').textContent = '⚠ 数据未就绪：请先确认服务器已启动（npm start）。'; return; }
    if (team.length !== TEAM_SIZE) { $('#homeMsg').textContent = '⚠ 请选择 3 位角色组成队伍（可按顺序调整站位）。'; return; }
    let cards = deckArray();
    if (cards.length === 0) cards = autoBuildDeck(); // 未装配则自动生成
    if (cards.length > MAX_DECK) cards = cards.slice(0, MAX_DECK);
    const name = ($('#name').value || '指挥官').slice(0, 12);
    const room = ($('#room').value || 'r1').slice(0, 12);
    if (OFFLINE) {
      if (mode === 'pvp') { $('#homeMsg').textContent = '⚠ 局域网联机需要服务器：请运行 npm start 后通过 http://localhost:8080 打开。'; return; }
      local = new LocalGame({ team0: team, deck0: cards, name0: name });
      local.handler = handleMsg;
      loading = true;
      $('#homeMsg').textContent = '正在创建本地人机对局…';
      local.start();
      setTimeout(() => { loading = false; }, 300);
      return;
    }
    if (!transportReady()) { $('#homeMsg').textContent = '⚠ 未连接服务器：请用 http://localhost:8080 打开页面（或使用离线模式）。'; return; }
    loading = true;
    $('#homeMsg').textContent = mode === 'pve' ? '正在创建人机对局…' : (mode === 'pvp' ? '正在进入/创建房间…' : '');
    send({
      type: mode === 'pve' ? 'create' : 'join',
      room: mode === 'pve' ? 'pve_' + Date.now() : room,
      matchup: mode, name, theme: 'custom', team, deck: cards
    });
    setTimeout(() => { loading = false; }, 1200);
  }

  // ---------- 卡组装配 ----------
  function autoBuildDeck() {
    const counts = {};
    const priority = G.cards.slice().sort((a, b) => {
      const rank = id => ({ sup_yunchou: 0, r_li: 1, r_wen: 1, sup_chongdian: 2, f_tiantianhua: 3 })[id] ?? 4;
      return rank(a.id) - rank(b.id) || a.cost - b.cost;
    }).filter(c => !(c.type === 'talent' && c.char && !team.includes(c.char)));
    const arr = [];
    priority.forEach(c => {
      if (arr.length >= MAX_DECK) return;
      for (let i = 0; i < MAX_COPY && arr.length < MAX_DECK; i++) arr.push(c.id);
    });
    return arr;
  }

  function renderDeck() {
    if (!G) {
      $('#deckGrid').innerHTML = '<div class="hand-empty">正在加载卡牌数据…</div>';
      return;
    }
    // 标签
    const fw = $('#deckFilters');
    fw.innerHTML = '';
    ['all', ...TYPE_ORDER].forEach(t => {
      const b = document.createElement('button');
      b.className = 'filter-chip' + (deckFilter === t ? ' active' : '');
      b.textContent = t === 'all' ? '全部' : TYPE_NAME[t];
      b.onclick = () => { deckFilter = t; renderDeck(); };
      fw.appendChild(b);
    });
    $('#deckTotal').textContent = deckTotal() + '/' + MAX_DECK;
    const grid = $('#deckGrid');
    grid.innerHTML = '';
    G.cards.filter(c => deckFilter === 'all' || c.type === deckFilter).forEach(c => {
      const count = deck[c.id] || 0;
      const isTalent = c.type === 'talent' && c.char;
      const talentBlocked = isTalent && !team.includes(c.char);
      const el = document.createElement('div');
      el.className = 'deck-card';
      el.innerHTML = `<img src="${cardImg(c.id)}">
        <div class="dc-cost">${c.cost}</div>
        <div class="dc-type">${TYPE_NAME[c.type]}</div>
        <div class="dc-body">
          <div class="dc-name">${c.name}</div>
          <div class="dc-meta">${c.el ? c.el + '属性 · ' : ''}${c.fast ? '快速行动' : '作战行动'}${talentBlocked ? ' · <span style="color:var(--red)">需队伍中有对应角色</span>' : ''}</div>
          <div class="dc-controls">
            <div class="dc-count">
              <button class="dc-btn" data-add="-1" ${count <= 0 ? 'disabled' : ''}>−</button>
              <span class="num">${count}</span>
              <button class="dc-btn" data-add="1" ${talentBlocked || count >= MAX_COPY || deckTotal() >= MAX_DECK ? 'disabled' : ''}>＋</button>
            </div>
            <button class="btn btn-line btn-sm" data-info="1">详情</button>
          </div>
        </div>`;
      el.querySelectorAll('[data-add]').forEach(btn => {
        btn.onclick = () => addCard(c.id, parseInt(btn.dataset.add));
      });
      el.querySelector('[data-info]').onclick = () => openDetail({ type: 'card', id: c.id });
      grid.appendChild(el);
    });
  }

  function addCard(id, delta) {
    const cur = deck[id] || 0;
    const next = cur + delta;
    if (next < 0 || next > MAX_COPY) return;
    if (delta > 0 && deckTotal() >= MAX_DECK) return;
    deck[id] = next; if (deck[id] === 0) delete deck[id];
    saveLocal(); renderDeck();
  }

  // ---------- 图鉴 ----------
  function renderCodex() {
    if (!G) { $('#codexGrid').innerHTML = '<div class="hand-empty">正在加载图鉴数据…</div>'; return; }
    $$('.codex-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === codexTab));
    const filter = $('#codexFilter');
    filter.style.display = 'block';
    filter.innerHTML = '';
    ['all', ...TYPE_ORDER].forEach(t => {
      if (codexTab !== 'card') return;
      const b = document.createElement('button');
      b.className = 'filter-chip' + (deckFilter2 === t ? ' active' : '');
      b.textContent = t === 'all' ? '全部' : TYPE_NAME[t];
      b.onclick = () => { deckFilter2 = t; renderCodex(); };
      filter.appendChild(b);
    });
    filter.style.display = codexTab === 'card' ? 'flex' : 'none';
    const grid = $('#codexGrid');
    grid.innerHTML = '';
    if (codexTab === 'char') {
      Object.values(G.chars).forEach(c => {
        const el = document.createElement('button');
        el.className = 'codex-card';
        el.innerHTML = `<img src="${charImg(c.id)}"><div class="cc-body">
          <div class="cc-name">${c.name}</div>
          <div class="cc-meta">${c.element}属性 · ${c.body}体型 · ${c.maxHp}血量</div>
          <div class="cc-meta" style="color:var(--gold)">点击查看技能</div>
        </div>`;
        el.onclick = () => openDetail({ type: 'char', id: c.id });
        grid.appendChild(el);
      });
    } else if (codexTab === 'card') {
      G.cards.filter(c => deckFilter2 === 'all' || c.type === deckFilter2).forEach(c => {
        const el = document.createElement('button');
        el.className = 'codex-card';
        el.innerHTML = `<img src="${cardImg(c.id)}"><div class="cc-body">
          <div class="cc-name">${c.name}</div>
          <div class="cc-meta">${TYPE_NAME[c.type]} · 消耗${c.cost} · ${c.el ? c.el + '属性' : ''}</div>
        </div>`;
        el.onclick = () => openDetail({ type: 'card', id: c.id });
        grid.appendChild(el);
      });
    } else if (codexTab === 'react') {
      REACTIONS.forEach(r => {
        const el = document.createElement('div');
        el.className = 'codex-readme';
        el.innerHTML = `<div class="cr-head"><b>${r.key}</b><span class="cr-combo">${r.combo}</span></div><p>${r.text}</p>`;
        grid.appendChild(el);
      });
    } else if (codexTab === 'summon') {
      SUMMON_DATA.forEach(d => {
        const el = document.createElement('button');
        el.className = 'codex-card';
        el.innerHTML = `<img src="assets/icons/${d.icon}">
          <div class="cc-body"><div class="cc-name">${d.name}</div>
          <div class="cc-meta">${d.el}元素 · ${d.dur != null ? '持续' + d.dur + '回合' : ''}${d.uses ? ' · ' + d.uses + '次' : ''}</div>
          <div class="cc-meta" style="color:#c9cfe2">${d.text}</div></div>`;
        grid.appendChild(el);
      });
    }
  }

  // ---------- 详情弹窗 ----------
  function openDetail(info) {
    const c = $('#detailContent');
    if (info.type === 'char') {
      const m = charMeta(info.id);
      const skills = [m.a, m.s, m.b].filter(Boolean).map(x => `<div class="d-block"><b>${x.name}（${x.cost}点）</b><p>${x.desc}</p></div>`).join('');
      c.innerHTML = `<h3>${m.name}</h3>
        <p class="d-sub">${m.element}属性 · ${m.body}体型 · ${m.maxHp}血量 · 充能需求${m.chargeNeed}</p>
        <img class="d-img" src="${charImg(info.id)}">
        ${skills}
        <div class="d-block"><b>天赋：${m.talent.name}</b><p>${m.talent.desc}</p></div>
        <div class="d-block"><b>体型特性</b><p>${m.body === '大' ? '大体型：15血，每回合结束 +4 血（整局 3 次）' : '小体型：12血，每回合行动点 +1（最多叠 2 层）'}</p></div>`;
    } else {
      const m = cardMeta(info.id);
      c.innerHTML = `<h3>${m.name}</h3>
        <p class="d-sub">${TYPE_NAME[m.type]} · 消耗${m.cost} · ${m.el ? m.el + '属性' : ''} · ${m.fast ? '快速行动' : '作战行动'}</p>
        <img class="d-img" src="${cardImg(info.id)}">
        <div class="d-block"><p>${m.text}</p></div>`;
    }
    $('#detailModal').style.display = 'flex';
  }

  // ---------- 离线本地会话 ----------
  function sanitizeLocal(state, viewerSide) {
    const E = window.XuekeEngine;
    const pv = (side, full) => {
      const p = state.players[side];
      const team = p.team.map((c, i) => ({
        id: c.id, name: c.name, element: c.element, body: c.body,
        maxHp: c.maxHp, hp: c.hp, charge: c.charge,
        chargeNeed: E.chargeNeed(state, side, c), shield: c.shield, attached: c.attached,
        weapon: c.weapon, artifact: c.artifact, talent: c.talent, buffs: c.buffs,
        active: i === p.activeIndex
      }));
      return {
        side, name: p.name, isAI: p.isAI, activeIndex: p.activeIndex, ap: p.ap, team,
        hand: full ? p.hand.map(h => h.id) : null, handCount: p.hand.length,
        deckCount: p.deck.length, discards: p.discards.length,
        summons: p.summons, scenes: p.scenes, supports: p.supports
      };
    };
    return {
      you: viewerSide, phase: state.phase, round: state.round, fatigue: state.fatigue, winner: state.winner,
      matchup: 'pve', current: state.current, firstThisRound: state.firstThisRound,
      me: pv(viewerSide, true), opp: pv(1 - viewerSide, false),
      actions: (state.phase === 'round' && state.current === viewerSide)
        ? E.getValidActions(state, viewerSide).map(a => ({
            type: a.type, cost: a.cost, index: a.index, handIndex: a.handIndex,
            cardId: a.meta ? a.meta.id : null, cardName: a.meta ? a.meta.name : null,
            activeChar: a.active ? a.active.id : null, gain: a.gain
          }))
        : []
    };
  }

  class LocalGame {
    constructor(settings) {
      this.settings = settings;
      this.state = null;
      this.handler = null;
    }
    handle(msg) {
      if (msg.type === 'create' || msg.type === 'join') {
        const st = window.XuekeEngine.createGame({
          matchup: 'pve',
          team0: this.settings.team0, deck0: this.settings.deck0,
          team1: this.settings.team1 || ['shuxue', 'wuli', 'huaxue'],
          deck1: this.settings.deck1 || ['sup_yunchou', 'sup_yunchou', 'r_li', 'r_li'],
          ai1: true, name0: this.settings.name0 || '我', name1: 'AI 对手', seed: Math.floor(Math.random() * 1e9)
        });
        this.state = st;
        st.events.push({ type: 'dealt' });
        this.emit();
        return;
      }
      if (!this.state) return;
      if (msg.type === 'mulligan') {
        if (msg.do) {
          const p = this.state.players[0];
          p.hand = [];
          window.XuekeEngine.draw(this.state, 0, 5);
        }
        this.state.meta.mulligans[0] = true;
        this.state.meta.mulligans[1] = true; // 本地 AI 默认不换
        if (this.state.meta.mulligans[0] && this.state.meta.mulligans[1]) {
          window.XuekeEngine.startRound(this.state);
        }
        this.emit();
        this.maybeAI();
        return;
      }
      if (msg.type === 'action') {
        if (this.state.phase === 'round' && this.state.current === 0) {
          window.XuekeEngine.resolveAction(this.state, 0, msg.action);
          this.emit();
          this.maybeAI();
        }
        return;
      }
    }
    start() { this.handle({ type: 'create' }); }
    emit() {
      if (this.handler) this.handler({ type: 'state', state: sanitizeLocal(this.state, 0), events: this.state.events.slice() });
      this.state.events.length = 0;
    }
    maybeAI() {
      const st = this.state;
      if (!st || st.phase !== 'round' || st.current !== 1) return;
      setTimeout(() => {
        if (!this.state || this.state.phase !== 'round' || this.state.current !== 1) return;
        const act = window.XuekeAI.chooseAction(this.state, 1);
        window.XuekeEngine.resolveAction(this.state, 1, act);
        this.emit();
        this.maybeAI();
      }, 1500 + Math.random() * 3000);
    }
  }

  // ---------- 服务器/离线消息 ----------
  function handleMsg(msg) {
    if (msg.type === 'lobby') { $('#homeMsg').textContent = msg.note; loading = false; return; }
    if (msg.type === 'error') {
      $('#homeMsg').textContent = msg.text; loading = false;
      if (view === 'game' && msg.text.includes('房间')) showView('home');
      return;
    }
    if (msg.type === 'state') {
      S = msg.state;
      if (S.phase === 'setup' || S.phase === 'round' || S.phase === 'finished') showView('game');
      renderGame();
      renderEvents(msg.events || []);
      return;
    }
    if (msg.type === 'chat') { addLog('', msg.text, 'sys'); }
  }

  // ---------- 对局渲染 ----------
  function renderGame() {
    if (!S) return;
    $('#roundInfo').textContent = '回合 ' + (S.round || 1);
    $('#fatigue').textContent = S.fatigue ? '⚡疲劳(消耗+1)' : '';
    const cur = S.current;
    $('#turnInfo').textContent = S.phase === 'finished' ? '' : (cur === S.you ? '你的行动轮' : (S.opp.isAI ? 'AI 思考中…' : '轮到对方'));
    const banner = $('#banner');
    if (S.phase === 'setup') banner.textContent = '⚑ 换牌阶段：请先确认是否更换手牌';
    else if (S.phase === 'finished') banner.textContent = '对局结束';
    else banner.textContent = (cur === S.you ? '轮到你了' : '轮到对方') + ' · 回合 ' + S.round + ' · 行动点 ' + S.me.ap;
    $('#endTurnBtn').style.display = (S.phase === 'round' && cur === S.you) ? 'inline-flex' : 'none';
    renderZone('#oppZone', S.opp, false);
    renderZone('#myZone', S.me, true);
    renderHand();
    renderSetupBar();
    if (openChar) renderCharPanel(openChar.side, openChar.index);
    if (openCard != null) renderCardPanel(openCard);
    else if (openInfo) renderInfoPanel(openInfo);
    if (S.phase === 'finished') renderGameover();
  }

  function renderZone(sel, p, mine) {
    const zone = $(sel);
    let html = '<div class="char-row">';
    p.team.forEach((c, i) => {
      const dead = c.hp <= 0;
      let cls = 'char-card' + (c.active ? ' active' : '') + (dead ? ' dead' : '');
      if (pendingAction && pendingAction.target === 'summon') cls += c.active ? '' : '';
      const need = c.chargeNeed || 3;
      let pips = '';
      for (let k = 0; k < need; k++) pips += '<span class="pip' + (k < c.charge ? ' full' : '') + '"></span>';
      html += `<div class="${cls}" data-side="${p.side}" data-index="${i}">
        <img class="art" src="${charImg(c.id)}">
        <div class="hp">${c.hp}</div>
        <img class="el" src="${elIcon(c.element)}">
        ${c.shield > 0 ? '<div class="shield" style="background:url(assets/icons/icon_shield.png) center/cover">' + c.shield + '</div>' : ''}
        <div class="charge">${pips}</div>
        <div class="name">${c.name}</div>
        <div class="buffrow">${renderBuffs(c.buffs)}</div>
      </div>`;
    });
    html += '</div>';
    const hasFx = p.summons.length || p.scenes.length || p.supports.length;
    if (hasFx) {
      html += '<div class="rowlabel">召唤物 / 场景 / 支援（点击查看）</div><div class="fx-strip">';
      p.summons.forEach((sm, si) => {
        const cls = (pendingAction && pendingAction.target === 'summon' && p.side !== S.you) ? ' can-target' : '';
        html += `<div class="fx-slot${cls}" data-kind="summon" data-side="${p.side}" data-si="${si}">
          <img src="${summonImg(sm.key)}"><span class="fx-dur">${sm.dur != null ? sm.dur + '回合' : (sm.uses != null ? sm.uses + '次' : '持续')}</span>
          <span class="fx-name">${summonName(sm.key)}</span></div>`;
      });
      p.scenes.forEach((sc, si) => {
        html += `<div class="fx-slot" data-kind="scene" data-side="${p.side}" data-si="${si}">
          <img src="${sceneImg(sc.id)}"><span class="fx-dur">${sc.dur != null ? sc.dur : '持续'}</span>
          <span class="fx-name">${cardMeta(sc.id) ? cardMeta(sc.id).name : '场景'}</span></div>`;
      });
      p.supports.forEach((sc, si) => {
        html += `<div class="fx-slot" data-kind="support" data-side="${p.side}" data-si="${si}">
          <img src="${sceneImg(sc.id)}"><span class="fx-dur">${sc.dur != null ? sc.dur : '持续'}</span>
          <span class="fx-name">${cardMeta(sc.id) ? cardMeta(sc.id).name : '支援'}</span></div>`;
      });
      html += '</div>';
    }
    html += `<div class="rowlabel" style="color:var(--muted)">${(mine ? '我方' : '对方') + '行动点 ' + p.ap + ' · 手牌 ' + p.handCount + ' · 牌库 ' + p.deckCount}</div>`;
    zone.innerHTML = html;
    zone.querySelectorAll('.char-card').forEach(el => {
      el.onclick = () => {
        const sd = parseInt(el.dataset.side), ix = parseInt(el.dataset.index);
        pendingAction = null;
        openInfo = null;
        openChar = { side: sd, index: ix };
        renderCharPanel(sd, ix);
      };
    });
    zone.querySelectorAll('.fx-slot').forEach(el => {
      el.onclick = () => {
        if (pendingAction && pendingAction.target === 'summon') {
          const si = parseInt(el.dataset.si);
          const act = { type: 'card', handIndex: pendingAction.handIndex, targetSummon: si };
          pendingAction = null;
          doAction(act);
          $('#cardPanel').classList.remove('open');
          openCard = null;
          return;
        }
        const kind = el.dataset.kind, si = parseInt(el.dataset.si);
        openInfo = { kind, side: parseInt(el.dataset.side), si };
        renderInfoPanel(openInfo);
      };
    });
  }

  function renderBuffs(buffs) {
    if (!buffs) return '';
    return buffs.map(b => `<span class="buff" title="${buffName(b.key)}">${buffShort(b.key)}</span>`).join('');
  }

  function renderHand() {
    const p = S.me, hand = $('#hand');
    if (!p.hand) { hand.innerHTML = '<div class="hand-empty">你的手牌</div>'; return; }
    const actions = S.actions || [];
    hand.innerHTML = '';
    p.hand.forEach((id, hi) => {
      const meta = cardMeta(id);
      const action = actions.find(a => a.type === 'card' && a.handIndex === hi);
      const el = document.createElement('div');
      el.className = 'hand-card' + (action ? '' : ' dim') + (openCard === hi ? ' selected' : '');
      el.innerHTML = `<img src="${cardImg(id)}"><div class="cost">${meta ? meta.cost : ''}</div>`;
      el.dataset.hi = hi;
      el.onclick = () => { openCard = hi; openChar = null; openInfo = null; pendingAction = null; renderCharPanel(null, null); renderCardPanel(hi); };
      hand.appendChild(el);
    });
  }

  function renderSetupBar() {
    const hint = $('#handHint');
    if (!S || !hint) return;
    if (S.phase === 'setup') {
      hint.innerHTML = '<div class="setup-actions"><button class="btn btn-gold" id="mullYes">换一次手牌</button><button class="btn btn-line" id="mullNo">不换（确认）</button></div>';
      $('#mullYes').onclick = () => { if (!mulliganDone) { mulliganDone = true; send({ type: 'mulligan', do: true }); } };
      $('#mullNo').onclick = () => { if (!mulliganDone) { mulliganDone = true; send({ type: 'mulligan', do: false }); } };
      return;
    }
    hint.textContent = S.phase === 'round' && S.current === S.you
      ? '点击手牌查看效果并确认打出 · 点击角色卡查看信息与行动'
      : (S.current === S.you ? '等待行动…' : (S.opp.isAI ? 'AI 思考中…' : '等待对方行动…'));
  }

  function closePanels() {
    openChar = null; openCard = null; openInfo = null; pendingAction = null;
    const a = $('#charPanel'), b = $('#cardPanel');
    if (a) a.classList.remove('open');
    if (b) b.classList.remove('open');
  }

  let panelSeq = 0; const panelHandlers = {};
  function actBtn(label, fn, gold) {
    const id = 'ph' + (++panelSeq);
    panelHandlers[id] = fn;
    return `<button class="panel-act${gold ? ' gold' : ''}" data-hid="${id}">${label}</button>`;
  }

  function renderCharPanel(side, index) {
    const panel = $('#charPanel');
    if (!panel) return;
    if (side == null || index == null || !S) { panel.classList.remove('open'); openChar = null; return; }
    const mine = side === S.you;
    const p = mine ? S.me : S.opp;
    const c = p.team[index];
    if (!c) { panel.classList.remove('open'); openChar = null; return; }
    const m = charMeta(c.id); if (!m) return;
    const active = index === p.activeIndex;
    const myTurn = S.phase === 'round' && S.current === S.you;
    const acts = S.actions || [];
    let actsHtml = '<div class="panel-none">暂无可执行行动</div>';
    if (mine && myTurn && c.hp > 0) {
      const list = [];
      if (active) {
        const atk = acts.find(a => a.type === 'attack');
        if (atk) list.push(actBtn('⚔ ' + m.a.name + '　消耗 ' + atk.cost + ' · 预计伤害 ' + estimateAbilityDamage(c, 'attack'), () => doAction({ type: 'attack' })));
        const sk = acts.find(a => a.type === 'skill');
        if (sk && m.s) list.push(actBtn('✦ ' + m.s.name + '　消耗 ' + sk.cost + ' · 预计伤害 ' + estimateAbilityDamage(c, 'skill'), () => doAction({ type: 'skill' })));
        if (m.s2) {
          const sk2 = acts.find(a => a.type === 'skill2');
          if (sk2) list.push(actBtn('✦✨ ' + m.s2.name + '　消耗 ' + sk2.cost + ' · 预计伤害 ' + estimateAbilityDamage(c, 'skill2'), () => doAction({ type: 'skill2' })));
        }
        const bu = acts.find(a => a.type === 'burst');
        if (bu && m.b) list.push(actBtn('✹ ' + m.b.name + '　消耗 ' + bu.cost + ' · 充能 ' + c.charge + '/' + (c.chargeNeed || 3), () => doAction({ type: 'burst' }), true));
      } else {
        const sw = acts.find(a => a.type === 'switch' && a.index === index);
        if (sw && c.hp > 0) list.push(actBtn('⇄ 切换至 ' + c.name + '　消耗 ' + sw.cost, () => doAction({ type: 'switch', index })));
      }
      if (list.length) actsHtml = list.join('');
      else actsHtml = '<div class="panel-none">行动点不足，可使用“结束回合”</div>';
    } else if (mine && S.phase === 'round') {
      actsHtml = '<div class="panel-none">等待你的行动轮…</div>';
    }
    const buffs = (c.buffs || []).map(formatBuff).filter(Boolean).map(x => `<li>${x}</li>`).join('');
    panel.classList.add('open');
    panel.innerHTML = `
      <button class="panel-close" data-close="1">✕</button>
      <div class="panel-avatar"><img src="${charImg(c.id)}"></div>
      <div class="panel-name">${c.name}</div>
      <div class="panel-tags">${c.element}属性 · ${c.body}体型${active ? ' · 出战' : ''}</div>
      <div class="panel-stats">
        <div><span>血量</span><b>${c.hp} / ${c.maxHp}</b></div>
        <div><span>充能</span><b>${c.charge} / ${c.chargeNeed || 3}</b></div>
        <div><span>护盾</span><b>${c.shield}</b></div>
        <div><span>附着</span><b>${c.attached ? c.attached + '元素' : '无'}</b></div>
      </div>
      <div class="panel-sec">行动</div>
      <div class="panel-actions">${actsHtml}</div>
      <div class="panel-sec">当前状态效果</div>
      <ul class="panel-buffs">${buffs || '<li><span class="bname">无</span></li>'}</ul>
      <div class="panel-sec">技能一览</div>
      <div class="panel-skills">
        ${skillLine(m.a)}${m.s ? skillLine(m.s) : ''}${m.s2 ? skillLine(m.s2) : ''}${m.b ? skillLine(m.b) : ''}
      </div>
      `;
    panel.querySelectorAll('[data-hid]').forEach(b => { const f = panelHandlers[b.dataset.hid]; if (f) b.onclick = f; });
    panel.querySelector('[data-close]').onclick = () => { openChar = null; panel.classList.remove('open'); };
  }

  function renderCardPanel(hi) {
    const panel = $('#cardPanel');
    if (!panel) return;
    if (hi == null || !S || !S.me.hand || !S.me.hand[hi]) { panel.classList.remove('open'); openCard = null; return; }
    const id = S.me.hand[hi];
    const m = cardMeta(id); if (!m) return;
    const myTurn = S.phase === 'round' && S.current === S.you;
    const acts = S.actions || [];
    const cardAct = myTurn ? acts.find(a => a.type === 'card' && a.handIndex === hi) : null;
    const tuneAct = myTurn ? acts.find(a => a.type === 'tune' && a.handIndex === hi) : null;
    panel.classList.add('open');
    const activeChar = S.me.team[S.me.activeIndex];
    const isEquip = ['weapon', 'artifact', 'talent'].includes(m.type);
    const slot = m.type === 'weapon' ? 'weapon' : m.type === 'artifact' ? 'artifact' : 'talent';
    const replacing = isEquip && activeChar && activeChar[slot] != null;
    const actionTag = replacing ? ' · 作战行动（更换，+2）' : ' · 快速行动';
    const cardDmg = CARD_DMG[id];
    let actions = '<div class="panel-none">暂不可打出</div>';
    const list = [];
    if (cardAct) list.push(actBtn('✧ 打出　消耗 ' + cardAct.cost, () => playHandCard(hi, cardAct), true));
    if (tuneAct) list.push(actBtn('♻ 调和　获得 +' + (tuneAct.gain || 0) + ' 行动点', () => { doAction({ type: 'tune', handIndex: hi }); }));
    if (list.length) actions = list.join('');
    panel.innerHTML = `
      <button class="panel-close" data-close="1">✕</button>
      <div class="panel-card-img"><img src="${cardImg(id)}"></div>
      <div class="panel-name">${m.name}</div>
      <div class="panel-tags">${TYPE_NAME[m.type]} · 消耗${m.cost} · ${m.el ? m.el + '属性' : ''}${actionTag}</div>
      ${cardDmg ? `<div class="panel-damage">预计伤害：<b>${cardDmg.dmg}</b> 点${cardDmg.el}元素</div>` : ''}
      <div class="panel-text">${m.text}</div>
      <div class="panel-actions">${actions}</div>`;
    panel.querySelectorAll('[data-hid]').forEach(b => { const f = panelHandlers[b.dataset.hid]; if (f) b.onclick = f; });
    panel.querySelector('[data-close]').onclick = () => { openCard = null; panel.classList.remove('open'); };
  }

  function renderInfoPanel(info) {
    const panel = $('#cardPanel');
    if (!panel || !info || !S) return;
    const side = info.side;
    const p = side === S.you ? S.me : S.opp;
    let title = '', tags = '', text = '', img = '';
    if (info.kind === 'summon') {
      const sm = p.summons[info.si];
      if (!sm) { panel.classList.remove('open'); openInfo = null; return; }
      const d = SUMMON_DATA.find(x => x.key === sm.key) || {};
      title = d.name || summonName(sm.key);
      tags = `${d.el || sm.el}元素 · ${sm.dur != null ? '持续 ' + sm.dur + ' 回合' : '持续生效'}${sm.uses != null ? ' · 可用 ' + sm.uses + ' 次' : ''}`;
      text = d.text || '每回合结束造成 ' + sm.dmg + ' 点' + (sm.el || '') + '元素伤害';
      img = 'assets/icons/' + (d.icon || 'icon_zhaohuan_wen.png');
    } else if (info.kind === 'scene' || info.kind === 'support') {
      const arr = info.kind === 'scene' ? p.scenes : p.supports;
      const sc = arr[info.si];
      if (!sc) { panel.classList.remove('open'); openInfo = null; return; }
      const m = cardMeta(sc.id);
      title = m ? m.name : '卡牌';
      tags = `${TYPE_NAME[info.kind === 'scene' ? 'scene' : 'support']} · ${sc.dur != null ? '剩余 ' + sc.dur + ' 回合' : '持续生效'}`;
      text = m ? m.text : '';
      img = cardImg(sc.id);
    }
    panel.classList.add('open');
    panel.innerHTML = `
      <button class="panel-close" data-close="1">✕</button>
      <div class="panel-card-img"><img src="${img}"></div>
      <div class="panel-name">${title}</div>
      <div class="panel-tags">${tags}</div>
      <div class="panel-text">${text}</div>`;
    panel.querySelector('[data-close]').onclick = () => { openInfo = null; panel.classList.remove('open'); };
  }

  function playHandCard(hi, cardAct) {
    if (cardAct.cardId === 'sup_songni') {
      pendingAction = { type: 'card', handIndex: hi, target: 'summon' };
      renderZone('#oppZone', S.opp, false);
      $('#cardPanel .panel-actions').innerHTML = '<div class="panel-none">请点击对方召唤物以消灭（点击召唤物）</div>';
      return;
    }
    doAction({ type: 'card', handIndex: hi });
  }

  function skillLine(s) {
    if (!s) return '';
    return `<div class="skill-row"><b>${s.name}（${s.cost}点）</b><span>${s.desc}</span></div>`;
  }

  function formatBuff(b) {
    const name = buffName(b.key);
    const extra = (b.val != null && b.key === 'vulnerable') ? ' +' + (b.val || 0) + '%' : '';
    const dur = b.dur != null ? ' · 持续 ' + b.dur + ' 回合' : '';
    const uses = b.uses != null ? ' · ' + b.uses + ' 次' : '';
    return `<span class="bname">${name}</span><span class="bdur">${extra}${dur}${uses}</span>`;
  }

  function doAction(action) {
    if (!S || S.phase !== 'round' || S.current !== S.you || pendingAction) return;
    send({ type: 'action', action });
    // 保留角色面板，让玩家在自己的下一个行动轮可直接继续出招
    openCard = null;
    const kp = $('#cardPanel');
    if (kp) kp.classList.remove('open');
  }

  function renderEvents(events) {
    if (!events) return;
    events.forEach(ev => {
      if (ev.type === 'round') { addLog('', '===== 回合 ' + ev.round + ' =====', 'sys'); return; }
      if (ev.type === 'turn') { addLog('', ev.player === S.you ? '轮到你了' : '轮到对方', 'sys'); return; }
      if (ev.type === 'question') { if (ev.side !== S.you) showQuestion(ev.text); return; }
      if (ev.type === 'dealt' || ev.type === 'dice_round') return;
      addLog('', ev.text || '', ev.side == null ? 'sys' : (ev.side === S.you ? 'you' : 'opp'));
    });
    runFx(events);
  }
  function addLog(who, text, cls) {
    const log = $('#log'); const p = document.createElement('p');
    p.className = cls || 'sys'; p.textContent = text; log.appendChild(p); log.scrollTop = log.scrollHeight;
  }

  // ---------- 特效 ----------
  let fxChain = Promise.resolve();
  function queueFx(fn) { fxChain = fxChain.then(fn).catch(() => {}); }
  function runFx(events) {
    events.forEach(ev => {
      if (ev.type === 'dice_round') showDiceFx(ev);
      else if (ev.type === 'card_play') queueFx(() => fxCardPlay(ev));
      else if (ev.type === 'skill_cast') queueFx(() => fxSkillCast(ev));
      else if (ev.type === 'damage') queueFx(() => fxDamage(ev));
    });
  }
  const FX_COLOR = { '文': '#c26bf0', '理': '#5aa9e6', '物理': '#f2f2f2' };
  function elColor(el) { return FX_COLOR[el] || '#ffffff'; }
  function centerOf(sel) {
    const el = document.querySelector(sel);
    if (!el) return { x: innerWidth / 2, y: innerHeight / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function spawnParticles(x, y, color, n) {
    const layer = $('#fxLayer');
    for (let i = 0; i < (n || 16); i++) {
      const d = document.createElement('i');
      d.className = 'fx-particle';
      d.style.left = x + 'px'; d.style.top = y + 'px';
      d.style.background = color;
      layer.appendChild(d);
      const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 120;
      d.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0)`, opacity: 0 }
      ], { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => d.remove();
    }
  }
  function fxCardPlay(ev) {
    return new Promise(res => {
      if (!S) return res();
      const layer = $('#fxLayer');
      const img = document.createElement('img');
      img.src = cardImg(ev.cardId); img.className = 'fx-card-image';
      const me = ev.side === S.you;
      const sx = innerWidth / 2, sy = me ? innerHeight - 120 : 130;
      img.style.left = (sx - 70) + 'px'; img.style.top = (sy - 100) + 'px';
      layer.appendChild(img);
      const cx = innerWidth / 2, cy = innerHeight / 2;
      img.animate([
        { transform: 'scale(.3) rotate(-6deg)', opacity: .5, offset: 0 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: .45 },
        { transform: 'scale(1.5) translate(0,-20px)', opacity: 1, offset: .75 },
        { transform: 'scale(1.9) translate(0,-60px)', opacity: 0, offset: 1 }
      ], { duration: 1300, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => {
        spawnParticles(cx, cy - 40, '#e6c26a', 22);
        setTimeout(() => { img.remove(); res(); }, 300);
      };
    });
  }
  function fxSkillCast(ev) {
    return new Promise(res => {
      if (!S) return res();
      const layer = $('#fxLayer');
      const name = document.createElement('div');
      name.className = 'fx-skill-name';
      name.textContent = ev.charName + ' · ' + ev.skillName;
      layer.appendChild(name);
      name.animate([
        { transform: 'scale(.7)', opacity: 0 },
        { transform: 'scale(1.05)', opacity: 1, offset: .25 },
        { transform: 'scale(1)', opacity: 1, offset: .7 },
        { transform: 'scale(1.1)', opacity: 0 }
      ], { duration: 900, easing: 'ease-out' }).onfinish = () => name.remove();
      const from = centerOf('.char-card[data-side="' + ev.side + '"].active');
      const to = centerOf('.char-card[data-side="' + (1 - ev.side) + '"].active');
      const orb = document.createElement('div');
      orb.className = 'fx-orb';
      orb.style.left = from.x + 'px'; orb.style.top = from.y + 'px';
      layer.appendChild(orb);
      orb.animate([
        { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .2 },
        { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(1.1)`, opacity: 1, offset: .88 },
        { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(1.5)`, opacity: 0 }
      ], { duration: 950, easing: 'cubic-bezier(.3,.7,.4,1)' }).onfinish = () => {
        spawnParticles(to.x, to.y, '#f0d78a', 18);
        orb.remove(); setTimeout(res, 180);
      };
    });
  }
  function fxDamage(ev) {
    return new Promise(res => {
      const pos = centerOf('.char-card[data-side="' + ev.targetSide + '"][data-index="' + ev.targetIndex + '"]');
      const layer = $('#fxLayer');
      const d = document.createElement('div');
      d.className = 'fx-damage';
      d.textContent = '-' + ev.amount + '!';
      d.style.color = elColor(ev.element);
      d.style.left = pos.x + 'px'; d.style.top = pos.y + 'px';
      layer.appendChild(d);
      d.animate([
        { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
        { transform: 'translate(-50%,-70%) scale(1.2)', opacity: 1, offset: .25 },
        { transform: 'translate(-50%,-140%) scale(1)', opacity: 0 }
      ], { duration: 850, easing: 'ease-out' }).onfinish = () => { d.remove(); res(); };
    });
  }
  function showDiceFx(ev) {
    const layer = $('#fxLayer');
    const me = S.you === 0;
    const mineRolls = me ? ev.rolls0 : ev.rolls1;
    const oppRolls = me ? ev.rolls1 : ev.rolls0;
    const mineAp = me ? ev.ap0 : ev.ap1;
    const oppAp = me ? ev.ap1 : ev.ap0;
    const first = (ev.first == null ? 0 : ev.first) === S.you ? '你' : '对方';
    const el = document.createElement('div');
    el.className = 'fx-dice';
    el.innerHTML = `<div class="fx-dice-title">第 ${ev.round} 回合 · 掷骰结果</div>
      <div class="fx-dice-row"><span class="side me">我方</span><b>${mineRolls.join(' · ')}</b><em>行动点 ${mineAp}</em></div>
      <div class="fx-dice-row"><span class="side op">对方</span><b>${oppRolls.join(' · ')}</b><em>行动点 ${oppAp}</em></div>
      <div class="fx-dice-first">本回合先手：${first}</div>`;
    layer.appendChild(el);
    el.animate([
      { transform: 'translateY(20px) scale(.9)', opacity: 0 },
      { transform: 'translateY(0) scale(1)', opacity: 1 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: .8 },
      { transform: 'translateY(-10px) scale(.94)', opacity: 0 }
    ], { duration: 2600, easing: 'ease-out' }).onfinish = () => el.remove();
  }

  // ---------- 问答 / 结束 ----------
  function showQuestion(text) {
    $('#qText').textContent = text || '语文天赋提问：请回答一个学过的知识点（10秒内）。';
    $('#question').style.display = 'flex';
  }
  function renderGameover() {
    const w = S.winner;
    let t, x;
    if (w === -1) { t = '平 局'; x = '15回合未分胜负。'; }
    else if (w === S.you) { t = '胜 利'; x = '你击败了对手！'; }
    else { t = '败 北'; x = '对手获胜。'; }
    $('#goTitle').textContent = t; $('#goText').textContent = x;
    $('#gameover').style.display = 'flex';
  }

  // ---------- 演示模式 ----------
  function runDemo() {
    let probed = false;
    let clicked = false;
    let actedOnce = false;
    const iv = setInterval(() => {
      if (!G) return;
      if (!OFFLINE && ws && ws.readyState !== 1) return;
      clearInterval(iv);
      if (team.length === 0) team = (G.presets.balanced || []).slice();
      if (deckTotal() === 0) { deck = {}; autoBuildDeck().forEach(id => { deck[id] = (deck[id] || 0) + 1; }); }
      saveLocal(); renderHome();
      $('#name').value = '演示';
      startGame();
    }, 200);
    setInterval(() => {
      if (!S) return;
      if (new URLSearchParams(location.search).get('click') && !clicked && S.phase === 'round' && S.current === S.you) {
        clicked = true;
        const el = document.querySelector('.char-card[data-side="' + S.you + '"][data-index="' + S.me.activeIndex + '"]');
        if (el) el.click();
      }
      if (new URLSearchParams(location.search).get('probe') && !probed && S.me.team) {
        probed = true;
        openChar = { side: S.you, index: S.me.activeIndex };
        renderCharPanel(S.you, S.me.activeIndex);
        if (S.me.hand && S.me.hand.length) { openCard = 0; renderCardPanel(0); }
      }
      if (S.phase === 'setup' && !mulliganDone) { mulliganDone = true; send({ type: 'mulligan', do: false }); return; }
      if (new URLSearchParams(location.search).get('pause')) return;
      if (S.phase !== 'round' || S.current !== S.you) return;
      if (new URLSearchParams(location.search).get('once') && actedOnce) return;
      const preferCard = new URLSearchParams(location.search).get('card');
      const preferSkill = new URLSearchParams(location.search).get('skill');
      const a = preferCard
        ? (S.actions || []).find(x => x.type === 'card') || (S.actions || []).find(x => x.type === 'attack') || (S.actions || []).find(x => x.type === 'pass')
        : preferSkill
          ? (S.actions || []).find(x => x.type === 'skill') || (S.actions || []).find(x => x.type === 'skill2') || (S.actions || []).find(x => x.type === 'attack') || (S.actions || []).find(x => x.type === 'pass')
        : (S.actions || []).find(x => x.type === 'attack') || (S.actions || []).find(x => x.type === 'skill') || (S.actions || []).find(x => x.type === 'pass');
      doAction(a ? { type: a.type, handIndex: a.handIndex, index: a.index } : { type: 'pass' });
      actedOnce = true;
    }, 700);
  }

  // ---------- 小工具 ----------
  function summonImg(key) {
    const map = { zuowen: 'icon_zuowen.png', jiexijihe: 'icon_jiexijihe.png', qixing: 'icon_qixing.png', minglang: 'icon_minglang.png', leibao: 'icon_leibao.png', zhaohuan: 'icon_zhaohuan_wen.png' };
    return 'assets/icons/' + (map[key] || 'icon_zhaohuan_wen.png');
  }
  function summonName(key) { const d = SUMMON_DATA.find(x => x.key === key); return d ? d.name : key; }
  function sceneImg(id) { return 'assets/cards/card_' + id + '.png'; }
  function estimateAbilityDamage(c, kind) {
    const m = charMeta(c && c.id); if (!m || !S) return 0;
    let base = 0, el = '';
    if (kind === 'attack') {
      base = m.a.dmg || 0; el = m.a.el;
      const inf = (c.buffs || []).find(b => b.key === 'infuse' && b.dur > 0);
      if (inf) { el = inf.el; base += 1; }
      if ((c.buffs || []).some(b => b.key === 'politBuff' && b.dur > 0)) { if (el === '物理') el = '文'; base += 1; }
    } else if (kind === 'skill' || kind === 'skill2') {
      const s = kind === 'skill2' ? m.s2 : m.s;
      base = (s && s.dmg) || 0; el = (s && s.el) || c.element;
    } else {
      base = (m.b && m.b.dmg) || 0; el = (m.b && m.b.el) || c.element;
      if (c.id === 'shengwu') base += (S.me.summons || []).length;
    }
    if (c.weapon) base += (c.weapon === 'w_huanyu' && c.hp < 8) ? 3 : 1;
    const target = S.opp.team[S.opp.activeIndex];
    if (target && el && el !== '物理') {
      if (target.attached && target.attached !== el) base += 2;
      const vuln = (target.buffs || []).filter(b => b.key === 'vulnerable').reduce((s, b) => s + (b.val || 0), 0) / 100;
      if (vuln) base = Math.round(base * (1 + vuln));
    }
    return Math.max(0, base);
  }
  function buffName(k) {
    const map = { vulnerable: '易伤', vulnerableOne: '易伤(1次)', reactive: '应激', bleed: '流血', camo: '迷彩', infuse: '元素附魔', stun: '眩晕', cheguStun: '冰寒', huxinkai: '护心铠', politBuff: '政治强化', foodChicken: '烟熏鸡', foodPizza: '菠萝披萨', foodShieldReduce: '莲花酥', foodBurstBoost: '仙跳墙', foodBadouAtk: '巴豆' };
    return map[k] || k;
  }
  function buffShort(k) {
    const map = { vulnerable: '易', reactive: '应', bleed: '血', camo: '迷', infuse: '附', stun: '晕', cheguStun: '寒', huxinkai: '铠', politBuff: '政', foodChicken: '鸡', foodPizza: '披', foodShieldReduce: '莲', foodBurstBoost: '跳', foodBadouAtk: '巴' };
    return map[k] || '?';
  }

  // ---------- 事件绑定 ----------
  $('#detailClose').onclick = () => $('#detailModal').style.display = 'none';
  $('#detailModal').onclick = e => { if (e.target === $('#detailModal')) $('#detailModal').style.display = 'none'; };
  $('#qYes').onclick = () => { $('#question').style.display = 'none'; send({ type: 'answer', correct: true }); };
  $('#qNo').onclick = () => { $('#question').style.display = 'none'; send({ type: 'answer', correct: false }); };
  $('#againBtn').onclick = () => location.reload();
  $('#quitBtn').onclick = () => location.reload();
  $('#endTurnBtn').onclick = () => { if (S && S.phase === 'round' && S.current === S.you) doAction({ type: 'pass' }); };
  $('#clearDeck2').onclick = () => { deck = {}; saveLocal(); renderDeck(); };
  $('#autoDeck').onclick = () => { deck = {}; autoBuildDeck().forEach(id => { deck[id] = (deck[id] || 0) + 1; }); saveLocal(); renderDeck(); };
  $('#saveDeck').onclick = () => { saveLocal(); renderHome(); showView('home'); };
  $$('.codex-tab').forEach(b => b.onclick = () => { codexTab = b.dataset.tab; renderCodex(); });

  init();
})();
