import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import {
  NOTES_KEY,
  parseNotes,
  type Note,
} from "../lib/store.js";

export default defineTool({
  description:
    "Save a short personal note. Use when the user wants something remembered as a note (not a lasting preference key).",
  effect: "write",
  inputSchema: z.object({
    title: z.string().min(1).describe("Short title for the note."),
    body: z.string().min(1).describe("Note body, kept concise."),
  }),
  async execute({ title, body }, ctx) {
    const notes = parseNotes(await ctx.host.kv.get(NOTES_KEY));
    const note: Note = {
      id: crypto.randomUUID(),
      title: title.trim(),
      body: body.trim(),
      createdAt: new Date().toISOString(),
    };
    notes.unshift(note);
    await ctx.host.kv.put(NOTES_KEY, notes);
    return { saved: true, note };
  },
});
