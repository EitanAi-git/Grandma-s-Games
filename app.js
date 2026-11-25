'use strict';

/* =========================================================
   כלים כלליים
   ========================================================= */

const app = document.getElementById('app');

// מונע לחיצה כפולה / לחיצות מהירות בטעות
const TAP_GAP_MS = 450;
let lastTap = 0;

function onTap(el, handler, opts = {}) {
  const armDelay = opts.armDelay || 0; // כפתור חדש לא מגיב מיד, כדי שלחיצה קודמת לא "תיפול" עליו
  const createdAt = Date.now();
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - createdAt < armDelay) return;
    if (now - lastTap < (opts.gap ?? TAP_GAP_MS)) return;
    lastTap = now;
    sound.unlock();
    handler(e);
  });
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

// טיימרים של המשחק הנוכחי — מבוטלים ביציאה מהמשחק
let timers = [];
function later(fn, ms) {
  const id = setTimeout(() => { timers = timers.filter((t) => t !== id); fn(); }, ms);
  timers.push(id);
  return id;
}
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

const wait = (ms) => new Promise((res) => later(res, ms));
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------- ניקוד שנשמר ---------- */
const store = {
  get() {
    try { return JSON.parse(localStorage.getItem('gg-score')) || {}; } catch { return {}; }
  },
  win(game, who) {
    const s = this.get();
    s[game] = s[game] || { you: 0, bot: 0 };
    s[game][who]++;
    try { localStorage.setItem('gg-score', JSON.stringify(s)); } catch { /* לא נורא */ }
  },
};

/* ---------- רמת קושי ---------- */
const LEVELS = [
  { id: 'easy', name: 'קל' },
  { id: 'medium', name: 'בינוני' },
  { id: 'hard', name: 'קשה' },
];
const level = {
  get() {
    try {
      const v = localStorage.getItem('gg-level');
      return LEVELS.some((l) => l.id === v) ? v : 'easy';
    } catch { return 'easy'; }
  },
  set(v) { try { localStorage.setItem('gg-level', v); } catch { /* לא נורא */ } },
  name() { return LEVELS.find((l) => l.id === this.get()).name; },
};

/* ---------- נגד מי משחקים: המחשב או חבר/ה (על אותו טלפון) ---------- */
const mode = {
  get() {
    try { return localStorage.getItem('gg-mode') === 'friend' ? 'friend' : 'bot'; } catch { return 'bot'; }
  },
  set(v) { try { localStorage.setItem('gg-mode', v); } catch { /* לא נורא */ } },
  friends() { return this.get() === 'friend'; },
};

// שורת "תור": שני שחקנים, מי שתורו מסומן במסגרת
function turnChips(a, b) {
  const chipA = h('span', { class: 'chip' }, ...a);
  const chipB = h('span', { class: 'chip' }, ...b);
  return {
    el: h('div', { class: 'scoreline chips' }, chipA, chipB),
    set(first) { chipA.classList.toggle('active', first); chipB.classList.toggle('active', !first); },
  };
}

/* ---------- צלילים ---------- */
const sound = {
  ctx: null,
  out: null,
  on: (() => { try { return localStorage.getItem('gg-sound') !== 'off'; } catch { return true; } })(),
  setOn(v) {
    this.on = v;
    try { localStorage.setItem('gg-sound', v ? 'on' : 'off'); } catch { /* לא נורא */ }
  },
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.out) {
      // מגבר + מגביל: צליל חזק בלי רעשים/צרימות
      const boost = this.ctx.createGain();
      boost.gain.value = 4;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      const post = this.ctx.createGain();
      post.gain.value = 1.4; // הגבר סופי עד קרוב למקסימום
      boost.connect(limiter).connect(post).connect(this.ctx.destination);
      this.out = boost;
    }
  },
  tone(freq, ms = 300, type = 'triangle', vol = 0.35) {
    if (!this.ctx || !this.out || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + ms / 1000 + 0.05);
  },
  // "דינג" אחד, כמו פעמון קטן: מכה אחת שדועכת לאט (צליל אחד, לא מנגינה)
  ding() {
    if (!this.ctx || !this.out || !this.on) return;
    const t = this.ctx.currentTime;
    // צליל יסוד + צליל עליון קצר שנותן את ה"פעמון"
    for (const [freq, vol, len] of [[1320, 0.16, 0.9], [1320 * 2.76, 0.05, 0.3]]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  },
  click() { this.tone(880, 130, 'triangle', 0.3); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 260), i * 170)); },
  lose() { [784, 659, 523].forEach((f, i) => setTimeout(() => this.tone(f, 340), i * 240)); },
  draw() { [660, 660].forEach((f, i) => setTimeout(() => this.tone(f, 240), i * 280)); },
};

