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

const app = express();
app.use(cors());
app.use(express.json());

const xClient = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET
});

const rwClient = xClient.readWrite;

async function replyToTweet(tweetId, message) {
  try {
    await rwClient.v2.reply(message, tweetId);
    console.log(`💬 Replied to ${tweetId}: ${message}`);
  } catch (err) {
    console.error("❌ Reply failed:", err?.data || err);
  }
}

// 🔥 MAIN HANDLER — receives tweet events from your backend
app.post("/api/handleTweet", async (req, res) => {
  try {
    const { tweet_id, text, sender_handle } = req.body;
    if (!tweet_id || !text || !sender_handle) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log(`📥 New tweet from @${sender_handle}: ${text}`);

    const regex = /send\s*@(\w+)\s*\$?([\d.]+)/i;
    const match = text.match(regex);
    if (!match) {
      return res.json({ message: "No payment command found" });
    }

    const recipient = match[1];
    const amount = parseFloat(match[2]);
    console.log(`🧾 Command detected: send $${amount} to @${recipient}`);

    // Check sender profile
    const senderCheck = await fetch(`${BACKEND_URL}/api/check-profile?handle=${sender_handle}`);
    const senderData = await senderCheck.json();
    if (!senderData.success) {
      await replyToTweet(tweet_id, `@${sender_handle} You need a WASSY Pay account on dev.fun before sending payments.`);
      return res.json({ success: false });
    }

    // Check recipient profile
    const recvCheck = await fetch(`${BACKEND_URL}/api/check-profile?handle=${recipient}`);
    const recvData = await recvCheck.json();
    if (!recvData.success) {
      await replyToTweet(tweet_id, `@${sender_handle} The recipient @${recipient} isn’t registered on WASSY Pay yet.`);
      return res.json({ success: false });
    }

    // Perform transfer
    const transfer = await fetch(`${BACKEND_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromTwitterId: sender_handle,
        toHandle: recipient,
        amount
      })
    });

    const result = await transfer.json();
    if (transfer.status === 200 && result.success) {
      await replyToTweet(tweet_id, `✅ @${sender_handle} sent $${amount} USDC to @${recipient} via WASSY Pay!`);
    } else if (transfer.status === 402) {
      await replyToTweet(tweet_id, `⚠️ @${sender_handle} Insufficient funds — top up your vault on WASSY Pay.`);
    } else {
      await replyToTweet(tweet_id, `❌ @${sender_handle} Payment failed: ${result.message || "unknown error"}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("💥 Error in handleTweet:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => console.log(`🚀 WASSY Bot webhook live on port ${PORT}`));
