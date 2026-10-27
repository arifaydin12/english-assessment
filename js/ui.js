// DOM rendering. Every render function returns an element (and sometimes a
// controller object); app.js decides when to mount it. No state lives here
// except the widget state of the question currently on screen.

import { LEVELS, LEVEL_INFO, formatDuration, acceptedAnswers } from './scoring.js';

const LEVEL_NAMES = Object.fromEntries(LEVELS.map((level) => [level, LEVEL_INFO[level].name]));

// ------------------------------------------------------------- DOM helpers

/** Tiny hyperscript helper: h('div', { class: 'x', onClick }, 'text', childNode). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  appendAll(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  appendAll(el, children);
  return el;
}

function appendAll(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace "___" in a prompt with a visible blank. */
function withBlank(text) {
  const parts = String(text).split('___');
  const nodes = [];
  parts.forEach((part, index) => {
    nodes.push(part);
    if (index < parts.length - 1) nodes.push(h('span', { class: 'blank', role: 'img', 'aria-label': 'blank' }));
  });
  return nodes;
}

const CATEGORY_LABEL = { grammar: 'Grammar', vocabulary: 'Vocabulary', reading: 'Reading' };
const INSTRUCTIONS = {
  'multiple-choice': 'Choose the best answer.',
  'fill-in-the-blank': 'Type the missing word.',
  'word-formation': 'Change the word in capitals so that it fits the gap.',
  reorder: 'Put the words in the correct order.',
};

export function announce(message) {
  const region = document.getElementById('live');
  if (!region) return;
  region.textContent = '';
  // A short delay makes screen readers re-announce identical messages.
  setTimeout(() => {
    region.textContent = message;
  }, 30);
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.setAttribute('aria-pressed', String(theme === 'dark'));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e1322' : '#f4f6fb');
}