/* ---------- חלון אישור ---------- */
const modal = {
  el: document.getElementById('modal'),
  text: document.getElementById('modal-text'),
  buttons: document.getElementById('modal-buttons'),
  open: false,
  ask(question, yesLabel, noLabel) {
    return new Promise((resolve) => {
      this.text.textContent = question;
      this.buttons.innerHTML = '';
      const close = (answer) => { this.el.classList.add('hidden'); this.open = false; resolve(answer); };
      const no = h('button', { class: 'big-btn green', text: noLabel });
      const yes = h('button', { class: 'big-btn light', text: yesLabel });
      onTap(no, () => close(false), { armDelay: 600 });
      onTap(yes, () => close(true), { armDelay: 600 });
      this.buttons.append(no, yes); // "להמשיך" למעלה — הבחירה הבטוחה
      this.el.classList.remove('hidden');
      this.open = true;
    });
  },
};

/* =========================================================
   ניווט
   ========================================================= */

let inGame = false;

async function askExit() {
  if (modal.open) return;
  const leave = await modal.ask('לחזור לתפריט הראשי?', 'כן, לחזור לתפריט', 'לא, להמשיך לשחק');
  if (leave) showHome();
}

// כפתור "חזור" של הטלפון: במשחק — שואלים קודם
window.addEventListener('popstate', () => {
  if (inGame) {
    history.pushState({ game: true }, '');
    askExit();
  }
});

// עוטף לוח משחק כך שיתאים בדיוק לשטח הפנוי במסך (בלי גלילה), ושומר על הצורה שלו
function fit(board) {
  return h('div', { class: 'fit' }, board);
}

function gameScreen(title, gameId, opts = {}) {
  clearTimers();
  if (!inGame) history.pushState({ game: true }, '');
  inGame = true;
  app.innerHTML = '';
  app.classList.add('game-mode');
  const back = h('button', { class: 'icon-btn home-btn', 'aria-label': 'חזרה לתפריט הראשי' },
    h('span', { class: 'icon', text: '🏠' }), h('span', { class: 'label', text: 'תפריט' }));
  onTap(back, askExit);
  const status = h('div', { class: 'status' });
  const body = h('div', { class: 'game-body' });
  const footer = h('div');
  app.append(h('div', { class: 'topbar game-top' }, back, h('h1', { class: 'game-title', text: title }), soundToggle()), h('p', { class: 'game-level', text: opts.friends ? '👥 שני שחקנים' + (opts.showLevel ? ' · רמה: ' + level.name() : '') : 'רמה: ' + level.name() }), status, body, footer);

  return {
    body,
    setStatus(text, who) {
      status.textContent = text;
      status.className = 'status' + (who ? ' ' + who : '');
    },
    // מסך סיום עם "לשחק שוב"
    // who: 'you' (ניצחון), 'bot' (הפסד), null (תיקו). opts.count=false: לא נספר בטבלה. opts.cls: צבע תיבת הסטטוס
    finish(text, who, restart, fopts = {}) {
      const count = fopts.count !== false && !opts.friends;
      if (who === 'you') { sound.win(); if (count) store.win(gameId, 'you'); }
      else if (who === 'bot') { sound.lose(); if (count) store.win(gameId, 'bot'); }
      else sound.draw();
      this.setStatus(text, fopts.cls ?? (who === 'you' ? 'you' : who === 'bot' ? 'bot' : ''));
      footer.innerHTML = '';
      const again = h('button', { class: 'big-btn green', text: '🔄 לשחק שוב' });
      const home = h('button', { class: 'big-btn light', text: '🏠 לתפריט הראשי' });
      onTap(again, restart, { armDelay: 1200 });
      onTap(home, showHome, { armDelay: 1200 });
      footer.append(h('div', { class: 'result' }, again, home));
      setTimeout(() => footer.scrollIntoView({ behavior: 'smooth', block: 'end' }), 300);
    },
  };
}

// כפתור צליל בפינה העליונה: אייקון גדול + מילה, זמין גם באמצע משחק
function soundToggle() {
  const icon = h('span', { class: 'icon' });
  const label = h('span', { class: 'label' });
  const btn = h('button', { class: 'icon-btn sound-icon-btn' }, icon, label);
  const render = () => {
    icon.textContent = sound.on ? '🔊' : '🔇';
    label.textContent = sound.on ? 'צליל' : 'שקט';
    btn.classList.toggle('off', !sound.on);
    btn.setAttribute('aria-pressed', String(sound.on));
    btn.setAttribute('aria-label', sound.on ? 'צליל פועל, לחצי להשתקה' : 'צליל כבוי, לחצי להפעלה');
  };
  onTap(btn, () => {
    sound.setOn(!sound.on);
    render();
    if (sound.on) sound.ding(); // רק בהפעלה, כדי לשמוע שהצליל חזר
  }, { gap: 700 });
  render();
  return btn;
}

// בחירה: נגד המחשב או נגד חבר/ה. שני כפתורים גדולים, הנבחר מסומן בבירור
function modePicker() {
  const row = h('div', { class: 'level-row' });
  const opts = [{ id: 'bot', name: '🤖 המחשב' }, { id: 'friend', name: '👥 חבר' }];
  const btns = opts.map((o) => {
    const b = h('button', { class: 'level-btn mode-btn' });
    onTap(b, () => { mode.set(o.id); render(); }, { gap: 600 });
    row.append(b);
    return [o, b];
  });
  function render() {
    const cur = mode.get();
    for (const [o, b] of btns) {
      b.textContent = (o.id === cur ? '✓ ' : '') + o.name;
      b.classList.toggle('on', o.id === cur);
      b.setAttribute('aria-pressed', String(o.id === cur));
    }
  }
  render();
  return h('div', { class: 'level-box' }, h('p', { class: 'level-title', text: 'משחקים נגד:' }), row);
}

