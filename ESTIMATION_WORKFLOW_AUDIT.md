# Estimation Workflow Audit
Generated: 2026-06-13

---

## How This Audit Was Done

- Full code read of `EstimateBuilder.tsx` (2632 lines) — every keyboard handler, focus function, and navigation path
- Live Playwright screenshots of the actual form at every stage
- Traced the exact execution path for Tab, Enter, Arrow, and mouse through the grid

---

## CRITICAL — Header Hidden on Every New Estimate

**What happens:** Clicking "New Estimate" opens to a nearly blank screen. The header — which contains Client, Date, Subject, Brand — is **collapsed by default**. The user sees:

- A breadcrumb showing "SM/E/26-27/203 | NO CLIENT"
- A toolbar with Add Store, Add Row, Copy, etc.
- An amber warning: **"Select Client first."**
- A body that says: **"Select a store to begin the estimate."**
- Nothing clickable that obviously leads to the client field

**What the user must do:** Find and click "Show Estimate Details" in the top-right corner — a small toggle that looks like a secondary UI action, not the primary entry point.

**Impact:** A new estimator has zero indication of where to start. Even an experienced user has to make an extra click before they can fill in anything. There is no autofocus on Client on open.

**Fix:** Header must be **expanded by default** for new estimates. Autofocus should land on the Client dropdown the moment the form opens.

---

## CRITICAL — Tab at Last Column Freezes Cursor

**What happens:** The grid has editable columns: `element → product → hsn → standard → width → height → quantity → rate`. Rate is the last editable column. All columns after it (Amount, GST %, GST Amt, CGST %, Total) are calculated read-only.

When Tab is pressed on the `rate` cell (last editable column), the code runs:

```js
nextColPosition = Math.min(navigableColumnIds.length - 1, colPosition + 1);
```

This clamps at the last position — `rate` — and stays there. **The cursor goes nowhere.** No new row is created. Focus is trapped.

**What the estimator has to do:** Reach for the mouse, click "Add Row" in the toolbar, then click back into the new row.

**Fix:** When Tab is pressed on the last editable column of the last row, automatically add a blank row in the same store and move focus to the `element` cell of the new row.

---

## CRITICAL — Enter Key Moves Down, Not Right

**What happens:** In edit mode, pressing Enter calls `navigateCell(rowIndex, columnId, "down")`. This moves focus to the **same column on the next row**, not to the next field.

For an estimator filling a row:
- They type the element name → press Enter → cursor jumps to element on **row 2** (skipping product, width, height, quantity, rate entirely)
- They must manually Tab through each field for every row

**Expected:** Enter should commit the current cell and move to the **next editable column** (same as Tab). Down arrow should be the row-navigation key.

**Note:** This is a design decision that can go either way. Excel uses Enter=down, Tab=right. However in a form context where rows have many fields that must be filled, Enter=next field (Tab behavior) is faster. Given the current Tab-is-broken issue above, Enter=down makes the workflow even harder.

**Fix options:**
1. Make Enter behave like Tab (commit + move right, create row at end)
2. Keep Enter=down but fix Tab so it wraps and creates rows

---

## MAJOR — No Auto New Row Creation

**What happens:** When the estimator finishes the last field of a row, **no new row is created automatically**. The user must:
1. Click "Add Row" in the toolbar (mouse required), OR
2. Press `Ctrl+D` (duplicate — wrong, copies data), OR
3. There is no keyboard shortcut to add a blank new row

The only keyboard auto-row path that exists is `moveFromRateToNextElement` — but this function is used in the **old v1 grid input** for rate inputs, not in the current v2 spreadsheet grid.

**Fix:** Tab from last editable column → new row. Enter from last editable column of last row → new row.

---

## MAJOR — Two Interactions Required to Edit Every Cell

**What happens:** The grid uses a spreadsheet model:
1. Click or Tab to a cell → cell becomes **active** (highlighted, not editable)
2. Press Enter or double-click → cell enters **edit mode** (input appears)

So filling a row requires the pattern: `Tab → Enter → type → Tab → Enter → type → Tab → Enter → type...`

Every single field requires an extra Enter to enter edit mode after Tab focus arrives.

**Fix:** When Tab navigation lands on a cell, immediately enter edit mode. Only the initial arrow-key navigation (Excel-style browse mode) should leave cells in active-not-editing state.

---

## MAJOR — Store Picker: Multi-Store Selection Requires Mouse

**What happens:** The store picker opens inline with a search box and a checklist. Keyboard path:
- Type to filter ✅
- Arrow keys to highlight ✅
- Enter to add the **highlighted single store** and close ✅
- **But: selecting multiple stores requires clicking checkboxes** — they have `tabIndex={-1}` and are not keyboard-accessible

For a job with 20 stores, the estimator must:
1. Search → Enter (adds 1 store, picker closes)
2. Click "Add Store" again
3. Search → Enter (adds 1 more)
4. Repeat 20 times

