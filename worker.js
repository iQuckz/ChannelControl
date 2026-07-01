/**
 * Cloudflare Worker: Telegram Channel Manager Bot
 * runs 100% on Cloudflare Workers and KV
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // GET /health
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "healthy", time: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // GET /setWebhook
    if (request.method === "GET" && url.pathname === "/setWebhook") {
      const botToken = env.BOT_TOKEN;
      if (!botToken) {
        return new Response("Error: BOT_TOKEN is not configured in environment variables.", { status: 400 });
      }
      const workerUrl = `${url.protocol}//${url.host}/webhook`;
      const tgUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(workerUrl)}`;
      
      try {
        const res = await fetch(tgUrl);
        const data = await res.json();
        return new Response(JSON.stringify({ message: "Webhook registration attempt", telegramResponse: data }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(`Error registering webhook: ${err.message}`, { status: 500 });
      }
    }

    // POST /webhook
    if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/")) {
      try {
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(update, env));
        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("Webhook processing error:", err);
        return new Response("Error processing update", { status: 500 });
      }
    }

    return new Response("Telegram Bot Worker running! Use /setWebhook to register your worker URL.", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    // Cron trigger running every minute to process scheduled posts
    ctx.waitUntil(processScheduledPosts(env));
  }
};

/**
 * TELEGRAM API UTILS
 */
async function callTelegram(env, method, body) {
  const token = env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing!");
  
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

// Global helper to send messages
async function sendMessage(env, chatId, text, options = {}) {
  return callTelegram(env, "sendMessage", {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    ...options
  });
}

async function answerCallbackQuery(env, callbackQueryId, text = "", showAlert = false) {
  return callTelegram(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text,
    show_alert: showAlert
  });
}

/**
 * PARSERS
 */
function parseButtons(text) {
  const keyboard = [];
  let currentRow = [];
  const lines = text.split("\n");
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line === "—" || line === "---" || line === "--") {
      if (currentRow.length > 0) {
        keyboard.push(currentRow);
        currentRow = [];
      }
    } else {
      const parts = line.split("|");
      if (parts.length >= 2) {
        const btnText = parts[0].trim();
        const btnUrl = parts.slice(1).join("|").trim();
        currentRow.push({ text: btnText, url: btnUrl });
      }
    }
  }
  if (currentRow.length > 0) {
    keyboard.push(currentRow);
  }
  return keyboard;
}

function telegramEntitiesToHtml(text, entities) {
  if (!text) return "";
  if (!entities || entities.length === 0) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const inserts = {};
  
  for (const entity of entities) {
    const start = entity.offset;
    const end = entity.offset + entity.length;
    
    let openTag = "";
    let closeTag = "";
    
    switch (entity.type) {
      case "bold":
        openTag = "<b>";
        closeTag = "</b>";
        break;
      case "italic":
        openTag = "<i>";
        closeTag = "</i>";
        break;
      case "underline":
        openTag = "<u>";
        closeTag = "</u>";
        break;
      case "strikethrough":
        openTag = "<s>";
        closeTag = "</s>";
        break;
      case "spoiler":
        openTag = "<tg-spoiler>";
        closeTag = "</tg-spoiler>";
        break;
      case "code":
        openTag = "<code>";
        closeTag = "</code>";
        break;
      case "blockquote":
        openTag = "<blockquote>";
        closeTag = "</blockquote>";
        break;
      case "pre":
        if (entity.language) {
          openTag = `<pre><code class="language-${entity.language}">`;
        } else {
          openTag = "<pre>";
        }
        closeTag = entity.language ? "</code></pre>" : "</pre>";
        break;
      case "text_link":
        openTag = `<a href="${entity.url}">`;
        closeTag = "</a>";
        break;
      default:
        break;
    }
    
    if (openTag) {
      if (!inserts[start]) inserts[start] = [];
      inserts[start].push({ type: "open", tag: openTag, entity });
    }
    if (closeTag) {
      if (!inserts[end]) inserts[end] = [];
      inserts[end].push({ type: "close", tag: closeTag, entity });
    }
  }

  let result = "";
  for (let i = 0; i <= text.length; i++) {
    if (inserts[i]) {
      const events = inserts[i];
      const closeEvents = events.filter(e => e.type === "close");
      const openEvents = events.filter(e => e.type === "open");

      openEvents.sort((a, b) => b.entity.length - a.entity.length);
      closeEvents.sort((a, b) => b.entity.offset - a.entity.offset);

      for (const ev of closeEvents) {
        result += ev.tag;
      }
      for (const ev of openEvents) {
        result += ev.tag;
      }
    }

    if (i < text.length) {
      const char = text[i];
      if (char === "&") {
        result += "&amp;";
      } else if (char === "<") {
        result += "&lt;";
      } else if (char === ">") {
        result += "&gt;";
      } else {
        result += char;
      }
    }
  }

  return result;
}

function parseMarkdownToHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/__(.*?)__/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/_(.*?)_/g, "<i>$1</i>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/\|\|(.*?)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
}

function parseDateTimeWithOffset(dateStr, offsetMinutes) {
  if (!dateStr) return null;
  // Normalize Persian/Arabic digits to English digits
  dateStr = dateStr.replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString())
                   .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
                   .trim().toLowerCase();

  const nowUtc = Date.now();
  const localNow = new Date(nowUtc + offsetMinutes * 60 * 1000);

  // Case A: Full Gregorian date-time like YYYY-MM-DD HH:mm or YYYY/MM/DD HH:mm
  const fullMatch = dateStr.match(/^(\d{4})[-/](\d{2})[-/](\d{2})\s+(\d{2}):(\d{2})$/);
  if (fullMatch) {
    const [_, year, month, day, hour, minute] = fullMatch.map(Number);
    const utcDate = Date.UTC(year, month - 1, day, hour, minute);
    if (!isNaN(utcDate)) {
      return utcDate - offsetMinutes * 60 * 1000;
    }
  }

  // Case B: Relative offsets like "30m", "+30", "1h", "2 ساعت"
  const relativeMatch = dateStr.match(/^\+?(\d+)\s*(min|m|دقیقه|دقیقه دیگر|دق)?$/);
  if (relativeMatch && !dateStr.includes(":")) {
    const mins = parseInt(relativeMatch[1], 10);
    const label = relativeMatch[2] || "m";
    if (label === "m" || label === "min" || label.includes("دقیقه") || label === "دق") {
      return nowUtc + mins * 60 * 1000;
    }
  }

  const relativeHoursMatch = dateStr.match(/^\+?(\d+)\s*(h|hour|ساعت|ساعت دیگر|س)?$/);
  if (relativeHoursMatch && !dateStr.includes(":")) {
    const hrs = parseInt(relativeHoursMatch[1], 10);
    return nowUtc + hrs * 60 * 60 * 1000;
  }

  // Case C: Relative phrases with clock time like "فردا 14:30" or "پس فردا 18:00" or just "18:00"
  const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      let targetLocal = new Date(localNow);
      targetLocal.setUTCHours(hour, minute, 0, 0);

      let daysToAdd = 0;
      if (dateStr.includes("پس فردا")) {
        daysToAdd = 2;
      } else if (dateStr.includes("فردا") || dateStr.includes("farda")) {
        daysToAdd = 1;
      } else if (dateStr.includes("امروز") || dateStr.includes("emruz")) {
        daysToAdd = 0;
      } else {
        // If they just entered "18:30" and that hour has already passed today, assume tomorrow!
        if (targetLocal.getTime() <= localNow.getTime()) {
          daysToAdd = 1;
        }
      }

      if (daysToAdd > 0) {
        targetLocal.setUTCDate(targetLocal.getUTCDate() + daysToAdd);
      }
      
      return targetLocal.getTime() - offsetMinutes * 60 * 1000;
    }
  }

  return null;
}

function calculatePresetTimestamp(preset, offsetMinutes) {
  const nowUtc = Date.now();
  const localNow = new Date(nowUtc + offsetMinutes * 60 * 1000);
  let targetLocal = new Date(localNow);

  if (preset === "15m") {
    return nowUtc + 15 * 60 * 1000;
  } else if (preset === "30m") {
    return nowUtc + 30 * 60 * 1000;
  } else if (preset === "1h") {
    return nowUtc + 60 * 60 * 1000;
  } else if (preset === "2h") {
    return nowUtc + 2 * 60 * 60 * 1000;
  } else if (preset === "5h") {
    return nowUtc + 5 * 60 * 60 * 1000;
  } else if (preset === "12h") {
    return nowUtc + 12 * 60 * 60 * 1000;
  } else if (preset === "tomorrow_morning") {
    targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
    targetLocal.setUTCHours(9, 0, 0, 0);
    return targetLocal.getTime() - offsetMinutes * 60 * 1000;
  } else if (preset === "tomorrow_night") {
    targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
    targetLocal.setUTCHours(21, 0, 0, 0);
    return targetLocal.getTime() - offsetMinutes * 60 * 1000;
  } else if (preset === "tomorrow_same") {
    return nowUtc + 24 * 60 * 60 * 1000;
  }
  return nowUtc;
}

