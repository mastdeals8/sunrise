import pg from "pg";
import dotenv from "dotenv";
import assert from "assert";

dotenv.config();

const cleanUrl = process.env.DATABASE_URL!.replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

export interface WakefitEstimateDef {
  estimateNumber: string;
  pdfFile: string;
  storeName: string;
  storeCode: string;
  storeId: number;
  date: string;
  subject: string;
  title: string;
  description: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  totalAmount: number;
  items: Array<{
    sl: number;
    itemName: string;
    description: string;
    hsn: string;
    width: number | null;
    height: number | null;
    quantity: number;
    totalSize: number | null;
    rate: number;
    unit: string;
    totalPrice: number;
    cgstPercent: number;
    cgstAmount: number;
    sgstPercent: number;
    sgstAmount: number;
    igstPercent: number;
    igstAmount: number;
    totalAmount: number;
    lineType: "product";
    calculationType: "sqft" | "fixed";
  }>;
}

export const WAKEFIT_ESTIMATES: WakefitEstimateDef[] = [
  {
    estimateNumber: "SM/25-26/238",
    pdfFile: "Estimate for Wakefit - NIBM - Ganesh.pdf",
    storeName: "NIBM -RO58",
    storeCode: "R058",
    storeId: 559,
    date: "2025-08-21 12:00:00",
    subject: "Ganesh Chaturthi",
    title: "Ganesh Chaturthi - NIBM - RO58",
    description: "Terms & Condition :\n1.Taxes will be applicable.\n2.100% Payment after the delivery of the material.\n3.Transportation charges As per Actual.\n4.Any additional work / rework will be extra.",
    subtotal: 6680.00,
    cgst: 601.20,
    sgst: 601.20,
    totalAmount: 7882.40,
    items: [
      {
        sl: 1,
        itemName: "Print and Cut",
        description: "Latex Print on Vinyl with Ploter Cut",
        hsn: "3921",
        width: 72.00,
        height: 72.00,
        quantity: 1.00,
        totalSize: 36.00,
        rate: 120.00,
        unit: "sqft",
        totalPrice: 4320.00,
        cgstPercent: 9,
        cgstAmount: 388.80,
        sgstPercent: 9,
        sgstAmount: 388.80,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 5097.60,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 2,
        itemName: "Easel print",
        description: "Latex Print on Vinyl with 5mm SB Front and Back",
        hsn: "3921",
        width: 24.00,
        height: 36.00,
        quantity: 1.00,
        totalSize: 6.00,
        rate: 160.00,
        unit: "sqft",
        totalPrice: 960.00,
        cgstPercent: 9,
        cgstAmount: 86.40,
        sgstPercent: 9,
        sgstAmount: 86.40,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 1132.80,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 3,
        itemName: "Danglers",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 14.00,
        totalSize: null,
        rate: 50.00,
        unit: "nos",
        totalPrice: 700.00,
        cgstPercent: 9,
        cgstAmount: 63.00,
        sgstPercent: 9,
        sgstAmount: 63.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 826.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 4,
        itemName: "Tent Card",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 5.00,
        totalSize: null,
        rate: 80.00,
        unit: "nos",
        totalPrice: 400.00,
        cgstPercent: 9,
        cgstAmount: 36.00,
        sgstPercent: 9,
        sgstAmount: 36.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 472.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 5,
        itemName: "Transport",
        description: "Transportation",
        hsn: "9987",
        width: null,
        height: null,
        quantity: 1.00,
        totalSize: 1.00,
        rate: 300.00,
        unit: "job",
        totalPrice: 300.00,
        cgstPercent: 9,
        cgstAmount: 27.00,
        sgstPercent: 9,
        sgstAmount: 27.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 354.00,
        lineType: "product",
        calculationType: "fixed"
      }
    ]
  },
  {
    estimateNumber: "SM/25-26/239",
    pdfFile: "Estimate for Wakefit - Baner - ganesh.pdf",
    storeName: "Baner -RO56",
    storeCode: "R056",
    storeId: 557,
    date: "2025-08-21 12:00:00",
    subject: "Ganesh Chaturthi",
    title: "Ganesh Chaturthi - Baner - RO56",
    description: "Terms & Condition :\n1.Taxes will be applicable.\n2.100% Payment after the delivery of the material.\n3.Transportation charges As per Actual.\n4.Any additional work / rework will be extra.",
    subtotal: 6580.00,
    cgst: 592.20,
    sgst: 592.20,
    totalAmount: 7764.40,
    items: [
      {
        sl: 1,
        itemName: "Print and Cut",
        description: "Latex Print on Vinyl with Ploter Cut",
        hsn: "3921",
        width: 72.00,
        height: 72.00,
        quantity: 1.00,
        totalSize: 36.00,
        rate: 120.00,
        unit: "sqft",
        totalPrice: 4320.00,
        cgstPercent: 9,
        cgstAmount: 388.80,
        sgstPercent: 9,
        sgstAmount: 388.80,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 5097.60,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 2,
        itemName: "Easel print",
        description: "Latex Print on Vinyl with 5mm SB Front and Back",
        hsn: "3921",
        width: 24.00,
        height: 36.00,
        quantity: 1.00,
        totalSize: 6.00,
        rate: 160.00,
        unit: "sqft",
        totalPrice: 960.00,
        cgstPercent: 9,
        cgstAmount: 86.40,
        sgstPercent: 9,
        sgstAmount: 86.40,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 1132.80,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 3,
        itemName: "Danglers",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 12.00,
        totalSize: null,
        rate: 50.00,
        unit: "nos",
        totalPrice: 600.00,
        cgstPercent: 9,
        cgstAmount: 54.00,
        sgstPercent: 9,
        sgstAmount: 54.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 708.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 4,
        itemName: "Tent Card",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 5.00,
        totalSize: null,
        rate: 80.00,
        unit: "nos",
        totalPrice: 400.00,
        cgstPercent: 9,
        cgstAmount: 36.00,
        sgstPercent: 9,
        sgstAmount: 36.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 472.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 5,
        itemName: "Transport",
        description: "Transportation",
        hsn: "9987",
        width: null,
        height: null,
        quantity: 1.00,
        totalSize: 1.00,
        rate: 300.00,
        unit: "job",
        totalPrice: 300.00,
        cgstPercent: 9,
        cgstAmount: 27.00,
        sgstPercent: 9,
        sgstAmount: 27.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 354.00,
        lineType: "product",
        calculationType: "fixed"
      }
    ]
  },
  {
    estimateNumber: "SM/25-26/240",
    pdfFile: "Estimate for Wakefit - Hinjewadi -Ganesh.pdf",
    storeName: "Hinjewadi -RO57",
    storeCode: "R057",
    storeId: 558,
    date: "2025-08-21 12:00:00",
    subject: "Ganesh Chaturthi",
    title: "Ganesh Chaturthi - Hinjewadi - RO57",
    description: "Terms & Condition :\n1.Taxes will be applicable.\n2.100% Payment after the delivery of the material.\n3.Transportation charges As per Actual.\n4.Any additional work / rework will be extra.",
    subtotal: 5810.00,
    cgst: 522.90,
    sgst: 522.90,
    totalAmount: 6855.80,
    items: [
      {
        sl: 1,
        itemName: "Print and Cut",
        description: "Latex Print on Vinyl with Ploter Cut",
        hsn: "3921",
        width: 66.00,
        height: 66.00,
        quantity: 1.00,
        totalSize: 30.25,
        rate: 120.00,
        unit: "sqft",
        totalPrice: 3630.00,
        cgstPercent: 9,
        cgstAmount: 326.70,
        sgstPercent: 9,
        sgstAmount: 326.70,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 4283.40,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 2,
        itemName: "Easel print",
        description: "Latex Print on Vinyl with 5mm SB Front and Back",
        hsn: "3921",
        width: 24.00,
        height: 36.00,
        quantity: 1.00,
        totalSize: 6.00,
        rate: 160.00,
        unit: "sqft",
        totalPrice: 960.00,
        cgstPercent: 9,
        cgstAmount: 86.40,
        sgstPercent: 9,
        sgstAmount: 86.40,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 1132.80,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 3,
        itemName: "Danglers",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 12.00,
        totalSize: null,
        rate: 50.00,
        unit: "nos",
        totalPrice: 600.00,
        cgstPercent: 9,
        cgstAmount: 54.00,
        sgstPercent: 9,
        sgstAmount: 54.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 708.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 4,
        itemName: "Tent Card",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 4.00,
        totalSize: null,
        rate: 80.00,
        unit: "nos",
        totalPrice: 320.00,
        cgstPercent: 9,
        cgstAmount: 28.80,
        sgstPercent: 9,
        sgstAmount: 28.80,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 377.60,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 5,
        itemName: "Transport",
        description: "Transportation",
        hsn: "9987",
        width: null,
        height: null,
        quantity: 1.00,
        totalSize: 1.00,
        rate: 300.00,
        unit: "job",
        totalPrice: 300.00,
        cgstPercent: 9,
        cgstAmount: 27.00,
        sgstPercent: 9,
        sgstAmount: 27.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 354.00,
        lineType: "product",
        calculationType: "fixed"
      }
    ]
  },
  {
    estimateNumber: "SM/25-26/241",
    pdfFile: "Estimate for Wakefit - Creativecity - Ganesh.pdf",
    storeName: "Creaticity -RO48",
    storeCode: "R048",
    storeId: 560,
    date: "2025-08-21 12:00:00",
    subject: "Ganesh Chaturthi",
    title: "Ganesh Chaturthi - Creaticity - RO48",
    description: "Terms & Condition :\n1.Taxes will be applicable.\n2.100% Payment after the delivery of the material.\n3.Transportation charges As per Actual.\n4.Any additional work / rework will be extra.",
    subtotal: 12000.00,
    cgst: 1080.00,
    sgst: 1080.00,
    totalAmount: 14160.00,
    items: [
      {
        sl: 1,
        itemName: "Print and Cut",
        description: "Latex Print on Vinyl with Ploter Cut",
        hsn: "3921",
        width: 108.00,
        height: 108.00,
        quantity: 1.00,
        totalSize: 81.00,
        rate: 120.00,
        unit: "sqft",
        totalPrice: 9720.00,
        cgstPercent: 9,
        cgstAmount: 874.80,
        sgstPercent: 9,
        sgstAmount: 874.80,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 11469.60,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 2,
        itemName: "Easel print",
        description: "Latex Print on Vinyl with 5mm SB Front and Back",
        hsn: "3921",
        width: 24.00,
        height: 36.00,
        quantity: 1.00,
        totalSize: 6.00,
        rate: 160.00,
        unit: "sqft",
        totalPrice: 960.00,
        cgstPercent: 9,
        cgstAmount: 86.40,
        sgstPercent: 9,
        sgstAmount: 86.40,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 1132.80,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 3,
        itemName: "Danglers",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 14.00,
        totalSize: null,
        rate: 50.00,
        unit: "nos",
        totalPrice: 700.00,
        cgstPercent: 9,
        cgstAmount: 63.00,
        sgstPercent: 9,
        sgstAmount: 63.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 826.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 4,
        itemName: "Tent Card",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 4.00,
        totalSize: null,
        rate: 80.00,
        unit: "nos",
        totalPrice: 320.00,
        cgstPercent: 9,
        cgstAmount: 28.80,
        sgstPercent: 9,
        sgstAmount: 28.80,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 377.60,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 5,
        itemName: "Transport",
        description: "Transportation",
        hsn: "9987",
        width: null,
        height: null,
        quantity: 1.00,
        totalSize: 1.00,
        rate: 300.00,
        unit: "job",
        totalPrice: 300.00,
        cgstPercent: 9,
        cgstAmount: 27.00,
        sgstPercent: 9,
        sgstAmount: 27.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 354.00,
        lineType: "product",
        calculationType: "fixed"
      }
    ]
  },
  {
    estimateNumber: "SM/25-26/242",
    pdfFile: "Estimate for Wakefit - Wagohli - Ganesh.pdf",
    storeName: "Wagholi-R083",
    storeCode: "R083",
    storeId: 561,
    date: "2025-08-21 12:00:00",
    subject: "Ganesh Chaturthi",
    title: "Ganesh Chaturthi - Wagholi - RO83",
    description: "Terms & Condition :\n1.Taxes will be applicable.\n2.100% Payment after the delivery of the material.\n3.Transportation charges As per Actual.\n4.Any additional work / rework will be extra.",
    subtotal: 9030.00,
    cgst: 812.70,
    sgst: 812.70,
    totalAmount: 10655.40,
    items: [
      {
        sl: 1,
        itemName: "Print and Cut",
        description: "Latex Print on Vinyl with Ploter Cut",
        hsn: "3921",
        width: 84.00,
        height: 84.00,
        quantity: 1.00,
        totalSize: 49.00,
        rate: 120.00,
        unit: "sqft",
        totalPrice: 5880.00,
        cgstPercent: 9,
        cgstAmount: 529.20,
        sgstPercent: 9,
        sgstAmount: 529.20,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 6938.40,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 2,
        itemName: "Easel print",
        description: "Latex Print on Vinyl with 5mm SB Front and Back",
        hsn: "3921",
        width: 24.00,
        height: 36.00,
        quantity: 1.00,
        totalSize: 6.00,
        rate: 160.00,
        unit: "sqft",
        totalPrice: 960.00,
        cgstPercent: 9,
        cgstAmount: 86.40,
        sgstPercent: 9,
        sgstAmount: 86.40,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 1132.80,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 3,
        itemName: "Danglers",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 25.00,
        totalSize: null,
        rate: 50.00,
        unit: "nos",
        totalPrice: 1250.00,
        cgstPercent: 9,
        cgstAmount: 112.50,
        sgstPercent: 9,
        sgstAmount: 112.50,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 1475.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 4,
        itemName: "Tent Card",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 8.00,
        totalSize: null,
        rate: 80.00,
        unit: "nos",
        totalPrice: 640.00,
        cgstPercent: 9,
        cgstAmount: 57.60,
        sgstPercent: 9,
        sgstAmount: 57.60,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 755.20,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 5,
        itemName: "Transport",
        description: "Transportation",
        hsn: "9987",
        width: null,
        height: null,
        quantity: 1.00,
        totalSize: 1.00,
        rate: 300.00,
        unit: "job",
        totalPrice: 300.00,
        cgstPercent: 9,
        cgstAmount: 27.00,
        sgstPercent: 9,
        sgstAmount: 27.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 354.00,
        lineType: "product",
        calculationType: "fixed"
      }
    ]
  },
  {
    estimateNumber: "SM/25-26/243",
    pdfFile: "Estimate for Wakefit - Kharadi - Ganesh.pdf",
    storeName: "Kharadi- RO07",
    storeCode: "R007",
    storeId: 562,
    date: "2025-08-21 12:00:00",
    subject: "Ganesh Chaturthi",
    title: "Ganesh Chaturthi - Kharadi - RO07",
    description: "Terms & Condition :\n1.Taxes will be applicable.\n2.100% Payment after the delivery of the material.\n3.Transportation charges As per Actual.\n4.Any additional work / rework will be extra.",
    subtotal: 2440.00,
    cgst: 219.60,
    sgst: 219.60,
    totalAmount: 2879.20,
    items: [
      {
        sl: 1,
        itemName: "Easel print",
        description: "Latex Print on Vinyl with 5mm SB Front and Back",
        hsn: "3921",
        width: 24.00,
        height: 36.00,
        quantity: 1.00,
        totalSize: 6.00,
        rate: 160.00,
        unit: "sqft",
        totalPrice: 960.00,
        cgstPercent: 9,
        cgstAmount: 86.40,
        sgstPercent: 9,
        sgstAmount: 86.40,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 1132.80,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 2,
        itemName: "Danglers",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 14.00,
        totalSize: null,
        rate: 50.00,
        unit: "nos",
        totalPrice: 700.00,
        cgstPercent: 9,
        cgstAmount: 63.00,
        sgstPercent: 9,
        sgstAmount: 63.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 826.00,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 3,
        itemName: "Tent Card",
        description: "Digital Print on 300gsm Paper with Die Cut",
        hsn: "3921",
        width: null,
        height: null,
        quantity: 6.00,
        totalSize: null,
        rate: 80.00,
        unit: "nos",
        totalPrice: 480.00,
        cgstPercent: 9,
        cgstAmount: 43.20,
        sgstPercent: 9,
        sgstAmount: 43.20,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 566.40,
        lineType: "product",
        calculationType: "fixed"
      },
      {
        sl: 4,
        itemName: "Transport",
        description: "Transportation",
        hsn: "9987",
        width: null,
        height: null,
        quantity: 1.00,
        totalSize: 1.00,
        rate: 300.00,
        unit: "job",
        totalPrice: 300.00,
        cgstPercent: 9,
        cgstAmount: 27.00,
        sgstPercent: 9,
        sgstAmount: 27.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 354.00,
        lineType: "product",
        calculationType: "fixed"
      }
    ]
  },
  {
    estimateNumber: "SM/25-26/246",
    pdfFile: "Estimate for Wakefit - NIBM Ganesh - add rework.pdf",
    storeName: "NIBM -RO58",
    storeCode: "R058",
    storeId: 559,
    date: "2025-08-21 12:00:00",
    subject: "Ganesh Chaturthi",
    title: "Ganesh Chaturthi - NIBM - RO58 Additional Rework",
    description: "Terms & Condition :\n1.Taxes will be applicable.\n2.100% Payment after the delivery of the material.\n3.Transportation charges As per Actual.\n4.Any additional work / rework will be extra.",
    subtotal: 2220.00,
    cgst: 199.80,
    sgst: 199.80,
    totalAmount: 2619.60,
    items: [
      {
        sl: 1,
        itemName: "Print and Cut",
        description: "Latex Print on Vinyl with Ploter Cut",
        hsn: "3921",
        width: 48.00,
        height: 48.00,
        quantity: 1.00,
        totalSize: 16.00,
        rate: 120.00,
        unit: "sqft",
        totalPrice: 1920.00,
        cgstPercent: 9,
        cgstAmount: 172.80,
        sgstPercent: 9,
        sgstAmount: 172.80,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 2265.60,
        lineType: "product",
        calculationType: "sqft"
      },
      {
        sl: 2,
        itemName: "Transport",
        description: "Transportation",
        hsn: "9987",
        width: null,
        height: null,
        quantity: 1.00,
        totalSize: 1.00,
        rate: 300.00,
        unit: "job",
        totalPrice: 300.00,
        cgstPercent: 9,
        cgstAmount: 27.00,
        sgstPercent: 9,
        sgstAmount: 27.00,
        igstPercent: 0,
        igstAmount: 0,
        totalAmount: 354.00,
        lineType: "product",
        calculationType: "fixed"
      }
    ]
  }
];

