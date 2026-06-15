import XLSX from "xlsx";
const wb = XLSX.readFile("/Users/Kunal/Documents/sunrise/reference-docs/PE Storelist.xlsx");
console.log("Sheets:", wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  console.log(`\n=== Sheet: ${name} (${rows.length} data rows) ===`);
  if (rows.length) {
    console.log("Headers:", Object.keys(rows[0]));
    console.log("Sample row 1:", JSON.stringify(rows[0]).slice(0, 600));
    if (rows.length > 1) console.log("Sample row 2:", JSON.stringify(rows[1]).slice(0, 600));
  }
}
