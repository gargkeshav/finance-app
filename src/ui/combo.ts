export type ComboResolution =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

export function resolveComboText(text: string, options: { id: string; name: string }[]): ComboResolution {
  const name = text.trim();
  if (!name) return { kind: "none" };

  const existing = options.find((option) => option.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  return existing ? { kind: "existing", id: existing.id } : { kind: "new", name };
}