export async function importWakefitEstimates() {
  const client = await pool.connect();
  console.log("=== STARTING IMPORT OF 7 HISTORICAL WAKEFIT ESTIMATES ===");

  try {
    // 1. Verify Target Workspace: Sunrise Media Pune (company_id: 1)
    console.log("\n>>> [STEP 1] Verifying Target Workspace 1...");
    const compRes = await client.query("SELECT id, name, gstin FROM companies WHERE id = 1");
    if (compRes.rows.length === 0) throw new Error("Workspace 1 not found!");
    const company = compRes.rows[0];
    console.log(`  ✓ Workspace 1 confirmed: "${company.name}", GSTIN: ${company.gstin}`);

    // Verify other companies (2 and 3)
    const otherComps = await client.query("SELECT id, name FROM companies WHERE id IN (2, 3) ORDER BY id");
    console.log(`  ✓ Workspaces 2 & 3 confirmed: ${otherComps.rows.map(r => `ID ${r.id} (${r.name})`).join(", ")}`);
    const preCountComp2 = (await client.query("SELECT count(*) FROM estimates WHERE company_id = 2")).rows[0].count;
    const preCountComp3 = (await client.query("SELECT count(*) FROM estimates WHERE company_id = 3")).rows[0].count;

    // 2. Verify Client: Wakefit Innovations Pvt Ltd
    console.log("\n>>> [STEP 2] Verifying Wakefit client & billing profile...");
    const clientRes = await client.query("SELECT id, name, pan, default_format_profile_code FROM clients WHERE id = 3");
    if (clientRes.rows.length === 0) throw new Error("Wakefit client ID 3 not found!");
    const wakefitClient = clientRes.rows[0];
    console.log(`  ✓ Client: ID ${wakefitClient.id} "${wakefitClient.name}", PAN: ${wakefitClient.pan}`);

    const bpRes = await client.query("SELECT id, legal_company_name, gstin, pan, state, state_code FROM client_billing_profiles WHERE id = 33");
    if (bpRes.rows.length === 0) throw new Error("Wakefit Billing Profile 33 not found!");
    const bp = bpRes.rows[0];
    console.log(`  ✓ Billing Profile: ID ${bp.id} "${bp.legal_company_name}", GSTIN: ${bp.gstin}, State: ${bp.state} (${bp.state_code})`);

    // 3. Verify Stores
    console.log("\n>>> [STEP 3] Verifying Wakefit Stores in Workspace 1...");
    const storesRes = await client.query("SELECT id, name, store_code, city FROM stores WHERE client_id = 3 ORDER BY id");
    const storeMap = new Map(storesRes.rows.map(s => [s.id, s]));
    for (const def of WAKEFIT_ESTIMATES) {
      const st = storeMap.get(def.storeId);
      if (!st) throw new Error(`Store ID ${def.storeId} not found for estimate ${def.estimateNumber}`);
      console.log(`  ✓ Store for ${def.estimateNumber}: ID ${st.id} "${st.name}" (Code: ${st.store_code})`);
    }

    // 4. Duplicate Protection: search for each estimate number in DB
    console.log("\n>>> [STEP 4] Duplicate protection check...");
    const estNumbers = WAKEFIT_ESTIMATES.map(e => e.estimateNumber);
    const existingRes = await client.query(
      "SELECT id, estimate_number, company_id, total_amount FROM estimates WHERE estimate_number = ANY($1)",
      [estNumbers]
    );
    if (existingRes.rows.length > 0) {
      console.log("  ⚠️ Existing records found:", existingRes.rows);
      throw new Error(`Duplicate protection triggered: estimates already exist: ${existingRes.rows.map(r => r.estimate_number).join(", ")}`);
    }
    console.log("  ✓ Duplicate check clean: none of the 7 estimate numbers exist in the database.");

    // Check sequence generator before creating
    const preNextEstNum = (await client.query("SELECT public.next_sunrise_document_number('estimate', CURRENT_DATE, 1) as num")).rows[0].num;
    console.log(`  ✓ Current FY sequence baseline before import: next number is "${preNextEstNum}"`);

    // 5. Create each of the 7 estimates
    console.log("\n>>> [STEP 5] Creating 7 Historical Estimates using canonical create_estimate_atomic & replace_estimate_items...");
    const createdEstimates: Array<{ id: number; estimateNumber: string; storeName: string; itemCount: number; subtotal: number; taxAmount: number; totalAmount: number }> = [];

    for (const def of WAKEFIT_ESTIMATES) {
      console.log(`\n  Creating ${def.estimateNumber} for Store "${def.storeName}"...`);
      const st = storeMap.get(def.storeId)!;

      const estimatePayload = {
        company_id: 1,
        estimate_number: def.estimateNumber,
        estimate_date: def.date,
        client_id: 3,
        brand_id: 4,
        store_id: def.storeId,
        title: def.title,
        description: def.description,
        subtotal: def.subtotal,
        tax_amount: def.cgst + def.sgst,
        total_amount: def.totalAmount,
        status: "draft",
        client_format: "RETAIL_SINGLE_STORE",
        format_profile_code: "RETAIL_SINGLE_STORE",
        subject: def.subject,
        billing_profile_id: bp.id,
        billing_legal_name_snapshot: bp.legal_company_name,
        billing_gstin_snapshot: bp.gstin,
        billing_state_snapshot: bp.state || "Maharashtra",
        billing_state_code_snapshot: bp.state_code || "27",
        billing_address_snapshot: `${bp.legal_company_name}, Pune, Maharashtra`,
        billing_to: bp.legal_company_name,
        shipping_to: st.name,
        gstin: bp.gstin,
        pan: bp.pan || wakefitClient.pan,
        state_code: bp.state_code || "27",
        gst_type: "CGST+SGST",
        created_by: 1,
      };

      const itemsPayload = def.items.map(it => ({
        company_id: 1,
        sl: it.sl,
        item_name: it.itemName,
        description: it.description,
        hsn: it.hsn,
        width: it.width,
        height: it.height,
        quantity: it.quantity,
        total_size: it.totalSize,
        rate: it.rate,
        unit: it.unit,
        total_price: it.totalPrice,
        cgst_percent: it.cgstPercent,
        cgst_amount: it.cgstAmount,
        sgst_percent: it.sgstPercent,
        sgst_amount: it.sgstAmount,
        igst_percent: it.igstPercent,
        igst_amount: it.igstAmount,
        total_amount: it.totalAmount,
        store_id: def.storeId,
        store_code: def.storeCode,
        line_type: it.lineType,
        calculation_type: it.calculationType,
        is_standard: true,
      }));

      // 1. Create estimate header + initial revision 0
      const createRes = await client.query(
        "SELECT public.create_estimate_atomic($1::jsonb, $2::jsonb) as res",
        [JSON.stringify(estimatePayload), JSON.stringify(itemsPayload)]
      );
      const createdEst = createRes.rows[0].res;
      const estId = createdEst.id;
      console.log(`    ✓ create_estimate_atomic succeeded: ID ${estId}, estimate_number: ${createdEst.estimate_number}`);

      // 2. Exercise replace_estimate_items RPC to verify persistence and revision tracking
      const replaceRes = await client.query(
        "SELECT public.replace_estimate_items($1::integer, $2::jsonb) as res",
        [estId, JSON.stringify(itemsPayload)]
      );
      console.log(`    ✓ replace_estimate_items RPC succeeded: replaced ${replaceRes.rows[0].res} items`);

      createdEstimates.push({
        id: estId,
        estimateNumber: def.estimateNumber,
        storeName: def.storeName,
        itemCount: def.items.length,
        subtotal: def.subtotal,
        taxAmount: def.cgst + def.sgst,
        totalAmount: def.totalAmount,
      });
    }

    // 6. Sequence Preservation Check
    console.log("\n>>> [STEP 6] Checking Sequence Preservation...");
    const postNextEstNum = (await client.query("SELECT public.next_sunrise_document_number('estimate', CURRENT_DATE, 1) as num")).rows[0].num;
    console.log(`  Sequence check: Before="${preNextEstNum}", After="${postNextEstNum}"`);
    assert.equal(postNextEstNum, preNextEstNum, "Estimate sequence number was inadvertently changed!");
    console.log("  ✓ Financial-year sequence completely preserved and untouched.");

    // 7. Isolation Check: confirm Workspace 2 & 3 unaffected
    console.log("\n>>> [STEP 7] Multi-Company Isolation Check...");
    const postCountComp2 = (await client.query("SELECT count(*) FROM estimates WHERE company_id = 2")).rows[0].count;
    const postCountComp3 = (await client.query("SELECT count(*) FROM estimates WHERE company_id = 3")).rows[0].count;
    assert.equal(postCountComp2, preCountComp2, "Workspace 2 estimates count changed!");
    assert.equal(postCountComp3, preCountComp3, "Workspace 3 estimates count changed!");
    console.log(`  ✓ Workspace 2 count intact (${postCountComp2}), Workspace 3 count intact (${postCountComp3}).`);

    // 8. Detailed Reopen & Value Verification
    console.log("\n>>> [STEP 8] Reopening every saved estimate from database and comparing against source PDF values...");
    for (const def of WAKEFIT_ESTIMATES) {
      const dbEstRes = await client.query(
        "SELECT *, TO_CHAR(estimate_date, 'YYYY-MM-DD') as formatted_date FROM estimates WHERE estimate_number = $1",
        [def.estimateNumber]
      );
      assert.equal(dbEstRes.rows.length, 1, `Estimate ${def.estimateNumber} must exist exactly once`);
      const dbEst = dbEstRes.rows[0];

      assert.equal(dbEst.company_id, 1, "Company ID must be 1");
      assert.equal(dbEst.client_id, 3, "Client ID must be 3");
      assert.equal(dbEst.brand_id, 4, "Brand ID must be 4");
      assert.equal(dbEst.store_id, def.storeId, `Store ID must match ${def.storeId}`);
      assert.equal(dbEst.format_profile_code, "RETAIL_SINGLE_STORE", "Format profile must be RETAIL_SINGLE_STORE");
      assert.equal(dbEst.client_format, "RETAIL_SINGLE_STORE", "Client format must be RETAIL_SINGLE_STORE");
      assert.equal(dbEst.formatted_date, "2025-08-21", "Formatted estimate date must be 2025-08-21");
      const localFormatted = new Date(dbEst.estimate_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
      console.log(`    Date display: SQL Date=${dbEst.formatted_date}, Rendered="${localFormatted}" (matches 21-Aug-2025)`);
      assert.equal(localFormatted, "21-Aug-2025", "Rendered estimate date must be 21-Aug-2025");
      assert.equal(Number(dbEst.subtotal).toFixed(2), def.subtotal.toFixed(2), "Subtotal mismatch");
      assert.equal(Number(dbEst.tax_amount).toFixed(2), (def.cgst + def.sgst).toFixed(2), "Tax amount mismatch");
      assert.equal(Number(dbEst.total_amount).toFixed(2), def.totalAmount.toFixed(2), "Total amount mismatch");

      // Verify line items
      const dbItemsRes = await client.query("SELECT * FROM estimate_items WHERE estimate_id = $1 ORDER BY sl", [dbEst.id]);
      const dbItems = dbItemsRes.rows;
      assert.equal(dbItems.length, def.items.length, `Line item count mismatch for ${def.estimateNumber}`);

      for (let i = 0; i < def.items.length; i++) {
        const src = def.items[i];
        const dbIt = dbItems[i];
        assert.equal(dbIt.sl, src.sl, `Item ${i+1} SL mismatch`);
        assert.equal(dbIt.item_name, src.itemName, `Item ${i+1} item_name mismatch`);
        assert.equal(dbIt.description, src.description, `Item ${i+1} description mismatch`);
        assert.equal(dbIt.hsn, src.hsn, `Item ${i+1} HSN mismatch`);
        assert.equal(Number(dbIt.quantity).toFixed(2), src.quantity.toFixed(2), `Item ${i+1} quantity mismatch`);
        assert.equal(Number(dbIt.rate).toFixed(2), src.rate.toFixed(2), `Item ${i+1} rate mismatch`);
        assert.equal(Number(dbIt.total_price).toFixed(2), src.totalPrice.toFixed(2), `Item ${i+1} total_price mismatch`);
        assert.equal(Number(dbIt.cgst_amount).toFixed(2), src.cgstAmount.toFixed(2), `Item ${i+1} CGST amount mismatch`);
        assert.equal(Number(dbIt.sgst_amount).toFixed(2), src.sgstAmount.toFixed(2), `Item ${i+1} SGST amount mismatch`);
        assert.equal(Number(dbIt.total_amount).toFixed(2), src.totalAmount.toFixed(2), `Item ${i+1} total_amount mismatch`);
        assert.equal(dbIt.store_code, def.storeCode, `Item ${i+1} store_code mismatch`);
        assert.equal(dbIt.store_id, def.storeId, `Item ${i+1} store_id mismatch`);
        assert.equal(dbIt.company_id, 1, `Item ${i+1} company_id mismatch`);
      }

      console.log(`  ✓ ${def.estimateNumber} verified: ${dbItems.length} items, Subtotal=₹${def.subtotal}, Tax=₹${(def.cgst + def.sgst).toFixed(2)}, Total=₹${def.totalAmount.toFixed(2)}`);
    }

    console.log("\n🎉 ALL 7 WAKEFIT ESTIMATES IMPORTED AND VERIFIED SUCCESSFULLY!");
    return createdEstimates;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("import-wakefit-estimates.ts")) {
  importWakefitEstimates().catch(err => {
    console.error("❌ Import failed:", err);
    process.exit(1);
  });
}
