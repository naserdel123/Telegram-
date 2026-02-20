// index.js
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// المتغيرات البيئية المطلوبة
const BOT_TOKEN = process.env.BOT_TOKEN;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // يجب تعيينه على Render.com (مثلاً https://your-app.onrender.com)

if (!BOT_TOKEN || !YOUTUBE_API_KEY || !WEBHOOK_URL) {
  console.error('❌ تأكد من تعيين المتغيرات البيئية: BOT_TOKEN, YOUTUBE_API_KEY, WEBHOOK_URL');
  process.exit(1);
}

// إنشاء البوت مع تعطيل الـ polling (سنستخدم webhook)
const bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`); // تعيين الـ webhook

const app = express();
app.use(express.json()); // لتحليل JSON الوارد من تليجرام

// نقطة النهاية الخاصة بالويب هوك
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// قائمة كلمات الشتم (يمكنك تعديلها حسب الحاجة)
const badWords = ['شتيمة1', 'شتيمة2', 'كلمة نابية', 'spam']; // مثال

// دالة للبحث في يوتيوب
async function searchYouTube(query) {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        maxResults: 1,
        q: query,
        key: YOUTUBE_API_KEY,
        type: 'video'
      }
    });

    if (response.data.items.length === 0) return null;

    const video = response.data.items[0];
    const videoId = video.id.videoId;
    const title = video.snippet.title;
    const channel = video.snippet.channelTitle;
    const thumbnail = video.snippet.thumbnails.high.url;

    // الحصول على تفاصيل إضافية (المدة والمشاهدات) باستخدام videoId
    const detailsResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'contentDetails,statistics',
        id: videoId,
        key: YOUTUBE_API_KEY
      }
    });

    const videoDetails = detailsResponse.data.items[0];
    const duration = videoDetails.contentDetails.duration; // مدة بصيغة ISO 8601
    const views = videoDetails.statistics.viewCount;

    // تحويل المدة إلى صيغة مفهومة (اختياري)
    const formattedDuration = duration.replace('PT', '').replace('H', ':').replace('M', ':').replace('S', '');

    return {
      title,
      channel,
      duration: formattedDuration,
      views,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail
    };
  } catch (error) {
    console.error('خطأ في بحث يوتيوب:', error.message);
    return null;
  }
}

// دالة لإنشاء 3 صور عشوائية من picsum.photos (مرتبطة بالاسم كـ seed)
function getRandomImages(query) {
  // نستخدم query كـ seed لجعل الصور تبدو مرتبطة (مع إضافة random salt لتعدد الصور)
  const seeds = [`${query}-1`, `${query}-2`, `${query}-3`];
  return seeds.map(seed => `https://picsum.photos/seed/${encodeURIComponent(seed)}/300/200`);
}

// الاستماع للأوامر والرسائل
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const messageId = msg.message_id;

  // إذا كانت الرسالة نصية
  if (text) {
    // 1. أمر /start
    if (text === '/start') {
      const keyboard = {
        inline_keyboard: [
          [{ text: '➕ اضفني لقروبك', url: `https://t.me/${bot.options.username}?startgroup=new` }]
        ]
      };
      await bot.sendMessage(chatId, 'مرحباً! أنا بوت متعدد المهام. أرسل "بحث [كلمة]" للبحث في يوتيوب، أو "صورة [كلمة]" للحصول على صور، أو قم بالرد على شخص بـ "همس [رسالتك]" لإرسال رسالة سرية.', {
        reply_markup: keyboard
      });
      return;
    }

    // 2. بحث يوتيوب
    if (text.startsWith('بحث ')) {
      const query = text.substring(3).trim();
      if (!query) {
        await bot.sendMessage(chatId, 'الرجاء إدخال كلمة البحث بعد الأمر "بحث".');
        return;
      }

      const videoInfo = await searchYouTube(query);
      if (videoInfo) {
        const caption = `🎬 *${videoInfo.title}*\n📺 القناة: ${videoInfo.channel}\n⏱ المدة: ${videoInfo.duration}\n👀 المشاهدات: ${videoInfo.views}\n🔗 [مشاهدة على يوتيوب](${videoInfo.url})`;
        await bot.sendPhoto(chatId, videoInfo.thumbnail, { caption, parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, 'لم أتمكن من العثور على فيديو بهذا الاسم.');
      }
      return;
    }

    // 3. بحث صور
    if (text.startsWith('صورة ')) {
      const query = text.substring(3).trim();
      if (!query) {
        await bot.sendMessage(chatId, 'الرجاء إدخال كلمة البحث بعد الأمر "صورة".');
        return;
      }

      const imageUrls = getRandomImages(query);
      const mediaGroup = imageUrls.map((url, index) => ({
        type: 'photo',
        media: url,
        caption: index === 2 ? `صور عن: ${query}` : undefined // إضافة تعليق للصورة الأخيرة فقط
      }));

      await bot.sendMediaGroup(chatId, mediaGroup);
      return;
    }

    // 4. حماية: حذف رسائل الشتم في المجموعات
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      const containsBadWord = badWords.some(word => text.toLowerCase().includes(word.toLowerCase()));
      if (containsBadWord) {
        try {
          await bot.deleteMessage(chatId, messageId);
        } catch (err) {
          console.error('فشل حذف الرسالة:', err.message);
        }
      }
    }
  }
});

// 5. همسات سرية (الرد على رسالة)
bot.on('message', async (msg) => {
  const text = msg.text;
  // إذا كانت الرسالة رداً على رسالة أخرى وتبدأ بـ "همس"
  if (msg.reply_to_message && text && text.startsWith('همس ')) {
    const whisperText = text.substring(4).trim(); // النص بعد همس
    const targetUser = msg.reply_to_message.from; // المستخدم الأصلي
    const sender = msg.from;

    if (!whisperText) {
      await bot.sendMessage(msg.chat.id, 'الرجاء كتابة رسالة بعد الأمر "همس".');
      return;
    }

    try {
      // إرسال رسالة خاصة للمستخدم المستهدف
      await bot.sendMessage(targetUser.id, `📩 رسالة سرية من ${sender.first_name}:\n${whisperText}`);
      // إعلام المرسل بأن الرسالة سُلّمت
      await bot.sendMessage(msg.chat.id, '✅ تم إرسال الهمسة بنجاح.', { reply_to_message_id: msg.message_id });
    } catch (err) {
      console.error('فشل إرسال الهمسة:', err.message);
      await bot.sendMessage(msg.chat.id, '❌ فشل إرسال الهمسة. ربما قام المستخدم بحظر البوت أو لم يبدأ المحادثة معه.', { reply_to_message_id: msg.message_id });
    }
  }
});

// بدء تشغيل الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 البوت يعمل على المنفذ ${PORT} باستخدام webhook`);
});
