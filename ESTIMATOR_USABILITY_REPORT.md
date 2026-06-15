# Estimator Usability Report
Review date: 2026-06-14  
Reviewer: Code-level analysis of EstimateBuilder.tsx (~2800 lines) + OperationsPage.tsx  
Perspective: Senior signage estimator creating 20-store BOQs all day

---

## Summary

After the latest fixes, Tab flow and store move/duplicate are improved. But the estimate workspace still has **3 P0 showstoppers** that would immediately drive an estimator back to Excel: Ctrl+C/V intercept kills cell-level copy-paste, and the first character you type to start editing is silently swallowed. These two bugs block the most basic typing workflow. Everything else is P1/P2.

---

## P0 — Blocks Estimator Work

### P0-1: Ctrl+C while editing a cell copies the ROW, not cell content

**Where:** `handleCellKeyDown` lines ~1738-1741

```js
if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
  event.preventDefault();
  copySelectedRows();  // fires regardless of editing state
  return;
}
```

**What happens:**  
User is editing the Rate cell (value: 1250). Presses Ctrl+A to select all text, then Ctrl+C to copy it to paste somewhere else — or simply copies from another app to paste here. Instead, `copySelectedRows()` fires, copying the entire row to the row clipboard and **overwriting the system clipboard with tab-separated row data**. The cell value they wanted to copy is gone.

**Impact on 20-store scenario:**  
Estimator is mid-row and wants to paste a rate from a WhatsApp message or Excel. Ctrl+V would paste a ROW not the number. The only workaround is to manually type the value. Excel is faster.

**Fix direction:** When `editing === true`, let Ctrl+C and Ctrl+V pass through to the browser natively. Only intercept when a cell is active but NOT in editing mode.

---

### P0-2: Ctrl+V while editing a cell pastes a ROW, not text

Same root cause as P0-1.

```js
if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
  event.preventDefault();
  pasteAfterSelection();  // fires regardless of editing state
}
```

**What happens:**  
User copies a product name from a PDF. Clicks into the Element cell (editing=true). Presses Ctrl+V. Instead of pasting "SUNBOARD 3MM", `pasteAfterSelection()` fires and inserts an entire duplicate row from the row clipboard (or does nothing if clipboard is empty).

**This is the single strongest reason the estimator would return to Excel.** Paste-into-cell is the most fundamental operation in any spreadsheet.

---

### P0-3: First character that starts editing is silently swallowed

**Where:** Every text cell (`renderTextInput`) + `ProductSearchCell`

**What happens:**  
Cell is in active-but-not-editing state (highlighted but cursor not inside). User presses "F" to start typing "Flex Board" in the Element cell.

1. `onKeyDown` fires on the readOnly input
2. `handleCellKeyDown` sees printable key → calls `beginEditCell(rowIndex, "element")`
3. `beginEditCell` schedules `setEditingCell` (async state update) + `focusCell` (RAF)
4. The "F" keypress itself: `onChange` is not called because `readOnly={!editing}` is still true at this moment
5. On next render, input becomes writable. RAF fires, selects all (empty string).
6. User sees empty input. The "F" is gone.

**User experience:** You press "F", nothing appears. You press "F" again, now "F" shows. For touch typists, this means every first character of every cell requires a double-strike. Across 100 rows × 8 fields = 800 swallowed keystrokes in a single estimate.

**Fix direction:** In `handleCellKeyDown`, when a printable key starts edit mode on a text cell, capture the key character and set it as the initial `cellDraft` value, then position cursor at end.

---

## P1 — Significantly Slows Estimator

### P1-1: No keyboard shortcut to insert a row at cursor position

**Current state:** The only keyboard path to add a row is Tab at the last field of the last row (creates a new row at the bottom). There is no keyboard shortcut to insert a row between existing rows.

**Real-world scenario:** Estimator is on row 7 of 20. Realizes they missed an item. They must:
- Mouse-click toolbar "Add Row" (top of page, far from cursor), OR
- Mouse-click the store header "+" button

Every row insertion requires a mouse trip. In a 100-row estimate with 15 corrections, that's 15 forced mouse moves.

**Fix direction:** `Alt+Enter` or `Ctrl+Insert` = insert blank row below current selection.

---

### P1-2: Store header disappears when scrolling inside a large store