function formatTimestamp(timestamp, offsetMinutes) {
  const date = new Date(timestamp + offsetMinutes * 60 * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} - ${h}:${min}`;
}

/**
 * SEND POST ENGINE
 */
async function sendPostToTelegram(env, chatId, post, replyToMessageId = null) {
  let method = "sendMessage";
  let body = { chat_id: chatId };

  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId;
  }

  // Set keyboard
  if (post.buttons && post.buttons.length > 0) {
    body.reply_markup = { inline_keyboard: post.buttons };
  }

  const isAbove = post.captionPosition === "above";

  if (post.contentType === "text") {
    method = "sendMessage";
    body.text = post.text;
    body.parse_mode = "HTML";
  } else {
    const fileId = post.fileId;
    const caption = post.text; // Text captured is stored under .text

    if (post.contentType === "photo") {
      method = "sendPhoto";
      body.photo = fileId;
    } else if (post.contentType === "video") {
      method = "sendVideo";
      body.video = fileId;
    } else if (post.contentType === "gif") {
      method = "sendAnimation";
      body.animation = fileId;
    } else if (post.contentType === "audio") {
      method = "sendAudio";
      body.audio = fileId;
    } else if (post.contentType === "document") {
      method = "sendDocument";
      body.document = fileId;
    } else if (post.contentType === "sticker") {
      method = "sendSticker";
      body.sticker = fileId;
    } else if (post.contentType === "voice") {
      method = "sendVoice";
      body.voice = fileId;
    }

    if (caption) {
      if (isAbove) {
        // Send caption first
        const capBody = {
          chat_id: chatId,
          text: caption,
          parse_mode: "HTML"
        };
        if (replyToMessageId) {
          capBody.reply_to_message_id = replyToMessageId;
        }
        const capRes = await callTelegram(env, "sendMessage", capBody);
        if (capRes.ok && capRes.result) {
          body.reply_to_message_id = capRes.result.message_id;
        }
      } else {
        body.caption = caption;
        body.parse_mode = "HTML";
      }
    }
  }

  const result = await callTelegram(env, method, body);
  
  // If reply post exists, send it
  if (result.ok && result.result && post.replyPost) {
    const firstMsgId = result.result.message_id;
    await sendPostToTelegram(env, chatId, post.replyPost, firstMsgId);
  }

  return result;
}

/**
 * TELEGRAM UPDATE HANDLER
 */
async function handleTelegramUpdate(update, env) {
  // Extract user info
  let user = null;
  let isCallback = false;
  let callbackQueryId = null;
  let callbackData = null;
  let message = null;

  if (update.callback_query) {
    user = update.callback_query.from;
    isCallback = true;
    callbackQueryId = update.callback_query.id;
    callbackData = update.callback_query.data;
    message = update.callback_query.message;
  } else if (update.message) {
    user = update.message.from;
    message = update.message;
  }

  if (!user) return;

  // Authorization Check
  const adminsVar = env.ADMIN_IDS || "";
  const adminIds = adminsVar.split(",").map(id => id.trim()).filter(id => id);
  if (!adminIds.includes(String(user.id))) {
    const unauthorizedText = "⛔ شما دسترسی به این ربات ندارید. لطفاً برای ثبت آی‌دی خود به متغیرهای محیطی در کلودفلر مراجعه کنید.";
    if (isCallback) {
      await answerCallbackQuery(env, callbackQueryId, "دسترسی غیرمجاز", true);
    } else {
      await callTelegram(env, "sendMessage", { chat_id: message.chat.id, text: unauthorizedText });
    }
    return;
  }

  const kv = env.BOT_KV;
  if (!kv) {
    const errorText = "⚠️ خطای پیکربندی: KV Namespace با نام BOT_KV متصل نشده است.";
    if (!isCallback) {
      await callTelegram(env, "sendMessage", { chat_id: message.chat.id, text: errorText });
    }
    return;
  }

  // Load state and draft
  const stateKey = `state:${user.id}`;
  const draftKey = `draft:${user.id}`;
  
  let state = await kv.get(stateKey, { type: "json" }) || { step: "MAIN_MENU" };
  let draft = await kv.get(draftKey, { type: "json" }) || {};

  try {
    if (isCallback) {
      await answerCallbackQuery(env, callbackQueryId);
      await handleCallback(callbackData, user, state, draft, message, env);
    } else {
      await handleMessage(message, user, state, draft, env);
    }
  } catch (err) {
    console.error("Error handling update:", err);
    // Reset state on error to prevent being locked
    await kv.put(stateKey, JSON.stringify({ step: "MAIN_MENU" }));
    await kv.delete(draftKey);
    await sendMessage(env, message.chat.id, `⚠️ خطایی رخ داد: ${err.message || err}\nبه منوی اصلی بازگردانده شدید.`, {
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]]
      }
    });
  }
}

/**
 * CALLBACK ROUTER
 */
async function handleCallback(data, user, state, draft, message, env) {
  const kv = env.BOT_KV;
  const chatId = message.chat.id;
  const msgId = message.message_id;

  // Global back or menu triggers
  if (data === "menu_main") {
    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    await showMainMenu(env, chatId, msgId);
    return;
  }

  if (data === "menu_channels") {
    state.step = "CHANNELS_LIST";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    await showChannelsList(env, chatId, msgId);
    return;
  }

  if (data === "add_channel_start") {
    state.step = "AWAITING_CHANNEL_FORWARD";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    const text = "➕ <b>افزودن کانال جدید</b>\n\nلطفاً یک پیام از کانال مورد نظر را به این ربات <b>فوردارد (هدایت)</b> کنید یا آیدی عمومی کانال را با @ ارسال کنید:\n\n<i>مثال: @my_channel</i>";
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "menu_channels" }]]
      }
    });
    return;
  }

  if (data === "menu_scheduled") {
    await showScheduledPosts(env, chatId, msgId, null);
    return;
  }

  if (data === "menu_settings") {
    await showSettings(env, chatId, msgId);
    return;
  }

  if (data === "settings_tz_menu") {
    await handleTzMenu(env, chatId, msgId);
    return;
  }

  if (data.startsWith("settings_tz_")) {
    const tz = data.replace("settings_tz_", "");
    let offset = 0;
    let label = "UTC";
    if (tz === "tehran") { offset = 210; label = "Tehran (UTC+3:30)"; }
    else if (tz === "dubai") { offset = 240; label = "Dubai (UTC+4)"; }
    else if (tz === "utc") { offset = 0; label = "UTC"; }

    let settings = await kv.get("settings", { type: "json" }) || {};
    settings.timezone = tz;
    settings.timezoneOffset = offset;
    settings.timezoneLabel = label;
    await kv.put("settings", JSON.stringify(settings));

    await callTelegram(env, "answerCallbackQuery", {
      callback_query_id: data,
      text: `منطقه زمانی به ${label} تغییر یافت`,
      show_alert: true
    });
    await showSettings(env, chatId, msgId);
    return;
  }

  if (data === "settings_tz_custom_start") {
    state.step = "AWAITING_SETTINGS_TZ_CUSTOM";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    const text = "🕐 <b>تنظیم دستی منطقه زمانی</b>\n\nلطفاً اختلاف زمانی با UTC را به دقیقه وارد کنید.\n\n<i>مثال برای ایران در نیمه اول سال: 270\nنیمه دوم سال: 210</i>";
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "menu_settings" }]]
      }
    });
    return;
  }

  if (data === "settings_test_channel_start") {
    state.step = "AWAITING_SETTINGS_TEST_CHANNEL";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    const text = "📲 <b>تنظیم آیدی کانال تست</b>\n\nلطفاً آیدی عددی کانال تست خود را وارد کنید (شروع با -100):\n\n<i>مثال: -100123456789</i>";
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "menu_settings" }]]
      }
    });
    return;
  }

  // View specific channel
  if (data.startsWith("chan_view:")) {
    const chanId = data.replace("chan_view:", "");
    await showChannelMenu(env, chatId, msgId, chanId);
    return;
  }

  // Delete channel
  if (data.startsWith("chan_delete:")) {
    const chanId = data.replace("chan_delete:", "");
    let channels = await kv.get("channels", { type: "json" }) || [];
    channels = channels.filter(c => c.id !== chanId);
    await kv.put("channels", JSON.stringify(channels));

    await callTelegram(env, "answerCallbackQuery", { callback_query_id: data, text: "🗑️ کانال حذف شد" });
    await showChannelsList(env, chatId, msgId);
    return;
  }

  // Post flow start
  if (data.startsWith("post_create:")) {
    const chanId = data.replace("post_create:", "");
    let channels = await kv.get("channels", { type: "json" }) || [];
    const targetChan = channels.find(c => c.id === chanId);
    
    state.step = "AWAITING_CONTENT_TYPE";
    state.targetChannelId = chanId;
    state.targetChannelName = targetChan ? targetChan.name : "نامشخص";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    // Initialize clean draft
    draft = {
      contentType: "text",
      fileId: null,
      text: "",
      captionPosition: "below",
      buttons: [],
      replyPost: null,
      scheduleAt: null
    };
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    await askContentType(env, chatId, msgId, state.targetChannelName);
    return;
  }

  // Select content type
  if (data.startsWith("post_type:")) {
    const type = data.replace("post_type:", "");
    draft.contentType = type;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    state.step = "AWAITING_CONTENT";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    let typePersian = "";
    if (type === "text") typePersian = "متن";
    else if (type === "photo") typePersian = "عکس";
    else if (type === "video") typePersian = "ویدیو";
    else if (type === "gif") typePersian = "گیف";
    else if (type === "audio") typePersian = "فایل صوتی";
    else if (type === "document") typePersian = "فایل / داکیومنت";
    else if (type === "sticker") typePersian = "استیکر";
    else if (type === "voice") typePersian = "ویس (صدای ضبط شده)";

    const text = `✍️ <b>ارسال محتوای پست (${typePersian})</b>\n\nلطفاً پیام خود را ارسال یا فوروارد کنید.\n\n🌟 <b>تشخیص خودکار قالب‌بندی:</b>\nربات به طور خودکار قالب‌بندی پیام شما را (شامل <b>bold</b>، <i>italic</i>، <u>underline</u>، <s>strikethrough</s>، نقل‌قول blockquote، لینک‌ها، متون مخفی spoiler و...) شناسایی و حفظ می‌کند.\n\n✍️ همچنین می‌توانید از قالب‌بندی استاندارد تلگرام یا <b>مارک‌داون</b> (مثل <code>**متن**</code> برای بولد یا <code>_متن_</code> برای مورب) استفاده کنید.`;
    
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: `chan_view:${state.targetChannelId}` }]]
      }
    });
    return;
  }

  // Caption Position buttons
  if (data.startsWith("post_caption_pos:")) {
    const pos = data.replace("post_caption_pos:", "");
    draft.captionPosition = pos;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    // Next step is Inline Buttons decision
    await askInlineButtonsChoice(env, chatId, msgId);
    return;
  }

  // Inline Buttons decision
  if (data === "post_btn_yes") {
    state.step = "AWAITING_BUTTONS_TEXT";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    const text = "🔗 <b>تنظیم دکمههای شیشهای</b>\n\nلطفاً دکمهها را در قالب متنی زیر ارسال کنید:\n\n<code>خرید اشتراک | https://example.com\nوبسایت | https://site.com\n—\nپشتیبانی | https://t.me/support</code>\n\n• علامت <code>|</code> نام دکمه را از لینک جدا میکند.\n• علامت <code>—</code> یا <code>---</code> در خط مجزا، یک ردیف جدید ایجاد میکند.";
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "❌ منصرف شدم / بدون دکمه", callback_data: "post_btn_no" }]]
      }
    });
    return;
  }

  if (data === "post_btn_no") {
    draft.buttons = [];
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));
    await askReplyChoice(env, chatId, msgId);
    return;
  }

  // Confirm inline buttons
  if (data === "post_btn_confirm") {
    await askReplyChoice(env, chatId, msgId);
    return;
  }

  if (data === "post_btn_reedit") {
    state.step = "AWAITING_BUTTONS_TEXT";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    const text = "🔗 دکمههای جدید را طبق همان الگو مجدداً ارسال کنید:";
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "❌ لغو دکمهها", callback_data: "post_btn_no" }]]
      }
    });
    return;
  }

  // Reply Choice buttons
  if (data === "post_reply_yes") {
    // We must transition current draft into a replyPost mode.
    // We save the parent draft in draft.parentDraft state, then we initialize replyPost
    const parentDraft = { ...draft };
    
    state.step = "AWAITING_REPLY_CONTENT_TYPE";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    // Reset draft as reply content type select
    draft = {
      isReply: true,
      parentDraft: parentDraft,
      contentType: "text",
      fileId: null,
      text: "",
      captionPosition: "below",
      buttons: [],
      replyPost: null,
      scheduleAt: null
    };
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    await askContentType(env, chatId, msgId, `${state.targetChannelName} (پیام پاسخ)`);
    return;
  }

  if (data === "post_reply_no") {
    // Move to test channel preview
    await prepareTestChannelPreview(env, user, state, draft, chatId, msgId);
    return;
  }

  // Test Channel actions
  if (data === "post_test_confirm") {
    await showSendOptions(env, chatId, msgId);
    return;
  }

  if (data === "post_test_edit") {
    // Go back to type selection or reset
    state.step = "AWAITING_CONTENT_TYPE";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    await askContentType(env, chatId, msgId, state.targetChannelName);
    return;
  }

  if (data === "post_test_cancel") {
    await kv.delete(`draft:${user.id}`);
    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    await sendMessage(env, chatId, "❌ ایجاد پست لغو شد.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]]
      }
    });
    return;
  }

  // Send Actions
  if (data === "post_send_now") {
    await sendMessage(env, chatId, "🚀 در حال ارسال پست به کانال اصلی...");
    
    const targetChatId = state.targetChannelId;
    const res = await sendPostToTelegram(env, targetChatId, draft);
    
    if (res.ok) {
      await kv.delete(`draft:${user.id}`);
      state.step = "MAIN_MENU";
      await kv.put(`state:${user.id}`, JSON.stringify(state));
      await sendMessage(env, chatId, "✅ <b>پست با موفقیت در کانال منتشر شد!</b>", {
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]]
        }
      });
    } else {
      await sendMessage(env, chatId, `⚠️ خطایی در ارسال مستقیم رخ داد:\n${res.description || "نامشخص"}`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]]
        }
      });
    }
    return;
  }

  if (data === "post_send_schedule") {
    state.step = "AWAITING_SCHEDULE_TIME";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    const settings = await kv.get("settings", { type: "json" }) || {};
    const offset = settings.timezoneOffset !== undefined ? settings.timezoneOffset : 210;
    const tzLabel = settings.timezoneLabel || "Tehran (UTC+3:30)";
    const currentLocalTime = formatTimestamp(Date.now(), offset);

    const text = `⏱️ <b>زمان‌بندی ارسال خودکار</b>\n\n🌐 منطقه زمانی: <b>${tzLabel}</b>\n🕐 ساعت فعلی شما از نظر ربات: <b>${currentLocalTime}</b>\n\nیکی از زمان‌های پیشنهادی زیر را انتخاب کنید یا خودتان زمان خاصی بنویسید:\n\n<b>مثال‌های ورود دستی قابل قبول:</b>\n- <code>18:30</code> (امروز ساعت ۱۸:۳۰ یا فردا)\n- <code>فردا 14:00</code>\n- <code>پس فردا 21:00</code>\n- <code>2026-07-15 14:30</code> (فرمت کامل میلادی)\n\n<i>نکته: زبان ارقام (فارسی یا انگلیسی) اهمیتی ندارد.</i>`;
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⏱️ ۱۵ دقیقه دیگر", callback_data: "post_sched_preset:15m" },
            { text: "⏱️ ۳۰ دقیقه دیگر", callback_data: "post_sched_preset:30m" }
          ],
          [
            { text: "⏱️ ۱ ساعت دیگر", callback_data: "post_sched_preset:1h" },
            { text: "⏱️ ۲ ساعت دیگر", callback_data: "post_sched_preset:2h" }
          ],
          [
            { text: "⏱️ ۵ ساعت دیگر", callback_data: "post_sched_preset:5h" },
            { text: "⏱️ ۱۲ ساعت دیگر", callback_data: "post_sched_preset:12h" }
          ],
          [
            { text: "🌅 فردا صبح (۰۹:۰۰)", callback_data: "post_sched_preset:tomorrow_morning" },
            { text: "🌌 فردا شب (۲۱:۰۰)", callback_data: "post_sched_preset:tomorrow_night" }
          ],
          [
            { text: "📅 فردا همین ساعت", callback_data: "post_sched_preset:tomorrow_same" }
          ],
          [
            { text: "⚙️ تنظیم منطقه زمانی (تغییر ساعت ربات)", callback_data: "post_sched_change_tz" }
          ],
          [
            { text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }
          ]
        ]
      }
    });
    return;
  }

  if (data === "post_sched_change_tz") {
    const text = "🕐 <b>تنظیم سریع منطقه زمانی</b>\n\nلطفاً منطقه زمانی هماهنگ با ساعت گوشی خود را انتخاب کنید تا زمانبندی‌ها کاملاً دقیق باشند:";
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🇮🇷 تهران UTC+3:30", callback_data: "post_sched_set_tz:tehran" },
            { text: "🌍 UTC / گرینویچ", callback_data: "post_sched_set_tz:utc" },
            { text: "🇦🇪 دبی UTC+4", callback_data: "post_sched_set_tz:dubai" }
          ],
          [
            { text: "✏️ وارد کردن دستی اختلاف ساعت (به دقیقه)", callback_data: "post_sched_set_tz:custom" }
          ],
          [
            { text: "🔙 بازگشت به زمان‌بندی", callback_data: "post_send_schedule" }
          ]
        ]
      }
    });
    return;
  }

  if (data.startsWith("post_sched_set_tz:")) {
    const tz = data.replace("post_sched_set_tz:", "");
    if (tz === "custom") {
      state.step = "AWAITING_POST_SCHED_TZ_CUSTOM";
      await kv.put(`state:${user.id}`, JSON.stringify(state));
      const text = "🕐 <b>تنظیم دستی منطقه زمانی</b>\n\nلطفاً اختلاف زمانی با UTC (گرینویچ) را به <b>دقیقه</b> وارد کنید.\n\n<i>مثال‌ها:</i>\n- ایران (نیمه دوم سال): <code>210</code>\n- ایران (نیمه اول سال): <code>270</code>\n- افغانستان: <code>270</code>\n- اروپا (برلین): <code>60</code>\n- ترکیه: <code>180</code>";
      await editMessage(env, chatId, msgId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "post_sched_change_tz" }]]
        }
      });
      return;
    }

    let offset = 0;
    let label = "UTC";
    if (tz === "tehran") { offset = 210; label = "Tehran (UTC+3:30)"; }
    else if (tz === "dubai") { offset = 240; label = "Dubai (UTC+4)"; }
    else if (tz === "utc") { offset = 0; label = "UTC"; }

    let settings = await kv.get("settings", { type: "json" }) || {};
    settings.timezone = tz;
    settings.timezoneOffset = offset;
    settings.timezoneLabel = label;
    await kv.put("settings", JSON.stringify(settings));

    await callTelegram(env, "answerCallbackQuery", {
      callback_query_id: data,
      text: `منطقه زمانی به ${label} تغییر یافت. ساعت شما تنظیم شد!`,
      show_alert: true
    });

    state.step = "AWAITING_SCHEDULE_TIME";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    const currentLocalTime = formatTimestamp(Date.now(), offset);
    const schedText = `⏱️ <b>زمان‌بندی ارسال خودکار</b>\n\n🌐 منطقه زمانی: <b>${label}</b>\n🕐 ساعت فعلی شما از نظر ربات: <b>${currentLocalTime}</b>\n\nیکی از زمان‌های پیشنهادی زیر را انتخاب کنید یا خودتان زمان خاصی بنویسید:\n\n<b>مثال‌های ورود دستی قابل قبول:</b>\n- <code>18:30</code> (امروز ساعت ۱۸:۳۰ یا فردا)\n- <code>فردا 14:00</code>\n- <code>پس فردا 21:00</code>\n- <code>2026-07-15 14:30</code> (فرمت کامل میلادی)\n\n<i>نکته: زبان ارقام (فارسی یا انگلیسی) اهمیتی ندارد.</i>`;
    await editMessage(env, chatId, msgId, schedText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⏱️ ۱۵ دقیقه دیگر", callback_data: "post_sched_preset:15m" },
            { text: "⏱️ ۳۰ دقیقه دیگر", callback_data: "post_sched_preset:30m" }
          ],
          [
            { text: "⏱️ ۱ ساعت دیگر", callback_data: "post_sched_preset:1h" },
            { text: "⏱️ ۲ ساعت دیگر", callback_data: "post_sched_preset:2h" }
          ],
          [
            { text: "⏱️ ۵ ساعت دیگر", callback_data: "post_sched_preset:5h" },
            { text: "⏱️ ۱۲ ساعت دیگر", callback_data: "post_sched_preset:12h" }
          ],
          [
            { text: "🌅 فردا صبح (۰۹:۰۰)", callback_data: "post_sched_preset:tomorrow_morning" },
            { text: "🌌 فردا شب (۲۱:۰۰)", callback_data: "post_sched_preset:tomorrow_night" }
          ],
          [
            { text: "📅 فردا همین ساعت", callback_data: "post_sched_preset:tomorrow_same" }
          ],
          [
            { text: "⚙️ تنظیم منطقه زمانی (تغییر ساعت ربات)", callback_data: "post_sched_change_tz" }
          ],
          [
            { text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }
          ]
        ]
      }
    });
    return;
  }

  if (data.startsWith("post_sched_preset:")) {
    const preset = data.replace("post_sched_preset:", "");
    const settings = await kv.get("settings", { type: "json" }) || {};
    const offset = settings.timezoneOffset !== undefined ? settings.timezoneOffset : 210;
    const tzLabel = settings.timezoneLabel || "Tehran (UTC+3:30)";

    const timestamp = calculatePresetTimestamp(preset, offset);
    const formatLabel = formatTimestamp(timestamp, offset);

    draft.scheduleAt = timestamp;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    // Show Confirmation
    const text = `📋 <b>تایید زمانبندی پست</b>\n\n📍 کانال مقصد: <b>${state.targetChannelName}</b>\n⏰ زمان ارسال: <b>${formatLabel}</b>\n🌐 منطقه زمانی: <b>${tzLabel}</b>\n\nآیا این زمانبندی را تایید میکنید؟`;
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ تایید و ذخیره زمانبندی", callback_data: `post_schedule_save:${settings.timezone || "tehran"}` },
            { text: "✏️ تغییر زمان", callback_data: "post_send_schedule" }
          ],
          [{ text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }]
        ]
      }
    });
    return;
  }

  if (data.startsWith("post_tz_select:")) {
    const tz = data.replace("post_tz_select:", "");
    let offset = 0;
    if (tz === "tehran") offset = 210;
    else if (tz === "dubai") offset = 240;
    else if (tz === "utc") offset = 0;

    const timestamp = parseDateTimeWithOffset(draft.tempScheduleTime, offset);
    if (!timestamp) {
      await sendMessage(env, chatId, "⚠️ خطا در پردازش تاریخ و زمان. لطفاً دوباره وارد کنید:");
      state.step = "AWAITING_SCHEDULE_TIME";
      await kv.put(`state:${user.id}`, JSON.stringify(state));
      return;
    }

    draft.scheduleAt = timestamp;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    // Show Confirmation
    const formatLabel = formatTimestamp(timestamp, offset);
    const text = `📋 <b>تایید زمانبندی پست</b>\n\n📍 کانال مقصد: <b>${state.targetChannelName}</b>\n⏰ زمان ارسال: <b>${formatLabel}</b>\n🌐 منطقه زمانی: <b>${tz.toUpperCase()}</b>\n\nآیا این زمانبندی را تایید میکنید؟`;
    
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ تایید و ذخیره زمانبندی", callback_data: `post_schedule_save:${tz}` },
            { text: "✏️ تغییر زمان", callback_data: "post_send_schedule" }
          ],
          [{ text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }]
        ]
      }
    });
    return;
  }

  if (data.startsWith("post_schedule_save:")) {
    const tz = data.replace("post_schedule_save:", "");
    // Save to scheduled posts
    const postId = "post_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    
    const schedObj = {
      id: postId,
      targetChannelId: state.targetChannelId,
      targetChannelName: state.targetChannelName,
      post: draft,
      scheduleAt: draft.scheduleAt,
      timezone: tz
    };

    await kv.put(`scheduled:${postId}`, JSON.stringify(schedObj));

    // Update scheduled list
    let index = await kv.get("scheduled_index", { type: "json" }) || [];
    index.push(postId);
    await kv.put("scheduled_index", JSON.stringify(index));

    // Done
    await kv.delete(`draft:${user.id}`);
    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    await sendMessage(env, chatId, "🎉 <b>پست شما با موفقیت زمانبندی شد!</b>\nدر زمان مشخص شده به صورت خودکار ارسال خواهد شد.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]]
      }
    });
    return;
  }

  // Scheduled viewer operations
  if (data.startsWith("sched_view:")) {
    const postId = data.replace("sched_view:", "");
    await showScheduledPostDetail(env, chatId, msgId, postId);
    return;
  }

  if (data.startsWith("sched_test_preview:")) {
    const postId = data.replace("sched_test_preview:", "");
    const schedObj = await kv.get(`scheduled:${postId}`, { type: "json" });
    if (!schedObj) {
      await answerCallbackQuery(env, data, "❌ پست پیدا نشد", true);
      return;
    }
    const settings = await kv.get("settings", { type: "json" }) || {};
    const testChannelId = settings.testChannelId || env.TEST_CHANNEL_ID;
    
    if (!testChannelId) {
      await sendMessage(env, chatId, "⚠️ کانال تست تنظیم نشده است. لطفاً ابتدا در تنظیمات آیدی کانال تست را ثبت کنید.");
      return;
    }

    await sendMessage(env, chatId, "🔄 در حال ارسال پیش‌نمایش به کانال تست...");
    await sendPostToTelegram(env, testChannelId, schedObj.post);
    await sendMessage(env, chatId, "✅ پیش‌نمایش ارسال شد. لطفاً کانال تست خود را بررسی کنید.");
    return;
  }

  if (data.startsWith("sched_edit_time:")) {
    const postId = data.replace("sched_edit_time:", "");
    state.step = "AWAITING_EDIT_SCHEDULE_TIME";
    state.editingPostId = postId;
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    const text = "✏️ <b>تغییر زمانبندی پست</b>\n\nلطفاً زمان جدید ارسال را به فرمت میلادی ارسال کنید:\n\n<code>YYYY-MM-DD HH:mm</code>\n\n<i>مثال: 2025-08-15 14:30</i>";
    await editMessage(env, chatId, msgId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: `sched_view:${postId}` }]]
      }
    });
    return;
  }

  if (data.startsWith("sched_delete:")) {
    const postId = data.replace("sched_delete:", "");
    await kv.delete(`scheduled:${postId}`);

    let index = await kv.get("scheduled_index", { type: "json" }) || [];
    index = index.filter(id => id !== postId);
    await kv.put("scheduled_index", JSON.stringify(index));

    await callTelegram(env, "answerCallbackQuery", { callback_query_id: data, text: "🗑️ پست زمانبندی حذف شد" });
    await showScheduledPosts(env, chatId, msgId, null);
    return;
  }
}

/**
 * MESSAGE ROUTER
 */
async function handleMessage(message, user, state, draft, env) {
  const kv = env.BOT_KV;
  const chatId = message.chat.id;
  const text = message.text ? message.text.trim() : "";

  // Handle global start command
  if (text === "/start" || text === "منوی اصلی") {
    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));
    await showMainMenu(env, chatId, null);
    return;
  }

  // Handle custom manual input steps
  if (state.step === "AWAITING_CHANNEL_FORWARD") {
    let targetChannelId = null;
    let targetChannelName = "";

    if (message.forward_from_chat && message.forward_from_chat.type === "channel") {
      targetChannelId = message.forward_from_chat.id;
      targetChannelName = message.forward_from_chat.title;
    } else if (text.startsWith("@")) {
      targetChannelId = text;
      targetChannelName = text;
    } else if (text.startsWith("-100")) {
      targetChannelId = text;
      targetChannelName = text;
    }

    if (!targetChannelId) {
      await sendMessage(env, chatId, "⚠️ پیام فوروارد شده معتبر نیست یا فرمت آیدی صحیح نیست. لطفاً مجدداً تلاش کنید یا بازگردید:", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "menu_channels" }]]
        }
      });
      return;
    }

    // Verify bot is admin using getChat
    const chatRes = await callTelegram(env, "getChat", { chat_id: targetChannelId });
    if (!chatRes.ok) {
      await sendMessage(env, chatId, `⚠️ خطا: ربات در کانال ${targetChannelName} عضو نیست یا دسترسی ادمین ندارد.\n\nلطفاً مطمئن شوید ربات را در کانال عضو کرده و دسترسی ادمین (Post Messages) داده‌اید.\nپیام خطای تلگرام:\n<code>${chatRes.description || "یافت نشد"}</code>`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 تلاش مجدد", callback_data: "add_channel_start" }],
            [{ text: "🔙 بازگشت به لیست کانال‌ها", callback_data: "menu_channels" }]
          ]
        }
      });
      return;
    }

    // Move to next step: Ask display name
    state.step = "AWAITING_CHANNEL_NAME";
    state.tempChannelId = String(chatRes.result.id);
    state.tempChannelName = chatRes.result.title || targetChannelName;
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    await sendMessage(env, chatId, `✅ ربات عضو کانال "<b>${state.tempChannelName}</b>" شد!\n\nحالا یک نام نمایشی کوتاه و دلخواه برای مدیریت این کانال در ربات بنویسید:\n<i>(این نام فقط به مدیران نمایش داده میشود)</i>`);
    return;
  }

  if (state.step === "AWAITING_CHANNEL_NAME") {
    if (!text) {
      await sendMessage(env, chatId, "⚠️ نام نمایشی نامعتبر است. لطفاً یک متن وارد کنید:");
      return;
    }

    // Add to channels list
    let channels = await kv.get("channels", { type: "json" }) || [];
    
    // Check if channel already exists
    channels = channels.filter(c => c.id !== state.tempChannelId);
    
    channels.push({
      id: state.tempChannelId,
      name: text,
      telegramTitle: state.tempChannelName,
      addedAt: Date.now()
    });

    await kv.put("channels", JSON.stringify(channels));

    // Reset state
    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    const keyboard = [
      [
        { text: "📢 رفتن به لیست کانال‌ها", callback_data: "menu_channels" },
        { text: "🏠 منوی اصلی", callback_data: "menu_main" }
      ]
    ];
    await sendMessage(env, chatId, `🎉 کانال <b>${text}</b> با موفقیت به سیستم مدیریت ربات متصل شد!`, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  if (state.step === "AWAITING_SETTINGS_TEST_CHANNEL") {
    if (!text.startsWith("-100")) {
      await sendMessage(env, chatId, "⚠️ آیدی معتبر کانال تلگرام معمولاً با <code>-100</code> شروع میشود. مجددا وارد کنید:");
      return;
    }

    let settings = await kv.get("settings", { type: "json" }) || {};
    settings.testChannelId = text;
    await kv.put("settings", JSON.stringify(settings));

    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    await sendMessage(env, chatId, `✅ آیدی کانال تست با موفقیت به <code>${text}</code> تغییر یافت.`, {
      reply_markup: {
        inline_keyboard: [[{ text: "⚙️ بازگشت به تنظیمات", callback_data: "menu_settings" }]]
      }
    });
    return;
  }

  if (state.step === "AWAITING_SETTINGS_TZ_CUSTOM") {
    const mins = parseInt(text);
    if (isNaN(mins)) {
      await sendMessage(env, chatId, "⚠️ لطفاً عدد صحیح وارد کنید:");
      return;
    }

    let settings = await kv.get("settings", { type: "json" }) || {};
    settings.timezone = "custom";
    settings.timezoneOffset = mins;
    settings.timezoneLabel = `دستی (UTC${mins >= 0 ? "+" : ""}${mins / 60})`;
    await kv.put("settings", JSON.stringify(settings));

    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    await sendMessage(env, chatId, `✅ منطقه زمانی با موفقیت به اختلاف ${mins} دقیقه ذخیره شد.`, {
      reply_markup: {
        inline_keyboard: [[{ text: "⚙️ بازگشت به تنظیمات", callback_data: "menu_settings" }]]
      }
    });
    return;
  }

  if (state.step === "AWAITING_POST_SCHED_TZ_CUSTOM") {
    const mins = parseInt(text);
    if (isNaN(mins)) {
      await sendMessage(env, chatId, "⚠️ لطفاً عدد صحیح به عنوان دقیقه وارد کنید:");
      return;
    }

    let settings = await kv.get("settings", { type: "json" }) || {};
    settings.timezone = "custom";
    settings.timezoneOffset = mins;
    settings.timezoneLabel = `دستی (UTC${mins >= 0 ? "+" : ""}${mins / 60})`;
    await kv.put("settings", JSON.stringify(settings));

    state.step = "AWAITING_SCHEDULE_TIME";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    const currentLocalTime = formatTimestamp(Date.now(), mins);
    const schedText = `✅ <b>منطقه زمانی با موفقیت تنظیم شد!</b>\n\n🌐 منطقه زمانی: <b>${settings.timezoneLabel}</b>\n🕐 ساعت فعلی شما از نظر ربات: <b>${currentLocalTime}</b>\n\nیکی از زمان‌های پیشنهادی زیر را انتخاب کنید یا خودتان زمان خاصی بنویسید:\n\n<b>مثال‌های ورود دستی قابل قبول:</b>\n- <code>18:30</code> (امروز ساعت ۱۸:۳۰ یا فردا)\n- <code>فردا 14:00</code>\n- <code>پس فردا 21:00</code>\n- <code>2026-07-15 14:30</code> (فرمت کامل میلادی)\n\n<i>نکته: زبان ارقام (فارسی یا انگلیسی) اهمیتی ندارد.</i>`;
    await sendMessage(env, chatId, schedText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⏱️ ۱۵ دقیقه دیگر", callback_data: "post_sched_preset:15m" },
            { text: "⏱️ ۳۰ دقیقه دیگر", callback_data: "post_sched_preset:30m" }
          ],
          [
            { text: "⏱️ ۱ ساعت دیگر", callback_data: "post_sched_preset:1h" },
            { text: "⏱️ ۲ ساعت دیگر", callback_data: "post_sched_preset:2h" }
          ],
          [
            { text: "⏱️ ۵ ساعت دیگر", callback_data: "post_sched_preset:5h" },
            { text: "⏱️ ۱۲ ساعت دیگر", callback_data: "post_sched_preset:12h" }
          ],
          [
            { text: "🌅 فردا صبح (۰۹:۰۰)", callback_data: "post_sched_preset:tomorrow_morning" },
            { text: "🌌 فردا شب (۲۱:۰۰)", callback_data: "post_sched_preset:tomorrow_night" }
          ],
          [
            { text: "📅 فردا همین ساعت", callback_data: "post_sched_preset:tomorrow_same" }
          ],
          [
            { text: "⚙️ تنظیم منطقه زمانی (تغییر ساعت ربات)", callback_data: "post_sched_change_tz" }
          ],
          [
            { text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }
          ]
        ]
      }
    });
    return;
  }

  if (state.step === "AWAITING_CONTENT") {
    // Collect text & files
    const type = draft.contentType;
    let fileId = null;
    let postText = message.text || message.caption || "";

    // Keep HTML tags if rich formatting exists
    const entities = message.entities || message.caption_entities;
    if (entities && entities.length > 0) {
      postText = telegramEntitiesToHtml(postText, entities);
    } else {
      postText = parseMarkdownToHtml(postText);
    }

    if (type === "photo" && message.photo) {
      // Pick highest resolution
      const photoArray = message.photo;
      fileId = photoArray[photoArray.length - 1].file_id;
    } else if (type === "video" && message.video) {
      fileId = message.video.file_id;
    } else if (type === "gif" && message.document && message.document.mime_type === "video/mp4") {
      fileId = message.document.file_id;
    } else if (type === "gif" && message.animation) {
      fileId = message.animation.file_id;
    } else if (type === "audio" && message.audio) {
      fileId = message.audio.file_id;
    } else if (type === "document" && message.document) {
      fileId = message.document.file_id;
    } else if (type === "sticker" && message.sticker) {
      fileId = message.sticker.file_id;
    } else if (type === "voice" && message.voice) {
      fileId = message.voice.file_id;
    }

    // Fallback if they sent incorrect file type
    if (type !== "text" && !fileId) {
      await sendMessage(env, chatId, `⚠️ محتوای ارسالی با قالب انتخابی (${type}) مطابقت ندارد. لطفاً فایل مناسب را ارسال کنید:`);
      return;
    }

    // Write to draft
    draft.fileId = fileId;
    draft.text = postText;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    // Determine next step
    if (type === "text") {
      // Skip caption position, ask buttons
      await askInlineButtonsChoice(env, chatId, null);
    } else {
      // Ask Caption Position
      state.step = "AWAITING_CAPTION_POSITION";
      await kv.put(`state:${user.id}`, JSON.stringify(state));

      const text = "📐 <b>محل قرارگیری کپشن (متن)</b>\n\nآیا میخواهید متن بالای تصویر/ویدیو به صورت یک پیام مستقل ارسال شود، یا کپشن زیر تصویر/ویدیو متصل باشد؟";
      const keyboard = [
        [
          { text: "⬆️ متن بالای تصویر/ویدیو", callback_data: "post_caption_pos:above" },
          { text: "⬇️ کپشن زیر تصویر/ویدیو", callback_data: "post_caption_pos:below" }
        ],
        [{ text: "🔙 بازگشت", callback_data: "menu_main" }]
      ];
      await sendMessage(env, chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    }
    return;
  }

  if (state.step === "AWAITING_BUTTONS_TEXT") {
    const keyboard = parseButtons(text);
    if (keyboard.length === 0) {
      await sendMessage(env, chatId, "⚠️ فرمت دکمه‌ها صحیح نیست. لطفاً مجدداً مطابق نمونه ارسال کنید:");
      return;
    }

    draft.buttons = keyboard;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    // Confirm buttons visually
    const confirmText = "👀 <b>پیش‌نمایش دکمه‌های شیشه‌ای شما:</b>\n\nدکمه‌ها با لینک‌های مربوطه به پست اضافه شدند. آیا مایلید ذخیره شوند؟";
    await sendMessage(env, chatId, confirmText, {
      reply_markup: {
        inline_keyboard: [
          ...keyboard,
          [
            { text: "✅ تایید دکمه‌ها", callback_data: "post_btn_confirm" },
            { text: "✏️ ویرایش مجدد", callback_data: "post_btn_reedit" }
          ]
        ]
      }
    });
    return;
  }

  if (state.step === "AWAITING_SCHEDULE_TIME") {
    const settings = await kv.get("settings", { type: "json" }) || {};
    const offset = settings.timezoneOffset !== undefined ? settings.timezoneOffset : 210;
    const tzLabel = settings.timezoneLabel || "Tehran (UTC+3:30)";

    const timestamp = parseDateTimeWithOffset(text, offset);
    if (!timestamp) {
      await sendMessage(env, chatId, "⚠️ متوجه زمان وارد شده نشدم! لطفاً یک ساعت یا فرمت معتبر بنویسید.\n\nمثال‌ها:\n- <code>18:30</code>\n- <code>فردا 14:00</code>\n- <code>2026-07-15 14:30</code>");
      return;
    }

    draft.scheduleAt = timestamp;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));

    const formatLabel = formatTimestamp(timestamp, offset);
    const confirmText = `📋 <b>تایید زمانبندی پست</b>\n\n📍 کانال مقصد: <b>${state.targetChannelName}</b>\n⏰ زمان ارسال: <b>${formatLabel}</b>\n🌐 منطقه زمانی: <b>${tzLabel}</b>\n\nآیا این زمانبندی را تایید میکنید؟`;

    await sendMessage(env, chatId, confirmText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ تایید و ذخیره زمانبندی", callback_data: `post_schedule_save:${settings.timezone || "tehran"}` },
            { text: "✏️ تغییر زمان", callback_data: "post_send_schedule" }
          ],
          [{ text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }]
        ]
      }
    });
    return;
  }

  if (state.step === "AWAITING_EDIT_SCHEDULE_TIME") {
    const postId = state.editingPostId;
    const schedObj = await kv.get(`scheduled:${postId}`, { type: "json" });
    if (!schedObj) {
      await sendMessage(env, chatId, "⚠️ پست زمانبندی شده یافت نشد.");
      return;
    }

    const settings = await kv.get("settings", { type: "json" }) || {};
    const offset = settings.timezoneOffset !== undefined ? settings.timezoneOffset : 210;

    const timestamp = parseDateTimeWithOffset(text, offset);
    if (!timestamp) {
      await sendMessage(env, chatId, "⚠️ متوجه زمان وارد شده نشدم! لطفاً یک ساعت یا فرمت معتبر بنویسید.\n\nمثال‌ها:\n- <code>18:30</code>\n- <code>فردا 14:00</code>\n- <code>2026-07-15 14:30</code>");
      return;
    }

    schedObj.scheduleAt = timestamp;
    await kv.put(`scheduled:${postId}`, JSON.stringify(schedObj));

    state.step = "MAIN_MENU";
    await kv.put(`state:${user.id}`, JSON.stringify(state));

    await sendMessage(env, chatId, `✅ زمان ارسال پست با موفقیت به <b>${formatTimestamp(timestamp, offset)}</b> تغییر یافت.`, {
      reply_markup: {
        inline_keyboard: [[{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]]
      }
    });
    return;
  }

  // Fallback
  await showMainMenu(env, chatId, null);
}

/**
 * UI SCREEN HELPERS
 */
async function showMainMenu(env, chatId, editMsgId) {
  const text = "<b>👋 به ربات پیشرفته مدیریت کانال خوش آمدید!</b>\n\nبا استفاده از این ربات قدرتمند، میتوانید محتواهای خود را ویرایش کرده، دکمههای شیشهای متصل کرده و آنها را برای ارسال خودکار زمانبندی کنید.";
  const keyboard = [
    [
      { text: "📢 کانالهای من", callback_data: "menu_channels" },
      { text: "➕ افزودن کانال جدید", callback_data: "add_channel_start" }
    ],
    [
      { text: "📋 پستهای زمانبندی شده", callback_data: "menu_scheduled" },
      { text: "⚙️ تنظیمات ربات", callback_data: "menu_settings" }
    ]
  ];

  if (editMsgId) {
    await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await sendMessage(env, chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function showChannelsList(env, chatId, editMsgId) {
  const kv = env.BOT_KV;
  const channels = await kv.get("channels", { type: "json" }) || [];

  let text = "<b>📢 لیست کانالهای متصل شده:</b>\n\nبرای مدیریت هر کانال و ثبت پست جدید، روی دکمه مربوطه کلیک کنید:";
  if (channels.length === 0) {
    text += "\n\n<i>هیچ کانالی یافت نشد! لطفاً کانال خود را اضافه کنید.</i>";
  }

  const keyboard = [];
  for (const c of channels) {
    keyboard.push([{ text: `📣 ${c.name}`, callback_data: `chan_view:${c.id}` }]);
  }
  
  keyboard.push([{ text: "➕ افزودن کانال جدید", callback_data: "add_channel_start" }]);
  keyboard.push([{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]);

  await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function showChannelMenu(env, chatId, editMsgId, chanId) {
  const kv = env.BOT_KV;
  const channels = await kv.get("channels", { type: "json" }) || [];
  const chan = channels.find(c => c.id === chanId);

  if (!chan) {
    await editMessage(env, chatId, editMsgId, "⚠️ کانال یافت نشد.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "menu_channels" }]]
      }
    });
    return;
  }

  const text = `📣 <b>مدیریت کانال: ${chan.name}</b>\n\nتایتل تلگرام: <code>${chan.telegramTitle}</code>\nآیدی عددی: <code>${chan.id}</code>\n\nلطفاً عملیات مورد نظر را انتخاب کنید:`;
  const keyboard = [
    [
      { text: "✍️ ایجاد پست جدید", callback_data: `post_create:${chan.id}` },
      { text: "📋 پست‌های زمانبندی شده این کانال", callback_data: `menu_scheduled:${chan.id}` }
    ],
    [
      { text: "🗑️ حذف اتصال کانال", callback_data: `chan_delete:${chan.id}` },
      { text: "🔙 بازگشت به لیست کانال‌ها", callback_data: "menu_channels" }
    ]
  ];

  await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function askContentType(env, chatId, editMsgId, title) {
  const text = `🛠️ <b>انتخاب نوع محتوای پست برای [ ${title} ]</b>\n\nلطفاً مشخص کنید قصد دارید چه نوع محتوایی ارسال کنید:`;
  const keyboard = [
    [
      { text: "📝 فقط متن", callback_data: "post_type:text" },
      { text: "🖼️ عکس + کپشن", callback_data: "post_type:photo" }
    ],
    [
      { text: "🎥 ویدیو + کپشن", callback_data: "post_type:video" },
      { text: "🎞️ گیف / انیمیشن", callback_data: "post_type:gif" }
    ],
    [
      { text: "🎵 فایل صوتی", callback_data: "post_type:audio" },
      { text: "📄 فایل / سند", callback_data: "post_type:document" }
    ],
    [
      { text: "🖼️ استیکر", callback_data: "post_type:sticker" },
      { text: "🎤 ویس ضبط شده", callback_data: "post_type:voice" }
    ],
    [{ text: "🔙 بازگشت به منوی اصلی", callback_data: "menu_main" }]
  ];

  await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function askInlineButtonsChoice(env, chatId, optionalMsgId) {
  const text = "🔗 <b>دکمه‌های شیشه‌ای (Inline Buttons)</b>\n\nآیا مایلید دکمه‌های شیشه‌ای دارای لینک به این پست اضافه شوند؟";
  const keyboard = [
    [
      { text: "✅ بله، دکمه اضافه کنم", callback_data: "post_btn_yes" },
      { text: "❌ خیر، بدون دکمه", callback_data: "post_btn_no" }
    ]
  ];

  if (optionalMsgId) {
    await editMessage(env, chatId, optionalMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await sendMessage(env, chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function askReplyChoice(env, chatId, editMsgId) {
  const text = "💬 <b>افزودن پیام پاسخ (Reply Post)</b>\n\nآیا مایلید یک پیام پاسخ ثانویه به این پست زنجیره کنید؟\n<i>(پیام پاسخ به عنوان Reply به پیام اول زیر آن ارسال خواهد شد)</i>";
  const keyboard = [
    [
      { text: "✅ بله، پیام پاسخ اضافه کنم", callback_data: "post_reply_yes" },
      { text: "❌ خیر", callback_data: "post_reply_no" }
    ],
    [{ text: "🔙 بازگشت", callback_data: "menu_main" }]
  ];
  await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function prepareTestChannelPreview(env, user, state, draft, chatId, editMsgId) {
  const kv = env.BOT_KV;

  // If this was a sub-draft (reply post creation flow)
  if (draft.isReply && draft.parentDraft) {
    const parent = draft.parentDraft;
    // Embed the current draft inside parent draft
    parent.replyPost = {
      contentType: draft.contentType,
      fileId: draft.fileId,
      text: draft.text,
      captionPosition: draft.captionPosition,
      buttons: draft.buttons
    };
    // Make parent standard
    draft = parent;
    await kv.put(`draft:${user.id}`, JSON.stringify(draft));
  }

  // Send to test channel ID
  const settings = await kv.get("settings", { type: "json" }) || {};
  const testChannelId = settings.testChannelId || env.TEST_CHANNEL_ID;

  if (!testChannelId) {
    await sendMessage(env, chatId, "⚠️ آیدی کانال تست تنظیم نشده است. لطفاً ابتدا در منوی تنظیمات کانال تست خود را ثبت کنید تا پیش‌نمایش به آن ارسال شود.");
    await showSendOptions(env, chatId, null);
    return;
  }

  await sendMessage(env, chatId, "🔄 در حال ارسال پیش‌نمایش پست به کانال تست...");
  const previewRes = await sendPostToTelegram(env, testChannelId, draft);

  if (previewRes.ok) {
    const text = "📲 <b>پیش‌نمایش در کانال تست منتشر شد!</b>\n\nلطفاً پست ارسال شده در کانال تست را به دقت مشاهده کنید و در صورت تایید یکی از گزینه‌های زیر را بزنید:";
    const keyboard = [
      [
        { text: "✅ تایید و ادامه", callback_data: "post_test_confirm" },
        { text: "✏️ ویرایش مجدد پست", callback_data: "post_test_edit" }
      ],
      [{ text: "❌ لغو و حذف کل پیش‌نویس", callback_data: "post_test_cancel" }]
    ];
    await sendMessage(env, chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await sendMessage(env, chatId, `⚠️ خطا در ارسال پیش‌نمایش به کانال تست:\n<code>${previewRes.description || "نامشخص"}</code>\n\nولی میتوانید مستقیما به مرحله بعد بروید:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ تایید و ادامه بدون پیش‌نمایش", callback_data: "post_test_confirm" }],
          [{ text: "❌ لغو پیش‌نویس", callback_data: "post_test_cancel" }]
        ]
      }
    });
  }
}

