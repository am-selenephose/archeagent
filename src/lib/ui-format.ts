type OperationalNumber = "count" | "currency" | "probability" | "seconds";

/** Display-only formatting; reported values and evaluator math retain their precision. */
export function formatOperationalNumber(value: number | null | undefined, type: OperationalNumber, signed = false) {
  if (value == null || !Number.isFinite(value)) return "--";
  const normalized = Object.is(value, -0) ? 0 : value;
  const amount = type === "probability" ? normalized * 100 : normalized;
  const absolute = Math.abs(amount);
  const sign = amount === 0 ? "" : amount < 0 ? "-" : signed ? "+" : "";
  if ((type === "currency" || type === "probability") && absolute > 0 && absolute < 0.005) {
    return sign + (type === "currency" ? "<$0.01" : "<0.01%");
  }
  const decimals = type === "currency" ? 2 : type === "probability" ? absolute >= 1000 ? 0 : absolute >= 100 ? 1 : 2 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: type === "currency" || type === "probability" ? decimals : 0,
    maximumFractionDigits: decimals,
  }).format(absolute);
  return sign + (type === "currency" ? "$" : "") + formatted + (type === "probability" ? "%" : type === "seconds" ? " s" : "");
}
