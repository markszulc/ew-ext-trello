// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import config from './config.js';
import {
  createClient, authorizeUrl, boardPermissions, TrelloError, TRELLO_ORIGIN,
} from './api.js';

const SDK_TIMEOUT_MS = 3000;
const STORAGE = {
  token: 'ew-trello:token',
  key: 'ew-trello:key',
  board: 'ew-trello:board',
  hideDone: 'ew-trello:hide-done',
};

const params = new URLSearchParams(window.location.search);
const app = document.getElementById('trello-app');
// Trello only accepts a return_url whose origin is in the Power-Up's Allowed origins.
const returnUrl = params.get('return_url') || config.returnUrl || window.location.origin;

const state = {
  sdk: null,
  key: params.get('key') || config.apiKey || localStorage.getItem(STORAGE.key) || '',
  token: localStorage.getItem(STORAGE.token) || '',
  client: null,
  me: null,
  boards: [],
  board: null,
  lists: [],
  perms: { role: 'none', canEdit: false, canCreate: false, canComment: false },
  filter: '',
  hideDone: localStorage.getItem(STORAGE.hideDone) === 'true',
  openLists: new Set(),
};

/* ---------- DOM helpers ---------- */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([name, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (name.startsWith('on') && typeof value === 'function') {
      el.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'class') {
      el.className = value;
    } else if (name === 'value') {
      el.value = value;
    } else if (name in el && typeof value !== 'string') {
      el[name] = value;
    } else {
      el.setAttribute(name, value === true ? '' : value);
    }
  });
  children.flat().forEach((child) => {
    if (child === undefined || child === null || child === false) return;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return el;
}

// Minimal line icons drawn to match Spectrum 2's 20px stroke style.
const ICONS = {
  refresh: ['M16 10a6 6 0 1 1-1.8-4.3', 'M14.5 2.75v3h-3'],
  logout: ['M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8', 'M12.5 6.5 16 10l-3.5 3.5', 'M16 10H8'],
  external: ['M11 4h5v5', 'M16 4l-7 7', 'M14 12v2.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 14.5v-7A1.5 1.5 0 0 1 5.5 6H8'],
  chevron: ['M8 5l5 5-5 5'],
  back: ['M12 5l-5 5 5 5'],
  clock: ['M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M10 6.5V10l2.5 1.5'],
  comment: ['M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3 3v-3h-.5A1.5 1.5 0 0 1 4 11.5z'],
  checklist: ['M4 6l1.5 1.5L8 5', 'M10.5 6.5H16', 'M4 12l1.5 1.5L8 11', 'M10.5 12.5H16'],
  text: ['M4 6h12', 'M4 10h12', 'M4 14h8'],
  checkmark: ['M5 10.5l3 3 7-7'],
  add: ['M10 4v12', 'M4 10h12'],
};

function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  // Presentation attributes keep icons small and outlined even before the stylesheet applies.
  Object.entries({
    viewBox: '0 0 20 20',
    width: '18',
    height: '18',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: `tp-icon tp-icon-${name}`,
  }).forEach(([k, v]) => svg.setAttribute(k, v));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  ICONS[name].forEach((d) => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

function render(...nodes) {
  app.replaceChildren(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
}

let statusTimer;
function status(message, type = 'info') {
  let region = document.querySelector('.tp-status');
  if (!region) {
    region = h('div', { class: 'tp-status', role: 'status' });
    document.body.append(region);
  }
  region.textContent = message;
  region.dataset.type = type;
  region.hidden = !message;
  clearTimeout(statusTimer);
  if (message) statusTimer = setTimeout(() => { region.hidden = true; }, type === 'error' ? 8000 : 3000);
}

function errorMessage(err) {
  if (err instanceof TrelloError) {
    if (err.status === 401) return 'Trello rejected the request: you do not have permission, or your token expired.';
    if (err.status === 403) return 'You do not have permission to do that on this board.';
    if (err.status === 404) return 'Not found in Trello (it may have been deleted or you lost access).';
    if (err.status === 429) return 'Trello rate limit reached. Please wait a moment and retry.';
    return `Trello error (${err.status}): ${err.message}`;
  }
  return err?.message || String(err);
}

async function run(task, { success, busyEl } = {}) {
  if (busyEl) busyEl.disabled = true;
  try {
    const result = await task();
    if (success) status(success, 'success');
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    if (err instanceof TrelloError && err.status === 401 && err.message.includes('invalid token')) {
      // eslint-disable-next-line no-use-before-define
      disconnect(false);
      status('Your Trello session expired. Please reconnect.', 'error');
      return undefined;
    }
    status(errorMessage(err), 'error');
    return undefined;
  } finally {
    if (busyEl) busyEl.disabled = false;
  }
}

/* ---------- Formatting ---------- */

function dueInfo(card) {
  if (!card.due) return null;
  const due = new Date(card.due);
  const now = new Date();
  let tone = 'normal';
  if (card.dueComplete) tone = 'done';
  else if (due < now) tone = 'overdue';
  else if (due - now < 24 * 60 * 60 * 1000) tone = 'soon';
  const label = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { tone, label, full: due.toLocaleString() };
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function labelChip(label, { pressed, onClick } = {}) {
  const text = label.name || label.color || 'label';
  const attrs = { class: 'tp-label', 'data-color': label.color || 'none', title: text };
  if (onClick) {
    return h('button', {
      ...attrs, type: 'button', 'aria-pressed': String(!!pressed), onClick,
    }, text);
  }
  return h('span', attrs, text);
}

function memberAvatar(member) {
  if (!member) return null;
  return h('span', { class: 'tp-avatar', title: member.fullName || member.username }, member.initials || '?');
}

/* ---------- Data ---------- */

function findCard(id) {
  for (const list of state.lists) {
    const card = list.cards.find((c) => c.id === id);
    if (card) return { list, card };
  }
  return {};
}

function upsertCard(card) {
  state.lists.forEach((list) => {
    list.cards = list.cards.filter((c) => c.id !== card.id);
  });
  if (card.closed) return;
  const list = state.lists.find((l) => l.id === card.idList);
  if (list) {
    list.cards.push(card);
    list.cards.sort((a, b) => a.pos - b.pos);
  }
}

function boardMember(id) {
  return state.board?.members?.find((m) => m.id === id);
}

async function loadBoard(boardId) {
  const [board, lists] = await Promise.all([
    state.client.board(boardId),
    state.client.lists(boardId),
  ]);
  state.board = board;
  state.lists = lists;
  state.perms = boardPermissions(board, state.me);
  localStorage.setItem(STORAGE.board, board.id);
  if (!lists.some((l) => state.openLists.has(l.id))) {
    lists.slice(0, 3).forEach((l) => state.openLists.add(l.id));
  }
}

/* ---------- Views ---------- */

function sdkNotice() {
  if (state.sdk) return null;
  return h('p', { class: 'tp-notice' }, 'Standalone mode: not connected to Experience Workspace. Trello features still work.');
}

function header() {
  const boardSelect = h(
    'select',
    {
      class: 'tp-board-select',
      'aria-label': 'Board',
      onChange: async (e) => {
        // eslint-disable-next-line no-use-before-define
        await run(() => loadBoard(e.target.value).then(showBoard));
      },
    },
    state.boards.map((b) => h('option', { value: b.id, selected: b.id === state.board?.id }, b.name)),
  );
  return h(
    'header',
    { class: 'tp-header' },
    h('div', { class: 'tp-header-row' }, boardSelect,
      h('button', {
        type: 'button',
        class: 'tp-icon-btn',
        title: 'Refresh',
        'aria-label': 'Refresh',
        onClick: async (e) => {
          // eslint-disable-next-line no-use-before-define
          await run(() => loadBoard(state.board.id).then(showBoard), { busyEl: e.currentTarget, success: 'Refreshed' });
        },
      }, icon('refresh')),
      h('button', {
        type: 'button',
        class: 'tp-icon-btn',
        title: 'Disconnect Trello',
        'aria-label': 'Disconnect Trello',
        // eslint-disable-next-line no-use-before-define
        onClick: () => disconnect(true),
      }, icon('logout'))),
    h('div', { class: 'tp-header-row tp-muted tp-small' },
      memberAvatar(state.me),
      h('span', {}, state.me?.fullName || state.me?.username || ''),
      h('span', { class: `tp-role tp-role-${state.perms.role}` }, state.perms.canEdit ? state.perms.role : `${state.perms.role} · read-only`),
      state.board ? h('a', { href: state.board.url, target: '_blank', rel: 'noopener' }, 'Open in Trello', icon('external')) : null),
  );
}

async function toggleComplete(card, el) {
  const dueComplete = !card.dueComplete;
  const updated = await run(
    () => state.client.updateCard(card.id, { dueComplete }),
    { busyEl: el, success: dueComplete ? 'Card completed' : 'Card reopened' },
  );
  if (updated) upsertCard({ ...card, ...updated });
  return updated;
}

function cardItem(card) {
  const due = dueInfo(card);
  const checkbox = h('button', {
    type: 'button',
    class: 'tp-check',
    role: 'checkbox',
    'aria-checked': String(!!card.dueComplete),
    'aria-label': card.dueComplete ? `Reopen ${card.name}` : `Complete ${card.name}`,
    disabled: !state.perms.canEdit,
    onClick: async (e) => {
      e.stopPropagation();
      // eslint-disable-next-line no-use-before-define
      if (await toggleComplete(card, e.currentTarget)) showBoard();
    },
  }, icon('checkmark'));
  const badges = card.badges || {};
  return h(
    'li',
    { class: `tp-card${card.dueComplete ? ' is-done' : ''}` },
    checkbox,
    h(
      'button',
      // eslint-disable-next-line no-use-before-define
      { type: 'button', class: 'tp-card-body', onClick: () => showCard(card.id) },
      card.labels?.length ? h('span', { class: 'tp-card-labels' }, card.labels.map((l) => h('span', { class: 'tp-label-dot', 'data-color': l.color || 'none', title: l.name || l.color }))) : null,
      h('span', { class: 'tp-card-name' }, card.name),
      h(
        'span',
        { class: 'tp-card-meta' },
        due ? h('span', { class: `tp-meta tp-due tp-due-${due.tone}`, title: due.full }, icon('clock'), due.label) : null,
        card.desc ? h('span', { class: 'tp-meta', title: 'Has description' }, icon('text')) : null,
        badges.comments ? h('span', { class: 'tp-meta', title: 'Comments' }, icon('comment'), String(badges.comments)) : null,
        badges.checkItems ? h('span', { class: 'tp-meta', title: 'Checklist' }, icon('checklist'), `${badges.checkItemsChecked}/${badges.checkItems}`) : null,
        h('span', { class: 'tp-card-members' }, (card.idMembers || []).map((id) => memberAvatar(boardMember(id)))),
      ),
    ),
  );
}

function matchesFilter(card) {
  if (state.hideDone && card.dueComplete) return false;
  if (!state.filter) return true;
  const q = state.filter.toLowerCase();
  return card.name.toLowerCase().includes(q)
    || (card.desc || '').toLowerCase().includes(q)
    || (card.labels || []).some((l) => (l.name || '').toLowerCase().includes(q));
}

function listsView() {
  return h('div', { class: 'tp-lists' }, state.lists.map((list) => {
    const cards = list.cards.filter(matchesFilter);
    const details = h(
      'details',
      {
        class: 'tp-list',
        open: state.openLists.has(list.id) || !!state.filter,
        onToggle: (e) => {
          if (e.target.open) state.openLists.add(list.id);
          else state.openLists.delete(list.id);
        },
      },
      h('summary', {}, icon('chevron'), h('span', { class: 'tp-list-name' }, list.name), h('span', { class: 'tp-count' }, String(cards.length))),
      cards.length
        ? h('ul', { class: 'tp-cards' }, cards.map(cardItem))
        : h('p', { class: 'tp-muted tp-small tp-empty' }, state.filter ? 'No matching cards' : 'No cards'),
      state.perms.canCreate
        ? h('button', {
          type: 'button',
          class: 'tp-link-btn',
          // eslint-disable-next-line no-use-before-define
          onClick: () => showCreate(list.id),
        }, icon('add'), 'Add a card')
        : null,
    );
    return details;
  }));
}

function showBoard() {
  const listsHost = h('div', {}, listsView());
  const rerenderLists = () => listsHost.replaceChildren(listsView());
  const toolbar = h(
    'div',
    { class: 'tp-toolbar' },
    h('input', {
      type: 'search',
      class: 'tp-input',
      placeholder: 'Filter cards…',
      'aria-label': 'Filter cards',
      value: state.filter,
      onInput: (e) => { state.filter = e.target.value; rerenderLists(); },
    }),
    h('label', { class: 'tp-toggle tp-small' }, h('input', {
      type: 'checkbox',
      checked: state.hideDone,
      onChange: (e) => {
        state.hideDone = e.target.checked;
        localStorage.setItem(STORAGE.hideDone, String(state.hideDone));
        rerenderLists();
      },
    }), 'Hide completed'),
    state.perms.canCreate
      // eslint-disable-next-line no-use-before-define
      ? h('button', { type: 'button', class: 'tp-btn tp-btn-primary', onClick: () => showCreate() }, icon('add'), 'New card')
      : null,
  );
  render(sdkNotice(), header(), toolbar, listsHost);
}

function listSelect(selectedId, attrs = {}) {
  return h(
    'select',
    { class: 'tp-input', ...attrs },
    state.lists.map((l) => h('option', { value: l.id, selected: l.id === selectedId }, l.name)),
  );
}

function field(label, control, id) {
  if (id) control.id = id;
  return h('div', { class: 'tp-field' }, h('label', { for: id }, label), control);
}

function backButton() {
  return h('button', { type: 'button', class: 'tp-link-btn tp-back', onClick: showBoard }, icon('back'), 'Back to board');
}

function sdkActions(card) {
  const actions = state.sdk?.actions;
  if (!actions) return [];
  const buttons = [];
  if (actions.sendHTML) {
    buttons.push(h('button', {
      type: 'button',
      class: 'tp-btn',
      onClick: () => {
        actions.sendHTML(`<a href="${escapeHtml(card.shortUrl)}">${escapeHtml(card.name)}</a>`);
        status('Link inserted into the page', 'success');
      },
    }, 'Insert link in page'));
  }
  if (actions.setPrompt) {
    buttons.push(h('button', {
      type: 'button',
      class: 'tp-btn',
      onClick: () => {
        const desc = card.desc ? ` The card description is: ${card.desc.trim()}` : '';
        actions.setPrompt(`I'm working on the Trello card "${card.name}" (${card.shortUrl}).${desc} Help me with this task for the page I currently have open.`, { autoSend: false });
        status('Sent to the Assistant chat', 'success');
      },
    }, 'Ask Assistant'));
  }
  return buttons;
}

async function showCard(cardId) {
  render(sdkNotice(), header(), backButton(), h('p', { class: 'tp-muted' }, 'Loading card…'));
  const card = await run(() => state.client.card(cardId));
  if (!card) { showBoard(); return; }
  const { canEdit, canComment } = state.perms;
  const disabled = !canEdit;

  const nameInput = h('textarea', {
    class: 'tp-input tp-title-input', rows: 2, disabled, value: card.name,
  });
  const descInput = h('textarea', {
    class: 'tp-input', rows: 6, disabled, value: card.desc || '', placeholder: canEdit ? 'Add a more detailed description…' : 'No description',
  });
  const dueInput = h('input', {
    type: 'datetime-local', class: 'tp-input', disabled, value: toLocalInput(card.due),
  });
  const listInput = listSelect(card.idList, { disabled });
  const selectedLabels = new Set(card.idLabels || []);
  const selectedMembers = new Set(card.idMembers || []);

  const visibleLabels = canEdit
    ? (state.board.labels || [])
    : (state.board.labels || []).filter((l) => selectedLabels.has(l.id));
  const labelPicker = h('div', { class: 'tp-chips' }, visibleLabels.map((label) => labelChip(label, {
    pressed: selectedLabels.has(label.id),
    onClick: canEdit ? (e) => {
      const btn = e.currentTarget;
      if (selectedLabels.has(label.id)) selectedLabels.delete(label.id);
      else selectedLabels.add(label.id);
      btn.setAttribute('aria-pressed', String(selectedLabels.has(label.id)));
    } : undefined,
  })));
  if (!visibleLabels.length) labelPicker.append(h('span', { class: 'tp-muted tp-small' }, 'No labels'));

  const memberPicker = h('div', { class: 'tp-chips' }, (state.board.members || []).map((m) => h('button', {
    type: 'button',
    class: 'tp-member-chip',
    'aria-pressed': String(selectedMembers.has(m.id)),
    disabled,
    onClick: (e) => {
      if (selectedMembers.has(m.id)) selectedMembers.delete(m.id);
      else selectedMembers.add(m.id);
      e.currentTarget.setAttribute('aria-pressed', String(selectedMembers.has(m.id)));
    },
  }, memberAvatar(m), m.fullName || m.username)));

  const completeBtn = h('button', {
    type: 'button',
    class: `tp-btn ${card.dueComplete ? '' : 'tp-btn-success'}`,
    disabled,
    onClick: async (e) => {
      if (await toggleComplete(card, e.currentTarget)) showCard(card.id);
    },
  }, card.dueComplete ? [icon('refresh'), 'Mark incomplete'] : [icon('checkmark'), 'Mark complete']);

  const saveBtn = h('button', {
    type: 'submit', class: 'tp-btn tp-btn-primary', disabled,
  }, 'Save changes');

  const form = h(
    'form',
    {
      class: 'tp-form',
      onSubmit: async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) { status('A card needs a title', 'error'); return; }
        const updated = await run(() => state.client.updateCard(card.id, {
          name,
          desc: descInput.value,
          due: fromLocalInput(dueInput.value),
          idList: listInput.value,
          idLabels: [...selectedLabels].join(','),
          idMembers: [...selectedMembers].join(','),
        }), { busyEl: saveBtn, success: 'Card saved' });
        if (updated) {
          upsertCard(updated);
          showCard(card.id);
        }
      },
    },
    field('Title', nameInput, 'tp-card-name'),
    h('div', { class: 'tp-row' }, completeBtn, card.dueComplete ? h('span', { class: 'tp-pill tp-pill-done' }, 'Completed') : null),
    field('List', listInput, 'tp-card-list'),
    field('Due date', dueInput, 'tp-card-due'),
    h('div', { class: 'tp-field' }, h('span', { class: 'tp-field-label' }, 'Labels'), labelPicker),
    h('div', { class: 'tp-field' }, h('span', { class: 'tp-field-label' }, 'Members'), memberPicker),
    field('Description', descInput, 'tp-card-desc'),
    canEdit ? h('div', { class: 'tp-row' }, saveBtn) : h('p', { class: 'tp-notice' }, `You are a${state.perms.role === 'observer' ? 'n observer' : ' non-member'} on this board, so this card is read-only.`),
  );

  const checklists = (card.checklists || []).map((cl) => {
    const done = cl.checkItems.filter((i) => i.state === 'complete').length;
    return h(
      'section',
      { class: 'tp-section' },
      h('h3', {}, `${cl.name} `, h('span', { class: 'tp-muted tp-small' }, `${done}/${cl.checkItems.length}`)),
      h('ul', { class: 'tp-checklist' }, cl.checkItems.sort((a, b) => a.pos - b.pos).map((item) => h(
        'li',
        {},
        h('label', {}, h('input', {
          type: 'checkbox',
          checked: item.state === 'complete',
          disabled,
          onChange: async (e) => {
            const next = e.target.checked ? 'complete' : 'incomplete';
            const ok = await run(() => state.client.setCheckItem(card.id, item.id, next), { busyEl: e.target });
            if (ok) item.state = next;
            else e.target.checked = !e.target.checked;
          },
        }), item.name),
      ))),
    );
  });

  const comments = (card.actions || []).filter((a) => a.type === 'commentCard');
  const commentInput = h('textarea', { class: 'tp-input', rows: 2, placeholder: 'Write a comment…' });
  const commentBtn = h('button', { type: 'submit', class: 'tp-btn' }, 'Comment');
  const commentsSection = h(
    'section',
    { class: 'tp-section' },
    h('h3', {}, 'Comments'),
    canComment ? h('form', {
      class: 'tp-form',
      onSubmit: async (e) => {
        e.preventDefault();
        const text = commentInput.value.trim();
        if (!text) return;
        const ok = await run(() => state.client.addComment(card.id, text), { busyEl: commentBtn, success: 'Comment added' });
        if (ok) showCard(card.id);
      },
    }, commentInput, h('div', { class: 'tp-row' }, commentBtn)) : h('p', { class: 'tp-muted tp-small' }, 'Commenting is not allowed for you on this board.'),
    comments.length
      ? h('ul', { class: 'tp-comments' }, comments.map((c) => h(
        'li',
        {},
        h('div', { class: 'tp-small tp-muted' }, memberAvatar(c.memberCreator), ` ${c.memberCreator?.fullName || ''} · ${new Date(c.date).toLocaleString()}`),
        h('p', { class: 'tp-pre' }, c.data?.text || ''),
      )))
      : h('p', { class: 'tp-muted tp-small' }, 'No comments yet'),
  );

  const attachments = card.attachments?.length
    ? h('section', { class: 'tp-section' }, h('h3', {}, 'Attachments'), h('ul', { class: 'tp-plain-list' }, card.attachments.map((a) => h('li', {}, h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.name || a.url)))))
    : null;

  const archiveBtn = canEdit ? h('button', {
    type: 'button',
    class: 'tp-btn tp-btn-danger',
    onClick: async (e) => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Archive "${card.name}"?`)) return;
      const updated = await run(() => state.client.updateCard(card.id, { closed: true }), { busyEl: e.currentTarget, success: 'Card archived' });
      if (updated) { upsertCard({ ...card, closed: true }); showBoard(); }
    },
  }, 'Archive') : null;

  render(
    sdkNotice(),
    header(),
    backButton(),
    form,
    ...checklists,
    attachments,
    commentsSection,
    h('div', { class: 'tp-row tp-actions' },
      h('a', {
        class: 'tp-btn', href: card.shortUrl, target: '_blank', rel: 'noopener',
      }, 'Open in Trello', icon('external')),
      ...sdkActions(card),
      archiveBtn),
  );
}

function showCreate(listId) {
  const nameInput = h('textarea', {
    class: 'tp-input tp-title-input', rows: 2, required: true, placeholder: 'Card title',
  });
  const descInput = h('textarea', { class: 'tp-input', rows: 4, placeholder: 'Description (optional)' });
  const dueInput = h('input', { type: 'datetime-local', class: 'tp-input' });
  const listInput = listSelect(listId || state.lists[0]?.id);
  const positionInput = h('select', { class: 'tp-input' }, h('option', { value: 'bottom' }, 'Bottom of list'), h('option', { value: 'top' }, 'Top of list'));
  const selectedLabels = new Set();
  const labelPicker = h('div', { class: 'tp-chips' }, (state.board.labels || []).map((label) => labelChip(label, {
    pressed: false,
    onClick: (e) => {
      if (selectedLabels.has(label.id)) selectedLabels.delete(label.id);
      else selectedLabels.add(label.id);
      e.currentTarget.setAttribute('aria-pressed', String(selectedLabels.has(label.id)));
    },
  })));
  const assignMe = h('input', { type: 'checkbox' });
  const createBtn = h('button', { type: 'submit', class: 'tp-btn tp-btn-primary' }, 'Create card');

  if (!state.lists.length) {
    render(sdkNotice(), header(), backButton(), h('p', { class: 'tp-notice' }, 'This board has no lists. Create a list in Trello first.'));
    return;
  }

  render(
    sdkNotice(),
    header(),
    backButton(),
    h('h2', { class: 'tp-h2' }, 'New card'),
    h(
      'form',
      {
        class: 'tp-form',
        onSubmit: async (e) => {
          e.preventDefault();
          const name = nameInput.value.trim();
          if (!name) { status('A card needs a title', 'error'); return; }
          const created = await run(() => state.client.createCard({
            idList: listInput.value,
            name,
            desc: descInput.value || undefined,
            due: fromLocalInput(dueInput.value) || undefined,
            pos: positionInput.value,
            idLabels: selectedLabels.size ? [...selectedLabels].join(',') : undefined,
            idMembers: assignMe.checked ? state.me.id : undefined,
          }), { busyEl: createBtn, success: 'Card created' });
          if (created) {
            await run(() => loadBoard(state.board.id));
            state.openLists.add(created.idList);
            showCard(created.id);
          }
        },
      },
      field('Title', nameInput, 'tp-new-name'),
      field('List', listInput, 'tp-new-list'),
      field('Position', positionInput, 'tp-new-pos'),
      field('Due date', dueInput, 'tp-new-due'),
      state.board.labels?.length ? h('div', { class: 'tp-field' }, h('span', { class: 'tp-field-label' }, 'Labels'), labelPicker) : null,
      h('label', { class: 'tp-toggle' }, assignMe, 'Assign to me'),
      field('Description', descInput, 'tp-new-desc'),
      h('div', { class: 'tp-row' }, createBtn, h('button', { type: 'button', class: 'tp-btn', onClick: showBoard }, 'Cancel')),
    ),
  );
  nameInput.focus();
}

/* ---------- Connect / bootstrap ---------- */

function saveToken(token) {
  state.token = token.trim();
  localStorage.setItem(STORAGE.token, state.token);
  // eslint-disable-next-line no-use-before-define
  start();
}

function showConnect(message) {
  const keyInput = h('input', {
    class: 'tp-input', value: state.key, placeholder: 'Trello API key', autocomplete: 'off',
  });
  const tokenInput = h('input', {
    class: 'tp-input', type: 'password', placeholder: 'Paste token', autocomplete: 'off',
  });
  const needsKey = !(params.get('key') || config.apiKey);

  const readKey = () => {
    const key = keyInput.value.trim();
    if (!key) { status('Enter your Trello API key first', 'error'); return null; }
    state.key = key;
    if (needsKey) localStorage.setItem(STORAGE.key, key);
    return key;
  };

  const connect = () => {
    const key = readKey();
    if (!key) return;
    const popup = window.open(
      authorizeUrl({
        key, appName: config.appName, expiration: config.tokenExpiration, returnUrl,
      }),
      'trello-auth',
      'width=600,height=720',
    );
    if (!popup) {
      status('Popup blocked. Use "Get a token manually" below instead.', 'error');
      return;
    }
    const onMessage = (event) => {
      if (event.origin !== TRELLO_ORIGIN || event.source !== popup) return;
      window.clearInterval(closedPoll);
      window.removeEventListener('message', onMessage);
      popup.close();
      if (typeof event.data === 'string' && event.data.length > 20) saveToken(event.data);
      else status('Trello authorization was cancelled.', 'error');
    };
    window.addEventListener('message', onMessage);
    // Trello posts the token to return_url's origin, so a return_url on another origin never reaches this page.
    const closedPoll = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(closedPoll);
      window.removeEventListener('message', onMessage);
      if (!state.token && new URL(returnUrl, window.location.href).origin !== window.location.origin) {
        status('No token received. return_url is on a different origin; use "Get a token manually".', 'error');
      }
    }, 1000);
  };

  render(
    sdkNotice(),
    h(
      'section',
      { class: 'tp-connect' },
      h('h1', { class: 'tp-h1' }, 'Connect Trello'),
      h('p', { class: 'tp-muted' }, 'View and update your Trello boards without leaving Experience Workspace. You will only be able to do what your Trello account allows on each board.'),
      message ? h('p', { class: 'tp-notice tp-notice-error' }, message) : null,
      needsKey ? field('API key', keyInput, 'tp-key') : null,
      needsKey ? h('p', { class: 'tp-small tp-muted' }, 'Find it in the Trello Power-Up admin portal (trello.com/power-ups/admin).') : null,
      h('button', { type: 'button', class: 'tp-btn tp-btn-primary tp-block', onClick: connect }, 'Connect with Trello'),
      h(
        'details',
        { class: 'tp-manual' },
        h('summary', {}, 'Get a token manually'),
        h('p', { class: 'tp-small' }, '1. ', h('a', {
          href: '#',
          onClick: (e) => {
            e.preventDefault();
            const key = readKey();
            if (key) window.open(authorizeUrl({ key, appName: config.appName, expiration: config.tokenExpiration }), '_blank', 'noopener');
          },
        }, 'Open the Trello authorization page'), ', click Allow and copy the token.'),
        h('p', { class: 'tp-small' }, '2. Paste it here:'),
        h('form', {
          class: 'tp-row',
          onSubmit: (e) => {
            e.preventDefault();
            if (!readKey()) return;
            if (tokenInput.value.trim()) saveToken(tokenInput.value);
          },
        }, tokenInput, h('button', { type: 'submit', class: 'tp-btn' }, 'Save')),
      ),
    ),
  );
}

async function disconnect(revoke) {
  if (revoke && state.client) {
    // Best effort: invalidate the token server-side too.
    await state.client.revokeToken().catch(() => {});
  }
  localStorage.removeItem(STORAGE.token);
  Object.assign(state, {
    token: '', client: null, me: null, board: null, boards: [], lists: [],
  });
  showConnect();
}

async function start() {
  if (!state.key || !state.token) { showConnect(); return; }
  render(sdkNotice(), h('p', { class: 'tp-muted' }, 'Loading your Trello boards…'));
  state.client = createClient({ key: state.key, token: state.token });
  try {
    [state.me, state.boards] = await Promise.all([state.client.me(), state.client.boards()]);
  } catch (err) {
    if (err instanceof TrelloError && err.status === 401) {
      localStorage.removeItem(STORAGE.token);
      state.token = '';
      showConnect('Your Trello token is invalid or expired. Please reconnect.');
      return;
    }
    showConnect(errorMessage(err));
    return;
  }
  if (!state.boards.length) {
    render(sdkNotice(), h('p', { class: 'tp-notice' }, 'You have no open Trello boards.'));
    return;
  }
  const wanted = params.get('board') || config.defaultBoardId || localStorage.getItem(STORAGE.board);
  const board = state.boards.find((b) => b.id === wanted || b.shortLink === wanted) || state.boards[0];
  const ok = await run(() => loadBoard(board.id).then(() => true));
  if (ok) showBoard();
  else if (board.id !== state.boards[0].id) {
    localStorage.removeItem(STORAGE.board);
    await run(() => loadBoard(state.boards[0].id).then(showBoard));
  }
}

async function init() {
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), SDK_TIMEOUT_MS); });
  state.sdk = await Promise.race([DA_SDK, timeout]);
  start();
}

init();
