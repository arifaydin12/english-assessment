// Application controller: wires state, storage and ui together, owns the
// per-question timer and the keyboard shortcuts.

import { QUESTIONS_URL, TEST_LENGTH, TIME_LIMITS, TIMER_WARNING_SECONDS } from './config.js';
import { resultOf, createEngine, createSession, currentQuestion, submitAnswer, isResumable, prepareQuestion, timeLimitFor } from './state.js';
import { createStorage, historyEntry } from './storage.js';
import * as ui from './ui.js';

const storage = createStorage();
const BASE_TITLE = 'English Placement Test (CEFR A1–C2)';

let engine = null;
let session = null; // the in-progress session
let view = 'loading'; // loading | landing | question | results | review
let controller = null; // widget controller of the question on screen
let shownAt = 0;
let deadline = 0;
let timerId = null;
let warned = false;

// ---------------------------------------------------------------- bootstrap

async function init() {
  setupTheme();
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', () => {
    // Nothing to pause: the timer is deadline-based. Just refresh the display on return.
    if (!document.hidden && view === 'question') tick();
  });
  await loadBank();
}

async function loadBank() {
  view = 'loading';
  ui.mount(ui.renderLoading());
  try {
    const response = await fetch(QUESTIONS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`The server answered with status ${response.status}.`);
    engine = createEngine(await response.json());
    showLanding();
  } catch (error) {
    view = 'error';
    ui.mount(ui.renderError(error.message || 'Unknown error.', loadBank));
    ui.focusHeading();
  }
}

function setupTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => storage.getTheme() ?? (media.matches ? 'dark' : 'light');
  ui.applyTheme(current());
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    storage.setTheme(next);
    ui.applyTheme(next);
    ui.announce(`${next === 'dark' ? 'Dark' : 'Light'} theme on.`);
  });
  media.addEventListener?.('change', () => {
    if (!storage.getTheme()) ui.applyTheme(current());
  });
}

function setTitle(suffix) {
  document.title = suffix ? `${suffix} · English Placement Test` : BASE_TITLE;
}

// ------------------------------------------------------------------ landing

function showLanding() {
  stopTimer();
  view = 'landing';
  controller = null;
  const saved = storage.loadSession();
  let resume = null;
  if (saved) {
    if (isResumable(saved, engine)) resume = saved;
    else storage.clearSession();
  }
  const lastSession = storage.loadLastResult();
  const last = lastSession && lastSession.responses?.every((r) => engine.byId.has(r.id)) ? { level: resultOf(lastSession).level } : null;

  ui.mount(
    ui.renderLanding({
      total: TEST_LENGTH,
      resume,
      last,
      history: storage.loadHistory(),
      timerOn: storage.getTimerPreference(),
      handlers: {
        onStart: startTest,
        onResume: () => resumeTest(resume),
        onDiscard: () => {
          storage.clearSession();
          ui.announce('Saved progress discarded.');
          showLanding();
        },
        onTimerChange: (enabled) => storage.setTimerPreference(enabled),
        onViewLast: () => showResults(lastSession),
        onViewLastReview: () => showReview(lastSession),
        onClearHistory: () => {
          storage.clearHistory();
          ui.announce('History cleared.');
          showLanding();
        },
      },
    }),
  );
  setTitle('');
  ui.focusHeading();
}

// --------------------------------------------------------------------- test

function startTest(timer) {
  storage.setTimerPreference(timer);
  session = createSession(engine, { timer });
  storage.saveSession(session);
  showQuestion();
}

function resumeTest(saved) {
  session = saved;
  ui.announce(`Resuming at question ${session.responses.length + 1}.`);
  showQuestion();
}

