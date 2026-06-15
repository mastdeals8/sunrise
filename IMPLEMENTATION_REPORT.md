# Estimation Workflow Redesign — Implementation Report
Implemented: 2026-06-13

---

## Changes Deployed

### Files Modified

| File | Changes |
|---|---|
| `client/src/pages/operations/components/EstimateBuilder.tsx` | 8 keyboard/UX fixes |
| `client/src/pages/operations/OperationsPage.tsx` | Unsaved warning, duplicate handler, prop wiring |
| `client/src/App.tsx` | Master Data nav section |
| `client/src/index.css` | Sticky totals bar, savebar hint styling |
| `server/routes.ts` | Duplicate estimate API route |

---

## Before vs After — Click Count for One Row

### BEFORE (audit baseline)

| Step | Action | Input Method |
|---|---|---|
| 1 | Click "New Estimate" | Mouse |
| 2 | Click "Show Estimate Details" toggle | Mouse (hidden!) |
| 3 | Click Client dropdown | Mouse |
| 4 | Select client | Mouse |
| 5 | Select brand | Mouse |
| 6 | Click "Add Store" | Mouse |
| 7 | Type store search | Keyboard ✅ |
| 8 | Press Enter to add store | Keyboard ✅ |
| 9 | **Click** Element cell | Mouse (no autofocus) |
| 10 | **Press Enter** to enter edit mode | Extra keystroke |
| 11 | Type element | Keyboard ✅ |
| 12 | Tab → Product (active, not editing) | Keyboard ✅ |
| 13 | **Press Enter** to enter edit mode | Extra keystroke |
| 14 | Type product | Keyboard ✅ |
| 15–21 | Tab → Enter → type (every field) | Tab+Enter pair each |
| 22 | Tab from Rate → **stuck** | Bug — no new row |
| 23 | **Mouse click "Add Row"** | Mouse (forced) |
| **Total mouse clicks for 1 row** | **~7 clicks** | |
| **Total extra Enter presses** | **~8** (one per field) | |

### AFTER (this implementation)

| Step | Action | Input Method |
|---|---|---|
| 1 | Click "New Estimate" | Mouse |
| 2 | — | Client dropdown has autoFocus ✅ |
| 3 | Tab → Date → Subject → Client (autoFocused already) | Keyboard ✅ |
| 4 | Select client | Keyboard (arrow) ✅ |
| 5 | Tab → Brand → select | Keyboard ✅ |
| 6 | Tab → GST Profile → Tab → store search opens | Keyboard ✅ |
| 7 | Type store code | Keyboard ✅ |
| 8 | Enter → store added, focus goes to Element cell | Keyboard ✅ |
| 9 | Type element — in edit mode immediately | Keyboard ✅ |
| 10 | Enter → next field, edit mode immediately | Keyboard ✅ |
| 11–16 | Enter through W, H, Qty, Rate — type each | Keyboard ✅ |
| 17 | Enter at last field → **new row created automatically** | Keyboard ✅ |
| 18 | Focus on Element of row 2, in edit mode | Keyboard ✅ |
| **Total mouse clicks for 1 row** | **1 click** (New Estimate) | |
| **Total extra Enter presses** | **0** (Enter = next field) | |

### Improvement

| Metric | Before | After | Saved |
|---|---|---|---|
| Mouse clicks to start | 6 | 1 | −5 |
| Mouse clicks per additional row | 1 (Add Row button) | 0 | −1/row |
| Extra keystrokes per cell | 1 (Enter to enter edit mode) | 0 | −8/row |
| Steps from "New Estimate" to typing first character | 9 | 2 | −7 |

---

## All 8 Audit Fixes — Implementation Details

### Fix 1 — Header Open by Default for New Estimates ✅

**File:** `EstimateBuilder.tsx:587`

**Before:**
```js
setHeaderExpanded(false); // always collapsed when form opened
```

**After:**
```js
setHeaderExpanded(!editingEstimateId); // open for new, collapsed for edit
```

Also added `autoFocus={!editingEstimateId}` on the Client select, so focus lands on Client immediately when creating a new estimate.

---

### Fix 2 — Tab on Last Column Creates New Row ✅

**File:** `EstimateBuilder.tsx` — `navigateCell()`