async function showSendOptions(env, chatId, editMsgId) {
  const text = "📤 <b>گزینه‌های انتشار پست</b>\n\nآیا مایلید پست هم اکنون منتشر شود یا برای آینده زمانبندی گردد؟";
  const keyboard = [
    [
      { text: "🚀 ارسال همین الان به کانال", callback_data: "post_send_now" },
      { text: "⏱️ زمانبندی ارسال خودکار", callback_data: "post_send_schedule" }
    ],
    [{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]
  ];
  if (editMsgId) {
    await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
  } else {
    await sendMessage(env, chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  }
}

async function showScheduledPosts(env, chatId, editMsgId, filterChanId) {
  const kv = env.BOT_KV;
  const index = await kv.get("scheduled_index", { type: "json" }) || [];
  const settings = await kv.get("settings", { type: "json" }) || {};
  const offset = settings.timezoneOffset || 0;

  const list = [];
  for (const id of index) {
    const p = await kv.get(`scheduled:${id}`, { type: "json" });
    if (p) {
      if (!filterChanId || p.targetChannelId === filterChanId) {
        list.push(p);
      }
    }
  }

  // Sort by date
  list.sort((a, b) => a.scheduleAt - b.scheduleAt);

  let text = "<b>📋 لیست پست‌های زمانبندی شده:</b>\n\nبرای مشاهده جزییات یا حذف هر پست، کلیک کنید:";
  if (list.length === 0) {
    text += "\n\n<i>هیچ پست زمانبندی شده‌ای یافت نشد.</i>";
  }

  const keyboard = [];
  for (const p of list) {
    const formattedTime = formatTimestamp(p.scheduleAt, offset);
    const label = `📅 ${formattedTime} | ${p.targetChannelName} | نوع: ${p.post.contentType}`;
    keyboard.push([{ text: label, callback_data: `sched_view:${p.id}` }]);
  }

  keyboard.push([{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]);

  await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function showScheduledPostDetail(env, chatId, editMsgId, postId) {
  const kv = env.BOT_KV;
  const p = await kv.get(`scheduled:${postId}`, { type: "json" });
  if (!p) {
    await editMessage(env, chatId, editMsgId, "⚠️ پست یافت نشد.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 بازگشت به لیست", callback_data: "menu_scheduled" }]]
      }
    });
    return;
  }

  const settings = await kv.get("settings", { type: "json" }) || {};
  const offset = settings.timezoneOffset || 0;
  const formattedTime = formatTimestamp(p.scheduleAt, offset);

  const text = `📋 <b>جزییات پست زمانبندی شده</b>\n\n📍 کانال مقصد: <b>${p.targetChannelName}</b>\n⏰ زمان ارسال: <b>${formattedTime}</b>\n📝 نوع محتوا: <b>${p.post.contentType}</b>\n💬 متن: <code>${p.post.text || "(ندارد)"}</code>\n🔗 تعداد دکمه‌ها: <b>${p.post.buttons ? p.post.buttons.flat().length : 0}</b>\n💬 پیام پاسخ ثانویه: <b>${p.post.replyPost ? "دارد" : "ندارد"}</b>`;

  const keyboard = [
    [
      { text: "👁️ پیش‌نمایش مجدد در کانال تست", callback_data: `sched_test_preview:${p.id}` },
      { text: "✏️ ویرایش زمان ارسال", callback_data: `sched_edit_time:${p.id}` }
    ],
    [
      { text: "🗑️ حذف این پست", callback_data: `sched_delete:${p.id}` },
      { text: "🔙 بازگشت به لیست", callback_data: "menu_scheduled" }
    ]
  ];

  await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function showSettings(env, chatId, editMsgId) {
  const kv = env.BOT_KV;
  const settings = await kv.get("settings", { type: "json" }) || {};
  
  const testChan = settings.testChannelId || env.TEST_CHANNEL_ID || "تنظیم نشده (از متغیرهای محیطی استفاده میشود)";
  const tzLabel = settings.timezoneLabel || "تنظیم نشده (پیش‌فرض UTC)";
  const admins = env.ADMIN_IDS || "هیچ مدیری تعریف نشده";

  const text = `⚙️ <b>تنظیمات ربات کانال من</b>\n\n📲 <b>کانال تست فعلی:</b> <code>${testChan}</code>\n🕐 <b>منطقه زمانی فعلی:</b> <code>${tzLabel}</code>\n\n👥 <b>مدیران مجاز (فقط خواندنی):</b>\n<code>${admins}</code>\n\n<i>نکته: برای اضافه یا حذف کردن مدیران، باید متغیر ADMIN_IDS را در کنترل پنل کلودفلر ویرایش کنید.</i>`;

  const keyboard = [
    [
      { text: "📲 تنظیم کانال تست جدید", callback_data: "settings_test_channel_start" },
      { text: "🕐 تنظیم منطقه زمانی", callback_data: "settings_tz_start" }
    ],
    [{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]
  ];

  // If clicking timezone setting, show options
  if (stateStepIsTimezone(editMsgId, env)) {
    // We add timezone choices below
  }

  // Let's create sub-menu timezone inside settings for simplicity
  await editMessage(env, chatId, editMsgId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📲 تنظیم کانال تست", callback_data: "settings_test_channel_start" },
          { text: "🕐 منطقه زمانی", callback_data: "settings_tz_menu" }
        ],
        [{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]
      ]
    }
  });
}

