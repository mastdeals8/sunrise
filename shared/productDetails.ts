type ProductLike = {
  id?: number | string | null;
  name?: string | null;
  description?: string | null;
  defaultSpecification?: string | null;
};

const cleanText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

export const sameDisplayText = (a: unknown, b: unknown) =>
  cleanText(a).toLowerCase() === cleanText(b).toLowerCase();

export const formatProductDetails = (
  product?: ProductLike | null,
  fallbackDescription?: string | null,
  element?: string | null,
) => {
  const alias = cleanText(product?.name);
  const description = cleanText(product?.description || product?.defaultSpecification || fallbackDescription);
  const fallback = cleanText(fallbackDescription);
  const elementText = cleanText(element);

  const composed = alias && description && sameDisplayText(alias, elementText)
    ? description
    : alias && description && !sameDisplayText(alias, description)
    ? `${alias} - ${description}`
    : alias || description || fallback;

  if (!composed || sameDisplayText(composed, elementText)) return "";
  if (!alias && fallback && sameDisplayText(fallback, elementText)) return "";
  return composed;
};