// בחירת רמת קושי: שלושה כפתורים גדולים, הנבחר מסומן בבירור
function levelPicker() {
  const row = h('div', { class: 'level-row' });
  const btns = LEVELS.map((l) => {
    const b = h('button', { class: 'level-btn' });
    onTap(b, () => { level.set(l.id); render(); }, { gap: 600 });
    row.append(b);
    return [l, b];
  });
  function render() {
    const cur = level.get();
    for (const [l, b] of btns) {
      b.textContent = (l.id === cur ? '✓ ' : '') + l.name;
      b.classList.toggle('on', l.id === cur);
      b.setAttribute('aria-pressed', String(l.id === cur));
    }
  }
  render();
  return h('div', { class: 'level-box' }, h('p', { class: 'level-title', text: 'רמת קושי:' }), row);
}

function showHome() {
  clearTimers();
  if (inGame) { inGame = false; history.back(); }
  app.innerHTML = '';
  app.classList.remove('game-mode');
  const games = [
    { emoji: '❌⭕', name: 'איקס עיגול', desc: 'שלוש בשורה', start: startTicTacToe },
    { emoji: '🔴🟡', name: 'ארבע בשורה', desc: 'ארבע דיסקיות בשורה', start: startConnectFour },
    { emoji: '🃏', name: 'זיכרון', desc: 'למצוא זוגות', start: startMemory },
    { emoji: '🎨', name: 'סיימון', desc: 'לזכור צבעים ולשבור שיא', start: startSimon },
  ];
  const list = h('div', { class: 'game-list' });
  for (const g of games) {
    const card = h('button', { class: 'game-card' },
      h('span', { class: 'emoji', text: g.emoji }),
      h('span', {}, h('span', { class: 'name', text: g.name }), h('span', { class: 'desc', text: g.desc })),
    );
    onTap(card, g.start, { armDelay: 500 });
    list.append(card);
  }

  const s = store.get();
  let you = 0, bot = 0;
  Object.entries(s).forEach(([k, v]) => { if (k !== 'simon') { you += v.you; bot += v.bot; } });

  app.append(...[
    h('div', { class: 'topbar home-top' }, soundToggle()),
    h('h1', { class: 'home-title', text: 'המשחקים של סבתא' }),
    h('p', { class: 'home-sub', text: 'במה נשחק היום?' }),
    list,
    modePicker(),
    levelPicker(),
    (you || bot) ? h('p', { class: 'home-score', text: `ניצחונות שלך: ${you}  ·  ניצחונות המחשב: ${bot}` }) : null,
    h('p', { class: 'version', text: 'גרסה ' + (self.APP_VERSION || '') }),
  ].filter(Boolean));
  window.scrollTo(0, 0);
}

/* =========================================================
   משחק 1: איקס עיגול
   ========================================================= */

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

let tttYouStart = true;
let tttXStarts = true; // מול חבר/ה: מי מתחיל מתחלף בכל משחק

