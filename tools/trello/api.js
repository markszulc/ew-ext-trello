const API_ROOT = 'https://api.trello.com/1';
export const TRELLO_ORIGIN = 'https://trello.com';

const CARD_FIELDS = 'name,desc,due,dueComplete,idList,idLabels,idMembers,labels,pos,shortUrl,closed,badges';
const MEMBER_FIELDS = 'fullName,username,initials,avatarUrl';

export class TrelloError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TrelloError';
    this.status = status;
  }
}

export function authorizeUrl({
  key, appName, expiration = '30days', returnUrl,
}) {
  const url = new URL(`${TRELLO_ORIGIN}/1/authorize`);
  url.searchParams.set('key', key);
  url.searchParams.set('name', appName);
  url.searchParams.set('expiration', expiration);
  url.searchParams.set('scope', 'read,write');
  url.searchParams.set('response_type', 'token');
  if (returnUrl) {
    // Trello posts the token back to window.opener, targeted at return_url's origin.
    url.searchParams.set('callback_method', 'postMessage');
    url.searchParams.set('return_url', returnUrl);
  }
  return url.toString();
}

export function createClient({ key, token, fetchImpl = (...args) => fetch(...args) }) {
  async function request(path, { method = 'GET', params = {}, body } = {}) {
    const url = new URL(`${API_ROOT}${path}`);
    url.searchParams.set('key', key);
    url.searchParams.set('token', token);
    Object.entries(params).forEach(([name, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(name, value);
    });
    const opts = { method, headers: { Accept: 'application/json' } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetchImpl(url.toString(), opts);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new TrelloError(text || resp.statusText || `HTTP ${resp.status}`, resp.status);
    }
    const type = resp.headers.get('content-type') || '';
    return type.includes('json') ? resp.json() : resp.text();
  }

  return {
    me: () => request('/members/me', { params: { fields: `id,${MEMBER_FIELDS}` } }),
    boards: () => request('/members/me/boards', {
      params: { filter: 'open', fields: 'name,shortLink,url,prefs' },
    }),
    board: (id) => request(`/boards/${id}`, {
      params: {
        fields: 'name,shortLink,url,prefs,closed,idOrganization',
        memberships: 'all',
        labels: 'all',
        label_fields: 'name,color',
        members: 'all',
        member_fields: MEMBER_FIELDS,
      },
    }),
    lists: (boardId) => request(`/boards/${boardId}/lists`, {
      params: { filter: 'open', fields: 'name,pos', cards: 'open', card_fields: CARD_FIELDS },
    }),
    card: (id) => request(`/cards/${id}`, {
      params: {
        fields: CARD_FIELDS,
        checklists: 'all',
        checkItemStates: 'true',
        actions: 'commentCard',
        actions_limit: 50,
        attachments: 'true',
        attachment_fields: 'name,url',
      },
    }),
    createCard: (fields) => request('/cards', { method: 'POST', body: fields }),
    updateCard: (id, fields) => request(`/cards/${id}`, { method: 'PUT', body: fields }),
    addComment: (id, text) => request(`/cards/${id}/actions/comments`, { method: 'POST', params: { text } }),
    setCheckItem: (cardId, checkItemId, state) => request(
      `/cards/${cardId}/checkItem/${checkItemId}`,
      { method: 'PUT', params: { state } },
    ),
    revokeToken: () => request(`/tokens/${token}`, { method: 'DELETE' }),
  };
}

/**
 * Derive what the current member may do on a board from their membership role
 * and the board's comment preference. Trello remains the source of truth: any
 * request it rejects is surfaced to the user.
 */
export function boardPermissions(board, me) {
  const membership = (board?.memberships || [])
    .find((m) => m.idMember === me?.id && !m.deactivated);
  const role = membership?.memberType || 'none';
  const isMember = role === 'admin' || role === 'normal';
  const commentPref = board?.prefs?.comments || 'members';
  const canComment = {
    disabled: false,
    members: isMember,
    observers: isMember || role === 'observer',
    org: role !== 'none',
    public: true,
  }[commentPref] ?? isMember;
  return {
    role,
    canEdit: isMember,
    canCreate: isMember,
    canComment,
  };
}
