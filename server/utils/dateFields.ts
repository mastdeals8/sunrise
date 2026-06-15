/**
 * Date-field preprocessing helper.
 *
 * --- WHY THIS EXISTS --------------------------------------------------------
 * Drizzle ORM declares timestamp columns as native JS `Date` values, and
 * `drizzle-zod`'s `createInsertSchema()` reflects that as `z.date()` -- which
 * does NOT coerce strings (drizzle-zod sets `coerce: false`).
 *
 * Browsers send dates over JSON as ISO strings ("2025-04-01T...") or
 * yyyy-mm-dd strings. Express' body parser keeps them as plain strings, so a
 * naive route like:
 *
 *     const parsed = insertInvoiceSchema.safeParse(req.body);
 *
 * fails Zod validation for every `timestamp` column with
 *   "Expected date, received string".
 *
 * The historical workaround scattered through `server/routes.ts` was to do
 *   date: req.body.date ? new Date(req.body.date) : undefined
 * on a per-field basis, which is:
 *   1. duplicated everywhere, and
 *   2. silently forgotten on every new POST/PATCH route, breaking the route.
 *
 * This helper centralizes the transform so a new route only needs to list
 * which fields are dates.
 * ---------------------------------------------------------------------------
 */

export type DateFieldSpec =
  | string
  | { field: string; defaultTo?: () => Date };

/**
 * Returns a shallow copy of `body` with the listed fields coerced to `Date`.
 *
 * Behavior per field:
 *   - If the value is already a `Date`, it is kept as-is.
 *   - If the value is a non-empty string or number, it is wrapped in `new Date()`.
 *   - If the value is missing/null/empty AND `defaultTo` is provided, the
 *     default factory is invoked (typically `() => new Date()` for "now").
 *   - Otherwise the field is left untouched, so Zod-optional fields keep
 *     validating as `undefined`.
 *
 * Use this BEFORE `safeParse` of any insert/update schema that maps to a
 * Drizzle `timestamp()` column.
 *
 * Examples:
 *   const data = preprocessDateFields(req.body, ["date", "dueDate"]);
 *   const parsed = insertInvoiceSchema.safeParse(data);
 *
 *   // With a "now" default for a missing field:
 *   const data = preprocessDateFields(req.body, [
 *     { field: "expenseDate", defaultTo: () => new Date() },
 *   ]);
 */
export function preprocessDateFields<T extends Record<string, any>>(
  body: T,
  fields: ReadonlyArray<DateFieldSpec>,
): T {
  const out: Record<string, any> = { ...body };
  for (const entry of fields) {
    const field = typeof entry === "string" ? entry : entry.field;
    const defaultTo = typeof entry === "string" ? undefined : entry.defaultTo;
    const raw = out[field];

    if (raw instanceof Date) continue;

    if (raw !== undefined && raw !== null && raw !== "") {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        out[field] = d;
        continue;
      }
    }

    if (defaultTo) {
      out[field] = defaultTo();
    }
  }
  return out as T;
}

/** Convenience factory: `defaultTo: nowDefault` -> defaults missing field to now. */
export const nowDefault = (): Date => new Date();
