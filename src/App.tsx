import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";

// @ts-ignore
import workerRaw from "../worker.js?raw";
import {
  MessageSquare,
  Send,
  Smartphone,
  Database,
  BookOpen,
  Download,
  Copy,
  Plus,
  Trash2,
  Settings,
  Clock,
  ExternalLink,
  Check,
  Code,
  Wifi,
  AlertCircle,
  Calendar,
  List,
  RefreshCw,
  FileText,
  ChevronDown,
  ChevronUp,
  Globe,
  Sliders,
  Image,
  Video,
  File,
  Mic,
  Music,
  Smile
} from "lucide-react";

function parseButtons(text: string) {
  const keyboard: any[] = [];
  let currentRow: any[] = [];
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

function formatTimestamp(timestamp: number, offsetMinutes: number) {
  const date = new Date(timestamp + offsetMinutes * 60 * 1000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} - ${h}:${min}`;
}

function parseFriendlyDateTime(text: string, offsetMinutes: number): number | null {
  // Normalize Persian/Arabic digits to English digits
  text = text.replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString())
             .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
             .trim().toLowerCase();

  const nowUtc = Date.now();
  const localNow = new Date(nowUtc + offsetMinutes * 60 * 1000);

  // Case A: Full Gregorian date-time like YYYY-MM-DD HH:mm or YYYY/MM/DD HH:mm
  const fullMatch = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})\s+(\d{2}):(\d{2})$/);
  if (fullMatch) {
    const [_, year, month, day, hour, minute] = fullMatch.map(Number);
    const utcDate = Date.UTC(year, month - 1, day, hour, minute);
    if (!isNaN(utcDate)) {
      return utcDate - offsetMinutes * 60 * 1000;
    }
  }

  // Case B: Relative offsets like "30m", "+30", "1h", "2 ساعت"
  const relativeMatch = text.match(/^\+?(\d+)\s*(min|m|دقیقه|دقیقه دیگر|دق)?$/);
  if (relativeMatch && !text.includes(":")) {
    const mins = parseInt(relativeMatch[1], 10);
    const label = relativeMatch[2] || "m";
    if (label === "m" || label === "min" || label.includes("دقیقه") || label === "دق") {
      return nowUtc + mins * 60 * 1000;
    }
  }

  const relativeHoursMatch = text.match(/^\+?(\d+)\s*(h|hour|ساعت|ساعت دیگر|س)?$/);
  if (relativeHoursMatch && !text.includes(":")) {
    const hrs = parseInt(relativeHoursMatch[1], 10);
    return nowUtc + hrs * 60 * 60 * 1000;
  }

  // Case C: Relative phrases with clock time like "فردا 14:30" or "پس فردا 18:00" or just "18:00"
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      let targetLocal = new Date(localNow);
      targetLocal.setUTCHours(hour, minute, 0, 0);

      let daysToAdd = 0;
      if (text.includes("پس فردا")) {
        daysToAdd = 2;
      } else if (text.includes("فردا") || text.includes("farda")) {
        daysToAdd = 1;
      } else if (text.includes("امروز") || text.includes("emruz")) {
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

function calculatePresetTimestamp(preset: string, offsetMinutes: number): number {
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

export default function App() {
  // Config & Variable Customization State
  const [botToken, setBotToken] = useState("123456789:ABCdefGhIJKlmNoPQRsTuvWxYz");
  const [adminIds, setAdminIds] = useState("123456789");
  const [testChannelId, setTestChannelId] = useState("-1001234567890");

  // Copy/Download Status
  const [copiedWorker, setCopiedWorker] = useState(false);
  const [copiedReadme, setCopiedReadme] = useState(false);

  // Active Tab in Developer Center
  const [devTab, setDevTab] = useState<"code" | "guide" | "kv">("code");

  // Phone Mock active view
  const [phoneTab, setPhoneTab] = useState<"bot" | "test_channel" | "main_channel">("bot");

  // Simulator State
  const [messages, setMessages] = useState<any[]>([
    {
      id: "init_1",
      sender: "bot",
      text: "<b>👋 به ربات پیشرفته مدیریت کانال خوش آمدید!</b>\n\nبا استفاده از این ربات قدرتمند، میتوانید محتواهای خود را ویرایش کرده، دکمههای شیشهای متصل کرده و آنها را برای ارسال خودکار زمانبندی کنید.",
      buttons: [
        [
          { text: "📢 کانالهای من", callback_data: "menu_channels" },
          { text: "➕ افزودن کانال جدید", callback_data: "add_channel_start" }
        ],
        [
          { text: "📋 پستهای زمانبندی شده", callback_data: "menu_scheduled" },
          { text: "⚙️ تنظیمات ربات", callback_data: "menu_settings" }
        ]
      ]
    }
  ]);

  const [inputVal, setInputVal] = useState("");

  // Simulated Database (KV)
  const [kvStore, setKvStore] = useState<Record<string, any>>({
    "channels": [
      { id: "-1001111111111", name: "کانال تکنولوژی من", telegramTitle: "My Tech Channel", addedAt: Date.now() - 36000000 }
    ],
    "settings": {
      "timezone": "tehran",
      "timezoneOffset": 210,
      "timezoneLabel": "Tehran (UTC+3:30)",
      "testChannelId": "-1001234567890"
    },
    "scheduled_index": [],
  });

  // Simulated State Machine variables
  const [state, setState] = useState<any>({ step: "MAIN_MENU" });
  const [draft, setDraft] = useState<any>({
    contentType: "text",
    fileId: null,
    text: "",
    captionPosition: "below",
    buttons: [],
    replyPost: null,
    scheduleAt: null
  });

  // Simulated feeds for Test and Main Channel
  const [testFeed, setTestFeed] = useState<any[]>([
    {
      id: "t_1",
      contentType: "text",
      text: "📢 پیام تست اولیه: ربات با موفقیت ادمین شد.",
      buttons: []
    }
  ]);

  const [mainFeed, setMainFeed] = useState<any[]>([
    {
      id: "m_1",
      contentType: "photo",
      text: "سلام به مخاطبین محترم کانال! 🌸",
      mediaUrl: "https://images.unsplash.com/photo-1518173946687-a4c8a383392e?w=600&auto=format&fit=crop&q=60",
      captionPosition: "below"
    }
  ]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of simulator chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle dynamic worker code output
  const getWorkerCode = () => {
    return workerRaw;
  };

  // Helper to add message in simulator
  const addMsg = (sender: "user" | "bot", text: string, buttons?: any[], mediaUrl?: string, fileType?: string) => {
    const id = "msg_" + Date.now() + "_" + Math.floor(Math.random() * 100);
    setMessages(prev => [...prev, { id, sender, text, buttons, mediaUrl, fileType }]);
  };

  // Simulated Webhook Callback Trigger
  const handleBotCallback = async (callbackData: string, btnText: string) => {
    // Add user click message
    addMsg("user", `[کلیک دکمه: ${btnText}]`);

    // Simulate callback execution
    setTimeout(async () => {
      // Main Menu Trigger
      if (callbackData === "menu_main") {
        setState({ step: "MAIN_MENU" });
        showMainMenuSim();
        return;
      }

      if (callbackData === "menu_channels") {
        setState({ step: "CHANNELS_LIST" });
        showChannelsListSim();
        return;
      }

      if (callbackData === "add_channel_start") {
        setState({ step: "AWAITING_CHANNEL_FORWARD" });
        addMsg("bot", "➕ <b>افزودن کانال جدید</b>\n\nلطفاً یک پیام از کانال مورد نظر را به این ربات <b>فوردارد (هدایت)</b> کنید یا آیدی عمومی کانال را با @ ارسال کنید:\n\n<i>مثال: @my_channel</i>", [
          [{ text: "🔙 بازگشت", callback_data: "menu_channels" }]
        ]);
        return;
      }

      if (callbackData === "menu_scheduled") {
        showScheduledPostsSim();
        return;
      }

      if (callbackData === "menu_settings") {
        showSettingsSim();
        return;
      }

      // Timezone Settings
      if (callbackData.startsWith("settings_tz_")) {
        const tz = callbackData.replace("settings_tz_", "");
        if (tz === "menu") {
          addMsg("bot", "🕐 <b>انتخاب منطقه زمانی پیش‌فرض</b>\n\nلطفاً برای محاسبه ساعت‌های زمانبندی، ریجن خود را انتخاب کنید:", [
            [
              { text: "🇮🇷 تهران +3:30", callback_data: "settings_tz_tehran" },
              { text: "🌍 UTC / گرینویچ", callback_data: "settings_tz_utc" },
              { text: "🇦🇪 دبی +4", callback_data: "settings_tz_dubai" }
            ],
            [
              { text: "✏️ وارد کردن دستی (به دقیقه)", callback_data: "settings_tz_custom_start" },
              { text: "🔙 بازگشت به تنظیمات", callback_data: "menu_settings" }
            ]
          ]);
          return;
        }

        let offset = 0;
        let label = "UTC";
        if (tz === "tehran") { offset = 210; label = "Tehran (UTC+3:30)"; }
        else if (tz === "dubai") { offset = 240; label = "Dubai (UTC+4)"; }
        else if (tz === "utc") { offset = 0; label = "UTC"; }

        const updatedKv = { ...kvStore };
        updatedKv.settings.timezone = tz;
        updatedKv.settings.timezoneOffset = offset;
        updatedKv.settings.timezoneLabel = label;
        setKvStore(updatedKv);

        addMsg("bot", `✅ منطقه زمانی با موفقیت به <b>${label}</b> تغییر یافت.`);
        showSettingsSim();
        return;
      }

      if (callbackData === "settings_tz_custom_start") {
        setState({ step: "AWAITING_SETTINGS_TZ_CUSTOM" });
        addMsg("bot", "🕐 <b>تنظیم دستی منطقه زمانی</b>\n\nلطفاً اختلاف زمانی با UTC را به دقیقه وارد کنید:\n\n<i>مثال برای ایران: 210</i>", [
          [{ text: "🔙 بازگشت", callback_data: "menu_settings" }]
        ]);
        return;
      }

      if (callbackData === "settings_test_channel_start") {
        setState({ step: "AWAITING_SETTINGS_TEST_CHANNEL" });
        addMsg("bot", "📲 <b>تنظیم آیدی کانال تست</b>\n\nلطفاً آیدی عددی کانال تست خود را وارد کنید (شروع با -100):\n\n<i>مثال: -1001234567890</i>", [
          [{ text: "🔙 بازگشت", callback_data: "menu_settings" }]
        ]);
        return;
      }

      // View channel
      if (callbackData.startsWith("chan_view:")) {
        const chanId = callbackData.replace("chan_view:", "");
        showChannelMenuSim(chanId);
        return;
      }

      // Delete Channel
      if (callbackData.startsWith("chan_delete:")) {
        const chanId = callbackData.replace("chan_delete:", "");
        const updatedKv = { ...kvStore };
        updatedKv.channels = updatedKv.channels.filter((c: any) => c.id !== chanId);
        setKvStore(updatedKv);
        addMsg("bot", "🗑️ اتصال کانال مورد نظر با موفقیت حذف شد.");
        showChannelsListSim();
        return;
      }

      // Post Create trigger
      if (callbackData.startsWith("post_create:")) {
        const chanId = callbackData.replace("post_create:", "");
        const chan = kvStore.channels.find((c: any) => c.id === chanId);
        setState({ step: "AWAITING_CONTENT_TYPE", targetChannelId: chanId, targetChannelName: chan?.name || "کانال شخصی" });
        setDraft({
          contentType: "text",
          fileId: null,
          text: "",
          captionPosition: "below",
          buttons: [],
          replyPost: null,
          scheduleAt: null
        });

        addMsg("bot", `🛠️ <b>انتخاب نوع محتوای پست برای [ ${chan?.name || "کانال شما"} ]</b>\n\nلطفاً مشخص کنید قصد دارید چه نوع محتوایی ارسال کنید:`, [
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
        ]);
        return;
      }

      // Select content type
      if (callbackData.startsWith("post_type:")) {
        const type = callbackData.replace("post_type:", "");
        const updatedDraft = { ...draft, contentType: type };
        setDraft(updatedDraft);
        setState({ ...state, step: "AWAITING_CONTENT" });

        let typePersian = "";
        if (type === "text") typePersian = "فقط متن";
        else if (type === "photo") typePersian = "تصویر (عکس)";
        else if (type === "video") typePersian = "ویدیو";
        else if (type === "gif") typePersian = "گیف";
        else if (type === "audio") typePersian = "فایل صوتی";
        else if (type === "document") typePersian = "فایل / سند";
        else if (type === "sticker") typePersian = "استیکر";
        else if (type === "voice") typePersian = "ویس (صدای ضبط شده)";

        addMsg("bot", `✍️ <b>ارسال محتوای پست (${typePersian})</b>\n\nلطفاً پیام خود را به عنوان محتوای پست ارسال کنید.\nمیتوانید از فرمتبندی استاندارد HTML تلگرام استفاده کنید:\n\n- <code>&lt;b&gt;bold&lt;/b&gt;</code>\n- <code>&lt;i&gt;italic&lt;/i&gt;</code>\n- <code>&lt;u&gt;underline&lt;/u&gt;</code>\n- <code>&lt;a href=\"URL\"&gt;link&lt;/a&gt;</code>\n\n<b>هم‌اکنون پیام/فایل خود را در چت تایپ کنید و بفرستید:</b>`);
        return;
      }

      // Caption position callback
      if (callbackData.startsWith("post_caption_pos:")) {
        const pos = callbackData.replace("post_caption_pos:", "");
        setDraft(prev => ({ ...prev, captionPosition: pos }));
        askButtonsChoiceSim();
        return;
      }

      // Inline Buttons choices
      if (callbackData === "post_btn_yes") {
        setState({ ...state, step: "AWAITING_BUTTONS_TEXT" });
        addMsg("bot", "🔗 <b>تنظیم دکمههای شیشهای</b>\n\nلطفاً دکمهها را در قالب متنی زیر تایپ کرده و ارسال کنید:\n\n<code>خرید اشتراک | https://example.com\nوبسایت | https://site.com\n—\nپشتیبانی | https://t.me/support</code>\n\n• علامت <code>|</code> نام دکمه را از لینک جدا میکند.\n• علامت <code>—</code> ردیف جدید ایجاد میکند.");
        return;
      }

      if (callbackData === "post_btn_no") {
        setDraft(prev => ({ ...prev, buttons: [] }));
        askReplyChoiceSim();
        return;
      }

      if (callbackData === "post_btn_confirm") {
        askReplyChoiceSim();
        return;
      }

      if (callbackData === "post_btn_reedit") {
        setState({ ...state, step: "AWAITING_BUTTONS_TEXT" });
        addMsg("bot", "🔗 دکمههای جدید خود را طبق الگو مجدداً ارسال کنید:");
        return;
      }

      // Reply post choice
      if (callbackData === "post_reply_yes") {
        addMsg("bot", "💬 پیام پاسخ (Reply Post) فعال شد.\nدر ربات واقعی، فرآیند ایجاد پیام دوم شروع می‌شود.\nبرای راحتی شبیه‌سازی، پست شما ثبت شد و به بخش پیش‌نمایش می‌رویم.");
        setTimeout(() => {
          triggerPreviewSim();
        }, 1000);
        return;
      }

      if (callbackData === "post_reply_no") {
        triggerPreviewSim();
        return;
      }

      // Test Preview confirm actions
      if (callbackData === "post_test_confirm") {
        addMsg("bot", "📤 <b>گزینه‌های انتشار پست</b>\n\nآیا مایلید پست هم اکنون منتشر شود یا برای آینده زمانبندی گردد؟", [
          [
            { text: "🚀 ارسال همین الان به کانال", callback_data: "post_send_now" },
            { text: "⏱️ زمانبندی ارسال خودکار", callback_data: "post_send_schedule" }
          ],
          [{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]
        ]);
        return;
      }

      if (callbackData === "post_test_edit") {
        setState({ step: "MAIN_MENU" });
        addMsg("bot", "✏️ پیش‌نویس لغو شد. به منوی اصلی بازگشتید تا مجدد اقدام کنید.");
        showMainMenuSim();
        return;
      }

      if (callbackData === "post_test_cancel") {
        setDraft({
          contentType: "text",
          fileId: null,
          text: "",
          captionPosition: "below",
          buttons: [],
          replyPost: null,
          scheduleAt: null
        });
        setState({ step: "MAIN_MENU" });
        addMsg("bot", "❌ ایجاد پست لغو شد و پیش‌نویس کاملاً پاک گردید.");
        showMainMenuSim();
        return;
      }

      // Send Options
      if (callbackData === "post_send_now") {
        addMsg("bot", "🚀 در حال ارسال پست به کانال اصلی...");
        setTimeout(() => {
          // Push to main feed
          setMainFeed(prev => [
            ...prev,
            {
              id: "msg_" + Date.now(),
              contentType: draft.contentType,
              text: draft.text,
              buttons: draft.buttons
            }
          ]);
          addMsg("bot", "✅ <b>پست با موفقیت در کانال منتشر شد!</b>\nمیتوانید در تب [📣 کانال اصلی] آن را مشاهده کنید.", [
            [{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]
          ]);
          // Reset
          setState({ step: "MAIN_MENU" });
        }, 1200);
        return;
      }

      if (callbackData === "post_send_schedule") {
        setState({ ...state, step: "AWAITING_SCHEDULE_TIME" });
        const tzLabel = kvStore.settings.timezoneLabel || "Tehran (UTC+3:30)";
        addMsg("bot", `⏱️ <b>زمان‌بندی ارسال خودکار</b>\n\nمنطقه زمانی فعلی شما: <b>${tzLabel}</b>\n\nیکی از زمان‌های پیشنهادی زیر را انتخاب کنید یا خودتان زمان خاصی بنویسید:\n\n<b>مثال‌های ورود دستی قابل قبول:</b>\n- <code>18:30</code> (امروز ساعت ۱۸:۳۰ یا فردا)\n- <code>فردا 14:00</code>\n- <code>پس فردا 21:00</code>\n- <code>2026-07-15 14:30</code> (فرمت کامل میلادی)\n\n<i>نکته: زبان ارقام (فارسی یا انگلیسی) اهمیتی ندارد.</i>`, [
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
            { text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }
          ]
        ]);
        return;
      }

      if (callbackData.startsWith("post_sched_preset:")) {
        const preset = callbackData.replace("post_sched_preset:", "");
        const offset = kvStore.settings.timezoneOffset !== undefined ? kvStore.settings.timezoneOffset : 210;
        const tzLabel = kvStore.settings.timezoneLabel || "Tehran (UTC+3:30)";
        
        const timestamp = calculatePresetTimestamp(preset, offset);
        const formattedTime = formatTimestamp(timestamp, offset);
        
        setDraft((prev: any) => ({ ...prev, scheduleAt: timestamp }));
        
        addMsg("bot", `⏰ <b>تایید زمان‌بندی پست</b>\n\n📍 کانال مقصد: <b>${state.targetChannelName || "کانال تکنولوژی من"}</b>\n📅 زمان ارسال: <b>${formattedTime}</b>\n🌐 منطقه زمانی: <b>${tzLabel}</b>\n\nآیا این زمان‌بندی را تایید می‌کنید؟`, [
          [
            { text: "✅ تایید و ذخیره", callback_data: "post_schedule_save" },
            { text: "✏️ تغییر زمان", callback_data: "post_send_schedule" }
          ],
          [{ text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }]
        ]);
        return;
      }

      if (callbackData === "post_schedule_save") {
        const offset = kvStore.settings.timezoneOffset !== undefined ? kvStore.settings.timezoneOffset : 210;
        const finalTime = draft.scheduleAt ? formatTimestamp(draft.scheduleAt, offset) : "نامشخص";
        
        const updatedKv = { ...kvStore };
        const simulatedPostId = "post_" + Date.now();
        const schedObj = {
          id: simulatedPostId,
          targetChannelId: state.targetChannelId || "-1001111111111",
          targetChannelName: state.targetChannelName || "کانال تکنولوژی من",
          post: { ...draft },
          scheduleAt: draft.scheduleAt || Date.now() + 3600000,
          timezone: kvStore.settings.timezone || "tehran"
        };
        
        updatedKv[`scheduled:${simulatedPostId}`] = schedObj;
        updatedKv.scheduled_index.push(simulatedPostId);
        setKvStore(updatedKv);

        addMsg("bot", `🎉 <b>پست شما با موفقیت زمان‌بندی شد!</b>\n\n📍 کانال: <b>${state.targetChannelName || "کانال تکنولوژی من"}</b>\n⏰ زمان ارسال: <b>${finalTime}</b>\n\nدر زمان فوق به صورت خودکار منتشر خواهد شد.`, [
          [{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]
        ]);

        setState({ step: "MAIN_MENU" });
        return;
      }

      // Post timezone select (fallback)
      if (callbackData.startsWith("post_tz_select:")) {
        const tz = callbackData.replace("post_tz_select:", "");
        let offset = tz === "tehran" ? 210 : tz === "dubai" ? 240 : 0;
        let offsetLabel = tz === "tehran" ? "Tehran (UTC+3:30)" : tz === "dubai" ? "Dubai (UTC+4)" : "UTC";
        
        const timestamp = parseFriendlyDateTime(draft.tempScheduleTime || "", offset) || (Date.now() + 3600000);
        const formattedTime = formatTimestamp(timestamp, offset);

        const updatedKv = { ...kvStore };
        const simulatedPostId = "post_" + Date.now();
        const schedObj = {
          id: simulatedPostId,
          targetChannelId: state.targetChannelId || "-1001111111111",
          targetChannelName: state.targetChannelName || "کانال تکنولوژی من",
          post: { ...draft, scheduleAt: timestamp },
          scheduleAt: timestamp,
          timezone: tz
        };
        
        updatedKv[`scheduled:${simulatedPostId}`] = schedObj;
        updatedKv.scheduled_index.push(simulatedPostId);
        setKvStore(updatedKv);

        addMsg("bot", `🎉 <b>پست شما با موفقیت زمانبندی شد!</b>\n\n📍 کانال: <b>${state.targetChannelName}</b>\n⏰ زمان: <b>${formattedTime}</b> (${offsetLabel})\n\nدر تاریخ فوق به صورت خودکار منتشر خواهد شد.`, [
          [{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]
        ]);

        setState({ step: "MAIN_MENU" });
        return;
      }

      // Scheduled posts actions
      if (callbackData.startsWith("sched_view:")) {
        const id = callbackData.replace("sched_view:", "");
        const postObj = kvStore[`scheduled:${id}`];
        if (!postObj) {
          addMsg("bot", "⚠️ پست پیدا نشد.");
          return;
        }

        addMsg("bot", `📋 <b>جزییات پست زمانبندی شده</b>\n\n📍 کانال مقصد: <b>${postObj.targetChannelName}</b>\n⏰ زمان ارسال: <b>${postObj.scheduleAt}</b>\n📝 نوع محتوا: <b>${postObj.post.contentType}</b>\n💬 متن: <code>${postObj.post.text || "(ندارد)"}</code>`, [
          [
            { text: "👁️ پیش‌نمایش مجدد در کانال تست", callback_data: `sched_test_preview:${id}` },
            { text: "🗑️ حذف این پست", callback_data: `sched_delete:${id}` }
          ],
          [{ text: "🔙 بازگشت به لیست", callback_data: "menu_scheduled" }]
        ]);
        return;
      }

      if (callbackData.startsWith("sched_test_preview:")) {
        const id = callbackData.replace("sched_test_preview:", "");
        const postObj = kvStore[`scheduled:${id}`];
        if (!postObj) {
          addMsg("bot", "⚠️ پست پیدا نشد.");
          return;
        }
        
        addMsg("bot", "🔄 در حال ارسال پیش‌نمایش زمانبندی شده به کانال تست...");
        setTimeout(() => {
          setTestFeed(prev => [
            ...prev,
            {
              id: "t_" + Date.now(),
              contentType: postObj.post.contentType,
              text: `[پیش‌نمایش زمانبندی شده] \n${postObj.post.text}`,
              buttons: postObj.post.buttons
            }
          ]);
          addMsg("bot", "✅ پیش‌نمایش به کانال تست فرستاده شد. میتوانید تب [📲 کانال تست] را بررسی کنید.");
        }, 1000);
        return;
      }

      if (callbackData.startsWith("sched_delete:")) {
        const id = callbackData.replace("sched_delete:", "");
        const updatedKv = { ...kvStore };
        delete updatedKv[`scheduled:${id}`];
        updatedKv.scheduled_index = updatedKv.scheduled_index.filter((idx: any) => idx !== id);
        setKvStore(updatedKv);
        addMsg("bot", "🗑️ پست زمانبندی شده حذف شد.");
        showScheduledPostsSim();
        return;
      }

    }, 300);
  };

  // Chat message send simulation
  const handleSendText = () => {
    if (!inputVal.trim()) return;
    const txt = inputVal.trim();
    addMsg("user", txt);
    setInputVal("");

    setTimeout(() => {
      // Step: AWAITING_CHANNEL_FORWARD
      if (state.step === "AWAITING_CHANNEL_FORWARD") {
        if (!txt.startsWith("@") && !txt.startsWith("-100")) {
          addMsg("bot", "⚠️ پیام فوروارد شده معتبر نیست یا آیدی عمومی کانال را به درستی همراه با @ وارد نکرده‌اید. مجدداً تلاش کنید یا بازگردید:", [
            [{ text: "🔙 بازگشت", callback_data: "menu_channels" }]
          ]);
          return;
        }

        const simulatedId = txt.startsWith("-100") ? txt : "-100" + Math.floor(Math.random() * 10000000);
        setState({ step: "AWAITING_CHANNEL_NAME", tempChannelId: simulatedId, tempChannelName: txt });
        addMsg("bot", `✅ عضویت ربات در کانال "<b>${txt}</b>" تایید شد!\n\nحالا یک نام نمایشی کوتاه و دلخواه برای مدیریت این کانال در ربات بنویسید:\n<i>(این نام فقط به مدیران نمایش داده میشود)</i>`);
        return;
      }

      // Step: AWAITING_CHANNEL_NAME
      if (state.step === "AWAITING_CHANNEL_NAME") {
        const updatedKv = { ...kvStore };
        updatedKv.channels.push({
          id: state.tempChannelId,
          name: txt,
          telegramTitle: state.tempChannelName,
          addedAt: Date.now()
        });
        setKvStore(updatedKv);

        setState({ step: "MAIN_MENU" });
        addMsg("bot", `🎉 کانال <b>${txt}</b> با موفقیت به سیستم مدیریت ربات متصل شد!`, [
          [
            { text: "📢 رفتن به لیست کانال‌ها", callback_data: "menu_channels" },
            { text: "🏠 منوی اصلی", callback_data: "menu_main" }
          ]
        ]);
        return;
      }

      // Step: AWAITING_CONTENT
      if (state.step === "AWAITING_CONTENT") {
        setDraft(prev => ({ ...prev, text: txt }));
        
        if (draft.contentType === "text") {
          askButtonsChoiceSim();
        } else {
          setState({ ...state, step: "AWAITING_CAPTION_POSITION" });
          addMsg("bot", "📐 <b>محل قرارگیری کپشن (متن)</b>\n\nآیا میخواهید متن بالای تصویر/ویدیو به صورت یک پیام مستقل ارسال شود، یا کپشن زیر تصویر/ویدیو متصل باشد؟", [
            [
              { text: "⬆️ متن بالای تصویر/ویدیو", callback_data: "post_caption_pos:above" },
              { text: "⬇️ کپشن زیر تصویر/ویدیو", callback_data: "post_caption_pos:below" }
            ],
            [{ text: "🔙 بازگشت", callback_data: "menu_main" }]
          ]);
        }
        return;
      }

      // Step: AWAITING_BUTTONS_TEXT
      if (state.step === "AWAITING_BUTTONS_TEXT") {
        const parsed = parseButtons(txt);
        if (parsed.length === 0) {
          addMsg("bot", "⚠️ فرمت دکمه‌ها صحیح نیست. لطفاً مجدداً مطابق نمونه ارسال کنید:\n\n<code>خرید | http...\nسایت | http...</code>");
          return;
        }

        setDraft(prev => ({ ...prev, buttons: parsed }));
        addMsg("bot", "👀 <b>پیش‌نمایش دکمه‌های شیشه‌ای شما:</b>\nدکمه‌ها با موفقیت پارس و شبیه‌سازی شدند:", [
          ...parsed,
          [
            { text: "✅ تایید دکمه‌ها", callback_data: "post_btn_confirm" },
            { text: "✏️ ویرایش مجدد", callback_data: "post_btn_reedit" }
          ]
        ]);
        return;
      }

      // Step: AWAITING_SETTINGS_TEST_CHANNEL
      if (state.step === "AWAITING_SETTINGS_TEST_CHANNEL") {
        if (!txt.startsWith("-100")) {
          addMsg("bot", "⚠️ فرمت آیدی عددی کانال تلگرام معمولاً با -100 شروع می‌شود. مجدداً وارد کنید:");
          return;
        }
        const updatedKv = { ...kvStore };
        updatedKv.settings.testChannelId = txt;
        setKvStore(updatedKv);
        setTestChannelId(txt);

        setState({ step: "MAIN_MENU" });
        addMsg("bot", `✅ آیدی کانال تست با موفقیت به <code>${txt}</code> تغییر یافت.`, [
          [{ text: "⚙️ بازگشت به تنظیمات", callback_data: "menu_settings" }]
        ]);
        return;
      }

      // Step: AWAITING_SETTINGS_TZ_CUSTOM
      if (state.step === "AWAITING_SETTINGS_TZ_CUSTOM") {
        const mins = parseInt(txt);
        if (isNaN(mins)) {
          addMsg("bot", "⚠️ لطفاً عدد صحیح به عنوان دقیقه وارد کنید:");
          return;
        }

        const updatedKv = { ...kvStore };
        updatedKv.settings.timezone = "custom";
        updatedKv.settings.timezoneOffset = mins;
        updatedKv.settings.timezoneLabel = `دستی (UTC${mins >= 0 ? "+" : ""}${mins / 60})`;
        setKvStore(updatedKv);

        setState({ step: "MAIN_MENU" });
        addMsg("bot", `✅ منطقه زمانی اختصاصی با موفقیت تنظیم شد.`, [
          [{ text: "⚙️ بازگشت به تنظیمات", callback_data: "menu_settings" }]
        ]);
        return;
      }

      // Step: AWAITING_SCHEDULE_TIME
      if (state.step === "AWAITING_SCHEDULE_TIME") {
        const offset = kvStore.settings.timezoneOffset !== undefined ? kvStore.settings.timezoneOffset : 210;
        const tzLabel = kvStore.settings.timezoneLabel || "Tehran (UTC+3:30)";
        
        const timestamp = parseFriendlyDateTime(txt, offset);
        if (!timestamp) {
          addMsg("bot", "⚠️ متوجه زمان وارد شده نشدم! لطفاً یک ساعت یا فرمت معتبر بنویسید.\n\nمثال‌ها:\n- <code>18:30</code>\n- <code>فردا 14:00</code>\n- <code>2026-07-15 14:30</code>");
          return;
        }

        const formattedTime = formatTimestamp(timestamp, offset);
        setDraft((prev: any) => ({ ...prev, scheduleAt: timestamp }));
        
        addMsg("bot", `⏰ <b>تایید زمان‌بندی پست</b>\n\n📍 کانال مقصد: <b>${state.targetChannelName || "کانال تکنولوژی من"}</b>\n📅 زمان ارسال: <b>${formattedTime}</b>\n🌐 منطقه زمانی: <b>${tzLabel}</b>\n\nآیا این زمان‌بندی را تایید می‌کنید؟`, [
          [
            { text: "✅ تایید و ذخیره", callback_data: "post_schedule_save" },
            { text: "✏️ تغییر زمان", callback_data: "post_send_schedule" }
          ],
          [{ text: "🔙 بازگشت به گزینه‌ها", callback_data: "post_test_confirm" }]
        ]);
        return;
      }

      // Default main menu route if idle
      showMainMenuSim();
    }, 400);
  };

  // Fast transitions
  const showMainMenuSim = () => {
    addMsg("bot", "<b>🏠 منوی اصلی ربات کانال من</b>\n\nانتخاب کنید:", [
      [
        { text: "📢 کانالهای من", callback_data: "menu_channels" },
        { text: "➕ افزودن کانال جدید", callback_data: "add_channel_start" }
      ],
      [
        { text: "📋 پستهای زمانبندی شده", callback_data: "menu_scheduled" },
        { text: "⚙️ تنظیمات ربات", callback_data: "menu_settings" }
      ]
    ]);
  };

  const showChannelsListSim = () => {
    const list = kvStore.channels.map((c: any) => [
      { text: `📣 ${c.name}`, callback_data: `chan_view:${c.id}` }
    ]);
    addMsg("bot", "<b>📢 لیست کانالهای متصل شده به ربات:</b>\n\nبرای ثبت پست جدید یا ادمینی روی نام کانال کلیک کنید:", [
      ...list,
      [{ text: "➕ افزودن کانال جدید", callback_data: "add_channel_start" }],
      [{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]
    ]);
  };

  const showChannelMenuSim = (chanId: string) => {
    const chan = kvStore.channels.find((c: any) => c.id === chanId);
    addMsg("bot", `📣 <b>مدیریت کانال: ${chan?.name || "نامشخص"}</b>\n\nتایتل تلگرام: <code>${chan?.telegramTitle || "ناشناخته"}</code>\nآیدی عددی کانال: <code>${chanId}</code>\n\nگزینه مورد نظر را برای این کانال مشخص کنید:`, [
      [
        { text: "✍️ ایجاد پست جدید", callback_data: `post_create:${chanId}` },
        { text: "🗑️ حذف این کانال", callback_data: `chan_delete:${chanId}` }
      ],
      [{ text: "🔙 بازگشت به لیست کانال‌ها", callback_data: "menu_channels" }]
    ]);
  };

  const askButtonsChoiceSim = () => {
    addMsg("bot", "🔗 <b>دکمه‌های شیشه‌ای (Inline Buttons)</b>\n\nآیا مایلید دکمه‌های شیشه‌ای دارای لینک به این پست اضافه شوند؟", [
      [
        { text: "✅ بله، دکمه اضافه کنم", callback_data: "post_btn_yes" },
        { text: "❌ خیر، بدون دکمه", callback_data: "post_btn_no" }
      ]
    ]);
  };

  const askReplyChoiceSim = () => {
    addMsg("bot", "💬 <b>افزودن پیام پاسخ (Reply Post)</b>\n\nآیا مایلید یک پیام پاسخ ثانویه به این پست زنجیره کنید؟\n<i>(پیام پاسخ به عنوان Reply به پیام اول زیر آن ارسال خواهد شد)</i>", [
      [
        { text: "✅ بله، پیام پاسخ اضافه کنم", callback_data: "post_reply_yes" },
        { text: "❌ خیر", callback_data: "post_reply_no" }
      ],
      [{ text: "🔙 بازگشت", callback_data: "menu_main" }]
    ]);
  };

  const triggerPreviewSim = () => {
    addMsg("bot", "🔄 در حال ارسال پیش‌نمایش پست به کانال تست...");
    setTimeout(() => {
      // Add to test channel feed
      setTestFeed(prev => [
        ...prev,
        {
          id: "t_" + Date.now(),
          contentType: draft.contentType,
          text: draft.text,
          buttons: draft.buttons
        }
      ]);
      addMsg("bot", "📲 <b>پیش‌نمایش در کانال تست منتشر شد!</b>\n\nلطفاً پست ارسال شده را در تب [📲 کانال تست] بالای همین بخش مشاهده کنید و در صورت رضایت تایید و ادامه دهید:", [
        [
          { text: "✅ تایید و ادامه", callback_data: "post_test_confirm" },
          { text: "✏️ ویرایش مجدد پست", callback_data: "post_test_edit" }
        ],
        [{ text: "❌ لغو پیش‌نویس", callback_data: "post_test_cancel" }]
      ]);
    }, 1000);
  };

  const showScheduledPostsSim = () => {
    const keys = Object.keys(kvStore).filter(k => k.startsWith("scheduled:"));
    const offset = kvStore.settings.timezoneOffset !== undefined ? kvStore.settings.timezoneOffset : 210;
    const listBtns = keys.map(k => {
      const obj = kvStore[k];
      const timeStr = typeof obj.scheduleAt === "number" ? formatTimestamp(obj.scheduleAt, offset) : obj.scheduleAt;
      return [{ text: `📅 ${timeStr} | ${obj.targetChannelName}`, callback_data: `sched_view:${obj.id}` }];
    });

    addMsg("bot", "<b>📋 لیست پست‌های زمانبندی شده فعال:</b>\n\nبرای مشاهده جزییات یا حذف پست کلیک کنید:", [
      ...listBtns,
      [{ text: "🏠 منوی اصلی", callback_data: "menu_main" }]
    ]);
  };

  const showSettingsSim = () => {
    addMsg("bot", `⚙️ <b>تنظیمات ربات کانال من</b>\n\n📲 <b>کانال تست فعلی:</b> <code>${kvStore.settings.testChannelId || testChannelId}</code>\n🕐 <b>منطقه زمانی فعلی:</b> <code>${kvStore.settings.timezoneLabel}</code>\n\n👥 <b>مدیران مجاز (فقط خواندنی):</b>\n<code>${adminIds}</code>\n\n<i>نکته: برای تغییر مدیران، متغیر ADMIN_IDS را در پنل کلودفلر خود ویرایش کنید.</i>`, [
      [
        { text: "📲 تنظیم کانال تست جدید", callback_data: "settings_test_channel_start" },
        { text: "🕐 منطقه زمانی", callback_data: "settings_tz_menu" }
      ],
      [{ text: "🏠 بازگشت به منوی اصلی", callback_data: "menu_main" }]
    ]);
  };

  // Copy helper
  const handleCopyText = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download helper
  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Interactive guide Accordion
  const [activeStep, setActiveStep] = useState<number | null>(1);

  const toggleStep = (stepNum: number) => {
    setActiveStep(activeStep === stepNum ? null : stepNum);
  };

  // Quick Simulate File upload helper
  const triggerMockUpload = (type: string) => {
    if (state.step !== "AWAITING_CONTENT") return;
    addMsg("user", `[ارسال فایل فرضی ${type.toUpperCase()}]`);
    setTimeout(() => {
      setDraft(prev => ({ ...prev, contentType: type, text: `این یک پیش‌فرض زیبا برای محتوای ${type} است.` }));
      setState({ ...state, step: "AWAITING_CAPTION_POSITION" });
      addMsg("bot", "📐 <b>محل قرارگیری کپشن (متن)</b>\n\nمحل دلخواه خود را تعیین کنید:", [
        [
          { text: "⬆️ متن بالای رسانه", callback_data: "post_caption_pos:above" },
          { text: "⬇️ کپشن زیر رسانه", callback_data: "post_caption_pos:below" }
        ],
        [{ text: "🔙 بازگشت", callback_data: "menu_main" }]
      ]);
    }, 400);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950 font-sans">
      {/* HEADER SECTION */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-xl shadow-lg shadow-cyan-500/20">
              <MessageSquare className="w-6 h-6 text-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                Telegram Channel Manager Builder
              </h1>
              <p className="text-xs text-slate-400 font-medium">
                شبیه‌ساز و سازنده اَبری ربات تلگرامی کلودفلر ورکرز
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs bg-slate-800/80 px-3.5 py-1.5 rounded-full border border-slate-700 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-slate-300">Workers Cloud Sync: Active</span>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: SIMULATOR (MOBILE INTEGRATION) */}
        <section className="lg:col-span-5 flex flex-col gap-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl flex flex-col h-[680px]">
            {/* Simulator Header & Tabs */}
            <div className="bg-slate-800 p-3 border-b border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                </div>
                <div className="text-xs text-slate-400 font-mono font-bold">TELEGRAM PHONE SIMULATOR</div>
              </div>
              
              {/* Smartphone Inner Navigation Tabs */}
              <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg text-xs">
                <button
                  onClick={() => setPhoneTab("bot")}
                  className={`py-1.5 px-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                    phoneTab === "bot"
                      ? "bg-cyan-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  چت ربات ادمین
                </button>
                <button
                  onClick={() => setPhoneTab("test_channel")}
                  className={`py-1.5 px-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                    phoneTab === "test_channel"
                      ? "bg-cyan-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  کانال تست {testFeed.length > 0 && <span className="bg-red-500 text-white text-[9px] px-1 rounded-full">{testFeed.length}</span>}
                </button>
                <button
                  onClick={() => setPhoneTab("main_channel")}
                  className={`py-1.5 px-2 rounded-md font-medium transition-all flex items-center justify-center gap-1.5 ${
                    phoneTab === "main_channel"
                      ? "bg-cyan-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  کانال اصلی
                </button>
              </div>
            </div>

            {/* Simulated Chat view */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
              
              {phoneTab === "bot" && (
                <>
                  <div className="text-center">
                    <span className="text-[10px] bg-slate-900 text-slate-500 px-2 py-1 rounded border border-slate-800">
                      امروز - شبیه‌سازی ورود ادمین مجاز ({adminIds.split(",")[0]})
                    </span>
                  </div>

                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex flex-col ${m.sender === "user" ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl p-3 text-sm leading-relaxed ${
                          m.sender === "user"
                            ? "bg-cyan-600/90 text-slate-950 rounded-tr-none text-right font-medium"
                            : "bg-slate-800 text-slate-100 rounded-tl-none text-right border border-slate-700/50"
                        }`}
                      >
                        <div dangerouslySetInnerHTML={{ __html: m.text }}></div>
                      </div>

                      {/* Render Buttons if any */}
                      {m.buttons && m.buttons.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1 w-full max-w-[85%]">
                          {m.buttons.map((row: any[], rIdx: number) => (
                            <div key={rIdx} className="flex gap-1">
                              {row.map((btn: any, bIdx: number) => (
                                <button
                                  key={bIdx}
                                  onClick={() => handleBotCallback(btn.callback_data || "custom", btn.text)}
                                  className="flex-1 bg-slate-900 border border-slate-700 hover:bg-slate-800 active:scale-98 transition text-xs text-cyan-400 py-2 px-2 rounded-lg text-center font-medium"
                                >
                                  {btn.text}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </>
              )}

              {phoneTab === "test_channel" && (
                <div className="space-y-4">
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-center text-xs text-slate-400">
                     <b>کانال پیش‌نویس تست ({testChannelId})</b><br />
                    پیش‌نمایش ارسالی‌ها را در این بخش با دکمه‌هایشان بررسی کنید.
                  </div>

                  {testFeed.map((post) => (
                    <div key={post.id} className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-md max-w-[90%] mx-auto">
                      <div className="p-3">
                        <div className="text-xs text-cyan-400 font-bold mb-1.5 flex items-center gap-1 justify-end">
                          <span>پیش‌نویس ربات کانال</span>
                          <span className="w-2.5 h-2.5 bg-cyan-400 rounded-full"></span>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-100 whitespace-pre-wrap text-right">{post.text}</p>
                      </div>
                      {post.buttons && post.buttons.length > 0 && (
                        <div className="p-2 border-t border-slate-800 bg-slate-950 flex flex-col gap-1">
                          {post.buttons.map((row: any[], rIdx: number) => (
                            <div key={rIdx} className="flex gap-1">
                              {row.map((btn: any, bIdx: number) => (
                                <a
                                  key={bIdx}
                                  href={btn.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex-1 block text-center bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-xs text-cyan-300 py-1.5 rounded"
                                >
                                  {btn.text} 🔗
                                </a>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {phoneTab === "main_channel" && (
                <div className="space-y-4">
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-center text-xs text-slate-400">
                     <b>کانال تلگرام اصلی (آیدی‌های متصل شده)</b><br />
                    پست‌هایی که به صورت فوری ارسال می‌شوند یا توسط کرون جاب کلودفلر ارسال شده‌اند:
                  </div>

                  {mainFeed.map((post) => (
                    <div key={post.id} className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-md max-w-[90%] mx-auto">
                      {post.mediaUrl && (
                        <img src={post.mediaUrl} alt="Post media" className="w-full h-40 object-cover" />
                      )}
                      <div className="p-3">
                        <p className="text-sm leading-relaxed text-slate-100 whitespace-pre-wrap text-right">{post.text}</p>
                      </div>
                      {post.buttons && post.buttons.length > 0 && (
                        <div className="p-2 border-t border-slate-800 bg-slate-950 flex flex-col gap-1">
                          {post.buttons.map((row: any[], rIdx: number) => (
                            <div key={rIdx} className="flex gap-1">
                              {row.map((btn: any, bIdx: number) => (
                                <a
                                  key={bIdx}
                                  href={btn.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex-1 block text-center bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-xs text-cyan-300 py-1.5 rounded"
                                >
                                  {btn.text}
                                </a>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

            </div>

            {/* Quick Actions Panel above Input */}
            {phoneTab === "bot" && (
              <div className="bg-slate-900 p-2 border-t border-slate-800">
                {/* Simulated State Indicator */}
                <div className="flex items-center justify-between text-[11px] mb-2 px-1 text-slate-400">
                  <span className="font-mono text-cyan-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {state.step}
                  </span>
                  <span className="text-right">گام فعال در پایگاه‌داده:</span>
                </div>

                {state.step === "AWAITING_CONTENT" && (
                  <div className="p-1 bg-slate-950 border border-slate-800 rounded-lg mb-2">
                    <p className="text-[11px] text-slate-400 text-center mb-1">شبیه‌سازی آپلود یا ارسال سریع فایل:</p>
                    <div className="grid grid-cols-4 gap-1">
                      <button onClick={() => triggerMockUpload("photo")} className="bg-slate-900 border border-slate-800 p-1.5 hover:bg-slate-800 rounded text-[10px] text-yellow-400 flex flex-col items-center gap-1 font-medium">
                        <Image className="w-3.5 h-3.5" /> عکس
                      </button>
                      <button onClick={() => triggerMockUpload("video")} className="bg-slate-900 border border-slate-800 p-1.5 hover:bg-slate-800 rounded text-[10px] text-blue-400 flex flex-col items-center gap-1 font-medium">
                        <Video className="w-3.5 h-3.5" /> ویدیو
                      </button>
                      <button onClick={() => triggerMockUpload("audio")} className="bg-slate-900 border border-slate-800 p-1.5 hover:bg-slate-800 rounded text-[10px] text-green-400 flex flex-col items-center gap-1 font-medium">
                        <Music className="w-3.5 h-3.5" /> موزیک
                      </button>
                      <button onClick={() => triggerMockUpload("document")} className="bg-slate-900 border border-slate-800 p-1.5 hover:bg-slate-800 rounded text-[10px] text-purple-400 flex flex-col items-center gap-1 font-medium">
                        <File className="w-3.5 h-3.5" /> سند / فایل
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Input Footer */}
            {phoneTab === "bot" ? (
              <div className="p-3 bg-slate-800 border-t border-slate-700 flex gap-2">
                <button
                  onClick={handleSendText}
                  className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 active:scale-95 transition p-3 rounded-xl flex items-center justify-center"
                >
                  <Send className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendText()}
                  placeholder={
                    state.step === "AWAITING_BUTTONS_TEXT"
                      ? "متن دکمه‌ها را به فرمت الگو تایپ کنید..."
                      : "پیام یا دستور خود را بنویسید..."
                  }
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 text-right focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            ) : (
              <div className="p-4 bg-slate-900 border-t border-slate-800 text-center text-xs text-slate-500">
                این فقط یک پیش‌نمایش زنده از وضعیت کانال‌ها در شبیه‌ساز تلگرام است.
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: DEVELOPER DASHBOARD */}
        <section className="lg:col-span-7 flex flex-col gap-6">
          
          {/* Dashboard Tab Bar */}
          <div className="bg-slate-900 p-1.5 rounded-xl border border-slate-800 flex gap-1">
            <button
              onClick={() => setDevTab("code")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs md:text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                devTab === "code"
                  ? "bg-slate-800 text-cyan-400 border border-slate-700/50 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Code className="w-4 h-4" />
              کدهای نهایی و دانلود (Code Generator)
            </button>
            <button
              onClick={() => setDevTab("guide")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs md:text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                devTab === "guide"
                  ? "bg-slate-800 text-cyan-400 border border-slate-700/50 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              راهنمای راه‌اندازی (Farsi Setup)
            </button>
            <button
              onClick={() => setDevTab("kv")}
              className={`flex-1 py-2 px-3 rounded-lg text-xs md:text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                devTab === "kv"
                  ? "bg-slate-800 text-cyan-400 border border-slate-700/50 shadow-md"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Database className="w-4 h-4" />
              دیتابیس ابری (Live KV Viewer)
            </button>
          </div>

          {/* ACTIVE CONTENT RENDER */}
          <div className="min-h-[550px]">
            {devTab === "code" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Fast Customizer Config Box */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                    <Sliders className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-base font-bold text-slate-100">سفارشی‌سازی مقادیر (تزریق مستقیم به کد)</h3>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed text-right">
                    با وارد کردن اطلاعات ربات خود در زیر، کدهای آماده ورکر و مستند راهنما به طور زنده با اطلاعات واقعی شما ویرایش می‌شوند. سپس می‌توانید فایل نهایی را با یک کلیک دریافت کنید!
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1.5 text-right font-medium">آیدی کانال تست (شروع با -100):</label>
                      <input
                        type="text"
                        value={testChannelId}
                        onChange={(e) => setTestChannelId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none text-left"
                        placeholder="-100123456789"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1.5 text-right font-medium">آیدی‌های عددی ادمین‌ها (با کاما):</label>
                      <input
                        type="text"
                        value={adminIds}
                        onChange={(e) => setAdminIds(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none text-left"
                        placeholder="123456789"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1.5 text-right font-medium">توکن تلگرام دریافت شده از BotFather:</label>
                      <input
                        type="text"
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none text-left"
                        placeholder="123456789:ABC..."
                      />
                    </div>
                  </div>
                </div>

                {/* Worker File Export Box */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="bg-slate-800/80 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCopyText(getWorkerCode(), setCopiedWorker)}
                        className="bg-slate-900 border border-slate-700/60 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 transition"
                      >
                        {copiedWorker ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedWorker ? "کپی شد!" : "کپی کد"}
                      </button>
                      <button
                        onClick={() => handleDownloadFile("worker.js", getWorkerCode())}
                        className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 font-medium transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        دانلود فایل
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-mono">worker.js</span>
                      <FileText className="w-4 h-4 text-cyan-400" />
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950 overflow-x-auto">
                    <pre className="text-xs text-slate-300 font-mono leading-relaxed max-h-[300px] overflow-y-auto scrollbar-thin">
                      <code>{getWorkerCode()}</code>
                    </pre>
                  </div>
                  <div className="bg-slate-900 px-4 py-2 text-[10px] text-slate-500 text-right border-t border-slate-800/60">
                    * این فایل شامل تمام ساختارهای منطقی، فراخوانی‌های API تلگرام و کرون جاب کلودفلر است.
                  </div>
                </div>

                {/* README File Export Box */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="bg-slate-800/80 px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCopyText(`راهنمای کستومایز شده راه اندازی:\nآیدی تست کانال: ${testChannelId}\nادمین اصلی: ${adminIds}`, setCopiedReadme)}
                        className="bg-slate-900 border border-slate-700/60 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 transition"
                      >
                        {copiedReadme ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedReadme ? "کپی شد!" : "کپی راهنما"}
                      </button>
                      <button
                        onClick={() => handleDownloadFile("README.md", `# راهنمای راه‌اندازی با توکن ${botToken}`)}
                        className="bg-slate-800 hover:bg-slate-750 text-slate-300 px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        دانلود راهنما
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-mono">README.md</span>
                      <FileText className="w-4 h-4 text-cyan-400" />
                    </div>
                  </div>

                  <div className="p-5 text-right space-y-2">
                    <p className="text-sm font-bold text-cyan-400">فایل مستند راهنما (README.md) به صورت کامل و فارسی تولید شد!</p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      این فایل راهنما به صورت ویژه برای راه‌اندازی از طریق داشبورد وب کلودفلر طراحی شده است و شامل تک‌تک مراحل با تصاویر فرضی، متغیرها و کرون‌تریگرها می‌باشد. فایل در ریشه پروژه قرار دارد.
                    </p>
                  </div>
                </div>

              </motion.div>
            )}

            {devTab === "guide" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span className="text-xs text-cyan-400 font-bold bg-cyan-950/50 px-2.5 py-1 rounded border border-cyan-800/40">آموزش گام‌به‌گام داشبورد</span>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    راهنمای تصویری کلودفلر
                  </h3>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      num: 1,
                      title: "ساخت ربات با BotFather در تلگرام",
                      desc: "در تلگرام به آیدی @BotFather پیام داده و با دستور /newbot ربات جدید بسازید. توکن اختصاصی نمایش داده شده را کپی کرده و در فیلد BOT_TOKEN اِسپیس‌های کلودفلر قرار دهید."
                    },
                    {
                      num: 2,
                      title: "ایجاد ورکر (Worker) در کلودفلر",
                      desc: "وارد پنل dash.cloudflare.com شوید. از بخش Workers & Pages گزینه Create Application و سپس Create Worker را کلیک کنید. یک نام انتخاب کرده و Deploy را بزنید تا ادرس شما ثبت شود."
                    },
                    {
                      num: 3,
                      title: "جایگزینی کد نهایی (Deploy code)",
                      desc: "در ورکر ساخته شده، دکمه Edit Code را بزنید. کل کدهای پیش‌فرض را حذف کرده و محتویات فایل کامل worker.js ما را پیست کنید و سپس دکمه Deploy بالا سمت راست را بزنید."
                    },
                    {
                      num: 4,
                      title: "ساخت دیتابیس رایگان (KV Namespace)",
                      desc: "از منوی Workers & Pages بخش KV گزینه Create Namespace را کلیک کرده و نام آن را دقیقاً BOT_KV بنویسید. سپس در صفحه تنظیمات ورکر (Settings → Variables) به بخش KV Bindings رفته و آن را با همین نام به ورکر متصل (Bind) کنید."
                    },
                    {
                      num: 5,
                      title: "تنظیم متغیرهای امنیتی (Environment Variables)",
                      desc: "در تنظیمات ورکر، تب Variables، سه متغیر BOT_TOKEN و ADMIN_IDS و TEST_CHANNEL_ID را همراه با مقادیر کستومایز شده خود ذخیره و دپلوی نمایید تا ربات آن‌ها را بخواند."
                    },
                    {
                      num: 6,
                      title: "فعال‌سازی وب‌هوک (setWebhook)",
                      desc: "آدرس ورکر کلودفلر خود را کپی کنید. کلمه setWebhook/ را به انتهای آدرس اضافه کرده و در مرورگر اینتر بزنید تا وب‌هوک متصل شود و ربات شروع به کار کند."
                    }
                  ].map((step) => (
                    <div key={step.num} className="bg-slate-950 rounded-xl border border-slate-800/80 overflow-hidden">
                      <button
                        onClick={() => toggleStep(step.num)}
                        className="w-full text-right p-4 flex items-center justify-between gap-4 hover:bg-slate-900/50 transition-colors"
                      >
                        {activeStep === step.num ? <ChevronUp className="w-4 h-4 text-cyan-400" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-slate-100">{step.title}</span>
                          <span className="w-6 h-6 rounded-full bg-slate-800 text-cyan-400 font-bold text-xs flex items-center justify-center">
                            {step.num}
                          </span>
                        </div>
                      </button>

                      <AnimatePresence>
                        {activeStep === step.num && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div className="p-4 pt-0 border-t border-slate-800 text-xs text-slate-400 leading-relaxed text-right whitespace-pre-wrap">
                              {step.desc}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {devTab === "kv" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/40">ONLINE SYNCHRONIZED</span>
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                  </div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                     وضعیت دیتابیس ابری (Cloudflare KV Store Simulator)
                  </h3>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed text-right">
                  این دیتابیس شبیه‌سازی شده، متغیرهای متصل به کلودفلر KV (با نام بایند شده <code>BOT_KV</code>) را نشان می‌دهد. با کار با دکمه‌ها و فرمت‌های مختلف در شبیه‌ساز تلفن سمت چپ، تغییرات زنده را در کلیدها و مقادیر دیتابیس در زیر مشاهده خواهید کرد!
                </p>

                <div className="space-y-3 font-mono text-xs">
                  {/* KV keys representation */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mb-2">
                      <span>TYPE: JSON Array</span>
                      <span className="text-cyan-400">"channels"</span>
                    </div>
                    <pre className="text-slate-300 overflow-x-auto text-right">
                      {JSON.stringify(kvStore.channels, null, 2)}
                    </pre>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mb-2">
                      <span>TYPE: JSON Object</span>
                      <span className="text-cyan-400">"state:{adminIds.split(",")[0]}"</span>
                    </div>
                    <pre className="text-slate-300 overflow-x-auto text-right">
                      {JSON.stringify(state, null, 2)}
                    </pre>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mb-2">
                      <span>TYPE: JSON Object</span>
                      <span className="text-cyan-400">"draft:{adminIds.split(",")[0]}"</span>
                    </div>
                    <pre className="text-slate-300 overflow-x-auto text-right">
                      {JSON.stringify(draft, null, 2)}
                    </pre>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mb-2">
                      <span>TYPE: JSON Object</span>
                      <span className="text-cyan-400">"settings"</span>
                    </div>
                    <pre className="text-slate-300 overflow-x-auto text-right">
                      {JSON.stringify(kvStore.settings, null, 2)}
                    </pre>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mb-2">
                      <span>TYPE: JSON Array</span>
                      <span className="text-cyan-400">"scheduled_index"</span>
                    </div>
                    <pre className="text-slate-300 overflow-x-auto text-right">
                      {JSON.stringify(kvStore.scheduled_index, null, 2)}
                    </pre>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="mt-auto border-t border-slate-900 bg-slate-950 p-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p>طراحی و توسعه یافته بر بستر Cloudflare Workers بدون وابستگی به سرور محلی.</p>
          <div className="flex gap-4">
            <span className="font-mono text-[10px] text-slate-600">Runtime: ES2022</span>
            <span className="font-mono text-[10px] text-slate-600">Free Tier Friendly</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
