import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";
import { TwitterApi } from "twitter-api-v2";

dotenv.config();

const {
  X_API_KEY,
  X_API_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_SECRET,
  BACKEND_URL,
  PORT = 3000
} = process.env;

if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
  throw new Error("❌ Missing Twitter API credentials in environment variables");
}

const app = express();
app.use(cors());
app.use(express.json());

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET
});
const rwClient = client.readWrite;

async function replyToTweet(tweetId, message) {
  try {
    await rwClient.v2.reply(message, tweetId);
    console.log(`💬 Replied to ${tweetId}: ${message}`);
  } catch (err) {
    console.error("❌ Reply failed:", err?.data || err);
  }
}

// --- Webhook Endpoint ---
app.post("/api/handleTweet", async (req, res) => {
  try {
    const { tweet_id, text, sender_handle } = req.body;

    if (!tweet_id || !text || !sender_handle) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log(`📥 New tweet from @${sender_handle}: ${text}`);

    // detect pattern: send @user $amount
    const regex = /send\s*@(\w+)\s*\$?([\d.]+)/i;
    const match = text.match(regex);
    if (!match) {
      console.log("No valid payment command found.");
      return res.json({ message: "No payment command found" });
    }

    const recipient = match[1];
    const amount = parseFloat(match[2]);
    console.log(`🧾 Parsed command: send $${amount} to @${recipient}`);

    // check sender has Wassy Pay account
    const senderCheck = await fetch(`${BACKEND_URL}/api/check-profile?handle=${sender_handle}`);
    const senderData = await senderCheck.json();

    if (!senderData.success) {
      await replyToTweet(tweet_id, `@${sender_handle} You must create a WASSY account on dev.fun first.`);
      return res.json({ success: false, reason: "no_sender_profile" });
    }

    // check recipient
    const recvCheck = await fetch(`${BACKEND_URL}/api/check-profile?handle=${recipient}`);
    const recvData = await recvCheck.json();

    if (!recvData.success) {
      await replyToTweet(tweet_id, `@${sender_handle} The recipient @${recipient} has no WASSY Pay account.`);
      return res.json({ success: false, reason: "no_recipient_profile" });
    }

    // attempt payment
    const sendRes = await fetch(`${BACKEND_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromTwitterId: sender_handle,
        toHandle: recipient,
        amount
      })
    });

    const result = await sendRes.json();

    if (sendRes.status === 200 && result.success) {
      await replyToTweet(tweet_id, `✅ @${sender_handle} sent $${amount} USDC to @${recipient} via WASSY Pay!`);
    } else if (sendRes.status === 402) {
      await replyToTweet(tweet_id, `⚠️ @${sender_handle} Insufficient funds. Top up your WASSY vault first.`);
    } else {
      await replyToTweet(tweet_id, `❌ @${sender_handle} Payment failed: ${result.message || "unknown error"}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("💥 Error in handleTweet:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => console.log(`🚀 WASSY Bot webhook running on port ${PORT}`));