**Where:** `<th colSpan={tableCols} className="eb-store-header">` — not sticky

**What happens:** A store with 40 rows. User scrolls down to row 30. The store header (showing "Mumbai — Andheri W | MHPL...") has scrolled off screen. The column labels row IS sticky (`<thead className="... sticky top-0">`), but the store title above it is not.

User is now filling row 30 with no visual cue of which store they're in. If two stores have similar layouts, mistakes happen.

**Fix direction:** Give `eb-store-header` `position: sticky; top: 0; z-index: 31` (one above the column labels). Store title stays visible while scrolling the rows.

---

### P1-3: Critical computed values are not memoized — triggers on every keystroke

**Where:** Inside the main render IIFE (lines ~1445–1560)

Three expensive operations run on EVERY render — every keystroke, every click, every focus change:

**a) `storeBreakdown`** — 20 stores × 100 rows = 2000 `.filter()` operations + 8 `.reduce()` per store per render:
```js
const storeBreakdown = activeStoreIds.map(sid => {
  const rows = estItems.filter(it => String(it.storeId) === sid);  // O(n) per store
  const productRows = rows.filter(r => r.lineType === "product" || !r.lineType);
  // ... 6 more filters, 8 reduces
});
```

**b) `visibleGridRows`** — full linear scan of estItems per render:
```js
const visibleGridRows = estItems.filter((row: any) => { ... });
```

**c) `navigableColumnIds`** — re-derived every render from `gridColumns.filter(...).map(...)`.

**Impact at scale:** At 20 stores, 100 rows, typing in a rate cell:
- Tab is pressed → state update → re-render
- storeBreakdown: 2000 filter ops + 160 reduce ops
- visibleGridRows: 100 filter ops
- navigableColumnIds: 15+ array ops
- PLUS `recalculateEstimateRows` over all 100 rows

Perceptible lag begins at ~50 rows. At 200+ rows it will feel sluggish.

**Fix direction:** Wrap `storeBreakdown`, `visibleGridRows`, and `navigableColumnIds` in `React.useMemo` with `[estItems, activeStoreIds, ...]` dependencies. Also memoize `rowMatchesFilters` with `useCallback`.

---

### P1-4: Column header row is repeated for every store — 20× visual noise

**What happens:** Each store renders its own `<table>` with its own `<thead>`:
```
[Store 1 header: "Mumbai Andheri W"]
[EL | HSN | Std | Product Details | W | H | Qty | Rate | ...]  ← header row 1
[row 1]
[row 2]
[Store 2 header: "Delhi CP"]
[EL | HSN | Std | Product Details | W | H | Qty | Rate | ...]  ← header row 2 (identical)
[row 1]
...
```

With 20 stores, there are 20 identical column header rows. This wastes ~400px of vertical space on a typical screen and creates visual clutter that slows scanning.

**Excel equivalent:** One frozen header row at the top. Rows from all stores flow underneath. Store breaks are indicated by a shaded separator row, not a full re-header.

---

### P1-5: Duplicate store — `window.prompt()` blocks the browser

**Where:** `duplicateStore()` in EstimateBuilder.tsx

The rename dialog is a synchronous `window.prompt()`. This:
- Completely blocks JavaScript execution
- Freezes all browser animations
- Looks like a browser security dialog (users associate it with phishing)
- Breaks on mobile (prompt() is disabled on many mobile browsers)

Any tool that uses `window.prompt` in 2026 signals "amateur software" to a power user. This is the first thing they'll screenshot to show colleagues why they prefer Excel.

**Fix direction:** Inline rename: after duplication, put the new store header's name into an `<input>` in-place with the name pre-selected. Press Enter to confirm, Escape to use default. Same pattern as renaming a tab in Excel or a layer in Figma.

---

### P1-6: No keyboard shortcut to open the store picker

**Current state:** The estimator adds 20 stores. Workflow for stores 2–20:
1. Fill row(s) for current store via keyboard
2. **Reach for mouse** to click "Add Store" in the toolbar
3. Store picker opens
4. Type to search
5. Enter to add

Step 2 is a forced mouse interruption after every store. For 20 stores, that's 19 forced mouse grabs.

**Fix direction:** `Ctrl+Shift+A` or `Ctrl+Shift+S` to open the store picker. Document in the shortcut hint bar.

