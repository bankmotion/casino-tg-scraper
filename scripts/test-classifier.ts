import "dotenv/config";
import { prefilter } from "../src/listener/prefilter.js";
import { classify } from "../src/listener/classifier.js";

const samples: { name: string; text: string }[] = [
  {
    name: "Real Winna promo",
    text: `🃏 ORIGINAL OF THE WEEK - Blackjack

The one game where you can actually blame yourself and not the RNG 😂

Play Blackjack! (https://link.winna.com/blackjack-tg)

BONUS CODE:
BL_CKJ_CK-05-m8k2

• $5 value
• 200 claims
• $15,000 wager required (last 7 days)


➡️ New to Winna? Register now! (https://link.winna.com/tg-register-msg)`,
  },
  {
    name: "Casino chat (non-promo)",
    text: `gm everyone 🌅 big win at the slots last night`,
  },
  {
    name: "News-style (non-promo)",
    text: `New game added to the lobby: Sweet Bonanza 1000. Try it out!`,
  },
];

async function main() {
  for (const s of samples) {
    console.log("=".repeat(70));
    console.log(`SAMPLE: ${s.name}`);
    console.log("-".repeat(70));
    console.log(s.text.slice(0, 200) + (s.text.length > 200 ? "..." : ""));
    console.log("-".repeat(70));

    const pre = prefilter(s.text);
    console.log(`pre-filter: ${pre.pass ? "PASS" : "FAIL"}  (${pre.reasons.join(", ")})`);
    if (!pre.pass) {
      console.log("→ would be dropped at stage 1 (no OpenAI call)\n");
      continue;
    }

    const t0 = Date.now();
    const result = await classify(s.text);
    const ms = Date.now() - t0;
    console.log(`OpenAI (${ms}ms):`);
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `→ ${result.confidence >= 0.5 ? "WOULD BE QUEUED" : "would be dropped (low confidence)"}\n`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
