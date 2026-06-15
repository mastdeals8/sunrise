# Tally Integration — Sunrise Media ERP

This integration lets accounts move invoices from Sunrise ERP into Tally
without re-keying. ERP remains the operational source of truth (POs, WCC,
estimates, payments). Tally is the accounting system of record.

## Status

Implemented in this pass:

- DB columns `invoices.tally_export_status` and `invoices.tally_exported_at`
  (additive migration, idempotent).
- Server endpoint `GET /api/tally/export-xml/:invoiceId` returns a Tally
  Vouchers XML envelope for one sales invoice (party ledger, GSTIN, taxable
  amount, CGST/SGST/IGST as applicable, bill allocation).
- Server endpoints `GET /api/tally/settings` and `PUT /api/tally/settings`
  store Tally connection settings in the `app_settings` table.
- React page at `/automation/tally` — enable toggle, mode (XML / push /
  both), Tally URL, company name, ledger names, voucher type, save + test
  buttons.
- `Submitted Invoices` page exposes a per-invoice **Tally XML** button that
  downloads the XML and bumps the invoice's tally export status.

## Status field values

| value              | meaning                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `not_exported`     | invoice has never been exported (default)                        |
| `exported_xml`     | Tally XML has been downloaded at least once                      |
| `pushed_to_tally`  | accountant has confirmed Tally accepted the voucher              |
| `failed`           | last attempt to push to Tally returned an error                  |

The transition `exported_xml → pushed_to_tally` is manual today — the
accountant marks it after Tally's "Import Vouchers" confirms successful import.

## XML envelope shape

```
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>##COMPANYNAME##</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Sales" ACTION="Create" REMOTEID="INV-####">
            <DATE>YYYYMMDD</DATE>
            <NARRATION>...</NARRATION>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>INV-####</VOUCHERNUMBER>
            <PARTYLEDGERNAME>{client name}</PARTYLEDGERNAME>
            <GUID>INV-####</GUID>
            <!-- one ALLLEDGERENTRIES.LIST per: party / sales / CGST / SGST / IGST -->
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
```

Notes:

- `##COMPANYNAME##` is a placeholder so Tally falls back to the active
  company when imported via the GUI. Replace with the configured
  `companyName` from `app_settings.tally_settings` if you want to lock the
  XML to a specific Tally company.
- Bill allocation includes the invoice number as a `New Ref` so payments
  reconciled later in Tally land on the right outstanding bill.

## Operating procedure

### Per-invoice XML download (today's flow)

1. Open **Submitted Invoices**.
2. Click **Tally XML** in the Action column.
3. Browser downloads `tally_INV-####.xml`.
4. In Tally Prime: *Gateway → Import → Vouchers → File name = downloaded XML*.
5. Verify "Voucher imported" line in Tally and mark the invoice's Tally
   status as `pushed_to_tally` in ERP (manual step today).

### Direct push (optional)

`mode = push` / `mode = both` in Tally settings expects a Tally Prime
instance with the HTTP server / ODBC enabled and listening on
`tallyUrl` (default `http://localhost:9000`). Browser CORS will reject
direct push from `/automation/tally`; the integration server can post the
XML server-side instead. **Not yet implemented** — XML download covers the
common case.

## Ledger mapping defaults

| ERP concept                 | Tally ledger (default)                       |
| --------------------------- | -------------------------------------------- |
| sales revenue               | `Sales`                                      |
| CGST tax                    | `CGST`                                       |
| SGST tax                    | `SGST`                                       |
| IGST tax                    | `IGST`                                       |
| client (party)              | `partyName` literal from invoice / client    |
| round-off                   | `Round Off` (when round-off ledger set)      |

Override any of these on `/automation/tally`. They are echoed verbatim into
the `<LEDGERNAME>` tags of the XML envelope.

## Things this integration does NOT do

- Push opening balances or chart of accounts.
- Sync payments back from Tally.
- Generate purchase vouchers (only sales).
- Auto-create ledgers in Tally — the ledger names must already exist or be
  created during import.
- Bypass Tally's own validation rules. If a ledger or company name is
  wrong the import will silently fail; check Tally's `tally.imp` log.

## Future work

- Server-side direct push using axios from the Node process (no CORS).
- Bulk XML download for all invoices in a month / financial year.
- Purchase voucher export.
- Payment voucher export.
- Receipt allocation parity.
- Push back of Tally voucher IDs into ERP so links survive Tally re-import.
