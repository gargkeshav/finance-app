export function cleanMerchantKey(description: string): string {
  return description.toLowerCase().replace(/[0-9]/g, "").replace(/\s+/g, " ").trim();
}