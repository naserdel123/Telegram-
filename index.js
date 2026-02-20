// index.js (Polling version with direct MP3 download and legendary start message)
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// المتغيرات البيئية المطلوبة
const BOT_TOKEN = process.env.BOT_TOKEN;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!BOT_TOKEN || !YOUTUBE_API_KEY) {
  console.error('❌ تأكد من تعيين المتغيرات البيئية: BOT_TOKEN, YOUTUBE_API_KEY');
  process.exit(1);
}

// إنشاء البوت مع تفعيل الـ polling
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('البوت يعمل بواسطة polling 🚀');
});

// قائمة كلمات الشتم (مثال)
const badWords = ['شتيمة1', 'شتيمة2', 'كلمة نابية', 'spam', 'سخيف', 'غبي', 'احمق']; // أضف المزيد حسب الحاجة

// دالة للبحث في يوتيوب والحصول على معلومات الفيديو
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

    const detailsResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'contentDetails,statistics',
        id: videoId,
        key: YOUTUBE_API_KEY
      }
    });

    const videoDetails = detailsResponse.data.items[0];
    const duration = videoDetails.contentDetails.duration; // ISO 8601
    const views = videoDetails.statistics.viewCount;

    // تحويل المدة إلى صيغة أبسط
    const formattedDuration = duration.replace('PT', '').replace('H', ':').replace('M', ':').replace('S', '');

    return {
      title,
      channel,
      duration: formattedDuration,
      views,
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail
    };
  } catch (error) {
    console.error('خطأ في بحث يوتيوب:', error.message);
    return null;
  }
}