---

### P1-7: No `Ctrl+A` to select all rows

Standard spreadsheet behavior. Currently absent. When the user wants to select all rows to copy them across to another store estimate, they must Shift+Click each store's checkbox, or use the new store header checkboxes individually.

---

### P1-8: No `F2` to enter edit mode

Excel standard: F2 enters edit mode for the active cell. Currently only double-click or printable character starts editing (with character swallow, P0-3). Power users who learned on Excel instinctively hit F2 when they want to edit a cell they're looking at. Nothing happens.

---

### P1-9: Paste has no visual feedback — no clipboard indicator

After Ctrl+C copies 3 rows, the toolbar "Paste" button becomes enabled. But:
- No count of how many rows are in the clipboard
- No visual preview of what will paste
- No highlight on the newly pasted rows after paste

User presses Ctrl+V and genuinely cannot tell if it worked. They may press it again, doubling the paste.

---

### P1-10: "Find" only jumps to first match, cannot cycle

`focusFirstFindMatch()` finds the first matching row and selects it. Pressing Enter in the find box again does nothing. To find the next "SUNBOARD" row, the user must scroll manually.

Excel: Ctrl+F → type → Enter repeatedly cycles through all matches.

---

### P1-11: "Standard" column select — cannot be activated purely by Tab

**Root cause:** The `<select>` element is `disabled={!editing}`. When `focusCell(rowIndex, "standard", true)` is called:
1. `setEditingCell({ rowIndex, columnId: "standard" })` is called (React async state update)
2. `requestAnimationFrame(() => el?.focus())` is scheduled
3. RAF fires — but React may not have re-rendered yet
4. `disabled` is still `true` — `el.focus()` on a disabled element is silently ignored

In practice this manifests as: Tab lands on the Standard column, the highlight appears, but the select does nothing and may not accept keyboard input. The user has to press Enter (or any key) a second time to actually engage the select.

**Fix direction:** Either remove `disabled` entirely and control editability through CSS pointer-events, or use a different pattern (e.g., a button that shows a dropdown on click/Enter, not a native select).

---

### P1-12: No feedback after delete — users don't know Ctrl+Z undoes it

Delete/Backspace on selected rows deletes them silently. No toast: "3 rows deleted · Ctrl+Z to undo". Users who accidentally delete rows sometimes don't realize it until several actions later, at which point the undo chain is consumed.

---

## P2 — Polish

### P2-1: No autosave / no draft recovery

A 2-hour 100-row estimate in a browser tab. The estimator accidentally closes the tab. Everything is lost. The only warning is the `beforeunload` dialog, which appears after the close action has begun.

**Minimum viable:** localStorage autosave every 60 seconds. On form open, if a saved draft exists for the current estimate number, offer "Restore draft from [timestamp]?". This is table stakes for any web app that holds significant user work.

---

### P2-2: No "unsaved changes" badge

During a 2-hour session, the estimator has no persistent visual cue that they're working in an unsaved state. The save bar at the bottom says "Ctrl+S to save" but does not say "● Unsaved". After making 50 changes, they might assume it auto-saved.

---

### P2-3: Active cell highlight is not prominent enough

The `eb-cell-active` CSS class is applied to the active cell. From the code, this is used for styling. But in a dense grid with 15 columns and 30 rows, the active cell needs to be immediately obvious — ideally with a blue border ring like Excel's current-cell indicator, not just a background tint.

Without a clear active cell indicator, estimators lose their place when switching focus between monitors or looking at reference materials.

---

### P2-4: Element column is not frozen — disappears on horizontal scroll

`fixed` columns in the grid are `select` and `sl` (row number). The `element` column — the most important column that identifies what's being estimated — is NOT frozen.

When the user scrolls right to see GST%, GST Amount, CGST%, Total columns, the element names disappear. They must scroll left to check what they're looking at, then scroll right again. For a 12-column grid this is constant back-and-forth.

**Fix direction:** Make `element` column fixed (sticky-left) alongside `sl`.

---

### P2-5: Product dropdown limited to 30 results

```js
return productOptions.filter(...).slice(0, 30);
```

