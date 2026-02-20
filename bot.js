/**
 * 🤖 Telegram Music Bot v3.0
 * تحميل الأغاني MP3 من يوتيوب
 */

require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const yts = require('yt-search');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==================== CONFIG ====================
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error('❌ BOT_TOKEN مطلوب!');
    process.exit(1);
}

// ==================== SETUP ====================
const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN);

// مجلد التحميلات
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// ==================== DATA ====================
const db = {
    downloads: new Map(),
    stats: { searches: 0, downloads: 0 },
    activeDownloads: new Set()
};

// ==================== UTILS ====================
const escapeHtml = (text) => {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
};

const BAD_WORDS = ['سب', 'شتم', 'قذف', 'خنيث', 'منيوك', 'عاهر', 'كلب', 'حيوان', 'نيك', 'احا', 'عرص', 'خول'];

// تنظيف الملفات القديمة
const cleanOldFiles = () => {
    fs.readdir(DOWNLOADS_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(DOWNLOADS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                const age = Date.now() - stats.mtime.getTime();
                if (age > 10 * 60 * 1000) { // 10 دقائق
                    fs.unlink(filePath, () => {});
                }
            });
        });
    });
};

setInterval(cleanOldFiles, 5 * 60 * 1000); // كل 5 دقائق

// ==================== DOWNLOAD FUNCTION ====================
const downloadMP3 = async (videoUrl, videoId, title) => {
    return new Promise((resolve, reject) => {
        if (db.activeDownloads.has(videoId)) {
            return reject('جاري التحميل بالفعل');
        }

        db.activeDownloads.add(videoId);
        
        const outputFile = path.join(DOWNLOADS_DIR, `${videoId}.mp3`);
        
        // التحقق من وجود الملف
        if (fs.existsSync(outputFile)) {
            db.activeDownloads.delete(videoId);
            return resolve(outputFile);
        }

        const stream = ytdl(videoUrl, { 
            quality: 'highestaudio',
            filter: 'audioonly'
        });

        ffmpeg(stream)
            .audioBitrate(128)
            .format('mp3')
            .on('end', () => {
                db.activeDownloads.delete(videoId);
                resolve(outputFile);
            })
            .on('error', (err) => {
                db.activeDownloads.delete(videoId);
                fs.unlink(outputFile, () => {});
                reject(err.message);
            })
            .save(outputFile);
    });
};

// ==================== HANDLERS ====================

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const name = escapeHtml(msg.from.first_name);
    const me = await bot.getMe();
    
    await bot.sendMessage(chatId, `
<b>🎵 بوت الأغاني MP3</b>

أهلاً ${name}!

🎧 <b>كيفية الاستخدام:</b>
اكتب: <code>بحث [اسم الأغنية]</code>
مثال: <code>بحث عمرو دياب</code>

📥 سأرسل لك:
• معاينة الأغنية
• زر تحميل MP3

⚡ سريع ومجاني 100%!
`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ ضفني لقروبك', url: `https://t.me/${me.username}?startgroup=true` }]
            ]
        }
    });
});

// بحث يوتيوب + تحميل MP3
bot.onText(/بحث\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    if (!query) {
        return bot.sendMessage(chatId, '⚠️ اكتب: <code>بحث [اسم الأغنية]</code>', { parse_mode: 'HTML' });
    }
    
    const loading = await bot.sendMessage(chatId, '🔍 <b>جاري البحث...</b>', { parse_mode: 'HTML' });
    
    try {
        const search = await yts(query);
        const video = search.videos[0]; // أفضل نتيجة
        
        if (!video) {
            await bot.deleteMessage(chatId, loading.message_id);
            return bot.sendMessage(chatId, '❌ لم أجد نتائج للبحث');
        }
        
        db.stats.searches++;
        
        // حذف رسالة التحميل
        await bot.deleteMessage(chatId, loading.message_id);
        
        // إرسال معاينة مع زر التحميل
        const previewMsg = await bot.sendMessage(chatId, `
🎵 <b>${escapeHtml(video.title)}</b>

👤 ${escapeHtml(video.author.name)}
⏱️ ${video.timestamp} | 👁️ ${formatNumber(video.views)}

📥 <b>اضغط الزر أدناه لتحميل MP3</b>
⚠️ قد يستغرق التحميل دقيقة حسب حجم الملف
        `, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📥 تحميل MP3', callback_data: `dl_${video.videoId}` }
                ], [
                    { text: '▶️ مشاهدة على يوتيوب', url: video.url }
                ]]
            }
        });
        
        // تخزين معلومات الفيديو
        db.downloads.set(video.videoId, {
            url: video.url,
            title: video.title,
            chatId: chatId,
            messageId: previewMsg.message_id
        });
        
    } catch (e) {
        console.error('Search error:', e);
        bot.editMessageText('❌ خطأ في البحث', {
            chat_id: chatId,
            message_id: loading.message_id
        });
    }
});