function startTicTacToe() {
  const friends = mode.friends();
  const ui = gameScreen('איקס עיגול', 'ttt', { friends });
  let turnMark = 'X'; // מול חבר/ה: של מי התור
  const board = Array(9).fill(null);
  let busy = true;
  let over = false;

  const grid = h('div', { class: 'ttt' });
  const cells = board.map((_, i) => {
    const c = h('button', { class: 'cell', 'aria-label': `משבצת ${i + 1}` });
    onTap(c, () => playerMove(i), { gap: 600 });
    grid.append(c);
    return c;
  });
  const chips = friends ? turnChips(
    ['שחקן ', h('b', { text: 'X', style: 'color:var(--green)' })],
    ['שחקן ', h('b', { text: 'O', style: 'color:var(--red)' })],
  ) : null;
  ui.body.append(
    friends ? chips.el : h('div', { class: 'scoreline' },
      h('span', {}, 'את: ', h('b', { class: 'x-mark', text: 'X', style: 'color:var(--green)' })),
      h('span', {}, 'המחשב: ', h('b', { text: 'O', style: 'color:var(--red)' })),
    ),
    fit(grid),
  );

  function friendPrompt() {
    chips.set(turnMark === 'X');
    ui.setStatus(`תור של ${turnMark}! לחצו על משבצת`, turnMark === 'X' ? 'you' : 'red');
  }

  function place(i, mark) {
    board[i] = mark;
    cells[i].append(h('span', { class: 'mark', text: mark }));
    cells[i].classList.add(mark.toLowerCase(), 'new');
    sound.tone(mark === 'X' ? 880 : 660, 160, 'triangle', 0.35);
  }

  function winner() {
    for (const l of LINES) {
      const [a, b, c] = l;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return { mark: board[a], line: l };
    }
    return board.every(Boolean) ? { mark: 'draw' } : null;
  }

  function checkEnd() {
    const w = winner();
    if (!w) return false;
    over = true;
    busy = true;
    if (w.line) w.line.forEach((i) => cells[i].classList.add('win'));
    if (!friends) tttYouStart = !tttYouStart; // בפעם הבאה מתחיל השני
    later(() => {
      if (friends) {
        if (w.mark === 'draw') ui.finish('תיקו! 🤝', null, startTicTacToe);
        else ui.finish(`🎉 ${w.mark} ניצח! כל הכבוד!`, 'you', startTicTacToe, { cls: w.mark === 'X' ? 'you' : 'red' });
        return;
      }
      if (w.mark === 'X') ui.finish('🎉 ניצחת! כל הכבוד!', 'you', startTicTacToe);
      else if (w.mark === 'O') ui.finish('המחשב ניצח הפעם 🙂', 'bot', startTicTacToe);
      else ui.finish('תיקו! 🤝', null, startTicTacToe);
    }, 700);
    return true;
  }

  function playerMove(i) {
    if (busy || over || board[i]) return;
    if (friends) {
      place(i, turnMark);
      if (checkEnd()) return;
      turnMark = turnMark === 'X' ? 'O' : 'X';
      friendPrompt();
      return;
    }
    place(i, 'X');
    if (checkEnd()) return;
    botTurn();
  }

  function botTurn() {
    busy = true;
    ui.setStatus('המחשב חושב… 🤔', 'bot');
    later(() => {
      place(botChoice(), 'O');
      if (checkEnd()) return;
      busy = false;
      ui.setStatus('תורך! לחצי על משבצת ריקה', 'you');
    }, 1100);
  }

  // מינימקס: המהלך הטוב ביותר (לרמה הקשה)
  function bestMove() {
    const score = (turn, depth) => {
      const w = winner();
      if (w) return w.mark === 'O' ? 10 - depth : w.mark === 'X' ? depth - 10 : 0;
      let best = turn === 'O' ? -Infinity : Infinity;
      for (let i = 0; i < 9; i++) {
        if (board[i]) continue;
        board[i] = turn;
        const v = score(turn === 'O' ? 'X' : 'O', depth + 1);
        board[i] = null;
        best = turn === 'O' ? Math.max(best, v) : Math.min(best, v);
      }
      return best;
    };
    let bestI = null, bestV = -Infinity;
    for (const i of shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8])) {
      if (board[i]) continue;
      board[i] = 'O';
      const v = score('X', 1);
      board[i] = null;
      if (v > bestV) { bestV = v; bestI = i; }
    }
    return bestI;
  }

  // הבוט לפי רמת הקושי
  function botChoice() {
    const lvl = level.get();
    if (lvl === 'hard' && Math.random() < 0.9) return bestMove();
    const odds = lvl === 'easy'
      ? { win: 0.85, block: 0.6, center: 0.4 }
      : { win: 1, block: 0.9, center: 0.7 };
    const free = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
    const finishing = (mark) => {
      for (const [a, b, c] of LINES) {
        const vals = [board[a], board[b], board[c]];
        if (vals.filter((v) => v === mark).length === 2 && vals.includes(null)) return [a, b, c][vals.indexOf(null)];
      }
      return null;
    };
    const win = finishing('O');
    if (win !== null && Math.random() < odds.win) return win;
    const block = finishing('X');
    if (block !== null && Math.random() < odds.block) return block;
    if (!board[4] && Math.random() < odds.center) return 4;
    return pick(free);
  }

  if (friends) {
    turnMark = tttXStarts ? 'X' : 'O';
    tttXStarts = !tttXStarts;
    busy = false;
    friendPrompt();
  } else if (tttYouStart) {
    busy = false;
    ui.setStatus('את מתחילה! לחצי על משבצת', 'you');
  } else {
    botTurn();
  }
}

/* =========================================================
   משחק 2: סיימון — משחק לבד: חוזרים על רצף שמתארך ומנסים לשבור שיא.
   רמת הקושי קובעת את המהירות.
   ========================================================= */

const PADS = [
  { cls: 'green',  name: 'ירוק',  freq: 784 },
  { cls: 'red',    name: 'אדום',  freq: 659 },
  { cls: 'yellow', name: 'צהוב',  freq: 523 },
  { cls: 'blue',   name: 'כחול',  freq: 1047 },
];

const SIMON_SPEED = {
  easy:   { on: 750, off: 420 },
  medium: { on: 520, off: 280 },
  hard:   { on: 360, off: 180 },
};

