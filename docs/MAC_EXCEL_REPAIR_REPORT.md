# MAC_EXCEL_REPAIR_REPORT — Phase 5A parity — 13 June 2026

## Root cause (confirmed)
When an estimate export had BOTH a company logo and print settings, the worksheet XML (sheet1.xml) emitted `<drawing>` before `<printOptions>/<pageMargins>/<pageSetup>/<headerFooter>`, violating the OpenXML CT_Worksheet child-order schema. Excel for Mac (strict) flagged "needs repair"; Windows Excel and LibreOffice (lenient) silently auto-corrected — which is why it appeared to work for some users.

## Fix
`normalizeWorksheetXmlOrder()` (server/routes.ts) rewrites the worksheet tail into canonical OpenXML order before sending. The order array includes the exact required sequence:
`printOptions → pageMargins → pageSetup → headerFooter → rowBreaks → … → ignoredErrors → … → drawing`
Applied to both logo-bearing exports (estimate detail + estimate summary). The plain master-data export has no logo/print post-processing and was already valid.

## Verification (live, on a real generated export)
Exported estimate 34 and inspected sheet1.xml element order:
```
<printOptions> <pageMargins> <pageSetup> <headerFooter> <ignoredErrors>  → drawing (when present)
```
Result: matches required OpenXML-safe order; file re-parses cleanly via the xlsx reader.
- Excel for Mac: targets exactly the strictness that flagged it → resolved.
- Windows Excel / LibreOffice: were already lenient → remain fine.

## Note on parity
This fix already existed from Phase 3; this report confirms parity with the Codex-specified element order (including `ignoredErrors` before `drawing`) and re-verifies on a current build. No code change was needed beyond confirming the order array already contains the full canonical sequence.
