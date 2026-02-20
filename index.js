// index.js (YouTube Video Downloader with quality selection)
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

// المتغيرات البيئية
const BOT_TOKEN = process.env.BOT_TOKEN;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!BOT_TOKEN || !YOUTUBE_API_KEY) {
  console.error('❌ تأكد من تعيين المتغيرات البيئية: BOT_TOKEN, YOUTUBE_API_KEY');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('البوت يعمل 🚀'));

// قائمة كلمات الشتم (يمكنك تعديلها)
const badWords = ['شتيمة1', 'شتيمة2', 'سخيف', 'غبي'];

// دالة البحث في يوتيوب باستخدام YouTube Data API
async function searchYouTube(query) {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        maxResults: 5, // نعرض عدة نتائج ليختار المستخدم
        q: query,
        key: YOUTUBE_API_KEY,
        type: 'video'
      }
    });
    return response.data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium.url
    }));
  } catch (error) {
    console.error('YouTube API error:', error.message);
    return [];
  }
}

// دالة الحصول على معلومات الفيديو والجودات المتاحة
async function getVideoInfo(videoId) {
  try {
    const info = await ytdl.getInfo(videoId);
    const formats = ytdl.filterFormats(info.formats, 'videoandaudio'); // فيديو + صوت
    // ترتيب الجودات تنازلياً (من الأعلى جودة للأقل)
    const sorted = formats.sort((a, b) => (b.height || 0) - (a.height || 0));
    const qualities = sorted.map(f => ({
      itag: f.itag,
      quality: f.qualityLabel || 'unknown',
      container: f.container,
      contentLength: f.contentLength ? parseInt(f.contentLength) : null
    }));
    return {
      title: info.videoDetails.title,
      channel: info.videoDetails.author.name,
      duration: info.videoDetails.lengthSeconds,
      qualities
    };
  } catch (error) {
    console.error('ytdl error:', error.message);
    return null;
  }
}

// دالة تحميل الفيديو بجودة محددة
async function downloadVideo(videoId, itag, fileName) {
  return new Promise((resolve, reject) => {
    const stream = ytdl(videoId, { quality: itag });
    const tempDir = os.tmpdir();
    const outputPath = path.join(tempDir, fileName);
    const writeStream = fs.createWriteStream(outputPath);

    stream.pipe(writeStream);
    writeStream.on('finish', () => resolve(outputPath));
    writeStream.on('error', reject);
    stream.on('error', reject);
  });
}

// دالة إنشاء أزرار الجودة
function createQualityKeyboard(qualities, videoId, title) {
  const buttons = qualities.map(q => {
    // نحدد حجم الملف بالتقريب
    const size = q.contentLength ? ` (${(q.contentLength / (1024*1024)).toFixed(1)} MB)` : '';
    return [{
      text: `${q.quality}${size}`,
      callback_data: `dl:${videoId}:${q.itag}:${encodeURIComponent(title)}`
    }];
  });
  return { inline_keyboard: buttons };
}

// بدء المحادثة
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    '🎬 *مرحباً بك في بوت تحميل فيديوهات يوتيوب!*\n\n' +
    'أرسل اسم الفيديو الذي تريد تحميله، وسأعطيك قائمة بالنتائج.\n' +
    'اختر النتيجة ثم اختر الجودة المناسبة.\n\n' +
    '⚠️ ملاحظة: أقصى حجم يمكن إرساله هو 50 ميجابايت (حد تيليجرام).\n' +
    'إذا كان الفيديو أكبر من ذلك، قد لا يمكن إرساله.',
    { parse_mode: 'Markdown' }
  );
});

// البحث عن فيديو
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const statusMsg = await bot.sendMessage(chatId, '🔍 جاري البحث...');

  const results = await searchYouTube(text);
  if (results.length === 0) {
    return bot.editMessageText('❌ لم أجد نتائج. حاول بكلمات أخرى.', {
      chat_id: chatId,
      message_id: statusMsg.message_id
    });
  }

  // عرض النتائج كأزرار
  const buttons = results.map((res, index) => [{
    text: `${index+1}. ${res.title.substring(0, 40)}...`,
    callback_data: `select:${res.videoId}:${encodeURIComponent(res.title)}`
  }]);

  await bot.editMessageText('اختر الفيديو:', {
    chat_id: chatId,
    message_id: statusMsg.message_id,
    reply_markup: { inline_keyboard: buttons }
  });
});

// معالج الأزرار
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  if (data.startsWith('select:')) {
    // اختيار فيديو معين -> جلب الجودات
    const [_, videoId, title] = data.split(':');
    const decodedTitle = decodeURIComponent(title);

    await bot.editMessageText(`⏳ جلب معلومات الفيديو: ${decodedTitle}...`, {
      chat_id: chatId,
      message_id: messageId
    });

    const info = await getVideoInfo(videoId);
    if (!info || info.qualities.length === 0) {
      return bot.editMessageText('❌ لا يمكن الحصول على معلومات الفيديو.', {
        chat_id: chatId,
        message_id: messageId
      });
    }

    // عرض الجودات المتاحة
    const keyboard = createQualityKeyboard(info.qualities, videoId, decodedTitle);
    await bot.editMessageText(`اختر الجودة المناسبة لـ:\n${decodedTitle}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });

  } else if (data.startsWith('dl:')) {
    // تحميل الفيديو بالجودة المختارة
    const [_, videoId, itag, title] = data.split(':');
    const decodedTitle = decodeURIComponent(title);
    const itagNum = parseInt(itag);

    await bot.editMessageText(`📥 جاري تحميل الفيديو: ${decodedTitle}...`, {
      chat_id: chatId,
      message_id: messageId
    });

    try {
      const fileName = `video_${Date.now()}.mp4`; // يمكن تحسين الامتداد حسب الحاوية
      const filePath = await downloadVideo(videoId, itagNum, fileName);

      // التحقق من حجم الملف
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      if (fileSizeMB > 50) {
        fs.unlinkSync(filePath);
        return bot.editMessageText('⚠️ حجم الفيديو أكبر من 50 ميجابايت ولا يمكن إرساله عبر تيليجرام.', {
          chat_id: chatId,
          message_id: messageId
        });
      }

      await bot.editMessageText(`📤 جاري رفع الفيديو: ${decodedTitle}...`, {
        chat_id: chatId,
        message_id: messageId
      });

      await bot.sendVideo(chatId, filePath, {
        caption: `🎬 ${decodedTitle}`,
        supports_streaming: true
      });

      // حذف الرسالة المؤقتة والملف
      await bot.deleteMessage(chatId, messageId);
      fs.unlink(filePath, (err) => {
        if (err) console.error('خطأ في حذف الملف:', err);
      });

    } catch (err) {
      console.error('خطأ في التحميل:', err);
      bot.editMessageText('❌ فشل تحميل الفيديو. حاول مرة أخرى.', {
        chat_id: chatId,
        message_id: messageId
      });
    }
  }
});

// حماية المجموعات (اختياري)
bot.on('message', (msg) => {
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    const text = msg.text;
    if (text && badWords.some(w => text.includes(w))) {
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }
  }
});

// بدء الخادم
app.listen(PORT, () => {
  console.log(`🚀 البوت يعمل على المنفذ ${PORT}`);
});