function stateStepIsTimezone(editMsgId, env) {
  return false;
}

// Special callback router for settings sub menus
async function editMessage(env, chatId, msgId, text, options = {}) {
  return callTelegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: msgId,
    text: text,
    parse_mode: "HTML",
    ...options
  });
}

/**
 * TZ SUB MENU ROUTER EXTENSION
 */
async function handleTzMenu(env, chatId, editMsgId) {
  const text = "🕐 <b>انتخاب منطقه زمانی پیش‌فرض</b>\n\nلطفاً برای محاسبه تاریخ و ساعت‌های زمانبندی، ریجن خود را انتخاب کنید:";
  const keyboard = [
    [
      { text: "🇮🇷 تهران +3:30", callback_data: "settings_tz_tehran" },
      { text: "🌍 UTC / گرینویچ", callback_data: "settings_tz_utc" },
      { text: "🇦🇪 دبی +4", callback_data: "settings_tz_dubai" }
    ],
    [
      { text: "✏️ وارد کردن دستی (به دقیقه)", callback_data: "settings_tz_custom_start" },
      { text: "🔙 بازگشت به تنظیمات", callback_data: "menu_settings" }
    ]
  ];
  await editMessage(env, chatId, editMsgId, text, { reply_markup: { inline_keyboard: keyboard } });
}