export function mount(node) {
  const app = document.getElementById('app');
  app.replaceChildren(node);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/** Move keyboard / screen-reader focus to the main heading of the current view. */
export function focusHeading() {
  const target = document.querySelector('#app [data-autofocus]');
  if (target) target.focus({ preventScroll: true });
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ------------------------------------------------------------------ landing

export function renderLanding({ total, resume, last, history, timerOn, handlers }) {
  const timerInput = h('input', { type: 'checkbox', id: 'timer-toggle', role: 'switch', checked: timerOn ? true : null });
  timerInput.checked = Boolean(timerOn);
  timerInput.addEventListener('change', () => handlers.onTimerChange(timerInput.checked));

  const facts = [
    [String(total), 'adaptive questions'],
    ['A1–C2', 'CEFR scale'],
    ['5', 'task types'],
    ['0', 'sign-ups: data stays on your device'],
  ];

  const hero = h(
    'section',
    { class: 'card hero', 'aria-labelledby': 'landing-title' },
    h(
      'div',
      { class: 'hero-main' },
      h('p', { class: 'eyebrow' }, 'English placement test'),
      h('h1', { id: 'landing-title', tabindex: '-1', 'data-autofocus': true }, 'Find your English level in about 20 minutes'),
      h(
        'p',
        { class: 'lead' },
        `Answer ${total} questions on grammar, vocabulary and reading. The test adapts to you: it starts at B1 and gets easier or harder depending on your answers, then estimates your level on the CEFR scale from A1 to C2.`,
      ),
      h(
        'div',
        { class: 'hero-actions' },
        h('button', { class: 'btn primary large', id: 'start-btn', type: 'button', onClick: () => handlers.onStart(timerInput.checked) }, resume ? 'Start a new test' : 'Start the test'),
        h('label', { class: 'switch', for: 'timer-toggle' }, timerInput, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', { class: 'switch-label' }, 'Per-question timer ', h('small', {}, '(optional, 40-75 s)'))),
      ),
    ),
    // Decorative CEFR ladder (the same information is in the text above and in the results).
    h(
      'ol',
      { class: 'ladder', 'aria-hidden': 'true' },
      [...LEVELS].reverse().map((level, index) => h('li', { style: `--step:${LEVELS.length - index}` }, h('strong', {}, level), h('span', {}, LEVEL_NAMES[level]))),
    ),
    h('ul', { class: 'facts' }, facts.map(([value, label]) => h('li', {}, h('strong', {}, value), h('span', {}, label)))),
  );

  const nodes = [hero];

  if (resume) {
    const answered = resume.responses.length;
    nodes.push(
      h(
        'section',
        { class: 'card notice', 'aria-labelledby': 'resume-title' },
        h('div', {},
          h('h2', { id: 'resume-title' }, 'Continue where you left off'),
          h('p', { class: 'muted' }, `${answered} of ${total} questions answered. Started ${formatDate(resume.startedAt)}.`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', id: 'resume-btn', type: 'button', onClick: handlers.onResume }, 'Resume test'),
          h('button', { class: 'btn ghost', type: 'button', onClick: handlers.onDiscard }, 'Discard')),
      ),
    );
  }

  if (last) {
    nodes.push(
      h(
        'section',
        { class: 'card notice', 'aria-labelledby': 'last-title' },
        h('div', {},
          h('h2', { id: 'last-title' }, `Your last result: ${last.level}`),
          h('p', { class: 'muted' }, 'Open the result page or go through every question again with explanations.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn secondary', type: 'button', onClick: handlers.onViewLast }, 'View result'),
          h('button', { class: 'btn ghost', type: 'button', onClick: handlers.onViewLastReview }, 'Review answers')),
      ),
    );
  }

  nodes.push(
    h(
      'div',
      { class: 'grid-2' },
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'how-title' },
        h('h2', { id: 'how-title' }, 'How it works'),
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, h('strong', {}, 'Answer. '), 'Multiple choice, gap-fills, word formation, sentence reordering and short reading passages.'),
          h('li', {}, h('strong', {}, 'Adapt. '), 'A correct answer leads to a harder question, a mistake to an easier one. No going back.'),
          h('li', {}, h('strong', {}, 'Review. '), 'See your level, a per-level chart, your strengths and weaknesses, and an explanation for every question.'),
        ),
      ),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'keys-title' },
        h('h2', { id: 'keys-title' }, 'Keyboard shortcuts'),
        h(
          'dl',
          { class: 'keys' },
          h('dt', {}, h('kbd', {}, '1'), ' – ', h('kbd', {}, '4')), h('dd', {}, 'Pick an answer (or add a word when reordering)'),
          h('dt', {}, h('kbd', {}, 'Enter')), h('dd', {}, 'Confirm and continue'),
          h('dt', {}, h('kbd', {}, 'Backspace')), h('dd', {}, 'Remove the last word when reordering'),
        ),
        h('p', { class: 'muted small' }, 'Your progress is saved automatically in this browser, so you can close the page and resume later.'),
      ),
    ),
  );

  if (history.length > 0) nodes.push(renderHistory(history, handlers));
  nodes.push(h('p', { class: 'disclaimer' }, 'This is a quick placement estimate for guidance. It is not an official certificate.'));
  return h('div', { class: 'view' }, nodes);
}

function renderHistory(history, handlers) {
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'history-title' },
    h('div', { class: 'card-head' },
      h('h2', { id: 'history-title' }, 'Previous results'),
      h('button', { class: 'btn ghost small', type: 'button', onClick: handlers.onClearHistory }, 'Clear history')),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'history' },
        h('thead', {}, h('tr', {}, ['Date', 'Level', 'Score', 'Correct', 'Time'].map((c) => h('th', { scope: 'col' }, c)))),
        h(
          'tbody',
          {},
          history.map((entry) =>
            h('tr', {},
              h('td', {}, formatDate(entry.finishedAt)),
              h('td', {}, h('span', { class: 'badge' }, entry.level)),
              h('td', {}, `${entry.score}%`),
              h('td', {}, `${entry.correct}/${entry.answered}`),
              h('td', {}, formatDuration(entry.durationMs))),
          ),
        ),
      ),
    ),
  );
}

// ----------------------------------------------------------------- question

/**
 * Render one question. Returns { element, controller }; the controller exposes
 * the widget state to the keyboard handler and the timer in app.js.
 */
