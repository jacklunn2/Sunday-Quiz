/* The Sunday Quiz — application logic.
   Quiz content lives in /quizzes as JSON. Nothing in this file needs to change
   to publish a new quiz: add a file and a manifest entry (see README.md).

   Format: each question has a written answer. The player reveals it with a
   button, then marks themselves right or wrong. */
(() => {
  'use strict';

  const SITE_NAME = 'The Sunday Quiz';
  const SITE_URL = '';               // Set once the site has a public address; added to shared results.
  const TIME_ZONE = 'Australia/Sydney';
  const SECONDS_PER_QUESTION = 20;   // Used only for the "about N minutes" estimate.

  const app = document.getElementById('app');
  const main = document.getElementById('main');
  let manifest = null;
  const quizCache = new Map();
  let ctx = null;                    // { quiz, state } while a quiz is on screen

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function todayISO() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
  const toUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  function formatDate(iso, withYear = true) {
    const opts = { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' };
    if (withYear) opts.year = 'numeric';
    return new Intl.DateTimeFormat('en-AU', opts).format(toUTC(iso)).replace(/,/g, '');
  }
  function nextSundayISO() {
    const d = toUTC(todayISO());
    d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));   // On a Sunday this is the following Sunday.
    return d.toISOString().slice(0, 10);
  }
  const minutesFor = (n) => Math.max(1, Math.round((n * SECONDS_PER_QUESTION) / 60));

  /* ---------- saved progress (per browser; falls back to memory) ----------
     marks[i] is true (got it), false (missed it) or null (not marked yet). */
  const memory = {};
  const KEY = 'sq2:';
  const store = {
    get(id) {
      try { const v = JSON.parse(localStorage.getItem(KEY + id)); if (v) return v; } catch (e) { /* ignore */ }
      return memory[id] || null;
    },
    set(id, value) {
      memory[id] = value;
      try { localStorage.setItem(KEY + id, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
    clear(id) {
      delete memory[id];
      try { localStorage.removeItem(KEY + id); } catch (e) { /* ignore */ }
    },
  };
  function stateFor(quiz) {
    const n = quiz.questions.length;
    const s = store.get(quiz.id);
    if (s && Array.isArray(s.marks) && s.marks.length === n && Array.isArray(s.revealed) && s.revealed.length === n) {
      return { marks: s.marks, revealed: s.revealed, submitted: !!s.submitted };
    }
    return { marks: new Array(n).fill(null), revealed: new Array(n).fill(false), submitted: false };
  }
  const scoreOf = (state) => state.marks.filter((m) => m === true).length;
  const markedCount = (state) => state.marks.filter((m) => m !== null).length;
  const started = (state) => state.revealed.some(Boolean);

  /* ---------- data ---------- */
  async function getJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return res.json();
  }
  async function loadManifest() {
    if (manifest) return manifest;
    const data = await getJSON('quizzes/index.json');
    const today = todayISO();
    // Quizzes dated in the future stay hidden, so next Sunday's can be uploaded early.
    manifest = (data.quizzes || [])
      .filter((q) => q.id && q.date && q.date <= today)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return manifest;
  }
  async function loadQuiz(id) {
    if (quizCache.has(id)) return quizCache.get(id);
    const list = await loadManifest();
    if (!list.some((q) => q.id === id)) throw new Error('not-found');
    const quiz = await getJSON(`quizzes/${id}.json`);
    const ok = Array.isArray(quiz.questions) && quiz.questions.length > 0 &&
      quiz.questions.every((q) => q.question && q.answer);
    if (!ok) throw new Error('This quiz file has a formatting problem.');
    quizCache.set(id, quiz);
    return quiz;
  }

  /* ---------- shared pieces ---------- */
  const sampleTag = (q) => (q.sample ? '<span class="tag">Sample quiz</span>' : '');

  function statusFor(entry) {
    const s = store.get(entry.id);
    if (s && s.submitted) return { href: `#results-${entry.id}`, label: `You scored ${scoreOf(s)}/${entry.questionCount}`, cls: '' };
    if (s && started(s)) return { href: `#quiz-${entry.id}`, label: `In progress, ${markedCount(s)} of ${entry.questionCount}`, cls: '' };
    return { href: `#quiz-${entry.id}`, label: 'Not played', cls: 'is-new' };
  }
  function quizRow(entry) {
    const s = statusFor(entry);
    return `<li><a class="row" href="${s.href}">
      <span class="row-num shout blk c${(Number(entry.number) || 0) % 3}" aria-hidden="true">${esc(entry.number)}</span>
      <span class="row-main">
        <span class="row-date"><span>No. ${esc(entry.number)}</span><span>${esc(formatDate(entry.date))}</span><span>${esc(entry.questionCount)} questions</span>${sampleTag(entry)}</span>
        <h3 class="shout">${esc(entry.title)}</h3>
        ${entry.blurb ? `<p>${esc(entry.blurb)}</p>` : ''}
      </span>
      <span class="row-status ${s.cls}">${esc(s.label)}</span>
    </a></li>`;
  }

  // Rounds: a quiz of 20 or more questions, in tens, is split into rounds of ten.
  // The three rounds are the same every week. Questions 1-10 belong to the
  // first, 11-20 to the second and 21-30 to the third.
  const ROUND_NAMES = ['Australia', 'The World', 'Sport & Culture'];
  const roundName = (r, rounds) => (rounds === ROUND_NAMES.length ? ROUND_NAMES[r] : `Round ${r + 1}`);
  const ROUND = 10;
  const roundsOf = (n) => (n >= 20 && n % ROUND === 0 ? n / ROUND : 1);
  const colourOf = (i, n) => `c${roundsOf(n) > 1 ? Math.floor(i / ROUND) % 3 : 0}`;

  /* ---------- views ---------- */
  async function viewHome() {
    const list = await loadManifest();
    if (!list.length) {
      app.innerHTML = `<div class="view"><p class="empty">The first quiz is on its way. It lands on ${esc(formatDate(nextSundayISO()))}.</p></div>`;
      return;
    }
    const latest = list[0];
    const s = statusFor(latest);
    const saved = store.get(latest.id);
    const cta = saved && saved.submitted ? `See your result: ${scoreOf(saved)}/${latest.questionCount}`
      : saved && started(saved) ? `Continue, ${markedCount(saved)} of ${latest.questionCount} marked`
      : 'Start the quiz';
    const earlier = list.slice(1, 4);
    const isToday = latest.date === todayISO();
    const quiz = await loadQuiz(latest.id).catch(() => null);
    const qs = quiz ? quiz.questions : [];
    const picks = (qs.length > 20 ? [0, 10, 20] : [0, 1, 2]).filter((i) => i < qs.length);
    const cats = qs.length > 20 ? ROUND_NAMES.concat(ROUND_NAMES) : [...new Set(qs.map((q) => q.category).filter(Boolean))];
    const run = cats.map((c) => `${esc(c)}<i>✺</i>`).join('');
    app.innerHTML = `<div class="view">
      <section class="lead blk c0" aria-labelledby="lead-title">
        <p class="stamp" aria-hidden="true">${isToday ? 'Out<br>today' : 'This<br>week'}</p>
        <div class="lead-body">
          <p class="eyebrow">${isToday ? 'Out today' : 'This week'} · ${esc(formatDate(latest.date))}</p>
          <h1 class="shout" id="lead-title">${esc(latest.title)}</h1>
          ${latest.blurb ? `<p class="lead-blurb">${esc(latest.blurb)}</p>` : ''}
          <a class="btn" href="${s.href}">${esc(cta)}</a>
          <p class="meta"><span>${esc(latest.questionCount)} questions</span><span>About ${minutesFor(latest.questionCount)} minutes</span><span>Free, no sign-up</span>${sampleTag(latest)}</p>
        </div>
        <p class="issue shout" aria-label="Quiz number ${esc(latest.number)}"><small aria-hidden="true">No.</small><span aria-hidden="true">${esc(latest.number)}</span></p>
      </section>

      ${cats.length ? `<div class="ticker" aria-hidden="true"><div class="ticker-track"><span>${run}</span><span>${run}</span></div></div>
      <p class="sr">Three rounds: ${esc(ROUND_NAMES.join(', '))}.</p>` : ''}

      ${picks.length ? `<section aria-labelledby="taste-title">
        <div class="section-head"><h2 class="shout" id="taste-title">Three to get you started</h2><a href="${s.href}">Play all ${esc(latest.questionCount)}</a></div>
        <div class="teasers">
          ${picks.map((i, k) => `<a class="teaser blk c${k}" href="${s.href}">
            <span class="teaser-num shout" aria-hidden="true">${i + 1}<small>?</small></span>
            <span class="eyebrow">${esc(qs.length > 20 ? roundName(k, 3) : (qs[i].category || ''))}</span>
            <span class="teaser-q"><span class="sr">Question ${i + 1}. </span>${esc(qs[i].question)}</span>
          </a>`).join('')}
        </div>
      </section>` : ''}

      <section class="steps slab" aria-labelledby="steps-title">
        <h2 class="shout" id="steps-title">How it works</h2>
        <ol>
          <li><span class="step-num shout" aria-hidden="true">1</span><h3>Have a think</h3><p>Three rounds of ten: Australia, The World, then Sport and Culture. Settle on an answer, on your own or out loud with the table.</p></li>
          <li><span class="step-num shout" aria-hidden="true">2</span><h3>Show the answer</h3><p>Tap the button. Every answer comes with a short explanation, so you learn something either way.</p></li>
          <li><span class="step-num shout" aria-hidden="true">3</span><h3>Mark yourself</h3><p>Got it or missed it. Your score adds up as you go, so be honest.</p></li>
        </ol>
        <p>A new quiz lands every Sunday. The next one is due on ${esc(formatDate(nextSundayISO(), false))}.</p>
      </section>

      ${earlier.length ? `<section aria-labelledby="earlier-title">
        <div class="section-head"><h2 class="shout" id="earlier-title">Earlier quizzes</h2><a href="#archive">See the full archive</a></div>
        <ol class="rows">${earlier.map(quizRow).join('')}</ol>
      </section>` : ''}
    </div>`;
  }

  async function viewArchive() {
    const list = await loadManifest();
    app.innerHTML = `<div class="view">
      <section aria-labelledby="archive-title">
        <h1 class="page-title shout" id="archive-title">Archive</h1>
        <p class="page-intro">Every quiz published so far, newest first. Your scores are kept in this browser only.</p>
      </section>
      ${list.length ? `<ol class="rows">${list.map(quizRow).join('')}</ol>` : '<p class="empty">Nothing has been published yet.</p>'}
    </div>`;
  }

  function answerBlock(q, i, state) {
    const m = state.marks[i];
    return `<div class="answer" id="a-${i}" tabindex="-1">
      <p class="answer-text"><span class="sr">Answer: </span>${esc(q.answer)}</p>
      ${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}
      <div class="marks" role="group" aria-label="Mark question ${i + 1}">
        <button type="button" class="mark-btn" data-action="mark" data-i="${i}" data-v="1" aria-pressed="${m === true}">✓ Got it</button>
        <button type="button" class="mark-btn" data-action="mark" data-i="${i}" data-v="0" aria-pressed="${m === false}">✗ Missed it</button>
      </div>
    </div>`;
  }

  async function viewQuiz(id) {
    const quiz = await loadQuiz(id);
    const state = stateFor(quiz);
    if (state.submitted) { location.replace(`#results-${id}`); return; }
    ctx = { quiz, state };
    const n = quiz.questions.length;
    const rounds = roundsOf(n);
    const item = (q, i) => `<li class="item" id="q-${i}">
      <span class="item-num shout" aria-hidden="true">${i + 1}</span>
      <div class="item-body">
        ${q.category ? `<p class="eyebrow q-cat">${esc(q.category)}</p>` : ''}
        <h3 class="item-q"><span class="sr">Question ${i + 1}. </span>${esc(q.question)}</h3>
        ${state.revealed[i] ? answerBlock(q, i, state)
          : `<button type="button" class="btn btn-quiet btn-small" data-action="reveal" data-i="${i}">Show answer<span class="sr"> to question ${i + 1}</span></button>`}
      </div>
    </li>`;
    let body = '';
    for (let r = 0; r < rounds; r++) {
      const from = rounds > 1 ? r * ROUND : 0;
      const to = rounds > 1 ? from + ROUND : n;
      body += `<section class="round c${r % 3} ${rounds > 1 ? 'has-head' : ''}" ${rounds > 1 ? `aria-labelledby="round-${r}"` : 'aria-label="Questions"'}>
        ${rounds > 1 ? `<header class="round-head blk"><h2 class="shout" id="round-${r}">${esc(roundName(r, rounds))}</h2><p>Round ${r + 1} · Questions ${from + 1} to ${to}</p></header>` : ''}
        <ol class="items" start="${from + 1}">${quiz.questions.slice(from, to).map((q, k) => item(q, from + k)).join('')}</ol>
      </section>`;
    }
    app.innerHTML = `<div class="narrow">
      <header class="quiz-head">
        <p class="eyebrow">No. ${esc(quiz.number)} · ${esc(formatDate(quiz.date))} ${sampleTag(quiz)}</p>
        <h1 class="shout">${esc(quiz.title)}</h1>
        <p>${n} questions${rounds === 3 ? `: ten on ${ROUND_NAMES[0]}, ten on ${ROUND_NAMES[1]} and ten on ${ROUND_NAMES[2]}` : ''}. Decide on your answer, reveal it, then mark yourself.</p>
      </header>
      ${body}
      <div id="finish-notice"></div>
      <div class="tally slab">
        <p aria-live="polite"><strong id="tally-score"></strong><span id="tally-marked"></span></p>
        <button type="button" class="btn btn-small" data-action="finish">Finish quiz</button>
      </div>
    </div>`;
    updateTally();
  }

  function updateTally() {
    const { quiz, state } = ctx;
    const n = quiz.questions.length;
    document.getElementById('tally-score').textContent = `${scoreOf(state)} correct`;
    document.getElementById('tally-marked').textContent = `${markedCount(state)} of ${n} marked`;
  }

  function reveal(i, button) {
    const { quiz, state } = ctx;
    state.revealed[i] = true;
    store.set(quiz.id, state);
    button.insertAdjacentHTML('afterend', answerBlock(quiz.questions[i], i, state));
    button.remove();
    document.getElementById(`a-${i}`).focus({ preventScroll: true });
  }
  function mark(i, value) {
    const { quiz, state } = ctx;
    state.marks[i] = state.marks[i] === value ? null : value;   // Pressing the same button again clears the mark.
    store.set(quiz.id, state);
    document.querySelectorAll(`#a-${i} .mark-btn`).forEach((b) => {
      b.setAttribute('aria-pressed', String(state.marks[i] === (b.dataset.v === '1')));
    });
    document.getElementById('finish-notice').innerHTML = '';
    updateTally();
  }
  function finish() {
    const { quiz, state } = ctx;
    const missing = state.marks.map((m, k) => (m === null ? k : -1)).filter((k) => k >= 0);
    if (!missing.length) { submit(); return; }
    const box = document.getElementById('finish-notice');
    box.innerHTML = `<div class="notice" role="alert">
      <p>${missing.length === 1 ? `Question ${missing[0] + 1} is not marked yet.` : `${missing.length} questions are not marked yet.`} Unmarked questions count as missed.</p>
      <div class="actions">
        <button type="button" class="btn" data-action="jump" data-i="${missing[0]}">Go to question ${missing[0] + 1}</button>
        <button type="button" class="btn btn-quiet" data-action="submit">Finish anyway</button>
      </div>
    </div>`;
    box.querySelector('.btn').focus();
    void quiz;
  }
  function submit() {
    const { quiz, state } = ctx;
    state.submitted = true;
    store.set(quiz.id, state);
    location.hash = `#results-${quiz.id}`;
  }

  function verdictFor(pct) {
    if (pct === 100) return 'A perfect score. Nothing got past you.';
    if (pct >= 80) return 'Excellent. You would be carrying the table at trivia night.';
    if (pct >= 60) return 'A solid round, with a few that got away.';
    if (pct >= 40) return 'Respectable. There is room to move next Sunday.';
    return 'A tough week. The answers below are worth a read.';
  }
  function shareText(quiz, state) {
    const n = quiz.questions.length;
    const score = scoreOf(state);
    const cells = state.marks.map((m) => (m === true ? '■' : '□'));
    const rows = [];
    for (let i = 0; i < cells.length; i += 10) rows.push(cells.slice(i, i + 10).join(''));
    return [`${SITE_NAME} No. ${quiz.number}`, `${score}/${n} (${Math.round((score / n) * 100)}%)`, ...rows, SITE_URL].filter(Boolean).join('\n');
  }

  function gradeFor(pct) {
    if (pct === 100) return 'Flaw&shy;less';
    if (pct >= 80) return 'Sharp';
    if (pct >= 60) return 'Solid';
    if (pct >= 40) return 'Fair<br>go';
    return 'Tough<br>week';
  }

  async function viewResults(id) {
    const quiz = await loadQuiz(id);
    const state = stateFor(quiz);
    if (!state.submitted) { location.replace(`#quiz-${id}`); return; }
    ctx = { quiz, state };
    const n = quiz.questions.length;
    const rounds = roundsOf(n);
    const score = scoreOf(state);
    const pct = Math.round((score / n) * 100);
    const list = await loadManifest();
    const other = list.find((e) => e.id !== id && !(store.get(e.id) || {}).submitted);
    const roundScore = (r) => state.marks.slice(r * ROUND, (r + 1) * ROUND).filter((m) => m === true).length;
    app.innerHTML = `<div class="narrow">
      <section class="score blk c0" aria-labelledby="score-title">
        <p class="stamp" aria-hidden="true">${gradeFor(pct)}</p>
        <p class="eyebrow">Your result · No. ${esc(quiz.number)} · ${esc(formatDate(quiz.date))}</p>
        <p class="score-figure shout" aria-hidden="true">${score}<small>/${n}</small></p>
        <h1 id="score-title" tabindex="-1">You scored ${score} out of ${n}, or ${pct} per cent. ${esc(verdictFor(pct))}</h1>
        <div class="actions">
          <button type="button" class="btn" data-action="share" id="share-btn">Share your score</button>
          <button type="button" class="btn btn-quiet" data-action="retake">Play again</button>
        </div>
        <p class="meta" id="share-msg" role="status"></p>
      </section>

      ${rounds > 1 ? `<ol class="round-scores" aria-label="Score by round">
        ${Array.from({ length: rounds }, (_, r) => `<li class="blk c${r % 3}"><span class="eyebrow">${esc(roundName(r, rounds))}</span><b class="shout">${roundScore(r)}/${ROUND}</b></li>`).join('')}
      </ol>` : ''}

      <section aria-labelledby="review-title">
        <div class="section-head"><h2 class="shout" id="review-title">The answers</h2></div>
        <ol class="review">
          ${quiz.questions.map((q, i) => {
            const m = state.marks[i];
            const badge = m === true ? '<span class="mark good">✓ Got it</span>'
              : m === false ? '<span class="mark bad">✗ Missed it</span>'
              : '<span class="mark bad">Not marked</span>';
            return `<li class="${colourOf(i, n)}">
              <span class="review-num shout" aria-hidden="true">${i + 1}</span>
              <div class="review-body">
                ${q.category ? `<p class="eyebrow q-cat">${esc(q.category)}</p>` : ''}
                <h3><span class="sr">Question ${i + 1}. </span>${esc(q.question)}</h3>
                <p class="verdict"><span class="answer-text">${esc(q.answer)}</span><span>${badge}</span></p>
                ${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}
              </div>
            </li>`;
          }).join('')}
        </ol>
      </section>

      <section class="next slab" aria-labelledby="next-title">
        <h2 class="shout" id="next-title">Back next Sunday</h2>
        <p>The next quiz is published on ${esc(formatDate(nextSundayISO()))}.</p>
        <div class="actions">
          ${other ? `<a class="btn" href="#quiz-${esc(other.id)}">Play No. ${esc(other.number)} while you wait</a>` : ''}
          <a class="btn" href="#archive">Browse the archive</a>
        </div>
      </section>
    </div>`;
  }

  async function share() {
    const text = shareText(ctx.quiz, ctx.state);
    const msg = document.getElementById('share-msg');
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      msg.textContent = 'Copied. Paste it into a message to share.';
    } catch (e) {
      msg.innerHTML = '<span>Copy the text below to share it.</span>';
      let box = document.getElementById('share-out');
      if (!box) {
        box = document.createElement('textarea');
        box.id = 'share-out'; box.className = 'share-out'; box.readOnly = true; box.rows = 5;
        box.setAttribute('aria-label', 'Your result as text');
        msg.after(box);
      }
      box.value = text; box.focus(); box.select();
    }
  }

  function viewError(err) {
    const notFound = err && err.message === 'not-found';
    app.innerHTML = `<div class="view"><section>
      <h1 class="page-title shout">${notFound ? 'That quiz does not exist' : 'The quiz could not be loaded'}</h1>
      <p class="page-intro">${notFound ? 'It may not have been published yet.' : 'Check your connection and try again.'}</p>
      <p class="actions" style="margin-top:1.25rem">
        ${notFound ? '' : '<button type="button" class="btn" data-action="reload">Try again</button>'}
        <a class="btn btn-quiet" href="#home">Go to this week\'s quiz</a>
      </p>
    </section></div>`;
    if (!notFound) console.error(err);
  }

  /* ---------- routing ---------- */
  async function route() {
    const hash = location.hash.replace(/^#/, '');
    ctx = null;
    let nav = 'home';
    try {
      if (hash.startsWith('quiz-')) { nav = ''; await viewQuiz(hash.slice(5)); }
      else if (hash.startsWith('results-')) { nav = ''; await viewResults(hash.slice(8)); }
      else if (hash === 'archive') { nav = 'archive'; await viewArchive(); }
      else await viewHome();
    } catch (err) { viewError(err); }
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const nextLine = document.getElementById('next-line');
    if (nextLine) nextLine.textContent = `Next quiz: ${formatDate(nextSundayISO(), false)}.`;
    window.scrollTo(0, 0);
    if (route.started) main.focus({ preventScroll: true });
    route.started = true;
  }

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'reload') { manifest = null; route(); return; }
    if (!ctx) return;
    const i = Number(el.dataset.i);
    if (action === 'reveal') reveal(i, el);
    else if (action === 'mark') mark(i, el.dataset.v === '1');
    else if (action === 'finish') finish();
    else if (action === 'jump') {
      const item = document.getElementById(`q-${i}`);
      item.scrollIntoView({ block: 'start' });
      (item.querySelector('[data-action]') || item).focus({ preventScroll: true });
    }
    else if (action === 'submit') submit();
    else if (action === 'share') share();
    else if (action === 'retake') { store.clear(ctx.quiz.id); location.hash = `#quiz-${ctx.quiz.id}`; }
  });

  window.addEventListener('hashchange', route);
  route();
})();
