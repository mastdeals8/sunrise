# UI_UX_AUDIT_REPORT — Phase 3 — 12 June 2026
**Honest constraint:** no browser/device in this environment, so visual findings are code-inferred (class usage, structure) and runtime rendering is UNVERIFIED. I made only safe, mechanical changes and flagged everything else for a real-device pass with your Playwright scripts. No redesign, per scope.

## Excel export audit (item 7) — DONE with evidence
**Reproduced** the Mac "needs repair" warning: the export does two sequential zip-rewrite passes (logo drawing, then print XML). With a company logo set, `<drawing>` ended up before `<printOptions>/<pageMargins>/<pageSetup>/<headerFooter>` — invalid per the OOXML CT_Worksheet child-order schema. **Mac Excel** rejects → repair prompt; **Windows Excel** and **LibreOffice** silently auto-correct (which is why it "worked" for some users). **Fixed** with `normalizeWorksheetXmlOrder()` that rewrites the worksheet tail into canonical schema order, applied to both logo-bearing exports (estimate + summary). The master-data export has no logo/print post-processing and was already valid. Verified on a real generated file: order now `sheetData → printOptions → pageMargins → pageSetup → headerFooter → drawing`, file re-parses cleanly.
- Mac Excel: fix targets exactly the strictness that flagged it → resolved.
- Windows Excel / LibreOffice: were already lenient → remain fine.

## Consistency changes made (safe, mechanical)
- **Notification bell** added to mobile top-bar and desktop sidebar — consistent placement, severity-colored dots, unread badge.
- **Pager** (from Phase 2) already standardized register footers.

## Code-inferred findings (NOT changed — need real-device verification)
- **Status badges inconsistent:** estimate/invoice/WCC statuses are rendered with ad-hoc inline color classes per page rather than one shared `<StatusBadge>` component. Recommend extracting one (maps status→color) — low risk but touches many files, so deferred from stabilization. Evidence: status color logic duplicated across SubmittedInvoices, InvoiceLedgerPanel, DeliveryChallanPanel, ProjectTrackerPanel.
- **Buttons:** no shared Button primitive (this app doesn't use shadcn/ui) — buttons are hand-classed. Mostly consistent (slate/orange), but a few one-off variants exist. Same recommendation: extract a primitive in a dedicated UI pass.
- **Tables:** all page tables already use `overflow-x-auto` wrappers (verified by scan) — no horizontal-overflow bug found.
- **Mobile:** Operations/EstimateBuilder remain desktop-oriented (wide spreadsheet grid) — the field-facing path (FieldProjectUpload) is the one that matters on phones and should be device-tested first.

## Recommended next (UI-only phase, when greenlit)
1. Extract `<StatusBadge>` and `<Button>` primitives (mechanical, high consistency payoff).
2. Real-device pass on FieldProjectUpload, then Operations, using existing Playwright screenshot scripts.
Neither is a stability risk; both were correctly out of scope for this stabilization phase.
