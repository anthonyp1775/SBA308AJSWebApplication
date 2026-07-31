# Scouter — a Dragon Ball combat index

A single-page app for browsing the fighters of the Dragon Ball universe. Search
by name, filter by race, allegiance, and gender, sort by power level, save
favorites, and open a full file on anyone in the archive.

Data comes from the free [Dragon Ball API](https://web.dragonball-api.com/documentation).
No build step, no dependencies, no API key.

---

## Running it

The app uses ES modules, and browsers refuse to load modules from `file://`.
Open it through a local server instead — any of these work:

```bash
# Python (already on macOS and most Linux machines)
cd dragon-ball-scouter
python3 -m http.server 5500

# Node
npx serve .

# VS Code
# Right-click index.html → "Open with Live Server"
```

Then visit **http://localhost:5500**.

An internet connection is required — the app fetches live data on load.

---

## File structure

```
dragon-ball-scouter/
├── index.html          markup and the module entry point
├── css/
│   └── styles.css      the whole visual system
└── js/
    ├── main.js         entry point: wires state, API, and UI together
    ├── api.js          every network call, plus caching and error types
    ├── state.js        the store — one object, publish/subscribe
    ├── ui.js           every DOM write
    ├── favorites.js    saved fighters, persisted to localStorage
    └── utils.js        debounce, promise helpers, ki parsing, formatting
```

Each module has exactly one job and imports only what it needs. `api.js` never
touches the DOM; `ui.js` never fetches.

---

## Where each requirement lives

| Requirement | Where to look |
|---|---|
| **Modules and imports** | Six ES modules under `js/`, loaded via `<script type="module">`. Every file uses named `export` / `import`. |
| **fetch against an external API** | `api.js` → `request()` wraps `fetch` with headers, abort signals, status checks, and a response cache. |
| **async / await** | `api.js` → `request`, `getCharacters`, `getArchiveSnapshot`; `main.js` → `loadResults`, `openCharacterFile`, `scanFighter`, `init`. |
| **Promises** | `utils.js` → `preloadImage` and `delay` are hand-built `new Promise(...)` wrappers around image events and `setTimeout`. |
| **Promise combinators** | `Promise.all` runs the portrait download alongside the lock-on animation (`main.js` → `scanFighter`) and fetches the remaining archive pages concurrently (`api.js` → `getArchiveSnapshot`). `Promise.allSettled` boots the grid and the filter menus together in `init` so one failure doesn't take down the other. |
| **Event loop** | See the section below. |
| **Error handling** | `ApiError` in `api.js`; retry toast and empty states in `main.js` and `ui.js`. Try it with your network disconnected. |

---

## The event loop, in practice

Four places in this app exist specifically because of how the loop schedules work:

1. **Debounced search** (`utils.js` → `debounce`). Each keystroke clears a
   pending timer and queues a new one. The callback is a macrotask, so it can
   only run after the current call stack empties — typing "goku" fires one
   request instead of four.

2. **Batched renders** (`state.js` → `notify`). Subscribers are notified inside
   `queueMicrotask`. Microtasks drain after the current synchronous block but
   *before* the browser paints, so several state changes in the same tick
   collapse into a single render.

3. **Non-blocking animation** (`utils.js` → `countUp`). The power reading counts
   up inside `requestAnimationFrame`. Each frame yields control back to the
   loop, so the page stays responsive while the scouter climbs — a `while`
   loop doing the same math would freeze the tab.

4. **Suspension, not blocking** (`api.js` → `request`). `await fetch(...)` pauses
   the function and returns control to the loop. Clicks, scrolls, and repaints
   keep being handled; execution resumes in a microtask once the response
   lands.

Stale requests are cancelled too: `loadResults` aborts any in-flight request
through an `AbortController` before starting a new one, so a slow response from
an old query can't overwrite fresh results.

---

## Features

- **Live scouter feed** — a random fighter is scanned on load, with the power
  reading animating up from zero. "Scan another fighter" pulls a new one.
- **Search** — debounced, matches partial names.
- **Filters** — race, allegiance, and gender menus are built from the archive
  itself at startup, so the options always reflect the real data.
- **Sorting** — by power level or name. Power sorting normalizes the API's three
  different ki notations (`60.000.000`, `90 Septillion`, `unknown`) into
  comparable numbers first; fighters with no reading sort to the bottom rather
  than reading as the weakest.
- **Saved fighters** — starred characters persist in `localStorage`.
- **Character files** — a dialog with transformations, maximum power, and origin
  planet.
- **Pagination** — server-side when browsing, client-side when the API returns
  a filtered set whole.
- **Resilience** — skeleton loaders, an empty state per situation, a retry toast
  on network failure, and a fallback image for missing art.
- **Accessibility** — keyboard-operable cards, visible focus rings, live status
  announcements, a skip link, and `prefers-reduced-motion` respected.

---

## Design notes

The visual direction is a printed manga page crossed with a scouter HUD: bone
newsprint with a halftone screen, hard 3px ink rules and offset shadows instead
of soft blur, and the palette taken straight from the source — gi orange,
undershirt indigo, dragon ball gold, star crimson. Green appears in exactly one
place, inside the power readouts, because that's the color of the lens.

Type is Anton for display, Archivo for body copy, and IBM Plex Mono for anything
that's meant to read as instrument data.

---

## Credits

Character data and art via the [Dragon Ball API](https://web.dragonball-api.com/documentation).
Dragon Ball and its characters belong to their respective rights holders. This is
a non-commercial student project with no affiliation.