export function renderQuestion({ number, total, prepared, passage, timerOn, handlers }) {
  const q = prepared;
  const state = { choice: null, tokens: [] };
  const continueBtn = h('button', { class: 'btn primary', id: 'continue-btn', type: 'button', 'aria-disabled': 'true', onClick: () => handlers.onSubmit() }, 'Continue', h('kbd', { class: 'on-primary', 'aria-hidden': 'true' }, 'Enter'));
  const errorEl = h('p', { class: 'form-error', id: 'answer-error', hidden: true });
  const timerEl = timerOn ? h('div', { class: 'timer', id: 'timer', 'aria-hidden': 'true' }, '0:00') : null;

  const refresh = () => {
    const has = controller.hasAnswer();
    continueBtn.setAttribute('aria-disabled', String(!has));
    if (has) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
  };

  let widget;
  let focusTarget = null;
  const controller = {
    type: q.type,
    hasAnswer: () => (q.type === 'reorder' ? state.tokens.length > 0 : String(controller.getAnswer()).trim() !== ''),
    getAnswer: () => {
      if (q.type === 'multiple-choice') return state.choice ?? '';
      if (q.type === 'reorder') return state.tokens.map((id) => q.words[id]).join(' ');
      return typedInput ? typedInput.value : '';
    },
    pickOption: (index) => {
      const input = widget.querySelectorAll('input[type="radio"]')[index];
      if (!input) return false;
      input.checked = true;
      state.choice = input.value;
      input.focus();
      refresh();
      return true;
    },
    pickToken: (index) => {
      const token = q.tokens?.[index];
      if (!token || state.tokens.includes(token.id)) return false;
      state.tokens.push(token.id);
      redrawReorder();
      refresh();
      return true;
    },
    undoToken: () => {
      if (state.tokens.length === 0) return false;
      state.tokens.pop();
      redrawReorder();
      refresh();
      return true;
    },
    showError: (message) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
      announce(message);
    },
    setTimer: (secondsLeft, limit) => {
      if (!timerEl) return;
      const minutes = Math.floor(secondsLeft / 60);
      timerEl.textContent = `${minutes}:${String(secondsLeft % 60).padStart(2, '0')}`;
      timerEl.classList.toggle('low', secondsLeft <= 10);
      timerEl.style.setProperty('--fill', String(Math.max(0, secondsLeft / limit)));
    },
    focusFirst: () => focusTarget?.focus({ preventScroll: true }),
  };

  let typedInput = null;
  let redrawReorder = () => {};

  if (q.type === 'multiple-choice') {
    widget = h(
      'fieldset',
      { class: 'choices' },
      h('legend', { class: 'sr-only' }, 'Choose the best answer'),
      q.options.map((option, index) =>
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: 'answer',
            value: option,
            onChange: (event) => {
              state.choice = event.target.value;
              refresh();
            },
          }),
          h('span', { class: 'choice-card' }, h('span', { class: 'key', 'aria-hidden': 'true' }, String(index + 1)), h('span', { class: 'choice-text' }, option)),
        ),
      ),
    );
  } else if (q.type === 'reorder') {
    const answerList = h('ol', { class: 'slots', 'aria-label': 'Your sentence' });
    const bank = h('ul', { class: 'bank', 'aria-label': 'Available words' });
    redrawReorder = () => {
      answerList.replaceChildren();
      if (state.tokens.length === 0) answerList.append(h('li', { class: 'slots-empty' }, 'Choose the words below in the right order'));
      state.tokens.forEach((id) => {
        answerList.append(
          h('li', {}, h('button', { type: 'button', class: 'word placed', 'aria-label': `Remove ${q.words[id]}`, onClick: (event) => {
            state.tokens = state.tokens.filter((t) => t !== id);
            redrawReorder();
            refresh();
            // Keyboard users keep their place: focus the word that returned to the bank.
            if (event.detail === 0) bank.querySelectorAll('.word')[q.tokens.findIndex((t) => t.id === id)]?.focus();
          } }, q.words[id])),
        );
      });
      bank.replaceChildren(
        ...q.tokens.map((token, index) => {
          const used = state.tokens.includes(token.id);
          return h('li', {}, h('button', { type: 'button', class: 'word', disabled: used ? true : null, 'aria-label': `${index + 1}: ${token.text}`, onClick: (event) => {
            if (!controller.pickToken(index)) return;
            // Keyboard users: the activated word is now disabled, so move focus on instead of losing it.
            if (event.detail === 0) (bank.querySelector('.word:not(:disabled)') || continueBtn).focus();
          } }, h('span', { class: 'key', 'aria-hidden': 'true' }, String(index + 1)), token.text));
        }),
      );
    };
    redrawReorder();
    widget = h(
      'div',
      { class: 'reorder' },
      answerList,
      h('div', { class: 'reorder-tools' },
        h('span', { class: 'muted small' }, 'Keys: number = add word, Backspace = undo'),
        h('button', { type: 'button', class: 'btn ghost small', onClick: (event) => { state.tokens = []; redrawReorder(); refresh(); if (event.detail === 0) bank.querySelector('.word')?.focus(); else event.currentTarget.blur(); } }, 'Reset')),
      bank,
    );
  } else {
    typedInput = h('input', {
      type: 'text',
      id: 'typed-answer',
      class: 'text-input',
      autocomplete: 'off',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      maxlength: '40',
      onInput: refresh,
    });
    widget = h(
      'div',
      { class: 'typed' },
      q.type === 'word-formation' ? h('p', { class: 'base-word' }, 'Word to change: ', h('strong', {}, q.base)) : null,
      h('label', { for: 'typed-answer' }, 'Your answer'),
      typedInput,
    );
    focusTarget = typedInput;
  }

  const heading = h('h2', { class: 'q-number', tabindex: '-1', 'data-autofocus': true }, `Question ${number} `, h('span', { class: 'muted' }, `of ${total}`));
  if (!focusTarget) focusTarget = heading;

  const progress = h(
    'div',
    { class: 'progress', role: 'progressbar', 'aria-label': 'Test progress', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(number - 1), 'aria-valuetext': `${number - 1} of ${total} questions answered` },
    h('div', { class: 'progress-fill', style: `width:${((number - 1) / total) * 100}%` }),
  );

  const element = h(
    'div',
    { class: passage ? 'view question-view wide' : 'view question-view' },
    h(
      'section',
      { class: 'card question-card', 'aria-label': `Question ${number}` },
      h('div', { class: 'q-top' }, heading, h('div', { class: 'q-top-right' }, timerEl, h('button', { class: 'btn ghost small', type: 'button', onClick: handlers.onExit }, 'Save and exit'))),
      progress,
      h('div', { class: 'q-meta' }, h('span', { class: `chip cat-${q.category}` }, CATEGORY_LABEL[q.category]), h('span', { class: 'muted' }, q.passage ? 'Read the passage, then answer the question.' : INSTRUCTIONS[q.type])),
      h(
        'div',
        { class: passage ? 'q-body with-passage' : 'q-body' },
        passage
          ? h('figure', { class: 'passage' }, h('figcaption', {}, passage.title), h('blockquote', {}, h('p', {}, passage.text)))
          : null,
        h(
          'div',
          { class: 'q-main' },
          q.type === 'reorder' ? h('p', { class: 'prompt' }, INSTRUCTIONS.reorder) : h('p', { class: 'prompt' }, withBlank(q.question)),
          widget,
          errorEl,
          h('div', { class: 'q-actions' }, h('button', { class: 'btn ghost', type: 'button', onClick: handlers.onSkip }, "I don't know"), continueBtn),
        ),
      ),
    ),
  );

  return { element, controller };
}