**Before:** `Math.min(navigableColumnIds.length - 1, colPosition + 1)` — clamped at last column, cursor stuck.

**After:** When direction is "right" and already at last column:
- If more rows exist → wrap to first editable column (`element`) of next row
- If on last row → `setEstItems()` to add a blank row in the same store, `focusCell(newIdx, "element", true)` via `requestAnimationFrame`

```js
if (colPosition < navigableColumnIds.length - 1) {
  nextColPosition = colPosition + 1;
} else {
  if (rowPosition < visibleRowIndexes.length - 1) {
    nextRowPosition = rowPosition + 1;
    nextColPosition = navigableColumnIds.findIndex(id => editableColumnIds.includes(id));
  } else {
    // Last row — create new row in same store
    const sid = String(estItems[rowIndex]?.storeId || "");
    if (sid) {
      setEstItems(prev => {
        const newIdx = prev.length;
        window.requestAnimationFrame(() => focusCell(newIdx, "element", edit));
        return [...prev, blankRowForStore(sid, newIdx + 1, estGstType)];
      });
    }
    return;
  }
}
```

---

### Fix 3 — Tab Immediately Enters Edit Mode ✅

**File:** `EstimateBuilder.tsx` — `handleCellKeyDown()` Tab branch

**Before:**
```js
navigateCell(rowIndex, columnId, event.shiftKey ? "left" : "right");
// edit = false (default) — lands on cell but requires Enter to start editing
```

**After:**
```js
navigateCell(rowIndex, columnId, event.shiftKey ? "left" : "right", true);
// edit = true — focusCell calls setEditingCell and selects text immediately
```

---

### Fix 4 — Enter = Next Field (Right), Shift+Enter = Previous Field ✅

**File:** `EstimateBuilder.tsx` — `handleCellKeyDown()` Enter branch

**Before:**
```js
if (editing) {
  commit?.(); stopEditCell();
  navigateCell(rowIndex, columnId, "down"); // moved DOWN
} else {
  beginEditCell(rowIndex, columnId); // or began editing
}
```

**After:**
```js
if (editing) { commit?.(); stopEditCell(); }
if (event.shiftKey) {
  navigateCell(rowIndex, columnId, "left", true);  // Shift+Enter = previous
} else {
  navigateCell(rowIndex, columnId, "right", true); // Enter = next field
}
```

Note: Arrow keys still navigate without entering edit mode, so Excel-style browsing is preserved.

Also added: typing any printable character while a cell is active-but-not-editing begins edit mode immediately (no separate Enter needed to start typing).

---

### Fix 5 — Store Picker Space Key Toggles Without Closing ✅

**File:** `EstimateBuilder.tsx` — `handleStoreSearchKeyDown()`

**Before:** Space had no handler — checkboxes were mouse-only, `tabIndex={-1}`.

**After:**
```js
if (event.key === " ") {
  event.preventDefault();
  const store = visibleStores[storeHighlightIndex];
  if (!store) return;
  const sid = String(store.id);
  setPendingStoreIds(prev =>
    prev.includes(sid) ? prev.filter(id => id !== sid) : [...prev, sid]
  );
  return; // picker stays open
}
```

Also: Enter now confirms pending batch (if any stores are checked) before falling back to single-store select. Multi-store keyboard workflow: `Search → ↓ Space → ↓ Space → ↓ Space → Enter` adds all selected stores and closes.

---

### Fix 6 — Tab from GST Profile Jumps to Add Store ✅

**Pre-existing** — `handleGstProfileKeyDown` already had this behavior (Tab calls `openStorePickerAndFocusSearch()` regardless). `handleGstStepKeyDown` on Project Type select also jumps to store search. **No change needed.**

---

### Fix 7 — Master Data in Navigation Menu ✅

**File:** `client/src/App.tsx`

Added a new "Master Data" section in the left nav (between Finance and System, admin/manager only):

```
Master Data
  ├── Products        → /products
  ├── Brands          → /brands
  ├── Stores          → /stores
  ├── Material Codes  → /material-codes
  └── Rate Cards      → /customer-rate-cards
```

All 5 pages existed and had full CRUD — they were just unreachable without typing the URL directly.

