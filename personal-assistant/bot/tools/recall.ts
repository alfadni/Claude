import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import { FACTS_KEY, parseFacts } from "../lib/store.js";

export default defineTool({
  description:
    "Recall lasting personal facts. Pass a key for one fact, or omit key to list all.",
  effect: "read",
  inputSchema: z.object({
    key: z
      .string()
      .optional()
      .describe("Optional fact key. Omit to return every stored fact."),
  }),
  async execute({ key }, ctx) {
    const facts = parseFacts(await ctx.host.kv.get(FACTS_KEY));
    if (key === undefined || key.trim() === "") {
      return { count: facts.length, facts };
    }
    const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
    const fact = facts.find((f) => f.key === normalized);
    if (fact === undefined) {
      return { found: false, key: normalized, facts: [] as const };
    }
    return { found: true, fact };
  },
});
