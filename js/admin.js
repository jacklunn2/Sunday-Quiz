/* The Sunday Quiz — editor.
   Write a quiz in three rounds of ten, preview it, and publish it to the site.
   Drafts are kept in this browser. Publishing writes two files to the GitHub
   repository (the quiz itself and the list of quizzes) using a personal access
   key that is stored only in this browser. GitHub Pages then rebuilds the site. */
(() => {
  'use strict';

  const ROUND_NAMES = ['Australia', 'The World', 'Sport & Culture'];   // Keep in step with js/app.js
  const PER_ROUND = 10;
  const TOTAL = ROUND_NAMES.length * PER_ROUND;
  const TIME_ZONE = 'Australia/Sydney';
  const DEFAULTS = { owner: 'jacklunn2', repo: 'Sunday-Quiz', branch: 'main', token: '' };
  const FIELDS = ['category', 'question', 'answer', 'explanation', 'source'];

  const root = document.getElementById('admin');
  let manifest = [];
  let current = null;          // the draft open in the editor
  let confirming = false;
  let saveTimer = null;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const toUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const validISO = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && !Number.isNaN(toUTC(iso).getTime());
  const isSunday = (iso) => validISO(iso) && toUTC(iso).getUTCDay() === 0;
  const addDays = (iso, n) => { const d = toUTC(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function sundayOnOrAfter(iso) { let d = iso; while (!isSunday(d)) d = addDays(d, 1); return d; }
  function formatDate(iso) {
    if (!validISO(iso)) return 'no date set';
    return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toUTC(iso)).replace(/,/g, '');
  }
  const timeNow = () => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' }).format(new Date());
  const roundOf = (i) => Math.floor(i / PER_ROUND);

  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  /* ---------- browser storage ---------- */
  const ls = {
    get(k, fallback) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  let settings = { ...DEFAULTS, ...ls.get('sqe:settings', {}) };
  let drafts = ls.get('sqe:drafts', {});
  const saveSettings = () => ls.set('sqe:settings', settings);
  const saveDrafts = () => ls.set('sqe:drafts', drafts);

  /* ---------- GitHub ---------- */
  class PublishError extends Error {}
  function gh(path, opts = {}) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(`https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/${path}`, { ...opts, headers });
  }
  function explain(status) {
    const where = `${settings.owner}/${settings.repo}`;
    if (status === 401) return 'GitHub rejected the access key. It may have expired, or been copied with a character missing. Paste a fresh one under Publishing access.';
    if (status === 403) return `The access key is not allowed to change files in ${where}. It needs "Contents: Read and write" permission.`;
    if (status === 404) return `GitHub could not find ${where} using this key. Check the repository name, and that the key was given access to it.`;
    if (status === 409 || status === 422) return 'The files changed on GitHub while you were publishing. Press Publish again.';
    return `GitHub returned an unexpected error (${status}). Wait a minute and try again.`;
  }
  async function getFile(path) {
    const res = await gh(`contents/${path}?ref=${encodeURIComponent(settings.branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new PublishError(explain(res.status));
    const data = await res.json();
    return { sha: data.sha, text: b64decode(data.content) };
  }
  async function putFile(path, text, sha, message) {
    const body = { message, content: b64encode(text), branch: settings.branch };
    if (sha) body.sha = sha;
    const res = await gh(`contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!res.ok) throw new PublishError(explain(res.status));
    return res.json();
  }

  /* ---------- reading the quiz list ---------- */
  async function readJSON(path) {
    if (settings.token) {
      const f = await getFile(path);
      return f ? JSON.parse(f.text) : null;
    }
    const res = await fetch(path, { cache: 'no-cache' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load ${path}`);
    return res.json();
  }
  async function loadManifest() {
    const data = await readJSON('quizzes/index.json');
    manifest = ((data && data.quizzes) || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /* ---------- drafts ---------- */
  const blankQuestion = () => ({ category: '', question: '', answer: '', explanation: '', source: '' });
  function newDraft() {
    const maxNo = manifest.reduce((m, q) => Math.max(m, Number(q.number) || 0), 0);
    const latest = manifest[0] ? manifest[0].date : null;
    const start = latest && latest >= todayISO() ? addDays(latest, 1) : todayISO();
    const d = {
      key: `new-${Date.now()}`, originalId: null, number: maxNo + 1, date: sundayOnOrAfter(start),
      title: '', blurb: '', questions: Array.from({ length: TOTAL }, blankQuestion), updated: Date.now(),
    };
    drafts[d.key] = d; saveDrafts();
    return d;
  }
  async function draftFor(id) {
    const existing = Object.values(drafts).find((d) => d.originalId === id);
    if (existing) return existing;
    const entry = manifest.find((q) => q.id === id) || {};
    const quiz = await readJSON(`quizzes/${id}.json`);
    if (!quiz) throw new Error('That quiz file could not be found.');
    const qs = (quiz.questions || []).slice(0, TOTAL).map((q) => ({ ...blankQuestion(), ...Object.fromEntries(FIELDS.map((f) => [f, q[f] || ''])) }));
    while (qs.length < TOTAL) qs.push(blankQuestion());
    const d = {
      key: `edit-${id}`, originalId: id, number: quiz.number, date: quiz.date, title: quiz.title || '',
      blurb: entry.blurb || '', questions: qs, updated: Date.now(), wasSample: !!quiz.sample,
    };
    drafts[d.key] = d; saveDrafts();
    return d;
  }
  const isComplete = (q) => q.question.trim() && q.answer.trim();
  const completeCount = (d) => d.questions.filter(isComplete).length;

  function check(d) {
    const errors = [];
    const warnings = [];
    if (!(Number.isInteger(Number(d.number)) && Number(d.number) > 0)) errors.push('Give the quiz a number, such as 4.');
    if (!validISO(d.date)) errors.push('Choose a release date.');
    else if (!isSunday(d.date)) errors.push(`${formatDate(d.date)} is not a Sunday. Choose a Sunday.`);
    if (!d.title.trim()) errors.push('Add a headline for the quiz.');
    const missing = d.questions.map((q, i) => (isComplete(q) ? -1 : i + 1)).filter((n) => n > 0);
    if (missing.length) errors.push(`${missing.length === 1 ? 'Question' : 'Questions'} ${missing.join(', ')} ${missing.length === 1 ? 'needs' : 'need'} both a question and an answer.`);
    const others = manifest.filter((q) => q.id !== d.originalId);
    if (validISO(d.date) && others.some((q) => q.date === d.date)) errors.push(`Another quiz is already set for ${formatDate(d.date)}.`);
    if (others.some((q) => Number(q.number) === Number(d.number))) errors.push(`Quiz No. ${d.number} already exists. Use a different number.`);
    const noExp = d.questions.filter((q) => !q.explanation.trim()).length;
    const noSrc = d.questions.filter((q) => !q.source.trim()).length;
    const noCat = d.questions.filter((q) => !q.category.trim()).length;
    if (noExp) warnings.push(`${noExp} ${noExp === 1 ? 'question has' : 'questions have'} no explanation. Players see the answer on its own.`);
    if (noSrc) warnings.push(`${noSrc} ${noSrc === 1 ? 'question has' : 'questions have'} no source noted for fact-checking.`);
    if (noCat) warnings.push(`${noCat} ${noCat === 1 ? 'question has' : 'questions have'} no topic label.`);
    if (!d.blurb.trim()) warnings.push('There is no teaser line for the homepage.');
    if (validISO(d.date) && d.date <= todayISO()) warnings.push('The release date is today or earlier, so the quiz will appear on the site as soon as it is published.');
    return { errors, warnings };
  }

  function quizFile(d) {
    return {
      id: d.date, number: Number(d.number), date: d.date, title: d.title.trim(),
      questions: d.questions.map((q) => Object.fromEntries(FIELDS.map((f) => [f, q[f].trim()]))),
    };
  }
  function manifestEntry(d) {
    return { id: d.date, number: Number(d.number), date: d.date, title: d.title.trim(), blurb: d.blurb.trim(), questionCount: TOTAL };
  }

  /* ---------- views ---------- */
  function statusPill(q) {
    if (q.date > todayISO()) return '<span class="pill scheduled">Scheduled</span>';
    return '<span class="pill live">Live</span>';
  }

  function accessPanel(open) {
    const has = !!settings.token;
    return `<details class="ed-panel" id="access" ${open ? 'open' : ''}>
      <summary>Publishing access · <span class="ed-status ${has ? 'ok' : 'bad'}" id="access-status">${has ? 'Key saved in this browser' : 'Not set up'}</span></summary>
      <p class="ed-intro">To publish from this page, GitHub needs an access key that lets this editor change files in your repository. You only do this once on each computer. The key is stored in this browser and never appears in the site's code.</p>
      <ol class="steps-list">
        <li>While signed in to GitHub, open <strong>github.com/settings/personal-access-tokens/new</strong>.</li>
        <li>Name it "Sunday Quiz editor" and set an expiry date (a year is reasonable).</li>
        <li>Under <strong>Repository access</strong>, choose <strong>Only select repositories</strong> and pick <strong>${esc(settings.repo)}</strong>.</li>
        <li>Under <strong>Permissions</strong>, find <strong>Contents</strong> and set it to <strong>Read and write</strong>.</li>
        <li>Click <strong>Generate token</strong>, copy it, paste it below and press Save and test.</li>
      </ol>
      <div class="grid-2">
        <div class="field"><label for="set-token">Access key</label><input id="set-token" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? 'Saved. Paste a new one to replace it.' : 'github_pat_…'}"></div>
        <div class="field"><label for="set-repo">Repository</label><input id="set-repo" type="text" spellcheck="false" value="${esc(settings.owner)}/${esc(settings.repo)}"><span class="help">Owner and name, exactly as on GitHub.</span></div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-small" data-action="save-access">Save and test</button>
        ${has ? '<button type="button" class="btn btn-quiet btn-small" data-action="forget-access">Remove key from this browser</button>' : ''}
      </div>
      <div class="msg" id="access-msg" role="status"></div>
    </details>`;
  }

  async function renderHome(flash) {
    current = null; confirming = false;
    root.innerHTML = '<p class="loading">Loading your quizzes…</p>';
    let loadError = '';
    try { await loadManifest(); } catch (e) { loadError = e instanceof PublishError ? e.message : 'The list of quizzes could not be loaded.'; }
    const draftList = Object.values(drafts).sort((a, b) => b.updated - a.updated);
    root.innerHTML = `
      ${flash ? `<div class="msg good" role="status">${flash}</div>` : ''}
      <section class="ed-section" aria-labelledby="h-quizzes">
        <div class="section-head"><h2 class="shout" id="h-quizzes">Your quizzes</h2>
          <button type="button" class="btn" data-action="new">New quiz</button></div>
        ${loadError ? `<div class="msg bad">${esc(loadError)}</div>` : ''}
        ${draftList.length ? `<h3 class="eyebrow">Drafts in this browser</h3>
        <ol class="qlist">${draftList.map((d) => `<li class="qrow">
          <span class="row-num shout blk c2" aria-hidden="true">${esc(d.number)}</span>
          <div><h3>${esc(d.title || 'Untitled quiz')}</h3>
            <p><span class="pill draft">${d.originalId ? 'Unpublished changes' : 'Draft'}</span><span>${esc(formatDate(d.date))}</span><span>${completeCount(d)} of ${TOTAL} written</span></p></div>
          <div class="actions"><button type="button" class="btn btn-small" data-action="open" data-key="${esc(d.key)}">Continue</button>
            <button type="button" class="link-btn" data-action="discard" data-key="${esc(d.key)}">Discard</button></div>
        </li>`).join('')}</ol>` : ''}
        <h3 class="eyebrow">On the site</h3>
        ${manifest.length ? `<ol class="qlist">${manifest.map((q) => `<li class="qrow">
          <span class="row-num shout blk c0" aria-hidden="true">${esc(q.number)}</span>
          <div><h3>${esc(q.title)}</h3><p>${statusPill(q)}<span>${esc(formatDate(q.date))}</span><span>${esc(q.questionCount)} questions</span>${q.sample ? '<span class="pill draft">Sample</span>' : ''}</p></div>
          <div class="actions"><button type="button" class="btn btn-quiet btn-small" data-action="edit" data-id="${esc(q.id)}">Edit</button></div>
        </li>`).join('')}</ol>` : '<p class="ed-intro">Nothing published yet.</p>'}
      </section>
      ${accessPanel(!settings.token)}`;
  }

  function questionCard(q, i) {
    const id = (f) => `q${i}-${f}`;
    return `<div class="qcard ${isComplete(q) ? 'is-done' : ''}" id="card-${i}">
      <span class="item-num shout" aria-hidden="true">${i + 1}</span>
      <div class="qcard-fields">
        <div class="field"><label for="${id('question')}">Question ${i + 1}</label><textarea id="${id('question')}" data-q="${i}" data-f="question" rows="3">${esc(q.question)}</textarea></div>
        <div class="field"><label for="${id('answer')}">Answer</label><input id="${id('answer')}" type="text" data-q="${i}" data-f="answer" value="${esc(q.answer)}"></div>
        <div class="field"><label for="${id('explanation')}">Explanation</label><textarea id="${id('explanation')}" data-q="${i}" data-f="explanation" rows="2">${esc(q.explanation)}</textarea><span class="help">Shown with the answer. A sentence or two of extra context.</span></div>
        <div class="grid-2">
          <div class="field"><label for="${id('category')}">Topic label</label><input id="${id('category')}" type="text" data-q="${i}" data-f="category" value="${esc(q.category)}"><span class="help">Small label above the question, such as History.</span></div>
          <div class="field private"><label for="${id('source')}">Source</label><input id="${id('source')}" type="text" data-q="${i}" data-f="source" value="${esc(q.source)}"><span class="help">For your fact-checking. Players never see it.</span></div>
        </div>
      </div>
    </div>`;
  }

  function renderEditor(d) {
    current = d; confirming = false;
    const editingLive = !!d.originalId;
    root.innerHTML = `
      <p><button type="button" class="link-btn" data-action="home">← All quizzes</button></p>
      <section class="ed-section" aria-labelledby="h-edit">
        <h2 class="shout" id="h-edit">${editingLive ? `Editing No. ${esc(d.number)}` : `New quiz, No. ${esc(d.number)}`}</h2>
        <p class="ed-intro">Everything you type is saved in this browser as you go, so you can close the page and come back. Nothing reaches the site until you press Publish.</p>
        ${d.wasSample ? '<div class="msg">This is one of the sample quizzes. Publishing it will remove its sample label.</div>' : ''}
        <div class="ed-panel">
          <div class="grid-2">
            <div class="field"><label for="m-number">Quiz number</label><input id="m-number" type="number" min="1" step="1" data-m="number" value="${esc(d.number)}"></div>
            <div class="field"><label for="m-date">Release date</label><input id="m-date" type="date" data-m="date" value="${esc(d.date)}" ${editingLive ? 'readonly' : ''}>
              <span class="help" id="date-help">${editingLive ? 'The date of a published quiz cannot be changed.' : esc(formatDate(d.date))}</span></div>
          </div>
          <div class="field"><label for="m-title">Headline</label><input id="m-title" type="text" data-m="title" value="${esc(d.title)}" placeholder="An army against emus and a concert on a roof"></div>
          <div class="field"><label for="m-blurb">Teaser line</label><textarea id="m-blurb" data-m="blurb" rows="2" placeholder="One sentence for the homepage.">${esc(d.blurb)}</textarea></div>
        </div>
      </section>
      ${ROUND_NAMES.map((name, r) => `<section class="round-block c${r}" aria-labelledby="h-round-${r}">
        <header class="blk"><h3 class="shout" id="h-round-${r}">${esc(name)}</h3><p>Round ${r + 1} · Questions ${r * PER_ROUND + 1} to ${(r + 1) * PER_ROUND}</p></header>
        ${d.questions.slice(r * PER_ROUND, (r + 1) * PER_ROUND).map((q, k) => questionCard(q, r * PER_ROUND + k)).join('')}
      </section>`).join('')}
      <div id="preview"></div>
      <div class="msg" id="ed-msg" role="status" aria-live="polite"></div>
      <div class="ed-bar slab">
        <p class="progress-note"><strong id="ed-count"></strong><span id="ed-saved"></span></p>
        <div class="actions">
          <button type="button" class="btn btn-small btn-quiet" data-action="preview">Preview</button>
          <button type="button" class="btn btn-small btn-quiet" data-action="download">Download</button>
          <button type="button" class="btn btn-small" data-action="publish">Publish</button>
        </div>
      </div>`;
    updateProgress();
    document.getElementById('ed-saved').textContent = 'All changes saved in this browser';
    window.scrollTo(0, 0);
  }

  function updateProgress() {
    if (!current) return;
    document.getElementById('ed-count').textContent = `${completeCount(current)} of ${TOTAL} written`;
  }
  function scheduleSave() {
    current.updated = Date.now();
    drafts[current.key] = current;
    clearTimeout(saveTimer);
    const saved = document.getElementById('ed-saved');
    if (saved) saved.textContent = 'Saving…';
    saveTimer = setTimeout(() => {
      const ok = saveDrafts();
      const el = document.getElementById('ed-saved');
      if (el) el.textContent = ok ? `Saved in this browser at ${timeNow()}` : 'This browser is not letting the editor save. Download a copy before closing.';
    }, 400);
  }

  function renderPreview() {
    const d = current;
    const box = document.getElementById('preview');
    box.innerHTML = `<div class="preview-wrap">
      <div class="section-head"><h2 class="shout">Preview</h2><button type="button" class="link-btn" data-action="close-preview">Close preview</button></div>
      <p class="ed-intro">How players will see it, with every answer revealed. Sources are not shown to players.</p>
      <header class="quiz-head"><p class="eyebrow">No. ${esc(d.number)} · ${esc(formatDate(d.date))}</p><h1 class="shout">${esc(d.title || 'Untitled quiz')}</h1>${d.blurb ? `<p>${esc(d.blurb)}</p>` : ''}</header>
      ${ROUND_NAMES.map((name, r) => `<section class="round c${r} has-head">
        <header class="round-head blk"><h2 class="shout">${esc(name)}</h2><p>Round ${r + 1} · Questions ${r * PER_ROUND + 1} to ${(r + 1) * PER_ROUND}</p></header>
        <ol class="items">${d.questions.slice(r * PER_ROUND, (r + 1) * PER_ROUND).map((q, k) => `<li class="item">
          <span class="item-num shout" aria-hidden="true">${r * PER_ROUND + k + 1}</span>
          <div class="item-body">
            ${q.category ? `<p class="eyebrow q-cat">${esc(q.category)}</p>` : ''}
            <h3 class="item-q">${q.question ? esc(q.question) : '<em>No question yet</em>'}</h3>
            <div class="answer"><p class="answer-text">${q.answer ? esc(q.answer) : 'No answer yet'}</p>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}</div>
          </div>
        </li>`).join('')}</ol>
      </section>`).join('')}
    </div>`;
    box.scrollIntoView({ block: 'start' });
  }

  function showMsg(kind, html) {
    const el = document.getElementById('ed-msg');
    el.className = `msg ${kind}`;
    el.innerHTML = html;
    el.scrollIntoView({ block: 'nearest' });
  }

  function startPublish() {
    const { errors, warnings } = check(current);
    if (errors.length) {
      showMsg('bad', `<p>Not ready to publish yet.</p><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`);
      confirming = false;
      return;
    }
    if (!settings.token) {
      showMsg('bad', '<p>Publishing needs an access key. Go back to All quizzes and set up Publishing access, then return to this draft.</p>');
      return;
    }
    confirming = true;
    const when = current.date > todayISO() ? `It will appear on the site on ${esc(formatDate(current.date))}.` : 'It will appear on the site within a few minutes.';
    showMsg('', `<p>Publish No. ${esc(current.number)}, “${esc(current.title.trim())}”, for ${esc(formatDate(current.date))}? ${when}</p>
      ${warnings.length ? `<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="actions"><button type="button" class="btn btn-small" data-action="confirm-publish">Publish now</button>
      <button type="button" class="btn btn-quiet btn-small" data-action="cancel-publish">Not yet</button></div>`);
    document.querySelector('[data-action="confirm-publish"]').focus();
  }

  async function publish() {
    const d = current;
    const buttons = root.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    showMsg('', '<p>Publishing… keep this page open.</p>');
    try {
      const id = d.date;
      const path = `quizzes/${id}.json`;
      const existing = await getFile(path);
      if (existing && d.originalId !== id) throw new PublishError(`A quiz file for ${formatDate(id)} already exists on GitHub. Choose another date.`);
      await putFile(path, JSON.stringify(quizFile(d), null, 2) + '\n', existing && existing.sha, `${existing ? 'Update' : 'Publish'} quiz No. ${d.number} (${id})`);
      const index = await getFile('quizzes/index.json');
      const list = index ? (JSON.parse(index.text).quizzes || []) : [];
      const next = list.filter((q) => q.id !== id && q.id !== d.originalId);
      next.push(manifestEntry(d));
      next.sort((a, b) => (a.date < b.date ? 1 : -1));
      await putFile('quizzes/index.json', JSON.stringify({ quizzes: next }, null, 2) + '\n', index && index.sha, `List quiz No. ${d.number} (${id})`);
      delete drafts[d.key]; saveDrafts();
      const when = id > todayISO() ? `It is scheduled and will appear on ${esc(formatDate(id))}.` : 'It will be live on the site in a few minutes, once GitHub has rebuilt it.';
      await renderHome(`<p>Published No. ${esc(d.number)}. ${when}</p>`);
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      confirming = false;
      const text = e instanceof PublishError ? e.message : 'The connection to GitHub failed. Check your internet connection and press Publish again. Your draft is safe.';
      showMsg('bad', `<p>${esc(text)}</p>`);
    }
  }

  function download() {
    const d = current;
    const blob = new Blob([JSON.stringify(quizFile(d), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${validISO(d.date) ? d.date : 'quiz'}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showMsg('', '<p>Downloaded a copy of this quiz as a file. Keep it as a backup.</p>');
  }

  async function saveAccess() {
    const msg = document.getElementById('access-msg');
    const token = document.getElementById('set-token').value.replace(/\s+/g, '');
    const repo = document.getElementById('set-repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const [owner, name] = repo.split('/');
    if (!owner || !name) { msg.className = 'msg bad'; msg.textContent = 'Enter the repository as owner/name, for example jacklunn2/Sunday-Quiz.'; return; }
    const previous = { ...settings };
    settings = { ...settings, owner, repo: name, token: token || settings.token };
    if (!settings.token) { msg.className = 'msg bad'; msg.textContent = 'Paste your access key first.'; return; }
    msg.className = 'msg'; msg.textContent = 'Checking with GitHub…';
    try {
      const res = await gh('');
      if (!res.ok) throw new PublishError(explain(res.status));
      const info = await res.json();
      if (info.permissions && info.permissions.push === false) throw new PublishError(explain(403));
      saveSettings();
      await renderHome(`<p>Connected to ${esc(owner)}/${esc(name)}. You can publish from this browser.</p>`);
    } catch (e) {
      settings = previous;
      msg.className = 'msg bad';
      if (e instanceof PublishError) msg.textContent = e.message;
      else if (/[^\x21-\x7e]/.test(settings.token || token)) msg.textContent = 'The access key contains characters a GitHub key never has, so it was probably copied incorrectly. Copy it again from GitHub and paste it in.';
      else msg.innerHTML = `Your browser could not reach GitHub (api.github.com). Something on this computer or network may be blocking it, such as a privacy extension, antivirus web protection, a VPN or a network filter. To check, open <strong>api.github.com</strong> in a new tab: it should show a page of text. <span class="help">Technical detail: ${esc(e && e.message ? e.message : String(e))}</span>`;
    }
  }

  /* ---------- events ---------- */
  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    try {
      if (a === 'new') renderEditor(newDraft());
      else if (a === 'open') renderEditor(drafts[el.dataset.key]);
      else if (a === 'edit') { el.disabled = true; renderEditor(await draftFor(el.dataset.id)); }
      else if (a === 'discard') {
        if (el.dataset.confirm === 'yes') { delete drafts[el.dataset.key]; saveDrafts(); renderHome(); }
        else { el.dataset.confirm = 'yes'; el.textContent = 'Press again to delete this draft'; }
      }
      else if (a === 'home') renderHome();
      else if (a === 'preview') renderPreview();
      else if (a === 'close-preview') document.getElementById('preview').innerHTML = '';
      else if (a === 'download') download();
      else if (a === 'publish') startPublish();
      else if (a === 'confirm-publish' && confirming) publish();
      else if (a === 'cancel-publish') { confirming = false; showMsg('', ''); }
      else if (a === 'save-access') saveAccess();
      else if (a === 'forget-access') { settings.token = ''; saveSettings(); renderHome('<p>The access key was removed from this browser.</p>'); }
    } catch (err) {
      el.disabled = false;
      const box = document.getElementById('ed-msg');
      const text = err instanceof PublishError ? err.message : (err.message || 'Something went wrong.');
      if (box) showMsg('bad', `<p>${esc(text)}</p>`);
      else root.insertAdjacentHTML('afterbegin', `<div class="msg bad">${esc(text)}</div>`);
    }
  });

  root.addEventListener('input', (e) => {
    if (!current) return;
    const t = e.target;
    if (t.dataset.q !== undefined) {
      const i = Number(t.dataset.q);
      current.questions[i][t.dataset.f] = t.value;
      document.getElementById(`card-${i}`).classList.toggle('is-done', !!isComplete(current.questions[i]));
      updateProgress();
    } else if (t.dataset.m) {
      current[t.dataset.m] = t.dataset.m === 'number' ? t.value : t.value;
      if (t.dataset.m === 'date') {
        const help = document.getElementById('date-help');
        help.textContent = validISO(t.value) ? (isSunday(t.value) ? formatDate(t.value) : `${formatDate(t.value)}: not a Sunday`) : '';
      }
    } else return;
    if (confirming) { confirming = false; showMsg('', ''); }
    scheduleSave();
  });

  renderHome();
})();