/**
 * CRON TRIGGER EXECUTION (process due posts)
 */
async function processScheduledPosts(env) {
  const kv = env.BOT_KV;
  if (!kv) return;

  const index = await kv.get("scheduled_index", { type: "json" }) || [];
  if (index.length === 0) return;

  const now = Date.now();
  const duePostIds = [];
  const remainingPostIds = [];

  for (const id of index) {
    const p = await kv.get(`scheduled:${id}`, { type: "json" });
    if (p) {
      if (p.scheduleAt <= now) {
        duePostIds.push(p);
      } else {
        remainingPostIds.push(id);
      }
    }
  }

  // Send due posts
  for (const p of duePostIds) {
    try {
      console.log(`Sending due post ${p.id} to channel ${p.targetChannelId}`);
      const res = await sendPostToTelegram(env, p.targetChannelId, p.post);
      if (res.ok) {
        // Remove from KV
        await kv.delete(`scheduled:${p.id}`);
      } else {
        console.error(`Failed sending post ${p.id}:`, res.description);
        // We still remove or keep? Better to notify admin or retry once.
        // For safety on multiple failing loops, we remove it to prevent spamming errors.
        await kv.delete(`scheduled:${p.id}`);
      }
    } catch (err) {
      console.error(`Error sending due post ${p.id}:`, err);
      await kv.delete(`scheduled:${p.id}`);
    }
  }

  // Save updated index
  await kv.put("scheduled_index", JSON.stringify(remainingPostIds));
}
