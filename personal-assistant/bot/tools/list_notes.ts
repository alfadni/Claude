import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { NOTES_KEY, parseNotes } from "../lib/store.js";

export default defineTool({
  description:
    "List saved personal notes, newest first. Optionally filter by a case-insensitive substring in title or body.",
  effect: "read",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional substring filter over title and body."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max notes to return. Defaults to 20."),
  }),
  async execute({ query, limit }, ctx) {
    const max = limit ?? 20;
    let notes = parseNotes(await ctx.host.kv.get(NOTES_KEY));
    if (query !== undefined && query.trim() !== "") {
      const needle = query.trim().toLowerCase();
      notes = notes.filter(
        (n) =>
          n.title.toLowerCase().includes(needle) ||
          n.body.toLowerCase().includes(needle),
      );
    }
    const sliced = notes.slice(0, max);
    return { count: sliced.length, notes: sliced };
  },
});
