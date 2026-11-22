# Trello side panel for Experience Workspace

A side-panel plugin for [Experience Workspace](https://www.aem.live/docs/ew/developing/apps-plugins) that lets authors view and update Trello boards without leaving the editor.

## Features

- Pick any of your open Trello boards. The panel remembers the last one you used.
- Browse lists as collapsible sections, with a filter box and a "Hide completed" toggle.
- Card summaries show labels, due date (overdue or due soon), comment and checklist counts, and members.
- **Complete or reopen** a card with one click. This uses Trello's `dueComplete` checkbox.
- **Card details** show and edit the title, description, list (to move the card), due date, labels and members. You can also tick checklist items, read and add comments, view attachments and archive the card.
- **Create cards** with a title, list, position, due date, labels, description and an "Assign to me" option.
- **Permissions** follow your Trello role on each board:
  - `admin` and `normal` members can edit.
  - `observer` and non-members get read-only access.
  - Commenting follows the board's comment setting.
  - Trello still enforces every request, so if it rejects one, the panel shows the error.
- **Experience Workspace extras** (shown only when the panel runs inside Experience Workspace):
  - "Insert link in page" (`actions.sendHTML`)
  - "Ask Assistant" (`actions.setPrompt`) pre-fills the chat with the card's context.

## Try it without installing

A hosted copy is published to GitHub Pages, so you can evaluate the panel without copying any files:

1. Open `https://da.live/config#/{org}/{site}` and go to the **library** tab.
2. Add a row:

   | title | path |
   |---|---|
   | Trello | `https://markszulc.github.io/ew-ext-trello/tools/trello/trello.html` |

3. Save, then open Canvas (for example `https://da.live/canvas#/{org}/{site}/index`) and choose **Trello** from the side-panel switcher.
4. Enter your Trello API key and click **Connect with Trello**. Your Power-Up's **Allowed origins** must include `https://markszulc.github.io` (see [Setup](#setup)). You can also use **Get a token manually**, which doesn't need an allowed origin.

The token is stored in your browser for the `markszulc.github.io` origin only.

## Files

```
tools/trello/
  trello.html   # page loaded in the side-panel iframe
  trello.js     # UI and DA SDK integration
  api.js        # Trello REST client and permission logic
  trello.css    # Spectrum 2 tokens and component styling sized for the panel
  config.js     # API key and default board
```

Copy `tools/trello/` into your Edge Delivery Services project repository. The plugin has no dependencies and no build step.

## Setup

1. **Trello API key.** Create a Power-Up at <https://trello.com/power-ups/admin>, open **API key** and generate a key.
   - Add every origin that will serve the panel to **Allowed origins**, for example `http://localhost:3000`, `https://main--{site}--{org}.aem.live` or `https://markszulc.github.io` for the hosted copy.
   - Then set `apiKey` in `config.js`. You can instead append `?key=...` to the library path, or leave it empty so each user pastes a key.
2. **Register the panel.** Open `https://da.live/config#/{org}/{site}`, go to the **library** tab and add a row:

   | title | path |
   |---|---|
   | Trello (local) | `http://localhost:3000/tools/trello/trello.html` |
   | Trello | `https://main--{site}--{org}.aem.live/tools/trello/trello.html` |

   Optional: append `?board={boardShortLink}` to open a specific board first.

   **URL parameters.** You can configure the panel from the library path itself, for example:

   ```
   https://markszulc.github.io/ew-ext-trello/tools/trello/trello.html?key={apiKey}&return_url=https://markszulc.github.io
   ```

   | parameter | purpose |
   |---|---|
   | `key` | Trello API key. Skips the key field on the connect screen. |
   | `return_url` | `return_url` sent to Trello's authorize page. Defaults to the panel's origin. Its origin must be in the Power-Up's **Allowed origins**. |
   | `board` | Board id or short link to open first. |

   Trello sends the token back only to the `return_url` origin. If that isn't the origin serving the panel, the popup can't hand the token over, so use **Get a token manually** instead.
3. Run `aem up` and open Canvas, for example `https://da.live/canvas#/{org}/{site}/index`. Choose **Trello** from the side-panel switcher.
4. Click **Connect with Trello**. A Trello popup asks you to allow read and write access, and the token comes back to the panel. If the popup is blocked, use **Get a token manually** and paste the token instead.

## Notes

- The token is stored in `localStorage` on the panel's origin and expires after 30 days (`tokenExpiration` in `config.js`). **Disconnect** (the sign-out icon next to Refresh) revokes it with Trello and clears it.
- Outside Experience Workspace, the panel switches to standalone mode after 3 seconds. Trello features keep working there, which is useful for local testing at `http://localhost:3000/tools/trello/trello.html`.