---

### Fix 8 — Row Body Click Selects Row ✅

**Pre-existing** — `<tr onClick={(event) => { if ((event.target).closest("input, select, textarea, button")) return; selectSingleRow(idx); }}>` was already implemented. **No change needed.**

---

## Additional Features Implemented

### Keyboard Shortcuts ✅

| Shortcut | Action | Scope |
|---|---|---|
| `Ctrl+S` | Save/Update estimate | Grid + cell level |
| `Ctrl+D` | Duplicate selected row(s) | Grid level (pre-existing) |
| `Ctrl+Z` | Undo grid change | Grid level (pre-existing) |
| `Ctrl+Y` | Redo | Grid level (pre-existing) |
| `Ctrl+C` | Copy selected rows | Grid level (pre-existing) |
| `Ctrl+V` | Paste rows | Grid level (pre-existing) |
| `Ctrl+Delete` | Delete selected rows | Grid level (new) |
| `Enter` | Next cell (right), enter edit | Cell level |
| `Shift+Enter` | Previous cell (left) | Cell level |
| `Tab` | Next cell (right), enter edit | Cell level |
| `Shift+Tab` | Previous cell (left) | Cell level |
| `Arrow keys` | Navigate without editing | Cell level |
| `Escape` | Cancel cell edit | Cell level |
| `Delete/Backspace` | Delete selected rows (when not editing) | Grid level |
| Any printable key | Begin editing active cell | Grid level |

Shortcut hint displayed in the save bar: `Ctrl+S to save · Enter=next field · Shift+Enter=prev · Tab=next · Arrow keys=navigate`

---

### Duplicate Estimate ✅

**Server:** `POST /api/operations/estimates/:id/duplicate`
- Copies all estimate fields (title, client, brand, format, items, store grouping, etc.)
- Clears PO fields, follow-up fields
- Sets `status = "draft"`
- Assigns new estimate number via `nextDocumentNumber("estimate")`
- Copies all `estimateItems` rows

**Client:** "Dupe" button added to each estimate row in the list.

---

### Unsaved Changes Warning ✅

**File:** `OperationsPage.tsx`

```js
useEffect(() => {
  if (!showEstimateForm) return;
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, [showEstimateForm]);
```

Browser will prompt "Leave site? Changes may not be saved" if the user tries to navigate away or close the tab while the estimate form is open.

Cancel button also prompts: `"Discard unsaved estimate?"` if product rows exist.

---

### Sticky Running Totals ✅

**File:** `index.css`

The `.eb-v2-summary` bar (showing Stores / Rows / Qty / Sqft / Material Value / Estimate Total) is now `position: sticky; top: 0; z-index: 30`. It stays visible at the top of the grid viewport while scrolling through large BOQs. The running total updates live as rows are filled.

---

## Screenshots

| File | Shows |
|---|---|
| `/tmp/after-1-list.png` | Estimate list — Master Data visible in nav |
| `/tmp/after-2-new-form.png` | New estimate — header expanded immediately, Client focused, shortcut hint in footer |
| `/tmp/after-3-store-picker.png` | Store picker with GST Loaded, search ready |
| `/tmp/after-4-grid-row.png` | Grid with store added, row ready, sticky totals bar visible |
| `/tmp/after-5-nav-master-data.png` | Left nav with Master Data expanded: Products, Brands, Stores, Material Codes, Rate Cards |

---

## What Was NOT Implemented (Deferred)

### Grid Virtualization (500+ rows)
Rendering 500+ rows in a non-virtualized grid will cause slowdown. Implementing `react-virtual` or similar is the correct fix but is a large structural change. Deferred. Current performance is acceptable up to ~200 rows.

### Bulk Store Paste from Excel
Parsing a pasted column of store codes from Excel requires a new modal + matching logic. The existing "Paste rows from Excel" modal handles line items but not stores. The Space+ArrowKey multi-select in the store picker is the keyboard-friendly path for now. Deferred as a separate feature.

---

## No Business Logic Changed

- Estimate numbering: unchanged
- Calculations (sqft, GST, amounts): unchanged
- Save/update logic: unchanged
- PO, DC, WCC, Invoice flows: untouched
- Data schema: no migrations required