function showQuestion() {
  stopTimer();
  const question = currentQuestion(session, engine);
  if (!question) {
    finishTest();
    return;
  }
  view = 'question';
  const number = session.responses.length + 1;
  const prepared = prepareQuestion(question, session.seed);
  const passage = question.passage ? engine.passages.get(question.passage) : null;
  const rendered = ui.renderQuestion({
    number,
    total: TEST_LENGTH,
    prepared,
    passage,
    timerOn: session.timer,
    handlers: { onSubmit: submitCurrent, onSkip: () => finishQuestion({ skipped: true }), onExit: exitToLanding },
  });
  controller = rendered.controller;
  ui.mount(rendered.element);
  setTitle(`Question ${number} of ${TEST_LENGTH}`);
  controller.focusFirst();
  shownAt = performance.now();

  if (session.timer) {
    const limit = timeLimitFor(question, TIME_LIMITS);
    deadline = shownAt + limit * 1000;
    warned = false;
    controller.limit = limit;
    tick();
    timerId = setInterval(tick, 250);
  }
}

function tick() {
  if (!controller || !session?.timer || view !== 'question') return;
  const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
  controller.setTimer(left, controller.limit);
  if (!warned && left <= TIMER_WARNING_SECONDS && left > 0) {
    warned = true;
    ui.announce(`${left} seconds left.`);
  }
  if (left <= 0) {
    ui.announce('Time is up. Moving on.');
    // Keep whatever the learner had already entered; otherwise record a time-out.
    if (controller.hasAnswer()) finishQuestion({ answer: controller.getAnswer() });
    else finishQuestion({ timedOut: true });
  }
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function submitCurrent() {
  if (!controller.hasAnswer()) {
    controller.showError("Choose or enter an answer first, or press \u201CI don\u2019t know\u201D.");
    controller.focusFirst();
    return;
  }
  finishQuestion({ answer: controller.getAnswer() });
}

function finishQuestion({ answer = '', skipped = false, timedOut = false }) {
  if (view !== 'question') return;
  stopTimer();
  const ms = performance.now() - shownAt;
  submitAnswer(session, engine, { answer, ms, skipped, timedOut });
  storage.saveSession(session); // auto-save after every answer
  if (session.finished) finishTest();
  else showQuestion();
}

function exitToLanding() {
  storage.saveSession(session);
  showLanding();
  ui.announce('Progress saved. You can resume later.');
}

function finishTest() {
  stopTimer();
  session.finishedAt = Date.now();
  const result = resultOf(session);
  storage.saveLastResult(session);
  storage.addHistory(historyEntry(result, session.finishedAt));
  storage.clearSession();
  showResults(session);
}

// ------------------------------------------------------- results and review

function showResults(finished) {
  stopTimer();
  view = 'results';
  const result = resultOf(finished);
  ui.mount(
    ui.renderResults({
      result,
      finishedAt: finished.finishedAt || Date.now(),
      handlers: {
        onReview: () => showReview(finished),
        onPrint: () => window.print(),
        onRetake: () => startTest(storage.getTimerPreference()),
        onHome: showLanding,
      },
    }),
  );
  setTitle(`Result: ${result.level}`);
  ui.focusHeading();
}

function showReview(finished, filter = 'all', keepFocus = false) {
  view = 'review';
  ui.mount(
    ui.renderReview({
      session: finished,
      engine,
      filter,
      handlers: {
        onFilter: (value) => showReview(finished, value, true),
        onPrint: () => window.print(),
        onBack: () => showResults(finished),
      },
    }),
  );
  setTitle('Review');
  if (keepFocus) document.querySelector('.seg[aria-pressed="true"]')?.focus();
  else ui.focusHeading();
}
// ----------------------------------------------------------------- keyboard

function onKeyDown(event) {
  if (view !== 'question' || !controller) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const typing = target instanceof HTMLInputElement && target.type === 'text';

  if (/^[1-9]$/.test(event.key) && !typing) {
    const index = Number(event.key) - 1;
    if (controller.type === 'multiple-choice' && controller.pickOption(index)) event.preventDefault();
    else if (controller.type === 'reorder' && controller.pickToken(index)) event.preventDefault();
    return;
  }
  if (event.key === 'Backspace' && !typing && controller.type === 'reorder') {
    if (controller.undoToken()) event.preventDefault();
    return;
  }
  if (event.key === 'Enter') {
    // Let focused buttons and links do their normal job.
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
    submitCurrent();
  }
}

init();
