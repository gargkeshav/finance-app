import type { Ledger } from "./ledger";

export const STARTER_CATEGORIES = [
  { name: "Home", nature: "essential", children: ["Groceries", "Rent and mortgage", "Utilities", "Internet and phone", "Insurance", "Household items", "Repairs"] },
  { name: "Eating out", nature: "discretionary", children: ["Coffee", "Lunch", "Restaurants and takeaway", "Drinks"] },
  { name: "Transport", nature: "essential", children: ["Fuel", "Public transport", "Rideshare and taxi", "Parking and tolls", "Car"] },
  { name: "Health and fitness", nature: "essential", children: ["Medical and pharmacy", "Fitness"] },
  { name: "Shopping", nature: "discretionary", children: ["Clothing", "Electronics", "Outdoor and sport", "General"] },
  { name: "Travel", nature: "oneOff", children: ["Flights", "Accommodation", "Activities"] },
  { name: "Entertainment", nature: "discretionary", children: ["Subscriptions", "Events and outings"] },
  { name: "Gifts and giving", nature: "discretionary", children: ["Gifts", "Gift cards", "Donations"] },
  { name: "Fees and interest", nature: "essential", children: ["Card fees", "Interest"] },
  { name: "Work", nature: "reimbursable", children: ["Work expenses"] },
] as const;

export function addStarterCategories(ledger: Ledger, updatedAt: string): Ledger {
  const categories = [...(ledger.categories ?? [])];
  let added = false;

  function addCategory(name: string, parentId?: string, nature?: (typeof STARTER_CATEGORIES)[number]["nature"]): string | undefined {
    const existing = categories.find((category) => category.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    categories.push({
      id,
      name,
      archived: false,
      updatedAt,
      ...(parentId ? { parentId } : {}),
      ...(nature ? { nature } : {}),
    });
    added = true;
    return id;
  }

  for (const starter of STARTER_CATEGORIES) {
    const parentId = addCategory(starter.name, undefined, starter.nature)
      ?? categories.find((category) => category.name.trim().toLowerCase() === starter.name.toLowerCase())?.id;
    for (const child of starter.children) addCategory(child, parentId);
  }

  return added ? { ...ledger, categories } : ledger;
}