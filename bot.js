import dotenv from "dotenv";
import fetch from "node-fetch";
import { TwitterApi } from "twitter-api-v2";
dotenv.config();

const {
  X_API_KEY,
  X_API_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_SECRET,
  BACKEND_URL
} = process.env;

if (!X_API_KEY) throw new Error("❌ Missing X_API_KEY in .env");

const xClient = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET
});

const rwClient = xClient.readWrite;

// === CONFIG ===
const BOT_HANDLE = "bot_wassy";
const POLL_INTERVAL = 90000; // 90 seconds safe for free tier

console.log("🤖 Starting WASSY bot...");
let lastMentionId = null;

// === Helper: reply to tweet ===
async function replyToTweet(tweetId, message) {
  try {
    await rwClient.v2.reply(message, tweetId);
    console.log(`💬 Replied: ${message}`);
  } catch (err) {
    console.error("❌ Reply failed:", err?.data || err);
  }
}

// === Helper: process payment command ===
async function handleCommand(tweet) {
  const text = tweet.text.toLowerCase();
  const author = tweet.author_id;

  const regex = /send\s*@(\w+)\s*\$?([\d.]+)/i;
  const match = text.match(regex);
  if (!match) return;

  const handle = match[1];
  const amount = parseFloat(match[2]);
  console.log(`🧾 Parsed command: ${tweet.id} | send @${handle} $${amount}`);

  // Check sender’s Dev.fun account
  const senderUsername = tweet.author.username?.replace("@", "") || tweet.username;
  const checkRes = await fetch(`${BACKEND_URL}/api/check-profile?handle=${senderUsername}`);
  const senderData = await checkRes.json();
  if (!senderData.success) {
    await replyToTweet(tweet.id, `@${senderUsername} You must create a WASSY account on dev.fun before sending payments.`);
    return;
  }

  // Check recipient
  const recvRes = await fetch(`${BACKEND_URL}/api/check-profile?handle=${handle}`);
  const recvData = await recvRes.json();
  if (!recvData.success) {
    await replyToTweet(tweet.id, `@${senderUsername} The recipient @${handle} has no WASSY Pay account yet.`);
    return;
  }

  // Trigger payment
  const sendRes = await fetch(`${BACKEND_URL}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromTwitterId: senderUsername,
      toHandle: handle,
      amount
    })
  });

  const data = await sendRes.json();
  if (sendRes.status === 200 && data.success) {
    await replyToTweet(tweet.id, `✅ @${senderUsername} sent $${amount} USDC to @${handle} via WASSY Pay!`);
  } else if (sendRes.status === 402) {
    await replyToTweet(tweet.id, `⚠️ @${senderUsername} Insufficient funds. Top up your vault first.`);
  } else {
    await replyToTweet(tweet.id, `❌ Payment failed: ${data.message || "unknown error"}`);
  }
}

// === Polling loop ===
async function pollMentions() {
  try {
    const mentions = await rwClient.v2.userMentionTimeline("me", {
      since_id: lastMentionId || undefined,
      expansions: ["author_id"],
      "tweet.fields": ["id", "text", "author_id"]
    });

    if (mentions.data?.data?.length) {
      const tweets = mentions.data.data.reverse();
      for (const t of tweets) {
        console.log("📥 Mention:", t.text);
        await handleCommand(t);
      }
      lastMentionId = mentions.data.meta?.newest_id;
    } else {
      console.log("⏳ No new mentions...");
    }
  } catch (err) {
    console.error("⚠️ Polling error:", err?.data || err);
  } finally {
    setTimeout(pollMentions, POLL_INTERVAL);
  }
}

// === Start the loop ===
pollMentions();
