import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod";
import {
  FACTS_KEY,
  parseFacts,
  type Fact,
} from "../lib/store.js";

export default defineTool({
  description:
    "Store or update a lasting personal fact or preference under a stable key (for example timezone, name, preferred_city).",
  effect: "write",
  inputSchema: z.object({
    key: z
      .string()
      .min(1)
      .describe("Stable snake_case key, e.g. timezone or preferred_name."),
    value: z.string().min(1).describe("Fact or preference value."),
  }),
  async execute({ key, value }, ctx) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
    const facts = parseFacts(await ctx.host.kv.get(FACTS_KEY));
    const fact: Fact = {
      key: normalized,
      value: value.trim(),
      updatedAt: new Date().toISOString(),
    };
    const next = facts.filter((f) => f.key !== normalized);
    next.push(fact);
    next.sort((a, b) => a.key.localeCompare(b.key));
    await ctx.host.kv.put(FACTS_KEY, next);
    return { saved: true, fact };
  },
});