For an estimator with 150+ active products, if their item doesn't appear in the top 30 filtered results, they must type more characters to narrow down. "S" might show 30 "Sunboard" variants but miss the "Smooth Paper" they wanted. The arbitrary 30 cap is invisible to the user.

---

### P2-6: Right-click context menu is absent

Every Excel power user uses right-click → Insert, Delete, Copy, Paste, Format Cells. This app has no right-click menu. Users who reach for right-click on a row get the browser's default context menu (inspect, save page, etc.) which is jarring.

---

### P2-7: Cannot sort rows within a store

An estimator who fills 20 rows in random order wants to sort by Element name, or by Rate descending to find the most expensive items first. No sort is available.

---

### P2-8: No range selection (only row selection)

Can select multiple ROWS (via checkbox or Shift+click). Cannot select a rectangular RANGE of cells. Cannot copy just "rates from column J, rows 5-12" to paste into a different column. Full Excel-style range copy is missing.

---

### P2-9: SmartSizeInput suggestion disappears on Tab without applying

When `width = 45` and the suggestion tooltip shows "Nearest standard: 48", pressing Tab navigates away WITHOUT applying 48. The value stays 45. The user sees the tooltip, assumes Tab accepted it, and moves on. Rate is then wrong.

The behavior should be: Tab applies the suggestion AND navigates, or the suggestion tooltip disappears immediately (not showing it if Tab won't apply it).

---

### P2-10: Toolbar button labels — actions not always discoverable

Store header action buttons are icon-only (FileSpreadsheet = Duplicate, MoveUp, MoveDown, Trash, Copy, ClipboardPaste). Tooltips only appear after 1s hover. For a new estimator or a power user who hasn't memorized the icon set, discovery requires hovering every button.

**Fix direction:** Show text labels on the store header when width allows, or show keyboard shortcut badges on hover.

---

## Scenario 3 — Excel Replacement Test

**"If the user had Excel on one screen and Sunrise Estimate on another, what would make them return to Excel?"**

Ranked by likelihood of switching back:

| # | Reason | Root cause |
|---|---|---|
| 1 | Can't paste a value from clipboard into a cell (Ctrl+V inserts a ROW) | P0-2 |
| 2 | Typing first character doesn't appear — must type it twice | P0-3 |
| 3 | Can't copy a cell value out (Ctrl+C copies the row, overwrites clipboard) | P0-1 |
| 4 | No autosave — hours of work can vanish | P2-1 |
| 5 | `window.prompt()` for store rename looks like malware | P1-5 |
| 6 | No F2 to enter edit mode | P1-8 |
| 7 | Lag at 200+ rows (storeBreakdown not memoized) | P1-3 |
| 8 | No sort within a store | P2-7 |
| 9 | No right-click menu | P2-6 |
| 10 | Can't copy a rectangular range (only whole rows) | P2-8 |
| 11 | No find-next cycling (only first match) | P1-10 |
| 12 | Element name disappears when scrolling right | P2-4 |
| 13 | Store header disappears in large stores | P1-2 |

The top 3 are all triggered in the first 60 seconds of use. If the estimator hits any of P0-1/2/3 in their first minute, they will close the tab.

---

## Store Duplication Workflow — Redesign Proposal

**Current:** `window.prompt("Name for duplicated store:", defaultName)`

**Proposed inline flow:**
1. User clicks Duplicate Store icon
2. New store appears immediately at the bottom with all rows copied
3. Store header title renders as an `<input>` element (not a `<span>`) with the default "Copy" name pre-selected
4. Cursor is in the name input, blue border
5. User types new name (or accepts default)
6. Press Enter → name is saved, input reverts to text display
7. Press Escape → reverts to default name

This is the pattern used by browser tabs, Figma layers, Excel sheet tabs. It feels native and does not block the page.

---

## Store Selection Model — Current Assessment

| Operation | Current State | Issues |
|---|---|---|
| Select one row | Click row body OR checkbox | ✓ Works |
| Select multiple rows | Shift+click, Ctrl+click, or checkboxes | ✓ Works |
| Select all rows in a store | Store header checkbox (just added) | ✓ Works |
| Copy selected rows | Ctrl+C | ✓ Works for row clipboard |
| Paste to different store | Ctrl+V with row selected in target store | ✓ Fixed (storeId now corrected) |
| Select all rows everywhere | No Ctrl+A | ✗ Missing |
| Visual paste feedback | None | ✗ Missing |
| Copy cell value (not row) | Not possible — Ctrl+C copies row | ✗ P0-2 |

---

## Grid Behavior — Assessment

| Feature | Current | Verdict |
|---|---|---|
| Frozen select + sl column | ✓ | Good |
| Frozen Element column | ✗ | Missing — P2-4 |
| Store header sticky | ✗ | Missing — P1-2 |
| Column labels sticky per store | ✓ (`sticky top-0` on thead) | Works but competes with summary bar |
| Sticky totals bar | ✓ (`position: sticky; top: 0; z-index: 30`) | Good |
| Active cell visible | Partial (eb-cell-active class) | Needs stronger visual — P2-3 |
| Tab skip calculated cols | ✓ (just fixed) | Good |
| Arrow keys navigate all cols | ✓ | Good |
| Enter = next field | ✓ | Good |
| New row on Tab past last field | ✓ | Good |

---

## Bulk Operations — Assessment

| Operation | Works at 20 stores | Issues |
|---|---|---|
| Copy entire store (checkbox + Ctrl+C) | ✓ | No paste count feedback |
| Paste store rows to different store | ✓ (storeId fixed) | No preview of what will paste |
| Move store up/down | ✓ (ordinal fix applied) | Triggers full recalc — may lag at scale |
| Delete store | ✓ | No undo feedback |
| Duplicate store | ✓ | `window.prompt()` is P1-5 |
| Collapse/expand store | ✓ | |

---

## Performance Projections

| Scale | Expected behavior | Risk |
|---|---|---|
| 5 stores, 50 rows | Smooth | Low |
| 10 stores, 100 rows | Slight lag on Tab/Enter | Medium — `storeBreakdown` unmemoized |
| 20 stores, 200 rows | Noticeable lag (200-400ms on keystroke) | High |
| 50 stores, 500 rows | Grid freezes on every edit | Critical |

**Root cause of scale failure:** `storeBreakdown` O(stores × rows) computed inside render IIFE on every state change. `recalculateEstimateRows` runs over ALL rows on every `applyGridMutation`. Both must be addressed before 20-store estimates become standard.

---

## Product Selection UX — Assessment

| Aspect | Current behavior | Verdict |
|---|---|---|
| Search speed | Filtered client-side from loaded products list | Fast |
| Dropdown opens on focus | ✓ | Good |
| Arrow keys to navigate | ✓ | Good |
| Enter to select | ✓ | Good |
| Tab to select + advance | ✓ | Good |
| Focus after selection | Goes to width (next editable col) | ✓ Good |
| Max results shown | 30 (hardcoded) | P2-5 |
| First char swallowed if not editing | ✗ | P0-3 |

---

## Save Workflow — Assessment

| Feature | Current | Verdict |
|---|---|---|
| Ctrl+S to save | ✓ | Good |
| Save button disabled while saving | ✓ (isSaving, just added) | Good |
| "Saving..." text on button | ✓ (just added) | Good |
| Duplicate-save on slow connection | Fixed | Good |
| Unsaved changes indicator | ✗ (only beforeunload + Cancel warn) | P2-2 |
| Autosave | ✗ | P2-1 |
| Post-save confirmation | Toast message ✓ | Good |
| Save shortcut shown in UI | ✓ ("Ctrl+S to save" in hint bar) | Good |

---

## Implementation Priority Order

Fix in this exact sequence for maximum impact with minimum risk:

1. **P0-1 + P0-2** (1 change): Skip Ctrl+C/V interception when `editing === true`. Two-line change in `handleCellKeyDown`.
2. **P0-3**: Capture the trigger character when starting edit mode and set it as the initial draft.
3. **P1-2**: Make store header sticky (`position: sticky; top: 0`).
4. **P1-4**: Inline store rename (replace `window.prompt`).
5. **P1-3**: Memoize `storeBreakdown`, `visibleGridRows`, `navigableColumnIds`.
6. **P1-1**: `Alt+Enter` = insert row below.
7. **P1-8**: `F2` = enter edit mode.
8. **P1-7**: `Ctrl+A` = select all rows.
9. **P2-4**: Freeze `element` column.
10. **P2-1**: localStorage autosave.
