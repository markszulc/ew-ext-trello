/**
 * Trello side panel configuration.
 *
 * apiKey: your Trello Power-Up API key (https://trello.com/power-ups/admin).
 *   The API key is public by design; the per-user token is what grants access.
 *   Add the origins the panel is served from (e.g. http://localhost:3000 and
 *   https://main--{site}--{org}.aem.live) to the Power-Up's "Allowed origins".
 *   Leave empty to let each user paste a key on the connect screen.
 *   Can also be supplied via the `?key=` query param on the library row path.
 *
 * defaultBoardId: optional board id/shortLink to open first (or `?board=`).
 */
export default {
  apiKey: '',
  appName: 'Experience Workspace',
  defaultBoardId: '',
  tokenExpiration: '30days',
};