function startSimon() {
  const ui = gameScreen('סיימון', 'simon');
  const lvl = level.get();
  const speed = SIMON_SPEED[lvl];
  const bestKey = 'gg-simon-best-' + lvl;
  let best = 0;
  try { best = Number(localStorage.getItem(bestKey)) || 0; } catch { /* לא נורא */ }
  const seq = [];
  let input = [];
  let accepting = false;

  const grid = h('div', { class: 'simon' });
  const pads = PADS.map((p, i) => {
    const b = h('button', { class: `pad ${p.cls}`, text: p.name });
    onTap(b, () => playerPress(i), { gap: 250 });
    grid.append(b);
    return b;
  });
  const roundEl = h('div', { class: 'scoreline' });
  ui.body.append(roundEl, fit(grid));

  async function flash(i, ms = speed.on) {
    pads[i].classList.add('lit');
    sound.tone(PADS[i].freq, ms, 'triangle', 0.4);
    await wait(ms);
    pads[i].classList.remove('lit');
  }

  async function playSequence() {
    for (const i of seq) {
      await flash(i);
      await wait(speed.off);
    }
  }

  function showRound() {
    roundEl.innerHTML = '';
    roundEl.append(h('span', {}, 'שלב: ', h('b', { text: String(seq.length) })),
                   h('span', {}, 'השיא שלך: ', h('b', { text: String(best) })));
  }

  async function nextRound() {
    seq.push(rand(4));
    showRound();
    accepting = false;
    ui.setStatus('👀 הסתכלי טוב…', 'bot');
    await wait(1100);
    await playSequence();
    input = [];
    accepting = true;
    ui.setStatus('תורך! לחצי על הצבעים באותו סדר', 'you');
  }

  function playerPress(i) {
    if (!accepting) return;
    flash(i, 400);
    input.push(i);
    const pos = input.length - 1;
    if (input[pos] !== seq[pos]) {
      accepting = false;
      later(async () => {
        ui.setStatus('אופס… זה היה הרצף הנכון:', 'bot');
        await wait(900);
        await playSequence();
        gameOver();
      }, 500);
      return;
    }
    if (input.length === seq.length) {
      accepting = false;
      later(async () => {
        ui.setStatus('👏 נכון! מוסיפים עוד צבע…', 'you');
        await wait(1300);
        nextRound();
      }, 600);
    }
  }

  function gameOver() {
    const done = seq.length - 1;
    const colors = done === 1 ? 'צבע אחד' : `${done} צבעים`;
    if (done > best) {
      try { localStorage.setItem(bestKey, String(done)); } catch { /* לא נורא */ }
      best = done;
      showRound();
      ui.finish(`🏆 שיא חדש! זכרת ${colors}`, 'you', startSimon, { count: false });
    } else if (done > 0) {
      ui.finish(`כל הכבוד! זכרת ${colors} ברצף`, null, startSimon, { count: false });
    } else {
      ui.finish('לא נורא, ננסה שוב? 🙂', null, startSimon, { count: false });
    }
  }

  nextRound();
}

/* =========================================================
   משחק 4: ארבע בשורה — מול המחשב.
   לחיצה ראשונה על טור מסמנת אותו, לחיצה שנייה על אותו טור מפילה דיסקית.
   ========================================================= */

const C4_ROWS = 6;
const C4_COLS = 7;
const C4_ORDER = [3, 2, 4, 1, 5, 0, 6]; // מהמרכז החוצה
const C4_DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const YOU = 1;
const BOT = 2;

let c4YouStart = true;
let c4YellowStarts = true; // מול חבר/ה: מי מתחיל מתחלף בכל משחק

function c4Land(b, c) {
  for (let r = C4_ROWS - 1; r >= 0; r--) if (!b[r][c]) return r;
  return -1;
}
function c4Valid(b) { return C4_ORDER.filter((c) => !b[0][c]); }

// מחזיר את ארבע המשבצות המנצחות (או null)
function c4FindWin(b, onlyP) {
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const p = b[r][c];
      if (!p || (onlyP && p !== onlyP)) continue;
      for (const [dr, dc] of C4_DIRS) {
        const er = r + 3 * dr, ec = c + 3 * dc;
        if (er < 0 || er >= C4_ROWS || ec < 0 || ec >= C4_COLS) continue;
        if (b[r + dr][c + dc] === p && b[r + 2 * dr][c + 2 * dc] === p && b[er][ec] === p) {
          return [0, 1, 2, 3].map((k) => [r + k * dr, c + k * dc]);
        }
      }
    }
  }
  return null;
}

function c4WinsWith(b, c, p) {
  const r = c4Land(b, c);
  if (r < 0) return false;
  b[r][c] = p;
  const w = !!c4FindWin(b, p);
  b[r][c] = 0;
  return w;
}

// האם המהלך מאפשר ליריב לנצח מיד מעליו?
function c4GivesAway(b, c) {
  const r = c4Land(b, c);
  b[r][c] = BOT;
  const bad = r > 0 && c4WinsWith(b, c, YOU);
  b[r][c] = 0;
  return bad;
}

function c4Weighted(cols) {
  const weights = cols.map((c) => 4 - Math.abs(c - 3));
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cols.length; i++) { x -= weights[i]; if (x <= 0) return cols[i]; }
  return cols[cols.length - 1];
}

// הערכת לוח מנקודת המבט של המחשב
function c4Score(b) {
  let score = 0;
  for (let r = 0; r < C4_ROWS; r++) {
    if (b[r][3] === BOT) score += 3; else if (b[r][3] === YOU) score -= 3;
  }
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      for (const [dr, dc] of C4_DIRS) {
        const er = r + 3 * dr, ec = c + 3 * dc;
        if (er < 0 || er >= C4_ROWS || ec < 0 || ec >= C4_COLS) continue;
        let bot = 0, you = 0;
        for (let k = 0; k < 4; k++) {
          const v = b[r + k * dr][c + k * dc];
          if (v === BOT) bot++; else if (v === YOU) you++;
        }
        if (bot && you) continue;
        if (bot === 3) score += 6; else if (bot === 2) score += 2;
        if (you === 3) score -= 8; else if (you === 2) score -= 2;
      }
    }
  }
  return score;
}