// معالجة زر التحميل
bot.on('callback_query', async (query) => {
    const data = query.data;
    
    if (!data.startsWith('dl_')) return;
    
    const videoId = data.replace('dl_', '');
    const videoInfo = db.downloads.get(videoId);
    
    if (!videoInfo) {
        return bot.answerCallbackQuery(query.id, {
            text: '❌ انتهت صلاحية الرابط، ابحث مرة أخرى',
            show_alert: true
        });
    }
    
    const chatId = query.message.chat.id;
    
    // التحقق من حجم الملف (Telegram يدعم حتى 50MB للبوتات)
    bot.answerCallbackQuery(query.id, {
        text: '⏳ جاري التحضير...',
        show_alert: false
    });
    
    const loadingMsg = await bot.sendMessage(chatId, '⏳ <b>جاري تحميل الأغنية...</b>\nقد تستغرق 30-60 ثانية', { parse_mode: 'HTML' });
    
    try {
        const mp3Path = await downloadMP3(videoInfo.url, videoId, videoInfo.title);
        
        // التحقق من حجم الملف
        const stats = fs.statSync(mp3Path);
        const fileSizeMB = stats.size / (1024 * 1024);
        
        if (fileSizeMB > 50) {
            await bot.deleteMessage(chatId, loadingMsg.message_id);
            return bot.sendMessage(chatId, `❌ حجم الملف كبير جداً (${fileSizeMB.toFixed(1)} MB)\nالحد الأقصى: 50 MB`, { parse_mode: 'HTML' });
        }
        
        // إرسال MP3
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        
        await bot.sendAudio(chatId, mp3Path, {
            title: videoInfo.title,
            performer: 'YouTube',
            caption: `🎵 <b>${escapeHtml(videoInfo.title)}</b>\n\n✅ تم التحميل بنجاح!`,
            parse_mode: 'HTML'
        });
        
        db.stats.downloads++;
        
        // حذف الملف بعد الإرسال
        setTimeout(() => {
            fs.unlink(mp3Path, () => {});
        }, 5000);
        
    } catch (error) {
        console.error('Download error:', error);
        await bot.deleteMessage(chatId, loadingMsg.message_id);
        await bot.sendMessage(chatId, `❌ خطأ في التحميل: ${error.message || 'حاول مرة أخرى'}`, { parse_mode: 'HTML' });
    }
});

// همسات (اختياري)
bot.onText(/همس\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1].trim();
    
    if (!text || !msg.reply_to_message) {
        return bot.sendMessage(chatId, '⚠️ رد على رسالة + اكتب: همس [رسالتك]');
    }
    
    const target = msg.reply_to_message.from;
    const sender = msg.from;
    
    if (target.id === sender.id) return;
    
    try {
        await bot.sendMessage(target.id, `<b>🤫 همسة من ${escapeHtml(sender.first_name)}</b>\n\n${escapeHtml(text)}`, { parse_mode: 'HTML' });
        await bot.sendMessage(chatId, `✅ تم الإرسال`, { parse_mode: 'HTML' });
    } catch (e) {
        await bot.sendMessage(chatId, '❌ الشخص لم يبدأ محادثة مع البوت', { parse_mode: 'HTML' });
    }
});

// حماية من الشتم
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') db.downloads.set('groups', (db.downloads.get('groups') || 0) + 1);
    
    if (msg.text && BAD_WORDS.some(w => msg.text.toLowerCase().includes(w))) {
        if (msg.chat.type === 'private') return;
        
        try {
            await bot.deleteMessage(msg.chat.id, msg.message_id);
            const w = await bot.sendMessage(msg.chat.id, `⚠️ <b>${escapeHtml(msg.from.first_name)}</b>\n🚫 رسالة محذوفة!`, { parse_mode: 'HTML' });
            setTimeout(() => bot.deleteMessage(msg.chat.id, w.message_id).catch(() => {}), 5000);
        } catch (e) {}
    }
    
    // ترحيب
    if (msg.new_chat_members) {
        const me = await bot.getMe();
        if (msg.new_chat_members.find(m => m.id === me.id)) {
            await bot.sendMessage(msg.chat.id, '🎉 <b>بوت الأغاني جاهز!</b>\n\nاكتب: بحث [اسم الأغنية]\nواحصل على MP3', { parse_mode: 'HTML' });
        }
    }
});

// ==================== SERVER ====================
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.json({
        status: '✅ Music Bot Running',
        stats: db.stats,
        downloads: db.downloads.size
    });
});

const server = http.createServer(app);

server.listen(PORT, async () => {
    console.log(`✅ Server on port ${PORT}`);
    
    const webhookUrl = process.env.RENDER_EXTERNAL_URL;
    
    if (!webhookUrl) {
        console.log('⚠️ Using polling mode');
        return bot.startPolling();
    }
    
    try {
        await bot.deleteWebHook();
        await bot.setWebHook(`${webhookUrl}/bot${TOKEN}`);
        const me = await bot.getMe();
        console.log(`🎵 Music Bot: @${me.username}`);
    } catch (e) {
        console.error('Webhook error:', e.message);
        bot.startPolling();
    }
});
