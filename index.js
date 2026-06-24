// index.js – MaraX Entry Point
import MaraX from "./MaraX.js";
const bot = new MaraX();
bot.start().catch(err => console.error("❌ CRITICAL STARTUP ERROR:", err));
setInterval(() => {}, 600_000);
process.on("unhandledRejection", (err) => console.log("Unhandled Rejection:", err));
process.on("uncaughtException", (err) => console.log("Uncaught Exception:", err));