// دالة لتحميل الصوت من يوتيوب وتحويله إلى MP3
async function downloadAudioAsMP3(videoId, title) {
  return new Promise((resolve, reject) => {
    try {
      // إنشاء اسم ملف آمن
      const safeTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
      const tempDir = os.tmpdir(); // مجلد مؤقت (على Render يكون /tmp)
      const outputPath = path.join(tempDir, `${safeTitle}_${videoId}.mp3`);

      // الحصول على تدفق الصوت بأفضل جودة ممكنة
      const audioStream = ytdl(videoId, { quality: 'lowestaudio' }); // نستخدم lowestaudio لتقليل الحجم

      // تحويل الصوت إلى MP3 باستخدام ffmpeg
      ffmpeg(audioStream)
        .audioBitrate(128) // جودة 128 كيلوبت/ثانية مناسبة
        .toFormat('mp3')
        .on('end', () => {
          console.log(`تم تحويل ${videoId} إلى MP3`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('خطأ في ffmpeg:', err);
          reject(err);
        })
        .save(outputPath);
    } catch (error) {
      reject(error);
    }
  });
}

// دالة لإنشاء 3 صور عشوائية من picsum.photos
function getRandomImages(query) {
  const seeds = [`${query}-1`, `${query}-2`, `${query}-3`];
  return seeds.map(seed => `https://picsum.photos/seed/${encodeURIComponent(seed)}/300/200`);
}

// الاستماع للأوامر والرسائل
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const messageId = msg.message_id;

  if (text) {
    // 1. أمر /start برسالة ترحيبية أسطورية
    if (text === '/start') {
      const keyboard = {
        inline_keyboard: [
          [{ text: '➕ اضفني لقروبك', url: `https://t.me/${bot.options.username}?startgroup=new` }]
        ]
      };
      await bot.sendMessage(chatId, 
        '🌟 *مرحباً بك في البوت الأسطوري!* 🌟\n\n' +
        'أنا بوت متعدد المهام الخرافي، جاهز لخدمتك بكل ما تحتاج:\n\n' +
        '🎵 *بحث يوتيوب وتحويل إلى MP3*\n' +
        '• أرسل "بحث [اسم الأغنية]" وسأبحث لك عن الفيديو وأحوله إلى ملف صوتي MP3 مباشرة وأرسله لك هنا!\n\n' +
        '🖼 *بحث صور احترافي*\n' +
        '• أرسل "صورة [الكلمة]" وسأرسل لك 3 صور عالية الجودة من picsum.photos متعلقة ببحثك.\n\n' +
        '🤫 *الهمسات السرية*\n' +
        '• أرد على رسالة أي شخص واكتب "همس [رسالتك]" وسأوصل رسالتك له بشكل خاص دون أن يراه أحد.\n\n' +
        '🛡 *حماية المجموعات*\n' +
        '• إذا كنت مشرفاً في مجموعة، سأقوم بحذف أي رسالة تحتوي على كلمات نابية تلقائياً.\n\n' +
        '🔥 *ميزات أخرى قادمة...*\n\n' +
        '✨ استمتع بتجربة فريدة مع البوت الأسطوري! انقر على الزر أدناه لإضافتي إلى مجموعتك.',
        {
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        }
      );
      return;
    }

    // 2. بحث يوتيوب وإرسال MP3 مباشر
    if (text.startsWith('بحث ')) {
      const query = text.substring(3).trim();
      if (!query) {
        await bot.sendMessage(chatId, '⚠️ الرجاء إدخال كلمة البحث بعد الأمر "بحث".');
        return;
      }

      // إرسال رسالة "جاري البحث..."
      const statusMsg = await bot.sendMessage(chatId, '🔍 جاري البحث عن الأغنية...');

      try {
        const videoInfo = await searchYouTube(query);
        if (!videoInfo) {
          await bot.editMessageText('😕 لم أتمكن من العثور على فيديو بهذا الاسم.', {
            chat_id: chatId,
            message_id: statusMsg.message_id
          });
          return;
        }

        // تحديث الرسالة: جاري التحميل والتحويل
        await bot.editMessageText(`✅ تم العثور على: *${videoInfo.title}*\n⏱ جاري تحميل الصوت وتحويله إلى MP3...`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        });

        // تحميل وتحويل الصوت
        const mp3Path = await downloadAudioAsMP3(videoInfo.videoId, videoInfo.title);

        // إرسال الملف الصوتي مع معلومات الفيديو كتعليق
        const caption = `🎵 *${videoInfo.title}*\n📺 ${videoInfo.channel}\n⏱ ${videoInfo.duration}\n👀 ${videoInfo.views}`;
        await bot.sendAudio(chatId, mp3Path, {
          title: videoInfo.title,
          performer: videoInfo.channel,
          caption: caption,
          parse_mode: 'Markdown'
        });

        // حذف الرسالة المؤقتة
        await bot.deleteMessage(chatId, statusMsg.message_id);

        // حذف الملف المؤقت بعد الإرسال
        fs.unlink(mp3Path, (err) => {
          if (err) console.error('خطأ في حذف الملف المؤقت:', err);
        });

      } catch (error) {
        console.error('خطأ في معالجة طلب MP3:', error);
        await bot.editMessageText('❌ حدث خطأ أثناء معالجة الطلب. يرجى المحاولة لاحقاً.', {
          chat_id: chatId,
          message_id: statusMsg.message_id
        });
      }
      return;
    }

    // 3. بحث صور
    if (text.startsWith('صورة ')) {
      const query = text.substring(3).trim();
      if (!query) {
        await bot.sendMessage(chatId, '⚠️ الرجاء إدخال كلمة البحث بعد الأمر "صورة".');
        return;
      }

      const imageUrls = getRandomImages(query);
      const mediaGroup = imageUrls.map((url, index) => ({
        type: 'photo',
        media: url,
        caption: index === 2 ? `🖼 صور عن: ${query}` : undefined
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
          // يمكن إضافة رسالة تحذيرية للمخالف (اختياري)
          // await bot.sendMessage(chatId, `🚫 @${msg.from.username} ممنوع استخدام كلمات نابية!`);
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
  if (msg.reply_to_message && text && text.startsWith('همس ')) {
    const whisperText = text.substring(4).trim();
    const targetUser = msg.reply_to_message.from;
    const sender = msg.from;

    if (!whisperText) {
      await bot.sendMessage(msg.chat.id, '⚠️ الرجاء كتابة رسالة بعد الأمر "همس".');
      return;
    }

    try {
      await bot.sendMessage(targetUser.id, `📩 *رسالة سرية من ${sender.first_name}*:\n${whisperText}`, { parse_mode: 'Markdown' });
      await bot.sendMessage(msg.chat.id, '✅ تم إرسال الهمسة بنجاح.', { reply_to_message_id: msg.message_id });
    } catch (err) {
      console.error('فشل إرسال الهمسة:', err.message);
      await bot.sendMessage(msg.chat.id, '❌ فشل إرسال الهمسة. ربما قام المستخدم بحظر البوت أو لم يبدأ المحادثة معه.', { reply_to_message_id: msg.message_id });
    }
  }
});

// بدء تشغيل الخادم
app.listen(PORT, () => {
  console.log(`🌐 الخادم الوهمي يعمل على المنفذ ${PORT}`);
  console.log('🤖 البوت يعمل بواسطة polling...');
});
