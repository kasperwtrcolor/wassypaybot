import fs from "fs";

export async function log(message) {
  const time = new Date().toISOString();
  const line = `[${time}] ${message}`;
  console.log(line);
  fs.appendFileSync("bot.log", line + "\n");
}
