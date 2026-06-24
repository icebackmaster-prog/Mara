// MaraX.js – Core Bot (delete alert + menu cooldown + APK fallback + channels, open for all)
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";
import P from "pino";
import fs from "fs";
import { BOT_CONFIG, PLUGINS_DIR, SUBUSERS_FILE } from "./config.js";

export default class MaraX {
  constructor() {
    this.sock = null;
    this.botPhoneNumber = BOT_CONFIG.BOT_NUMBER;
    this.plugins = [];
    this.subusers = [];
    this.settings = this.loadSettings();
    this.viewOnceCache = {};
    this.tempNumberStates = new Map();
    this.menuCooldown = new Map();     // ⏱️ menu spam blocker

    if (!fs.existsSync("./MaraXOffcial")) {
      fs.mkdirSync("./MaraXOffcial", { recursive: true });
    }
    this.loadSubusers();
  }

  // ═══════════════ Settings ═══════════════
  loadSettings() {
    try {
      if (fs.existsSync("./marax-settings.json")) {
        return JSON.parse(fs.readFileSync("./marax-settings.json", "utf8"));
      }
    } catch (e) {}
    return {
      autoStatusView: false,
      autoReact: false,
      autoStatusLike: false,
      autoReply: false,
      autoReplyText: "_Auto reply from MaraX ❄️_"
    };
  }
  saveSettings() {
    fs.writeFileSync("./marax-settings.json", JSON.stringify(this.settings, null, 2));
  }

  // ═══════════════ Subusers ═══════════════
  loadSubusers() {
    try {
      if (fs.existsSync(SUBUSERS_FILE)) {
        this.subusers = JSON.parse(fs.readFileSync(SUBUSERS_FILE, "utf8"));
      }
    } catch (e) { this.subusers = []; }
  }
  saveSubusers() {
    fs.writeFileSync(SUBUSERS_FILE, JSON.stringify(this.subusers, null, 2));
  }