There is a multi-checkbox UI but it is mouse-only. Bulk store selection via keyboard is not possible.

**Fix:** When store is highlighted, pressing Space should toggle its checkbox without closing the picker. Enter (or a dedicated key) should then confirm all checked stores. This mirrors standard multi-select combobox behavior.

---

## MAJOR — No Keyboard Path from Header to Grid

**What happens:** After the estimator fills Client, Brand, Subject, and GST Profile in the header — all via Tab — the Tab key sequence continues through:

1. GST Profile input
2. The "► Billing / GST Details" accordion toggle (focusable `<button>`)
3. The Sunrise Media firm info footer area
4. Eventually reaches the "Add Store" toolbar button

There are ~6–8 Tab presses between "finished header" and "Add Store". There is also no keyboard shortcut to jump directly to the store search.

The `handleGstProfileKeyDown` does have a `Tab` handler that calls `openStorePickerAndFocusSearch()` — but only if a billing profile is selected. If GST Profile is left blank, Tab from that field goes to the generic flow above (no direct jump to store).

**Fix:** Tab from the last header field (GST Profile / Billing details) should jump directly to the store search with focus, skipping the firm footer area.

---

## MODERATE — Enter Doesn't Begin Editing on Arrow-Key Focus

**What happens:** Arrow keys navigate cells (sets active, doesn't edit). Pressing Enter on an active cell begins editing. This is correct and matches Excel.

However, when a cell is activated via Tab (not arrow key), Enter is required to start typing. If Tab already committed the previous cell and moved here, the user expects to be in edit mode immediately — not to press Enter first.

**Inconsistency:** Tab lands and sets `editingCell = null` — user must Enter to edit. Arrow keys also set `editingCell = null` — user must Enter to edit. The Tab path should enter edit mode immediately.

---

## MODERATE — Row Select Requires Checkbox Click

**What happens:** Rows have a select checkbox column. To select a row for copy/delete/duplicate, the estimator must click the checkbox cell specifically — clicking the row body does nothing.

The checkbox has no `tabIndex` in the grid cell, so Space key on an active row does not toggle selection.

**Fix:** Clicking anywhere on a row should select it. Space key when a row is active should toggle the checkbox.

---

## MINOR — Add Row Button Disabled Until Store Active

`disabled={activeStoreIds.length === 0}` — this is correct behavior, but the error message ("Select a store to begin the estimate.") does not explain the full sequence: Client → Brand → Add Store → Add Row. First-time users get blocked at each gate without understanding the full flow.

---

## MINOR — Subject / Job Field Has No Autofill from History

The Subject / Job field is a free-text input. For repeat clients (e.g., ABLBL EOSS jobs, Visual Changeover), the estimator types the same names repeatedly. A typeahead with recent subjects per client would save time.

---

## MASTER DATA ACCESS AUDIT

### Products — `/products`
- **Route:** Exists, fully functional (View, Edit, Duplicate, Deactivate, Delete)
- **Nav menu:** ❌ NOT IN MENU — only reachable via direct URL
- **Finding:** Admin cannot access Products from the left sidebar at all

### Brands — `/brands`
- **Route:** Exists, has Edit actions  
- **Nav menu:** ❌ NOT IN MENU
- **Finding:** Same as Products — URL-only access

### Stores — `/stores`
- **Route:** Exists, `StoresPanel.tsx` has full CRUD
- **Nav menu:** ❌ NOT IN MENU
- **Finding:** Estimators cannot view or search stores outside of the estimate picker

### Material Codes — `/material-codes`
- **Route:** Exists, `MaterialCodes.tsx` page
- **Nav menu:** ❌ NOT IN MENU
- **Finding:** CAPEX estimate material codes are unmaintainable from the UI without URL knowledge

### Customer Rate Cards — `/customer-rate-cards`
- **Route:** Exists, `CustomerRateCards.tsx`
- **Nav menu:** ❌ NOT IN MENU

### Clients — `/clients`
- **Route:** Exists ✅
- **Nav menu:** ✅ IN MENU — visible at top level

**Summary: 5 of 6 master data entities have no nav entry. Only Clients are reachable from the left menu.**

The pages exist and are functional — the only issue is discoverability. They were likely removed from the nav during UI modernization (probably when the sidebar was restructured) and never added back under a "Master Data" or "Settings" section.

---

## ESTIMATE REGISTER ACTIONS AUDIT

| Action | Works? | Issue |
|---|---|---|
| Create Estimate | ✅ | Header hidden on open — needs autofocus on Client |
| Edit Estimate | ✅ Fixed (last session) | |
| Delete Estimate | ✅ Added today | Confirm dialog present |
| Archive Estimate | ✅ | Via status PATCH, accessible from Edit form |
| Excel Export | ✅ | Download link works |
| Print / PDF | ✅ | Via Project → View tab |
| View Estimate | ✅ | Via Project button |
| Duplicate Estimate | ❌ | No whole-estimate duplicate on the list. In-grid row duplication works (Ctrl+D). |

---

## PROPOSED FIXES (PRIORITY ORDER)

### Fix 1 — Header open by default + autofocus Client
**File:** `EstimateBuilder.tsx`  
**Change:** Set `showEstimateDetails` initial state to `true`. Add `autoFocus` on the Client dropdown.

### Fix 2 — Tab on last column creates new row
**File:** `EstimateBuilder.tsx` → `navigateCell()`  
**Change:** When `direction === "right"` and already at last column AND on last row, call `addRowBelowSelection()` and focus `element` cell of new row.

### Fix 3 — Tab immediately enters edit mode
**File:** `EstimateBuilder.tsx` → `handleCellKeyDown()` Tab branch  
**Change:** After `navigateCell()`, also call `beginEditCell()` on the new target cell, so Tab → edit (not Tab → active → Enter → edit).

### Fix 4 — Enter = next field (Tab behavior) OR Enter = down (arrow behavior) — pick one consistently
**Recommendation:** Keep Enter = down (Excel standard), but fix Tab so it works as described in Fix 2+3 above. Add a callout in the toolbar: "Tab = next field · Enter = next row · Esc = cancel".

### Fix 5 — Store picker Space key toggles without closing
**File:** `EstimateBuilder.tsx` → `handleStoreSearchKeyDown()`  
**Change:** Add Space key handler that toggles `pendingStoreIds` for the highlighted store without closing the picker.

### Fix 6 — Tab from GST Profile jumps to Add Store  
**File:** `EstimateBuilder.tsx` → `handleGstProfileKeyDown()` / GST input `onKeyDown`  
**Change:** Tab from GST Profile always calls `openStorePickerAndFocusSearch()`, regardless of whether a billing profile was selected.

### Fix 7 — Add master data to nav menu
**File:** `client/src/App.tsx`  
**Change:** Add a "Master Data" section to the nav with: Products, Brands, Stores, Material Codes, Rate Cards.

### Fix 8 — Row selection on body click
**File:** `EstimateBuilder.tsx` → row `<tr>` click handler  
**Change:** Clicking the row body (not checkbox) should toggle row selection. Space key on active row should do the same.

---

## KEYBOARD FLOW AS-IS vs IDEAL

### Current flow to enter one row:
1. Click "New Estimate" (mouse)
2. Click "Show Estimate Details" (mouse — hidden toggle)
3. Click Client dropdown (mouse or Tab until you find it)
4. Select client (mouse)
5. Select brand (mouse)
6. Click "Add Store" (mouse)
7. Type store name (keyboard ✅)
8. Press Enter (adds store, closes picker ✅)
9. Click the Element cell in new row (mouse — no autofocus)
10. Press Enter (enter edit mode)
11. Type element name
12. Tab → lands on Product cell (active, not editing)
13. Press Enter (enter edit mode)
14. Type product search
15. Press Enter (select product ✅)
16. Tab → HSN (active, not editing)
17. Press Enter (edit)
18. Tab → W (active, not editing)
19. Press Enter (edit) → type width
20. Tab → H → Enter → type height
21. Tab → Qty → Enter → type quantity
22. Tab → Rate → Enter → type rate
23. Tab → **stuck at Rate** — no new row created
24. Mouse click "Add Row" (mouse)
25. Repeat from step 9

**Mouse interactions required for one row:** ~6 (steps 1, 2, 3/4, 5, 9, 24)

### Ideal flow for one row:
1. Click "New Estimate" — Client field gets autofocus immediately
2. Type client → Enter (select)
3. Tab → Brand → Enter (select)
4. Tab → Subject → type
5. Tab → GST Profile → type/select → Tab (jumps to store search)
6. Type store → Enter (adds store, focus goes to Element cell — already in edit mode)
7. Type element → Tab (next field, in edit mode immediately)
8. Type product search → Enter (select product, Tab to next)
9. Tab through W, H, Qty, Rate — each enters edit mode immediately
10. Tab after Rate → new row created, cursor on Element of row 2 in edit mode
11. Repeat from step 7

**Mouse interactions required:** 1 (just "New Estimate")

---

## SCREENSHOTS

Captured at: `/tmp/est-audit-*.png`

| File | Shows |
|---|---|
| `est-audit-1-list.png` | Estimate Register list — 2 estimates, DRAFT + PO RECEIVED |
| `est-audit-2a-new-form-default.png` | New estimate on open — **blank, header hidden, "Select Client first" warning** |
| `est-audit-2b-header-expanded.png` | Header after expanding — Client, Date, Subject, Brand, GST Profile visible |
| `est-audit-3-store-picker.png` | Store picker inline panel — search + checklist |
| `est-audit-4-grid-with-row.png` | Grid with one store and one row — columns visible |
