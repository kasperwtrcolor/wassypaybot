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
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
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
      const msg = `⚠️ You need a WASSY Pay account before sending money.\n👉 Visit https://wassy.dev.fun to create one.`;
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
        amount,
      }),
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

// === Poll mentions loop (with rate-limit backoff) ===
let lastSeenId = null;
let botUserId = null;
let pollInterval = 30000; // start at 30s, will adapt if rate limited

async function initBotUser() {
  try {
    const me = await rwClient.v2.me();
    botUserId = me.data.id;
    await log(`🤖 Bot user ID: ${botUserId}`);
  } catch (err) {
    await log(`❌ Failed to get bot user ID: ${err.message}`);
  }
}

async function pollMentions() {
  try {
    if (!botUserId) return;

    const options = {
      "tweet.fields": "author_id,text,created_at",
      max_results: 5,
    };
    if (lastSeenId) options.since_id = lastSeenId;

    const mentions = await rwClient.v2.userMentionTimeline(botUserId, options);

    if (mentions.data?.length) {
      for (const tweet of mentions.data.reverse()) {
        await handleMention(tweet);
        lastSeenId = tweet.id;
      }
    }

    pollInterval = 30000; // reset to 30s after success
  } catch (err) {
    await log(`⚠️ Polling error: ${err.message}`);

    // If it's a rate limit, slow down exponentially
    if (err.code === 429 || /429/.test(err.message)) {
      pollInterval = Math.min(pollInterval * 2, 10 * 60 * 1000); // cap at 10 minutes
      await log(`⏱️ Rate-limited. Backing off to ${pollInterval / 1000}s`);
    }
  }
}

// === Adaptive polling loop ===
async function pollMentionsLoop() {
  await pollMentions();
  setTimeout(pollMentionsLoop, pollInterval);
}

// === Initialize and start polling ===
await initBotUser();
pollMentionsLoop();
await log("🚀 WASSY Bot live — adaptive polling enabled...");

// === Keepalive endpoint ===
app.get("/", (_, res) => res.send("🤖 WASSY Bot active."));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`🌐 Server listening on port ${PORT}`));
