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

/* ---------- צלילים ---------- */
const sound = {
  ctx: null,
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
  },
  tone(freq, ms = 300, type = 'sine', vol = 0.25) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + ms / 1000 + 0.05);
  },
  click() { this.tone(520, 120, 'triangle', 0.18); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 260), i * 170)); },
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 320, 'triangle'), i * 220)); },
  draw() { [440, 440].forEach((f, i) => setTimeout(() => this.tone(f, 220), i * 260)); },
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

function gameScreen(title, gameId) {
  clearTimers();
  if (!inGame) history.pushState({ game: true }, '');
  inGame = true;
  app.innerHTML = '';
  const back = h('button', { class: 'big-btn light back-btn', text: '🏠 חזרה לתפריט' });
  onTap(back, askExit);
  const status = h('div', { class: 'status' });
  const body = h('div', { class: 'game-body' });
  const footer = h('div');
  app.append(h('div', { class: 'topbar' }, back), h('h1', { class: 'game-title', text: title }), status, body, footer);

  return {
    body,
    setStatus(text, who) {
      status.textContent = text;
      status.className = 'status' + (who ? ' ' + who : '');
    },
    // מסך סיום עם "לשחק שוב"
    finish(text, who, restart) {
      if (who === 'you') { sound.win(); store.win(gameId, 'you'); }
      else if (who === 'bot') { sound.lose(); store.win(gameId, 'bot'); }
      else sound.draw();
      this.setStatus(text, who === 'you' ? 'you' : who === 'bot' ? 'bot' : '');
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

// כפתור צליל גדול: מראה את המצב הנוכחי בבירור
function soundToggle() {
  const btn = h('button', { class: 'big-btn sound-btn' });
  const render = () => {
    btn.textContent = sound.on ? '🔊 צליל: פועל' : '🔇 צליל: כבוי';
    btn.classList.toggle('off', !sound.on);
    btn.setAttribute('aria-pressed', String(sound.on));
  };
  onTap(btn, () => {
    sound.setOn(!sound.on);
    render();
    sound.click(); // נשמע רק כשמדליקים
  }, { gap: 700 });
  render();
  return btn;
}

function showHome() {
  clearTimers();
  if (inGame) { inGame = false; history.back(); }
  app.innerHTML = '';
  const games = [
    { emoji: '❌⭕', name: 'איקס עיגול', desc: 'שלוש בשורה', start: startTicTacToe },
    { emoji: '🎨', name: 'סיימון', desc: 'לזכור את הצבעים', start: startSimon },
    { emoji: '🃏', name: 'זיכרון', desc: 'למצוא זוגות', start: startMemory },
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
  Object.values(s).forEach((v) => { you += v.you; bot += v.bot; });

  app.append(...[
    h('h1', { class: 'home-title', text: 'המשחקים של סבתא' }),
    h('p', { class: 'home-sub', text: 'במה נשחק היום?' }),
    list,
    soundToggle(),
    (you || bot) ? h('p', { class: 'home-score', text: `ניצחונות שלך: ${you}  ·  ניצחונות המחשב: ${bot}` }) : null,
  ].filter(Boolean));
  window.scrollTo(0, 0);
}

/* =========================================================
   משחק 1: איקס עיגול
   ========================================================= */

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

let tttYouStart = true;

function startTicTacToe() {
  const ui = gameScreen('איקס עיגול', 'ttt');
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
  ui.body.append(
    h('div', { class: 'scoreline' },
      h('span', {}, 'את: ', h('b', { class: 'x-mark', text: 'X', style: 'color:var(--green)' })),
      h('span', {}, 'המחשב: ', h('b', { text: 'O', style: 'color:var(--red)' })),
    ),
    grid,
  );

  function place(i, mark) {
    board[i] = mark;
    cells[i].textContent = mark;
    cells[i].classList.add(mark.toLowerCase(), 'new');
    sound.tone(mark === 'X' ? 600 : 400, 150, 'triangle', 0.2);
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
    tttYouStart = !tttYouStart; // בפעם הבאה מתחיל השני
    later(() => {
      if (w.mark === 'X') ui.finish('🎉 ניצחת! כל הכבוד!', 'you', startTicTacToe);
      else if (w.mark === 'O') ui.finish('המחשב ניצח הפעם 🙂', 'bot', startTicTacToe);
      else ui.finish('תיקו! 🤝', null, startTicTacToe);
    }, 700);
    return true;
  }

  function playerMove(i) {
    if (busy || over || board[i]) return;
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

  // בוט לא חכם מדי: לפעמים מפספס
  function botChoice() {
    const free = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
    const finishing = (mark) => {
      for (const [a, b, c] of LINES) {
        const vals = [board[a], board[b], board[c]];
        if (vals.filter((v) => v === mark).length === 2 && vals.includes(null)) return [a, b, c][vals.indexOf(null)];
      }
      return null;
    };
    const win = finishing('O');
    if (win !== null && Math.random() < 0.85) return win;
    const block = finishing('X');
    if (block !== null && Math.random() < 0.6) return block;
    if (!board[4] && Math.random() < 0.4) return 4;
    return pick(free);
  }

  if (tttYouStart) {
    busy = false;
    ui.setStatus('את מתחילה! לחצי על משבצת', 'you');
  } else {
    botTurn();
  }
}

/* =========================================================
   משחק 2: סיימון — את והמחשב חוזרים על אותו רצף.
   מי שטועה ראשון — מפסיד.
   ========================================================= */

const PADS = [
  { cls: 'green',  name: 'ירוק',  freq: 392 },
  { cls: 'red',    name: 'אדום',  freq: 330 },
  { cls: 'yellow', name: 'צהוב',  freq: 262 },
  { cls: 'blue',   name: 'כחול',  freq: 523 },
];

function startSimon() {
  const ui = gameScreen('סיימון', 'simon');
  const seq = [];
  let input = [];
  let accepting = false;

  const grid = h('div', { class: 'simon' });
  const pads = PADS.map((p, i) => {
    const b = h('button', { class: `pad ${p.cls}`, text: p.name });
    onTap(b, () => playerPress(i), { gap: 300 });
    grid.append(b);
    return b;
  });
  const roundEl = h('div', { class: 'scoreline' });
  ui.body.append(roundEl, grid);

  async function flash(i, ms = 650) {
    pads[i].classList.add('lit');
    sound.tone(PADS[i].freq, ms, 'sine', 0.3);
    await wait(ms);
    pads[i].classList.remove('lit');
  }

  async function playSequence() {
    for (const i of seq) {
      await flash(i);
      await wait(350);
    }
  }

  async function nextRound() {
    seq.push(rand(4));
    roundEl.innerHTML = '';
    roundEl.append(h('span', {}, 'שלב: ', h('b', { text: String(seq.length) })),
                   h('span', {}, 'צבעים לזכור: ', h('b', { text: String(seq.length) })));
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
        ui.finish('המחשב ניצח הפעם 🙂', 'bot', startSimon);
      }, 500);
      return;
    }
    if (input.length === seq.length) {
      accepting = false;
      later(() => botTurn(), 700);
    }
  }

  async function botTurn() {
    ui.setStatus('👏 נכון! עכשיו תור המחשב…', 'bot');
    await wait(1300);
    // הסיכוי של המחשב לטעות גדל ככל שהרצף ארוך יותר
    const errChance = Math.min(0.6, Math.max(0, (seq.length - 2) * 0.13));
    const willFail = Math.random() < errChance;
    const failAt = willFail ? rand(seq.length) : -1;
    for (let k = 0; k < seq.length; k++) {
      if (k === failAt) {
        let wrong;
        do { wrong = rand(4); } while (wrong === seq[k]);
        await flash(wrong, 500);
        await wait(400);
        ui.finish('🎉 המחשב טעה — ניצחת!', 'you', startSimon);
        return;
      }
      await flash(seq[k], 500);
      await wait(300);
    }
    ui.setStatus('המחשב הצליח. ממשיכים — הרצף מתארך!', 'bot');
    await wait(1400);
    nextRound();
  }

  nextRound();
}

/* =========================================================
   משחק 3: זיכרון — לסירוגין מול המחשב.
   מי שמוצא זוג — ממשיך. מי שמצא יותר זוגות — מנצח.
   ========================================================= */

const SYMBOLS = ['🍎', '🌸', '🐱', '🐶', '🌞', '🚗'];

function startMemory() {
  const ui = gameScreen('זיכרון', 'memory');
  const deck = shuffle([...SYMBOLS, ...SYMBOLS]);
  const state = deck.map(() => 'closed'); // closed | open | you | bot
  const botMemory = new Map(); // אינדקס -> סמל (זיכרון לא מושלם)
  let opened = [];
  let turn = 'you';
  let busy = false;
  const score = { you: 0, bot: 0 };

  const scoreEl = h('div', { class: 'scoreline' });
  const grid = h('div', { class: 'memory' });
  const cards = deck.map((_, i) => {
    const c = h('button', { class: 'mcard', 'aria-label': `קלף ${i + 1}` });
    onTap(c, () => { if (turn === 'you' && !busy) flip(i); }, { gap: 500 });
    grid.append(c);
    return c;
  });
  ui.body.append(scoreEl, grid);

  function render() {
    cards.forEach((c, i) => {
      const s = state[i];
      c.className = 'mcard' + (s === 'open' ? ' open' : s === 'you' ? ' found-you' : s === 'bot' ? ' found-bot' : '');
      c.innerHTML = '';
      if (s === 'closed') c.append(h('span', { class: 'back', text: '❓' }));
      else c.textContent = deck[i];
    });
    scoreEl.innerHTML = '';
    scoreEl.append(h('span', {}, 'זוגות שלך: ', h('b', { text: String(score.you) })),
                   h('span', {}, 'המחשב: ', h('b', { text: String(score.bot) })));
  }

  function remember(i) {
    if (Math.random() < 0.45) botMemory.set(i, deck[i]);
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
      if (turn === 'you') {
        ui.setStatus('🎉 מצאת זוג! עוד תור בשבילך', 'you');
        busy = false;
      } else {
        ui.setStatus('המחשב מצא זוג וממשיך…', 'bot');
        later(botTurn, 1300);
      }
    } else {
      // נותנים זמן לראות את הקלפים לפני שהם נסגרים
      ui.setStatus(turn === 'you' ? 'לא זוג. נסגור אותם…' : 'המחשב לא מצא זוג', turn);
      later(() => {
        state[a] = state[b] = 'closed';
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
    if (first === null || Math.random() < 0.3) {
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
      if (score.you > score.bot) ui.finish(`🎉 ניצחת! ${score.you} זוגות מול ${score.bot}`, 'you', startMemory);
      else if (score.bot > score.you) ui.finish(`המחשב ניצח הפעם, ${score.bot} מול ${score.you} 🙂`, 'bot', startMemory);
      else ui.finish('תיקו! 🤝', null, startMemory);
    }, 600);
  }

  render();
  ui.setStatus('תורך! הפכי קלף', 'you');
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