function c4Negamax(b, depth, alpha, beta, p) {
  if (c4FindWin(b, 3 - p)) return -100000 - depth; // השחקן הקודם ניצח
  const moves = c4Valid(b);
  if (!moves.length) return 0;
  if (depth === 0) return p === BOT ? c4Score(b) : -c4Score(b);
  let best = -Infinity;
  for (const c of moves) {
    const r = c4Land(b, c);
    b[r][c] = p;
    const v = -c4Negamax(b, depth - 1, -beta, -alpha, 3 - p);
    b[r][c] = 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function c4Choose(b, lvl) {
  const moves = c4Valid(b);
  const win = moves.find((c) => c4WinsWith(b, c, BOT));
  const block = moves.find((c) => c4WinsWith(b, c, YOU));

  if (lvl === 'easy') {
    if (win !== undefined && Math.random() < 0.8) return win;
    if (block !== undefined && Math.random() < 0.5) return block;
    return c4Weighted(moves);
  }
  if (lvl === 'medium') {
    if (win !== undefined) return win;
    if (block !== undefined && Math.random() < 0.9) return block;
    const safe = moves.filter((c) => !c4GivesAway(b, c));
    return c4Weighted(safe.length ? safe : moves);
  }
  // קשה: חושב כמה מהלכים קדימה
  if (win !== undefined) return win;
  if (block !== undefined) return block;
  let bestCol = moves[0], bestVal = -Infinity;
  for (const c of moves) {
    const r = c4Land(b, c);
    b[r][c] = BOT;
    const v = -c4Negamax(b, 5, -Infinity, Infinity, YOU);
    b[r][c] = 0;
    if (v > bestVal) { bestVal = v; bestCol = c; }
  }
  return bestCol;
}

function startConnectFour() {
  const friends = mode.friends();
  const ui = gameScreen('ארבע בשורה', 'c4', { friends });
  const lvl = level.get();
  let turnP = YOU; // מול חבר/ה: של מי התור (YOU = צהוב, BOT = אדום)
  const pName = (p) => (p === YOU ? 'הצהוב 🟡' : 'האדום 🔴');
  const pCls = (p) => (p === YOU ? 'yellow' : 'red');
  const board = Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(0));
  let busy = true;
  let over = false;
  let selected = null;

  const grid = h('div', { class: 'c4' });
  const cols = [];
  const cells = Array.from({ length: C4_ROWS }, () => []);
  for (let c = 0; c < C4_COLS; c++) {
    const col = h('button', { class: 'c4-col', 'aria-label': `טור ${c + 1}` });
    for (let r = 0; r < C4_ROWS; r++) {
      const d = h('span', { class: 'c4-cell' });
      col.append(d);
      cells[r][c] = d;
    }
    onTap(col, () => playerTap(c), { gap: 450 });
    grid.append(col);
    cols.push(col);
  }
  const chips = friends ? turnChips(
    ['צהוב ', h('span', { class: 'disc you' })],
    ['אדום ', h('span', { class: 'disc bot' })],
  ) : null;
  ui.body.append(
    friends ? chips.el : h('div', { class: 'scoreline' },
      h('span', {}, 'את: ', h('span', { class: 'disc you' })),
      h('span', {}, 'המחשב: ', h('span', { class: 'disc bot' })),
    ),
    fit(grid),
  );

  function friendPrompt() {
    chips.set(turnP === YOU);
    ui.setStatus(`תור ${pName(turnP)}! לחצו על טור`, pCls(turnP));
  }

  function render() {
    const ghostRow = selected === null ? -1 : c4Land(board, selected);
    for (let r = 0; r < C4_ROWS; r++) {
      for (let c = 0; c < C4_COLS; c++) {
        const v = board[r][c];
        const keep = cells[r][c].classList.contains('win') ? ' win' : '';
        cells[r][c].className = 'c4-cell' + (v === YOU ? ' you' : v === BOT ? ' bot' : '') +
          (c === selected && r === ghostRow ? ' ghost' + (friends && turnP === BOT ? ' ghost-red' : '') : '') + keep;
      }
    }
    cols.forEach((col, c) => col.classList.toggle('selected', c === selected));
  }

  function drop(c, p) {
    const r = c4Land(board, c);
    board[r][c] = p;
    render();
    cells[r][c].classList.add('drop');
    sound.tone(p === YOU ? 880 : 660, 160, 'triangle', 0.35);
  }

  function playerTap(c) {
    if (busy || over) return;
    if (c4Land(board, c) < 0) {
      ui.setStatus(friends ? 'הטור הזה מלא, בחרו טור אחר' : 'הטור הזה מלא, בחרי טור אחר', friends ? pCls(turnP) : 'you');
      return;
    }
    if (selected !== c) {
      selected = c;
      sound.click();
      render();
      ui.setStatus(friends ? 'לחצו שוב על אותו טור כדי להפיל' : 'לחצי שוב על אותו טור כדי להפיל', friends ? pCls(turnP) : 'you');
      return;
    }
    selected = null;
    if (friends) {
      drop(c, turnP);
      if (checkEnd()) return;
      turnP = 3 - turnP;
      friendPrompt();
      return;
    }
    drop(c, YOU);
    if (checkEnd()) return;
    botTurn();
  }

  function checkEnd() {
    const w = c4FindWin(board);
    const full = board[0].every(Boolean);
    if (!w && !full) return false;
    over = true;
    busy = true;
    if (w) w.forEach(([r, c]) => cells[r][c].classList.add('win'));
    if (!friends) c4YouStart = !c4YouStart;
    const winner = w ? board[w[0][0]][w[0][1]] : 0;
    later(() => {
      if (friends) {
        if (!winner) ui.finish('תיקו! 🤝', null, startConnectFour);
        else ui.finish(`🎉 ${pName(winner)} ניצח!`, 'you', startConnectFour, { cls: pCls(winner) });
        return;
      }
      if (winner === YOU) ui.finish('🎉 ניצחת! כל הכבוד!', 'you', startConnectFour);
      else if (winner === BOT) ui.finish('המחשב ניצח הפעם 🙂', 'bot', startConnectFour);
      else ui.finish('תיקו! 🤝', null, startConnectFour);
    }, 900);
    return true;
  }

  function botTurn() {
    busy = true;
    ui.setStatus('המחשב חושב… 🤔', 'bot');
    later(() => {
      drop(c4Choose(board, lvl), BOT);
      if (checkEnd()) return;
      busy = false;
      ui.setStatus('תורך! לחצי על טור', 'you');
    }, 1100);
  }

  render();
  if (friends) {
    turnP = c4YellowStarts ? YOU : BOT;
    c4YellowStarts = !c4YellowStarts;
    busy = false;
    friendPrompt();
  } else if (c4YouStart) {
    busy = false;
    ui.setStatus('את מתחילה! לחצי על טור', 'you');
  } else {
    botTurn();
  }
}

/* =========================================================
   משחק 3: זיכרון — לסירוגין מול המחשב.
   מי שמוצא זוג — ממשיך. מי שמצא יותר זוגות — מנצח.
   ========================================================= */

const SYMBOLS = ['🍎', '🌸', '🐱', '🐶', '🌞', '🚗', '🐟', '🌳', '⭐', '🍌'];
// מספר הזוגות והעמודות לפי רמת הקושי
const MEMORY_SIZE = {
  easy:   { pairs: 6,  cols: 3 }, // 12 קלפים
  medium: { pairs: 8,  cols: 4 }, // 16 קלפים
  hard:   { pairs: 10, cols: 4 }, // 20 קלפים
};

let memGreenStarts = true; // מול חבר/ה: מי מתחיל מתחלף בכל משחק

function startMemory() {
  const friends = mode.friends();
  const ui = gameScreen('זיכרון', 'memory', { friends, showLevel: true });
  // מול חבר/ה: 'you' = הירוק, 'bot' = הכחול (אותם צבעים של הזוגות שנמצאו)
  const pName = (t) => (t === 'you' ? '🟢 הירוק' : '🔵 הכחול');
  const size = MEMORY_SIZE[level.get()];
  const symbols = SYMBOLS.slice(0, size.pairs);
  const deck = shuffle([...symbols, ...symbols]);
  const state = deck.map(() => 'closed'); // closed | open | you | bot
  const botMemory = new Map(); // אינדקס -> סמל (זיכרון לא מושלם)
  // כמה טוב המחשב זוכר, ובאיזה סיכוי הוא "מתבלבל"
  const brain = { easy: { mem: 0.45, slip: 0.3 }, medium: { mem: 0.7, slip: 0.1 }, hard: { mem: 0.95, slip: 0 } }[level.get()];
  let opened = [];
  let turn = 'you';
  let busy = false;
  const score = { you: 0, bot: 0 };

  const scoreEl = h('div', { class: 'scoreline' });
  const rows = (size.pairs * 2) / size.cols;
  const grid = h('div', {
    class: 'memory',
    style: `--cols:${size.cols};--rows:${rows};--gap:${size.cols === 3 ? 14 : 10}px`,
  });
  const cards = deck.map((_, i) => {
    const c = h('button', { class: 'mcard', 'aria-label': `קלף ${i + 1}` });
    onTap(c, () => { if ((friends || turn === 'you') && !busy) flip(i); }, { gap: 500 });
    grid.append(c);
    return c;
  });
  ui.body.append(scoreEl, fit(grid));

  function render() {
    cards.forEach((c, i) => {
      const s = state[i];
      c.className = 'mcard' + (s === 'open' ? ' open' : s === 'you' ? ' found-you' : s === 'bot' ? ' found-bot' : '');
      c.innerHTML = '';
      if (s === 'closed') c.append(h('span', { class: 'back', text: '❓' }));
      else c.append(h('span', { class: 'face', text: deck[i] }));
    });
    scoreEl.innerHTML = '';
    if (friends) {
      scoreEl.className = 'scoreline chips';
      scoreEl.append(
        h('span', { class: 'chip' + (turn === 'you' ? ' active' : '') }, '🟢 ירוק: ', h('b', { text: String(score.you) })),
        h('span', { class: 'chip' + (turn === 'bot' ? ' active' : '') }, '🔵 כחול: ', h('b', { text: String(score.bot) })),
      );
      return;
    }
    scoreEl.append(h('span', {}, 'זוגות שלך: ', h('b', { text: String(score.you) })),
                   h('span', {}, 'המחשב: ', h('b', { text: String(score.bot) })));
  }

  function remember(i) {
    if (Math.random() < brain.mem) botMemory.set(i, deck[i]);
  }

  function flip(i) {
    if (state[i] !== 'closed' || opened.length >= 2) return;
    state[i] = 'open';
    opened.push(i);
    sound.click();
    remember(i);
    render();
    if (opened.length === 2) {
      busy = true;
      later(checkPair, 900);
    } else if (friends) {
      ui.setStatus(`${pName(turn)}: הפכו עוד קלף`, turn);
    } else if (turn === 'you') {
      ui.setStatus('יופי! עכשיו הפכי קלף נוסף', 'you');
    }
  }

  function checkPair() {
    const [a, b] = opened;
    opened = [];
    if (deck[a] === deck[b]) {
      state[a] = state[b] = turn;
      botMemory.delete(a); botMemory.delete(b);
      score[turn]++;
      sound.tone(784, 250);
      render();
      if (state.every((s) => s === 'you' || s === 'bot')) return endGame();
      if (friends) {
        ui.setStatus(`🎉 ${pName(turn)} מצא זוג! עוד תור`, turn);
        busy = false;
      } else if (turn === 'you') {
        ui.setStatus('🎉 מצאת זוג! עוד תור בשבילך', 'you');
        busy = false;
      } else {
        ui.setStatus('המחשב מצא זוג וממשיך…', 'bot');
        later(botTurn, 1300);
      }
    } else {
      // נותנים זמן לראות את הקלפים לפני שהם נסגרים
      ui.setStatus(friends || turn === 'you' ? 'לא זוג. נסגור אותם…' : 'המחשב לא מצא זוג', turn);
      later(() => {
        state[a] = state[b] = 'closed';
        if (friends) {
          turn = turn === 'you' ? 'bot' : 'you';
          render();
          busy = false;
          ui.setStatus(`תור ${pName(turn)}! הפכו קלף`, turn);
          return;
        }
        render();
        if (turn === 'you') {
          turn = 'bot';
          later(botTurn, 600);
        } else {
          turn = 'you';
          busy = false;
          ui.setStatus('תורך! הפכי קלף', 'you');
        }
      }, 1800);
    }
  }

  function botTurn() {
    busy = true;
    ui.setStatus('תור המחשב… 🤔', 'bot');
    const closed = state.map((s, i) => (s === 'closed' ? i : null)).filter((v) => v !== null);
    // האם המחשב זוכר זוג שלם?
    let first = null, second = null;
    const known = [...botMemory.entries()].filter(([i]) => state[i] === 'closed');
    for (let x = 0; x < known.length && first === null; x++) {
      for (let y = x + 1; y < known.length; y++) {
        if (known[x][1] === known[y][1]) { first = known[x][0]; second = known[y][0]; break; }
      }
    }
    if (first === null || Math.random() < brain.slip) {
      const unknown = closed.filter((i) => !botMemory.has(i));
      first = pick(unknown.length ? unknown : closed);
      second = null;
    }
    later(() => {
      flip(first);
      later(() => {
        if (second === null) {
          const match = [...botMemory.entries()].find(([i, s]) => i !== first && state[i] === 'closed' && s === deck[first]);
          const rest = state.map((s, i) => (s === 'closed' ? i : null)).filter((v) => v !== null);
          second = match ? match[0] : pick(rest);
        }
        flip(second);
      }, 1100);
    }, 1000);
  }

  function endGame() {
    later(() => {
      if (friends) {
        const g = score.you, b = score.bot;
        if (g === b) ui.finish('תיקו! 🤝', null, startMemory);
        else {
          const w = g > b ? 'you' : 'bot';
          ui.finish(`🎉 ${pName(w)} ניצח! ${Math.max(g, b)} זוגות מול ${Math.min(g, b)}`, 'you', startMemory, { cls: w });
        }
        return;
      }
      if (score.you > score.bot) ui.finish(`🎉 ניצחת! ${score.you} זוגות מול ${score.bot}`, 'you', startMemory);
      else if (score.bot > score.you) ui.finish(`המחשב ניצח הפעם, ${score.bot} מול ${score.you} 🙂`, 'bot', startMemory);
      else ui.finish('תיקו! 🤝', null, startMemory);
    }, 600);
  }

  if (friends) {
    turn = memGreenStarts ? 'you' : 'bot';
    memGreenStarts = !memGreenStarts;
    render();
    ui.setStatus(`תור ${pName(turn)}! הפכו קלף`, turn);
  } else {
    render();
    ui.setStatus('תורך! הפכי קלף', 'you');
  }
}

/* =========================================================
   הפעלה
   ========================================================= */

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

showHome();
