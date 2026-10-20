import type { JsonValue } from "@cursor/bdk";

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

export type Fact = {
  key: string;
  value: string;
  updatedAt: string;
};

const NOTES_KEY = "pa/notes";
const FACTS_KEY = "pa/facts";

function isNote(value: unknown): value is Note {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.title === "string" &&
    typeof n.body === "string" &&
    typeof n.createdAt === "string"
  );
}

function isFact(value: unknown): value is Fact {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.key === "string" &&
    typeof f.value === "string" &&
    typeof f.updatedAt === "string"
  );
}

export function parseNotes(raw: JsonValue | undefined): Note[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isNote);
}

export function parseFacts(raw: JsonValue | undefined): Fact[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFact);
}

export { NOTES_KEY, FACTS_KEY };