// ------------------------------------------------------------------ results

export function renderResults({ result, handlers, finishedAt }) {
  const { level, info, confidence } = result;
  const confidenceLabel = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }[confidence.label];

  const summary = h(
    'section',
    { class: 'card result-hero', 'aria-labelledby': 'result-title' },
    h('p', { class: 'print-only print-title' }, `English placement test – result (${formatDate(finishedAt)})`),
    h('div', { class: 'level-badge', 'aria-hidden': 'true' }, level === 'Pre-A1' ? '<A1' : level),
    h(
      'div',
      { class: 'result-text' },
      h('p', { class: 'eyebrow' }, 'Your estimated level'),
      h('h1', { id: 'result-title', tabindex: '-1', 'data-autofocus': true }, level === 'Pre-A1' ? 'Below A1 (beginner)' : `${level} · ${info.name}`),
      h('p', { class: 'lead' }, info.summary),
      h('p', { class: `confidence conf-${confidence.label}` }, h('strong', {}, confidenceLabel), h('span', {}, confidence.detail)),
    ),
    h(
      'dl',
      { class: 'stats' },
      stat('Weighted score', `${Math.round(result.score * 100)}%`),
      stat('Correct answers', `${result.correct} / ${result.answered}`),
      stat('Time taken', formatDuration(result.durationMs)),
      stat('Avg. per question', result.answered ? formatDuration(result.durationMs / result.answered) : '–'),
    ),
  );

  const chart = h(
    'section',
    { class: 'card', 'aria-labelledby': 'chart-title' },
    h('h2', { id: 'chart-title' }, 'Accuracy by CEFR level'),
    levelChart(result),
    h('p', { class: 'muted small' }, 'Because the test adapts, you were asked more questions near your own level. Levels below the ones you were asked about count as mastered; levels above count as not reached.'),
  );

  const categories = h(
    'section',
    { class: 'card', 'aria-labelledby': 'cat-title' },
    h('h2', { id: 'cat-title' }, 'Strengths and weaknesses'),
    h('div', { class: 'categories' }, ['grammar', 'vocabulary', 'reading'].map((key) => categoryRow(key, result.perCategory[key]))),
    h('p', { class: 'muted small' }, 'Compared with your own overall performance, with harder questions counting for more. Sections with fewer than three questions are not rated.'),
  );

  const how = h(
    'details',
    { class: 'card method' },
    h('summary', {}, 'How was this level calculated?'),
    h('p', {}, 'Accuracy on each level is corrected for lucky guesses, then combined into a score where level A1 counts 1 and C2 counts 6. You reach a level when you answer about 60% of its questions correctly and have mastered the levels below it. The confidence rating reflects how many questions you answered near your level, how close your score is to a boundary, and how consistent your answers were.'),
  );

  const actions = h(
    'div',
    { class: 'actions no-print' },
    h('button', { class: 'btn primary', id: 'review-btn', type: 'button', onClick: handlers.onReview }, 'Review all answers'),
    h('button', { class: 'btn secondary', type: 'button', onClick: handlers.onPrint }, 'Download result as PDF'),
    h('button', { class: 'btn secondary', id: 'retake-btn', type: 'button', onClick: handlers.onRetake }, 'Retake the test'),
    h('button', { class: 'btn ghost', type: 'button', onClick: handlers.onHome }, 'Back to start'),
  );

  return h('div', { class: 'view results-view' }, summary, actions, h('div', { class: 'grid-2' }, chart, categories), how);
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value));
}

