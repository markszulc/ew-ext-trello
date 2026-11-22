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
 *
 * returnUrl: optional return_url sent to Trello's authorize page (or `?return_url=`).
 *   Defaults to the panel's own origin. Its origin must be in "Allowed origins",
 *   and the token is only delivered back to the panel when it is on the same origin.
 */
export default {
  apiKey: '',
  appName: 'Experience Workspace',
  defaultBoardId: '',
  returnUrl: '',
  tokenExpiration: '30days',
};
