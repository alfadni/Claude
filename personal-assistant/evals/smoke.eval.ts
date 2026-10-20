import { defineEval, includes } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  cases: [
    {
      id: "remember-timezone",
      description: "Stores a lasting preference via remember.",
      async test(t) {
        await t.send("Please remember that my timezone is America/Los_Angeles.");
        t.succeeded();
        t.calledTool("remember");
        t.check(t.reply, includes(/america\/los_angeles|timezone|remembered|saved/i));
      },
    },
  ],
});