function categoryRow(key, data) {
  const verdicts = {
    strength: ['▲', 'Relative strength', 'strength'],
    weakness: ['▼', 'Relative weakness', 'weakness'],
    typical: ['●', 'In line with your level', 'typical'],
    insufficient: ['–', 'Too few questions', 'insufficient'],
  };
  const [icon, text, cls] = verdicts[data.verdict];
  const percent = data.accuracy === null ? null : Math.round(data.accuracy * 100);
  return h(
    'div',
    { class: 'cat-row' },
    h('div', { class: 'cat-head' }, h('strong', {}, CATEGORY_LABEL[key]), h('span', { class: 'muted' }, data.total ? `${data.correct}/${data.total} correct · ${percent}%` : 'not asked')),
    h('div', { class: 'meter', 'aria-hidden': 'true' }, h('div', { class: `meter-fill ${cls}`, style: `width:${percent ?? 0}%` })),
    h('p', { class: `verdict ${cls}` }, h('span', { 'aria-hidden': 'true' }, `${icon} `), text),
  );
}

/** Accessible bar chart in plain SVG (with an equivalent table for screen readers). */
function levelChart(result) {
  const width = 420;
  const baseline = 190;
  const maxHeight = 140;
  const groupWidth = width / LEVELS.length;
  const barWidth = 40;
  const svg = s('svg', { viewBox: `0 0 ${width} 252`, class: 'chart', role: 'img', 'aria-labelledby': 'chart-svg-title chart-svg-desc', focusable: 'false' });
  const description = LEVELS.map((level) => {
    const b = result.perLevel[level];
    return b.total ? `${level}: ${b.correct} of ${b.total} correct (${Math.round(b.accuracy * 100)}%)` : `${level}: not asked`;
  }).join('. ');
  svg.append(s('title', { id: 'chart-svg-title' }, 'Accuracy by CEFR level'), s('desc', { id: 'chart-svg-desc' }, `${description}. Estimated level: ${result.level}.`));

  [0, 0.5, 1].forEach((tick) => {
    const y = baseline - tick * maxHeight;
    svg.append(s('line', { x1: 0, x2: width, y1: y, y2: y, class: tick === 0 ? 'axis' : 'grid' }));
  });

  LEVELS.forEach((level, index) => {
    const b = result.perLevel[level];
    const cx = groupWidth * index + groupWidth / 2;
    const tested = b.total > 0;
    const height = tested ? Math.max(3, b.accuracy * maxHeight) : 0;
    const isEstimate = level === result.level;
    if (tested) {
      svg.append(s('rect', { x: cx - barWidth / 2, y: baseline - height, width: barWidth, height, rx: 4, class: isEstimate ? 'bar current' : 'bar' }));
      svg.append(s('text', { x: cx, y: baseline - height - 8, class: 'val', 'text-anchor': 'middle' }, `${Math.round(b.accuracy * 100)}%`));
    } else {
      svg.append(s('rect', { x: cx - barWidth / 2, y: baseline - 4, width: barWidth, height: 4, rx: 2, class: 'bar none' }));
      svg.append(s('text', { x: cx, y: baseline - 12, class: 'val muted', 'text-anchor': 'middle' }, '–'));
    }
    svg.append(s('text', { x: cx, y: baseline + 22, class: isEstimate ? 'lvl current' : 'lvl', 'text-anchor': 'middle' }, level));
    svg.append(s('text', { x: cx, y: baseline + 40, class: 'cnt', 'text-anchor': 'middle' }, tested ? `${b.correct}/${b.total}` : 'not asked'));
    if (isEstimate) svg.append(s('text', { x: cx, y: baseline + 58, class: 'you', 'text-anchor': 'middle' }, '▲ you'));
  });

  const table = h(
    'table',
    { class: 'sr-only' },
    h('caption', {}, 'Accuracy by CEFR level'),
    h('thead', {}, h('tr', {}, ['Level', 'Correct', 'Asked', 'Accuracy'].map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, LEVELS.map((level) => {
      const b = result.perLevel[level];
      return h('tr', {}, h('th', { scope: 'row' }, level), h('td', {}, String(b.correct)), h('td', {}, String(b.total)), h('td', {}, b.total ? `${Math.round(b.accuracy * 100)}%` : 'not asked'));
    })),
  );
  return h('figure', { class: 'chart-figure' }, svg, table);
}

// ------------------------------------------------------------------- review

export function renderReview({ session, engine, filter, handlers }) {
  const rows = session.responses.map((response, index) => ({ response, index, question: engine.byId.get(response.id) }));
  const wrong = rows.filter((row) => !row.response.correct);
  const shown = filter === 'wrong' ? wrong : rows;
  const seenPassages = new Set();

  const filterButton = (value, label, count) =>
    h('button', { class: 'seg', type: 'button', 'aria-pressed': String(filter === value), onClick: () => handlers.onFilter(value) }, `${label} (${count})`);

  const list = h(
    'ol',
    { class: 'review-list', 'aria-label': 'Reviewed questions' },
    shown.length === 0
      ? h('li', { class: 'card empty' }, 'No incorrect answers. Excellent work!')
      : shown.map(({ response, index, question }) => {
          const passage = question.passage ? engine.passages.get(question.passage) : null;
          const firstOfPassage = passage && !seenPassages.has(passage.id);
          if (passage) seenPassages.add(passage.id);
          return reviewCard({ response, index, question, passage, showPassage: Boolean(firstOfPassage) });
        }),
  );

  return h(
    'div',
    { class: 'view review-view' },
    h(
      'section',
      { class: 'card' },
      h('p', { class: 'print-only print-title' }, 'English placement test – answer review'),
      h('h1', { id: 'review-title', tabindex: '-1', 'data-autofocus': true }, 'Review your answers'),
      h('p', { class: 'muted' }, `${rows.length - wrong.length} of ${rows.length} correct. Every question is listed with your answer, the correct answer and a short explanation.`),
      h('div', { class: 'review-controls no-print' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter questions' }, filterButton('all', 'All', rows.length), filterButton('wrong', 'Incorrect only', wrong.length)),
        h('div', { class: 'row' },
          h('button', { class: 'btn secondary', type: 'button', onClick: handlers.onPrint }, 'Print / save as PDF'),
          h('button', { class: 'btn primary', id: 'back-results', type: 'button', onClick: handlers.onBack }, 'Back to result'))),
    ),
    list,
  );
}

function reviewCard({ response, index, question, passage, showPassage }) {
  const status = response.correct ? ['✓', 'Correct', 'ok'] : response.timedOut ? ['⏱', 'Time ran out', 'bad'] : response.skipped ? ['?', 'Skipped', 'bad'] : ['✗', 'Incorrect', 'bad'];
  const yourAnswer = response.answer && response.answer.trim() !== '' ? response.answer : 'No answer';
  const accepted = acceptedAnswers(question);
  const correctText = accepted.length > 1 ? `${accepted[0]} (also accepted: ${accepted.slice(1).join(', ')})` : accepted[0];

  return h(
    'li',
    { class: `card review-item ${status[2]}`, id: `review-${index + 1}` },
    h('div', { class: 'review-head' },
      h('span', { class: 'review-no' }, `Q${index + 1}`),
      h('span', { class: `status ${status[2]}` }, h('span', { 'aria-hidden': 'true' }, `${status[0]} `), status[1]),
      h('span', { class: 'chip' }, question.level),
      h('span', { class: `chip cat-${question.category}` }, CATEGORY_LABEL[question.category]),
      h('span', { class: 'muted small time' }, formatDuration(response.ms))),
    passage && showPassage ? h('figure', { class: 'passage compact' }, h('figcaption', {}, `Passage: ${passage.title}`), h('blockquote', {}, h('p', {}, passage.text))) : null,
    passage && !showPassage ? h('p', { class: 'muted small' }, `Passage: ${passage.title} (shown above)`) : null,
    h('p', { class: 'review-q' }, question.type === 'reorder' ? 'Put the words in the correct order.' : withBlank(question.question), question.type === 'word-formation' ? h('span', { class: 'muted' }, ` (${question.base})`) : null),
    h('dl', { class: 'answers' },
      h('dt', {}, 'Your answer'), h('dd', { class: response.correct ? 'ok' : 'bad' }, yourAnswer),
      response.correct ? null : [h('dt', {}, 'Correct answer'), h('dd', { class: 'ok' }, correctText)]),
    h('p', { class: 'explanation' }, h('strong', {}, 'Why: '), question.explanation),
  );
}

// -------------------------------------------------------------------- misc

export function renderLoading() {
  return h('div', { class: 'view' }, h('p', { class: 'card loading', role: 'status' }, 'Loading questions…'));
}

export function renderError(message, onRetry) {
  return h(
    'div',
    { class: 'view' },
    h('section', { class: 'card error-card', role: 'alert' },
      h('h1', { tabindex: '-1', 'data-autofocus': true }, 'The questions could not be loaded'),
      h('p', {}, message),
      h('p', { class: 'muted' }, 'If you opened index.html directly from disk, serve the folder over HTTP instead (for example with "npx serve .").'),
      h('button', { class: 'btn primary', type: 'button', onClick: onRetry }, 'Try again')),
  );
}