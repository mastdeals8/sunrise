export type ServiceProductLike = {
  id?: number | null;
  name?: string | null;
  calculationType?: string | null;
  calculation_type?: string | null;
  unit?: string | null;
  rate?: number | string | null;
  gstPercent?: number | string | null;
  gst_percent?: number | string | null;
  hsnSac?: string | null;
  hsn_sac?: string | null;
};

export type ServiceEstimateItemLike = {
  productId?: number | string | null;
  product_id?: number | string | null;
  lineType?: string | null;
  line_type?: string | null;
  itemName?: string | null;
  item_name?: string | null;
  description?: string | null;
  calculationType?: string | null;
  calculation_type?: string | null;
  unit?: string | null;
  rate?: number | string | null;
  hsn?: string | null;
  cgstPercent?: number | string | null;
  sgstPercent?: number | string | null;
  igstPercent?: number | string | null;
};

export type ResolvedServiceProduct = {
  product: ServiceProductLike | null;
  productName: string;
  calculationType: string;
  unit: string;
  rate: number;
  gstPercent: number;
  hsn: string;
  label: string;
  rateLabel: string;
};

const SERVICE_LINE_TYPES = new Set(["packing", "installation", "transport"]);

const text = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => text(value).toLowerCase();
const finiteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const displayNumber = (value: number) => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));

export const isServiceEstimateItem = (item: ServiceEstimateItemLike | null | undefined) =>
  SERVICE_LINE_TYPES.has(key(item?.lineType ?? item?.line_type));

const productIdOf = (item: ServiceEstimateItemLike) => Number(item.productId ?? item.product_id) || 0;
const calculationTypeOf = (value: ServiceProductLike | ServiceEstimateItemLike | null | undefined) =>
  key(value?.calculationType ?? value?.calculation_type);

const matchingProduct = (
  item: ServiceEstimateItemLike,
  products: ServiceProductLike[],
): ServiceProductLike | null => {
  const productId = productIdOf(item);
  if (productId) {
    const linked = products.find(product => Number(product.id) === productId);
    if (linked) return linked;
  }

  // Old estimates may predate product_id. Resolve them by service role while
  // keeping the saved item fields as the final backward-compatible fallback.
  const lineType = key(item.lineType ?? item.line_type);
  const itemCalc = calculationTypeOf(item);
  const itemUnit = key(item.unit);
  if (lineType === "packing") return products.find(product => key(product.name).includes("packing")) || null;
  if (lineType === "installation") return products.find(product => key(product.name).includes("installation")) || null;
  if (lineType === "transport") {
    const perUnit = itemCalc === "per_km" || itemUnit === "km";
    return products.find(product => {
      const productCalc = calculationTypeOf(product);
      const productUnit = key(product.unit);
      const isPerUnit = productCalc === "per_km" || productUnit === "km";
      return key(product.name).includes("transport") || key(product.name).includes("outstation")
        ? isPerUnit === perUnit
        : false;
    }) || null;
  }
  return null;
};

const fallbackProductName = (item: ServiceEstimateItemLike) => {
  const savedName = text(item.itemName ?? item.item_name ?? item.description)
    .replace(/\s*\([^)]*(?:%|\/\s*km|per\s+km)[^)]*\)\s*$/i, "")
    .trim();
  if (savedName) return savedName;
  const lineType = key(item.lineType ?? item.line_type);
  if (lineType === "packing") return "Packing Charges";
  if (lineType === "installation") return "Installation Charges";
  return "Transportation";
};

const displayProductName = (productName: string, calculationType: string, unit: string) => {
  if (calculationType === "per_km" || key(unit) === "km") {
    // Product Master historically calls this service "Outstation Charges";
    // the customer-facing estimate wording is the established transportation
    // label. This normalization lives only here for every UI/export consumer.
    return productName.replace(/\s+Charges$/i, " Transportation");
  }
  return productName;
};

export const resolveServiceProduct = (
  item: ServiceEstimateItemLike,
  products: ServiceProductLike[] = [],
): ResolvedServiceProduct => {
  const product = matchingProduct(item, products);
  const productName = text(product?.name) || fallbackProductName(item);
  const calculationType = calculationTypeOf(product) || calculationTypeOf(item) || "fixed";
  const unit = text(product?.unit) || text(item.unit);

  // The estimate row is the transactional snapshot. In particular, the three
  // reported estimates were sold at ₹15/KM while today's master rate is ₹18.
  const savedRate = item.rate;
  const rate = savedRate !== null && savedRate !== undefined && text(savedRate) !== ""
    ? finiteNumber(savedRate)
    : finiteNumber(product?.rate);
  const savedGst = finiteNumber(item.igstPercent)
    || finiteNumber(item.cgstPercent) + finiteNumber(item.sgstPercent);
  const gstPercent = savedGst || finiteNumber(product?.gstPercent ?? product?.gst_percent);
  const hsn = text(item.hsn) || text(product?.hsnSac ?? product?.hsn_sac);
  const customerName = displayProductName(productName, calculationType, unit);

  let label = customerName;
  let rateLabel = "";
  if (calculationType === "percentage") {
    rateLabel = `${displayNumber(rate)}%`;
    label = rate > 0 ? `${customerName} (${rateLabel})` : customerName;
  } else if (calculationType === "per_km" || key(unit) === "km") {
    const unitLabel = (unit || "km").toUpperCase();
    rateLabel = rate > 0 ? `₹${displayNumber(rate)}/${unitLabel}` : "";
    label = rateLabel ? `${customerName} (${rateLabel})` : customerName;
  }

  return { product, productName, calculationType, unit, rate, gstPercent, hsn, label, rateLabel };
};

export const serviceProductLabel = (
  item: ServiceEstimateItemLike,
  products: ServiceProductLike[] = [],
) => resolveServiceProduct(item, products).label;

export const serviceProductRateLabel = (
  item: ServiceEstimateItemLike,
  products: ServiceProductLike[] = [],
) => resolveServiceProduct(item, products).rateLabel;
