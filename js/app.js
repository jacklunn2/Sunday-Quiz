/* The Sunday Quiz — application logic.
   Quiz content lives in /quizzes as JSON. Nothing in this file needs to change
   to publish a new quiz: add a file and a manifest entry (see README.md). */
(() => {
  'use strict';

  const SITE_NAME = 'The Sunday Quiz';
  const SITE_URL = '';               // Set once the site has a public address; added to shared results.
  const TIME_ZONE = 'Australia/Sydney';
  const SECONDS_PER_QUESTION = 25;   // Used only for the "about N minutes" estimate.

  const app = document.getElementById('app');
  const main = document.getElementById('main');
  let manifest = null;
  const quizCache = new Map();
  let ctx = null;                    // { quiz, state } while a quiz is on screen

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LETTERS = 'ABCDEFGH';

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

  /* ---------- saved progress (per browser; falls back to memory) ---------- */
  const memory = {};
  const store = {
    get(id) {
      try { const v = JSON.parse(localStorage.getItem('sq:' + id)); if (v) return v; } catch (e) { /* ignore */ }
      return memory[id] || null;
    },
    set(id, value) {
      memory[id] = value;
      try { localStorage.setItem('sq:' + id, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
    clear(id) {
      delete memory[id];
      try { localStorage.removeItem('sq:' + id); } catch (e) { /* ignore */ }
    },
  };
  function stateFor(quiz) {
    const n = quiz.questions.length;
    const saved = store.get(quiz.id);
    if (saved && Array.isArray(saved.answers) && saved.answers.length === n) {
      return { answers: saved.answers, current: Math.min(Math.max(saved.current | 0, 0), n - 1), submitted: !!saved.submitted };
    }
    return { answers: new Array(n).fill(null), current: 0, submitted: false };
  }
  const scoreOf = (quiz, state) => quiz.questions.reduce((t, q, i) => t + (state.answers[i] === q.answer ? 1 : 0), 0);
  const answeredCount = (state) => state.answers.filter((a) => a !== null).length;

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
    const ok = Array.isArray(quiz.questions) && quiz.questions.length > 0 && quiz.questions.every((q) =>
      q.question && Array.isArray(q.options) && q.options.length >= 2 &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
    if (!ok) throw new Error('This quiz file has a formatting problem.');
    quizCache.set(id, quiz);
    return quiz;
  }

  /* ---------- shared pieces ---------- */
  const sampleTag = (q) => (q.sample ? '<span class="tag">Sample quiz</span>' : '');

  function statusFor(entry) {
    const saved = store.get(entry.id);
    if (saved && saved.submitted && quizCache.has(entry.id)) {
      return { href: `#results-${entry.id}`, label: `You scored ${scoreOf(quizCache.get(entry.id), saved)}/${entry.questionCount}`, cls: '' };
    }
    if (saved && saved.submitted) return { href: `#results-${entry.id}`, label: 'Completed', cls: '' };
    if (saved && answeredCount(saved) > 0) {
      return { href: `#quiz-${entry.id}`, label: `In progress, ${answeredCount(saved)} of ${entry.questionCount}`, cls: '' };
    }
    return { href: `#quiz-${entry.id}`, label: 'Not played', cls: 'is-new' };
  }
  function quizRow(entry) {
    const s = statusFor(entry);
    return `<li><a class="row" href="${s.href}">
      <span class="row-num"><small>No.</small>${esc(entry.number)}</span>
      <span class="row-main">
        <span class="row-date"><span>${esc(formatDate(entry.date))}</span><span>${esc(entry.questionCount)} questions</span>${sampleTag(entry)}</span>
        <h3>${esc(entry.title)}</h3>
        ${entry.blurb ? `<p>${esc(entry.blurb)}</p>` : ''}
      </span>
      <span class="row-status ${s.cls}">${esc(s.label)}</span>
    </a></li>`;
  }
  // Scores in rows need the quiz file; fetch quietly for anything already completed.
  async function warmCompleted(list) {
    await Promise.all(list.filter((e) => { const s = store.get(e.id); return s && s.submitted; })
      .map((e) => loadQuiz(e.id).catch(() => null)));
  }

  /* ---------- views ---------- */
  async function viewHome() {
    const list = await loadManifest();
    if (!list.length) {
      app.innerHTML = `<div class="view"><p class="empty">The first quiz is on its way. It lands on ${esc(formatDate(nextSundayISO()))}.</p></div>`;
      return;
    }
    await warmCompleted(list);
    const latest = list[0];
    const s = statusFor(latest);
    const saved = store.get(latest.id);
    const cta = saved && saved.submitted ? `See your result${quizCache.has(latest.id) ? `: ${scoreOf(quizCache.get(latest.id), saved)}/${latest.questionCount}` : ''}`
      : saved && answeredCount(saved) > 0 ? `Continue, ${answeredCount(saved)} of ${latest.questionCount} answered`
      : 'Start the quiz';
    const earlier = list.slice(1, 4);
    const isToday = latest.date === todayISO();
    app.innerHTML = `<div class="view">
      <section class="lead on-accent" aria-labelledby="lead-title">
        <div class="lead-body">
          <p class="eyebrow">${isToday ? 'Out today' : 'This week'} · ${esc(formatDate(latest.date))}</p>
          <h1 id="lead-title">${esc(latest.title)}</h1>
          ${latest.blurb ? `<p class="lead-blurb">${esc(latest.blurb)}</p>` : ''}
          <a class="btn" href="${s.href}">${esc(cta)}</a>
          <p class="meta"><span>${esc(latest.questionCount)} questions</span><span>About ${minutesFor(latest.questionCount)} minutes</span><span>Free, no sign-up</span>${sampleTag(latest)}</p>
        </div>
        <p class="issue" aria-label="Quiz number ${esc(latest.number)}"><small aria-hidden="true">No.</small><span aria-hidden="true">${esc(latest.number)}</span></p>
      </section>

      <section class="premise" aria-label="How it works">
        <div><h2>One quiz, every Sunday</h2><p>A new set of questions is published each Sunday. The next one is due on ${esc(formatDate(nextSundayISO(), false))}.</p></div>
        <div><h2>Written for Australians</h2><p>History, geography, sport, science and culture from here, mixed with general knowledge from everywhere else.</p></div>
        <div><h2>Answers worth reading</h2><p>Every answer comes with a short explanation and its source, so you finish knowing a little more than when you started.</p></div>
      </section>

      ${earlier.length ? `<section aria-labelledby="earlier-title">
        <div class="section-head"><h2 id="earlier-title">Earlier quizzes</h2><a href="#archive">See the full archive</a></div>
        <ol class="rows">${earlier.map(quizRow).join('')}</ol>
      </section>` : ''}
    </div>`;
  }

  async function viewArchive() {
    const list = await loadManifest();
    await warmCompleted(list);
    app.innerHTML = `<div class="view">
      <section aria-labelledby="archive-title">
        <h1 class="page-title" id="archive-title">Archive</h1>
        <p class="page-intro">Every quiz published so far, newest first. Your scores are kept in this browser only.</p>
      </section>
      ${list.length ? `<ol class="rows">${list.map(quizRow).join('')}</ol>` : '<p class="empty">Nothing has been published yet.</p>'}
    </div>`;
  }

  async function viewQuiz(id) {
    const quiz = await loadQuiz(id);
    const state = stateFor(quiz);
    if (state.submitted) { location.replace(`#results-${id}`); return; }
    ctx = { quiz, state, confirming: false };
    const n = quiz.questions.length;
    app.innerHTML = `<div class="narrow">
      <header class="quiz-head">
        <p class="eyebrow">No. ${esc(quiz.number)} · ${esc(formatDate(quiz.date))} ${sampleTag(quiz)}</p>
        <h1>${esc(quiz.title)}</h1>
      </header>
      <nav class="progress" aria-label="Questions">
        <ol>${quiz.questions.map((_, i) => `<li><button type="button" class="seg" data-action="goto" data-i="${i}"></button></li>`).join('')}</ol>
        <p class="progress-text"><span id="progress-pos"></span><span id="progress-done"></span></p>
      </nav>
      <div id="question"></div>
    </div>`;
    renderQuestion(false);
    void n;
  }

  function updateProgress() {
    const { quiz, state } = ctx;
    const n = quiz.questions.length;
    app.querySelectorAll('.seg').forEach((seg, i) => {
      const done = state.answers[i] !== null;
      seg.classList.toggle('is-answered', done);
      if (i === state.current) seg.setAttribute('aria-current', 'step'); else seg.removeAttribute('aria-current');
      seg.setAttribute('aria-label', `Question ${i + 1}, ${done ? 'answered' : 'not answered'}`);
    });
    document.getElementById('progress-pos').textContent = `Question ${state.current + 1} of ${n}`;
    document.getElementById('progress-done').textContent = `${answeredCount(state)} answered`;
  }

  function renderQuestion(moveFocus = true) {
    const { quiz, state } = ctx;
    const n = quiz.questions.length;
    const i = state.current;
    const q = quiz.questions[i];
    const last = i === n - 1;
    const missing = state.answers.map((a, k) => (a === null ? k : -1)).filter((k) => k >= 0);
    const confirm = ctx.confirming && missing.length
      ? `<div class="notice" role="alert">
          <p>${missing.length === 1 ? `Question ${missing[0] + 1} has no answer yet.` : `${missing.length} questions have no answer yet: ${missing.map((k) => k + 1).join(', ')}.`} Unanswered questions are marked wrong.</p>
          <div class="actions">
            <button type="button" class="btn" data-action="goto" data-i="${missing[0]}">Go to question ${missing[0] + 1}</button>
            <button type="button" class="btn btn-quiet" data-action="submit">Finish anyway</button>
          </div>
        </div>` : '';
    document.getElementById('question').innerHTML = `<div class="q">
      <div class="q-top">
        <p class="q-num" aria-hidden="true">${i + 1}<small>/${n}</small></p>
        ${q.category ? `<p class="eyebrow q-cat">${esc(q.category)}</p>` : ''}
      </div>
      <h2 class="q-text" id="q-text" tabindex="-1"><span class="skip" style="position:absolute;left:-999px">Question ${i + 1} of ${n}. </span>${esc(q.question)}</h2>
      <div class="options" role="radiogroup" aria-labelledby="q-text">
        ${q.options.map((opt, k) => `<label class="option" for="opt-${k}">
          <input type="radio" name="answer" id="opt-${k}" value="${k}" ${state.answers[i] === k ? 'checked' : ''}>
          <span class="option-key" aria-hidden="true">${LETTERS[k]}</span>
          <span class="option-text">${esc(opt)}</span>
        </label>`).join('')}
      </div>
      ${confirm}
      <div class="q-nav">
        ${i > 0 ? '<button type="button" class="btn btn-quiet" data-action="prev">Back</button>' : ''}
        ${last ? '<button type="button" class="btn" data-action="finish">Finish and see results</button>'
               : '<button type="button" class="btn" data-action="next">Next question</button>'}
      </div>
      <p class="hint">You can change any answer before you finish. Answers are revealed at the end.</p>
    </div>`;
    updateProgress();
    if (moveFocus) {
      document.getElementById('q-text').focus({ preventScroll: true });
      main.scrollIntoView({ block: 'start' });
    }
  }

  function goTo(i) {
    const { quiz, state } = ctx;
    state.current = Math.min(Math.max(i, 0), quiz.questions.length - 1);
    ctx.confirming = false;
    store.set(quiz.id, state);
    renderQuestion();
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
    return 'A tough week. The explanations below are worth a read.';
  }
  function shareText(quiz, state) {
    const n = quiz.questions.length;
    const score = scoreOf(quiz, state);
    const grid = quiz.questions.map((q, i) => (state.answers[i] === q.answer ? '■' : '□')).join('');
    return [`${SITE_NAME} No. ${quiz.number}`, `${score}/${n} (${Math.round((score / n) * 100)}%)`, grid, SITE_URL].filter(Boolean).join('\n');
  }

  async function viewResults(id) {
    const quiz = await loadQuiz(id);
    const state = stateFor(quiz);
    if (!state.submitted) { location.replace(`#quiz-${id}`); return; }
    ctx = { quiz, state };
    const n = quiz.questions.length;
    const score = scoreOf(quiz, state);
    const pct = Math.round((score / n) * 100);
    const list = await loadManifest();
    const other = list.find((e) => e.id !== id && !(store.get(e.id) || {}).submitted);
    app.innerHTML = `<div class="narrow">
      <section class="score on-accent" aria-labelledby="score-title">
        <p class="eyebrow">Your result · No. ${esc(quiz.number)} · ${esc(formatDate(quiz.date))}</p>
        <p class="score-figure" aria-hidden="true">${score}<small>/${n}</small></p>
        <h1 id="score-title" tabindex="-1">You scored ${score} out of ${n}, or ${pct} per cent. ${esc(verdictFor(pct))}</h1>
        <div class="actions">
          <button type="button" class="btn" data-action="share" id="share-btn">Share your score</button>
          <button type="button" class="btn btn-quiet" data-action="retake">Play again</button>
        </div>
        <p class="meta" id="share-msg" role="status"></p>
      </section>

      <section aria-labelledby="review-title">
        <div class="section-head"><h2 id="review-title">The answers</h2></div>
        <ol class="review">
          ${quiz.questions.map((q, i) => {
            const a = state.answers[i];
            const right = a === q.answer;
            return `<li>
              <span class="review-num" aria-hidden="true">${i + 1}</span>
              <div class="review-body">
                ${q.category ? `<p class="eyebrow q-cat">${esc(q.category)}</p>` : ''}
                <h3><span class="skip" style="position:absolute;left:-999px">Question ${i + 1}. </span>${esc(q.question)}</h3>
                <div class="verdict">
                  ${right
                    ? `<p><span class="mark good">✓ Correct</span> ${esc(q.options[a])}</p>`
                    : `<p><span class="mark bad">✗ ${a === null ? 'Not answered' : 'Your answer'}</span> ${a === null ? '' : esc(q.options[a])}</p>
                       <p><span class="mark good">Correct answer</span> ${esc(q.options[q.answer])}</p>`}
                </div>
                ${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}
                ${q.source ? `<p class="source">Source: ${esc(q.source)}</p>` : ''}
              </div>
            </li>`;
          }).join('')}
        </ol>
      </section>

      <section class="next" aria-labelledby="next-title">
        <h2 id="next-title">Back next Sunday</h2>
        <p>The next quiz is published on ${esc(formatDate(nextSundayISO()))}.</p>
        <div class="actions">
          ${other ? `<a class="btn" href="#quiz-${esc(other.id)}">Play No. ${esc(other.number)} while you wait</a>` : ''}
          <a class="btn btn-quiet" href="#archive">Browse the archive</a>
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
        box.id = 'share-out'; box.className = 'share-out'; box.readOnly = true; box.rows = 3;
        box.setAttribute('aria-label', 'Your result as text');
        msg.after(box);
      }
      box.value = text; box.focus(); box.select();
    }
  }

  function viewError(err) {
    const notFound = err && err.message === 'not-found';
    app.innerHTML = `<div class="view"><section>
      <h1 class="page-title">${notFound ? 'That quiz does not exist' : 'The quiz could not be loaded'}</h1>
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
    if (action === 'goto') goTo(Number(el.dataset.i));
    else if (action === 'prev') goTo(ctx.state.current - 1);
    else if (action === 'next') goTo(ctx.state.current + 1);
    else if (action === 'finish') {
      if (answeredCount(ctx.state) < ctx.quiz.questions.length) {
        ctx.confirming = true; renderQuestion(false);
        app.querySelector('.notice .btn').focus();
      } else submit();
    }
    else if (action === 'submit') submit();
    else if (action === 'share') share();
    else if (action === 'retake') { store.clear(ctx.quiz.id); location.hash = `#quiz-${ctx.quiz.id}`; }
  });

  app.addEventListener('change', (e) => {
    if (!ctx || e.target.name !== 'answer') return;
    ctx.state.answers[ctx.state.current] = Number(e.target.value);
    store.set(ctx.quiz.id, ctx.state);
    if (ctx.confirming) { ctx.confirming = false; renderQuestion(false); document.getElementById(e.target.id).focus(); }
    else updateProgress();
  });

  // Keyboard shortcut: 1-4 or A-D picks an answer.
  document.addEventListener('keydown', (e) => {
    if (!ctx || ctx.state.submitted || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(textarea|select)$/i.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    let k = '1234'.indexOf(key);
    if (k < 0) k = 'abcd'.indexOf(key);
    if (k < 0 || key.length !== 1) return;
    const input = document.getElementById(`opt-${k}`);
    if (input) { input.checked = true; input.focus(); input.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  window.addEventListener('hashchange', route);
  route();
})();
