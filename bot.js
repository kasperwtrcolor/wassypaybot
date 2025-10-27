import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { TwitterApi } from "twitter-api-v2";
import { log } from "./utils.js";

dotenv.config();

const app = express();
app.use(express.json());

// === Twitter client setup ===
const client = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});
const rwClient = client.readWrite;

// === Command parser ===
function parseTweet(text) {
  const regex = /send\s+@(\w+)\s*\$?([\d.]+)/i;
  const match = text.match(regex);
  if (!match) return null;
  return { handle: match[1], amount: parseFloat(match[2]) };
}

// === Core mention handler ===
async function handleMention(tweet) {
  try {
    const { id, text, author_id } = tweet;
    const command = parseTweet(text);
    if (!command) return;

    const { handle, amount } = command;
    await log(`💬 Detected command: @${handle} $${amount}`);

    // === Check if sender has a Dev.fun account ===
    const senderCheckUrl = `${process.env.BACKEND_URL}/api/check-profile?handle=${author_id}`;
    const senderResp = await fetch(senderCheckUrl);
    const senderData = await senderResp.json().catch(() => ({}));

    if (!senderData.success) {
      const msg = `⚠️ You need a WASSY Pay account before sending money.
👉 Visit https://wassy.dev.fun to create one.`;
      await rwClient.v2.reply(msg, id);
      await log(`❌ No Dev.fun profile found for ${author_id}`);
      return;
    }

    // === Proceed to payment ===
    const sendResp = await fetch(`${process.env.BACKEND_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromTwitterId: author_id,
        toHandle: handle,
        amount
      })
    });

    const result = await sendResp.json().catch(() => ({}));
    await log(`Backend response: ${JSON.stringify(result)}`);

    // === Construct reply ===
    let message;
    if (result.success) {
      message = `✅ Sent $${amount} to @${handle}!`;
    } else if (result.message?.includes("Payment")) {
      message = `💸 Payment request detected — complete $${amount} transfer here:\n${process.env.BACKEND_URL}`;
    } else {
      message = `⚠️ Unable to process your request right now.`;
    }

    await rwClient.v2.reply(message, id);
    await log(`✅ Replied to tweet ${id}`);
  } catch (err) {
    await log(`❌ Error handling mention: ${err.message}`);
  }
}

// === Poll mentions loop ===
let lastSeenId = null;

async function pollMentions() {
  try {
    const mentions = await rwClient.v2.mentions("bot_wassy", {
      since_id: lastSeenId,
      "tweet.fields": "author_id,text,created_at"
    });

    if (!mentions.data?.length) return;

    for (const tweet of mentions.data.reverse()) {
      await handleMention(tweet);
      lastSeenId = tweet.id;
    }
  } catch (err) {
    await log(`⚠️ Polling error: ${err.message}`);
  }
}

// === Interval polling ===
setInterval(pollMentions, 15000);
await log("🚀 WASSY Bot is live — watching mentions every 15s...");

// === Keepalive endpoint ===
app.get("/", (_, res) => res.send("🤖 WASSY Bot active."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`🌐 Server listening on port ${PORT}`));
