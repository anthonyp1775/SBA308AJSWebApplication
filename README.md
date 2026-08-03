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