  // ═══════════════ Plugins ═══════════════
  async loadPlugins() {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      console.log("📁 Plugins folder created.");
      return;
    }
    const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith(".js"));
    for (const file of files) {
      try {
        const plugin = await import(`./plugins/${file}`);
        this.plugins.push(plugin.default);
        console.log(`🔮 Loaded plugin: ${plugin.default?.command?.[0] || "non-cmd"} from ${file}`);
      } catch (err) {
        console.log(`⚠️ Failed to load plugin ${file}: ${err.message}`);
      }
    }
  }

  watchPlugins() {
    fs.watch(PLUGINS_DIR, { persistent: false }, async (event, filename) => {
      if (filename?.endsWith(".js")) {
        setTimeout(async () => {
          this.plugins = [];
          await this.loadPlugins();
          console.log("✅ Plugins reloaded");
        }, 150);
      }
    });
  }

  // ═══════════════ Main start ═══════════════
  async start() {
    console.log("❄️❄️❄️ MARAX BOT STARTING ❄️❄️❄️");
    await this.loadPlugins();
    this.watchPlugins();

    const { state, saveCreds } = await useMultiFileAuthState(BOT_CONFIG.SESSION_DIR || "sessions");
    const { version } = await fetchLatestBaileysVersion();

    const connect = () => {
      this.sock = makeWASocket({
        version,
        auth: state,
        logger: P({ level: "silent" }),
        printQRInTerminal: false,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 30_000
      });

      // ────── Channel support ──────
      const originalSendMessage = this.sock.sendMessage.bind(this.sock);
      this.sock.sendMessage = async (jid, content, options = {}) => {
        if (jid.endsWith("@newsletter")) {
          try {
            return await this.sock.newsletterSend(jid, content);
          } catch (err) {
            console.error("Channel send error:", err.message);
            return await originalSendMessage(jid, content, options);
          }
        }
        return await originalSendMessage(jid, content, options);
      };

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
          this.botPhoneNumber = this.sock.user.id.split(":")[0].split("@")[0];
          console.log(`❄️ Bot connected as ${this.botPhoneNumber}`);
          try {
            this.sock.newsletterSubscribe(BOT_CONFIG.CHANNEL_INVITE_CODE);
            console.log("📢 Channel followed: " + BOT_CONFIG.CHANNEL_INVITE);
          } catch (e) {}
        } else if (connection === "close") {
          const reason = lastDisconnect?.error?.message || "unknown";
          console.log("🔌 Connection closed:", reason);
          if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
            console.log("⏳ Reconnecting in 3 seconds...");
            setTimeout(() => connect(), 3000);
          } else {
            console.log("🚫 Logged out – delete sessions folder to re‑pair.");
          }
        }
      });

      // ═══════════════ Message handler ═══════════════
      this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        const msg = messages[0];
        if (!msg?.message) return;

        const from = msg.key.remoteJid;

        // ─── Anti‑delete alert ───
        const proto = msg.message?.protocolMessage;
        if (proto?.type === 0) {
          if (from === "status@broadcast") return;
          const originalSender = proto.key?.participant || proto.key?.remoteJid;
          const deleter = msg.key.participant || msg.key.remoteJid;
          if (!msg.key.fromMe) {
            const deleteTime = new Date().toLocaleTimeString("en-ZA", { hour12: false });
            const alertText =
              `╭─❲ *MESSAGE DELETED* ❳─╮\n` +
              `│\n` +
              `│ ✍️ *Sender* : @${originalSender.split("@")[0]}\n` +
              `│ 🗑️ *Deleted by* : @${deleter.split("@")[0]}\n` +
              `│ 🕒 *Time* : ${deleteTime}\n` +
              `│\n` +
              `╰─❲ *MaraX Md Bot* ❳─╯\n\n` +
              `> *Powered by Iceback Master Tech*`;
            await this.sock.sendMessage(from, { text: alertText, mentions: [originalSender, deleter] });
          }
          return;
        }

        const senderJid = msg.key.participant || msg.key.remoteJid;
        const senderNumber = senderJid.split("@")[0];
        const msgId = msg.key.id;

        // Cache view‑once media
        const media = msg.message.imageMessage || msg.message.videoMessage || msg.message.audioMessage;
        if (media?.viewOnce) {
          try {
            const buffer = await this.sock.downloadMediaMessage(msg);
            if (buffer) {
              this.viewOnceCache[msgId] = { buffer, mimetype: media.mimetype };
              const keys = Object.keys(this.viewOnceCache);
              if (keys.length > 100) delete this.viewOnceCache[keys[0]];
            }
          } catch (e) {}
        }

        // Extract body
        let body =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          "";
        if (!body && msg.message.listResponseMessage?.singleSelectReply?.selectedRowId) {
          body = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
        }

        // Auto‑react
        if (this.settings.autoReact && !msg.key.fromMe) {
          try {
            await this.sock.sendMessage(from, { react: { text: BOT_CONFIG.BOT_EMOJI, key: msg.key } });
          } catch (e) {}
        }

        // Auto‑reply (private, non‑command, not groups/channels)
        if (
          this.settings.autoReply &&
          !msg.key.fromMe &&
          body.trim().length > 0 &&
          !from.endsWith("@g.us") &&
          !from.endsWith("@newsletter")
        ) {
          let isCmdAuto = false;
          for (const p of BOT_CONFIG.PREFIX) {
            if (body.startsWith(p)) { isCmdAuto = true; break; }
          }
          if (!isCmdAuto && body.startsWith(".")) isCmdAuto = true;
          if (!isCmdAuto) {
            try {
              await this.sock.sendMessage(from, { text: this.settings.autoReplyText }, { quoted: msg });
            } catch (e) {}
          }
        }

        if (!body) return;

        // Command parsing
        let isCmd = false;
        let cmd = "";
        let usedPrefix = "";
        for (const prefix of BOT_CONFIG.PREFIX) {
          if (body.startsWith(prefix)) {
            isCmd = true;
            usedPrefix = prefix;
            cmd = body.slice(prefix.length).split(" ")[0].toLowerCase();
            break;
          }
        }
        if (!isCmd && body.startsWith(".")) {
          isCmd = true;
          usedPrefix = ".";
          cmd = body.substring(1).split(" ")[0].toLowerCase();
        }
        if (!isCmd) return;

        // ═══════════════ MENU / HELP COOLDOWN ═══════════════
        if (cmd === "menu" || cmd === "help") {
          const now = Date.now();
          const lastTime = this.menuCooldown.get(senderNumber) || 0;
          if (now - lastTime < 10_000) {
            await this.sock.sendMessage(from, {
              text: `⏳ *Please wait ${Math.ceil((10000 - (now - lastTime)) / 1000)}s before using .menu again.*`
            }, { quoted: msg });
            return;
          }
          this.menuCooldown.set(senderNumber, now);
        }

        const isGroup = from.endsWith("@g.us");

        // ═══════════════ Open admin commands (everyone) ═══════════════
        if (cmd === "freebot") {
          await this.sock.sendMessage(from, { text: "🔓 Bot is permanently open. No restrictions." }, { quoted: msg });
          return;
        }
        if (cmd === "selfmode") {
          await this.sock.sendMessage(from, { text: "🔒 Mode is fixed to public." }, { quoted: msg });
          return;
        }
        if (cmd === "addowner") {
          const args = body.split(" ");
          if (args.length < 2) {
            await this.sock.sendMessage(from, { text: `❌ Usage: ${usedPrefix}addowner <number>` }, { quoted: msg });
            return;
          }
          let newOwner = args[1].replace(/\D/g, "");
          if (newOwner.length < 10) {
            await this.sock.sendMessage(from, { text: "❌ Invalid phone number." }, { quoted: msg });
            return;
          }
          if (!BOT_CONFIG.OWNER.includes(newOwner)) {
            BOT_CONFIG.OWNER.push(newOwner);
            await this.sock.sendMessage(from, { text: `✅ Added ${newOwner} to owner list.` }, { quoted: msg });
          } else {
            await this.sock.sendMessage(from, { text: "❌ Already in the list." }, { quoted: msg });
          }
          return;
        }
        if (cmd === "addsubuser") {
          const args = body.split(" ");
          if (args.length < 2) {
            await this.sock.sendMessage(from, { text: `❌ Usage: ${usedPrefix}addsubuser <number>` }, { quoted: msg });
            return;
          }
          let newSub = args[1].replace(/\D/g, "");
          if (newSub.length < 10) {
            await this.sock.sendMessage(from, { text: "❌ Invalid phone number." }, { quoted: msg });
            return;
          }
          if (!this.subusers.includes(newSub)) {
            this.subusers.push(newSub);
            this.saveSubusers();
            await this.sock.sendMessage(from, { text: `✅ Sub‑user added: ${newSub}` }, { quoted: msg });
          } else {
            await this.sock.sendMessage(from, { text: "❌ Already a sub‑user." }, { quoted: msg });
          }
          return;
        }
        if (cmd === "delsubuser") {
          const args = body.split(" ");
          if (args.length < 2) {
            await this.sock.sendMessage(from, { text: `❌ Usage: ${usedPrefix}delsubuser <number>` }, { quoted: msg });
            return;
          }
          let delSub = args[1].replace(/\D/g, "");
          const idx = this.subusers.indexOf(delSub);
          if (idx !== -1) {
            this.subusers.splice(idx, 1);
            this.saveSubusers();
            await this.sock.sendMessage(from, { text: `✅ Sub‑user removed: ${delSub}` }, { quoted: msg });
          } else {
            await this.sock.sendMessage(from, { text: "❌ Sub‑user not found." }, { quoted: msg });
          }
          return;
        }
        if (cmd === "listsubusers") {
          const list = this.subusers.length ? this.subusers.join(", ") : "No sub‑users stored.";
          await this.sock.sendMessage(from, { text: `👥 Sub‑users:\n${list}` }, { quoted: msg });
          return;
        }

        // ═══════════════ Plugin execution ═══════════════
        let commandHandled = false;
        for (const plugin of this.plugins) {
          if (Array.isArray(plugin.command) && plugin.command.includes(cmd)) {
            commandHandled = true;
            try {
              await plugin.run({
                sock: this.sock,
                msg,
                from,
                body,
                cmd,
                isGroup,
                botNumber: this.botPhoneNumber,
                prefix: usedPrefix,
                bot: this
              });
            } catch (e) {
              console.log(`Plugin error [${cmd}]:`, e);
            }
          }
        }

        // ╔══════════════════════════════════════════════════════╗
        // ║  UNIVERSAL APK FALLBACK – auto‑download any app    ║
        // ╚══════════════════════════════════════════════════════╝
        if (!commandHandled && isCmd) {
          try {
            await this.sock.sendMessage(from, { text: `🔍 *Searching for "${cmd}" APK...*` }, { quoted: msg });
            const apk = await this._searchApk(cmd);
            if (!apk) {
              await this.sock.sendMessage(from, { text: `❌ *"${cmd}" not found as an app.*` }, { quoted: msg });
              return;
            }
            await this.sock.sendMessage(from, { text: `⬇️ *Downloading ${apk.name}* v${apk.version}...` }, { quoted: msg });
            const response = await fetch(apk.downloadUrl, { signal: AbortSignal.timeout(60000) });
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > 100 * 1024 * 1024) {
              await this.sock.sendMessage(from, { text: "❌ APK too large (>100MB)." }, { quoted: msg });
              return;
            }
            await this.sock.sendMessage(from, {
              document: buffer,
              fileName: `${apk.name} v${apk.version}.apk`,
              mimetype: "application/vnd.android.package-archive",
              caption: `📱 *${apk.name}* v${apk.version}\n\n> *Powered by IcebackMasterTech*`
            }, { quoted: msg });
            await this.sock.sendMessage(from, { react: { text: "✅", key: msg.key } });
          } catch (err) {
            console.error("Fallback APK error:", err.message);
            await this.sock.sendMessage(from, { text: `❌ *Failed to download APK for "${cmd}".*\n_${err.message}_` }, { quoted: msg });
          }
        }
      });

      // ═══════════════ Status handler (auto‑view, like, cache) ═══════════════
      this.sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
          if (msg.key.remoteJid === "status@broadcast" && msg.message) {
            if (this.settings.autoStatusView) {
              await this.sock.readMessages([msg.key]);
              console.log("👁️ Auto‑viewed status.");
            }
            if (this.settings.autoStatusLike) {
              await this.sock.sendMessage("status@broadcast", {
                react: { text: BOT_CONFIG.BOT_EMOJI, key: msg.key }
              });
            }
            // Cache status media for .mara-send
            const media = msg.message.imageMessage || msg.message.videoMessage;
            if (media) {
              try {
                const buffer = await this.sock.downloadMediaMessage(msg);
                if (buffer) {
                  this.viewOnceCache[msg.key.id] = {
                    buffer,
                    mimetype: media.mimetype,
                    isVideo: !!msg.message.videoMessage
                  };
                  const keys = Object.keys(this.viewOnceCache);
                  if (keys.length > 200) delete this.viewOnceCache[keys[0]];
                }
              } catch (e) {}
            }
          }
        }
      });

      // ═══════════════ Pairing code (if not registered) ═══════════════
      setTimeout(async () => {
        if (!state.creds.registered && BOT_CONFIG.PAIR_NUMBER) {
          try {
            console.log("🔑 Requesting pairing code for", BOT_CONFIG.PAIR_NUMBER);
            const code = await this.sock.requestPairingCode(BOT_CONFIG.PAIR_NUMBER);
            console.log("📲 PAIR CODE:", code);
          } catch (err) {
            console.log("⚠️ Pairing error:", err.message);
          }
        }
      }, 4000);
    };

    connect();
    console.log("❄️❄️❄️ MARAX BOT ONLINE (menu cooldown + delete alert + APK + channels) ❄️❄️❄️");
    console.log(`📌 Prefix: ${BOT_CONFIG.PREFIX.join(", ")}`);
  }

  // ═══════════════ APK Fallback Helpers ═══════════════
  async _searchApk(query) {
    // APKPure
    try {
      const url = `https://apkpure.com/search?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      const html = await resp.text();
      const cheerio = (await import("cheerio")).default;
      const $ = cheerio.load(html);
      const firstLink = $(".search-results .apk-card-row a").first().attr("href");
      if (!firstLink) throw new Error("not found");
      const packageId = firstLink.split("/").pop();
      const name = $(".search-results .apk-card-row .apk-card-title").first().text().trim();
      const version = $(".search-results .apk-card-row .version").first().text().trim();
      return { name, version, downloadUrl: `https://d.apkpure.com/b/APK/${packageId}?version=latest` };
    } catch (e) {}
    // APKCombo
    try {
      const url = `https://apkcombo.com/search/?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      const html = await resp.text();
      const cheerio = (await import("cheerio")).default;
      const $ = cheerio.load(html);
      const firstResult = $(".search-results .apk-item").first();
      if (!firstResult.length) throw new Error("not found");
      const name = firstResult.find(".app-name").text().trim();
      const version = firstResult.find(".version").text().trim();
      const appPageLink = firstResult.find("a").attr("href");
      const appPageUrl = `https://apkcombo.com${appPageLink}`;
      const res = await fetch(appPageUrl, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
      const pageHtml = await res.text();
      const $$ = cheerio.load(pageHtml);
      const downloadUrl = $$(".downloadstart").attr("href") || $$("a[href*='download']").attr("href");
      if (!downloadUrl) throw new Error("no download link");
      return { name, version, downloadUrl };
    } catch (e) {}
    return null;
  }
}