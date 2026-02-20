/**
 * 🤖 Telegram Pro Bot v2.2 (Auto Webhook)
 * يعمل تلقائياً على Render بدون إعداد يدوي
 */

require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const yts = require('yt-search');
const http = require('http');

// ==================== CONFIG ====================
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error('❌ BOT_TOKEN مطلوب!');
    process.exit(1);
}

// ==================== APP ====================
const app = express();
app.use(express.json());

// ==================== BOT ====================
// نترك Webhook فارغ أولاً ونعينه لاحقاً
const bot = new TelegramBot(TOKEN);

// ==================== DATA ====================
const db = {
    whispers: new Map(),
    stats: { searches: 0, images: 0, whispers: 0 },
    groups: new Set()
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

// ==================== HANDLERS ====================

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const name = escapeHtml(msg.from.first_name);
    
    const me = await bot.getMe();
    
    await bot.sendMessage(chatId, `
<b>🎉 أهلاً ${name}!</b>

🤖 بوت احترافي للبحث:

🎵 <b>بحث يوتيوب</b>
اكتب: بحث [اسم الأغنية]

📷 <b>بحث صور</b>
اكتب: صورة [الاسم]

💬 <b>همسة سرية</b>
رد على شخص + اكتب: همس [رسالتك]

🛡️ أحذف الشتائم تلقائياً!
`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ ضفني لقروبك', url: `https://t.me/${me.username}?startgroup=true` }]
            ]
        }
    });
});

// بحث يوتيوب
bot.onText(/بحث\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    if (!query) return bot.sendMessage(chatId, '⚠️ اكتب: بحث [اسم الأغنية]');
    
    const loading = await bot.sendMessage(chatId, '🔍 <b>جاري البحث...</b>', { parse_mode: 'HTML' });
    
    try {
        const search = await yts(query);
        const videos = search.videos.slice(0, 5);
        
        await bot.deleteMessage(chatId, loading.message_id);
        
        if (videos.length === 0) {
            return bot.sendMessage(chatId, '❌ لم أجد نتائج');
        }
        
        db.stats.searches++;
        
        for (const video of videos) {
            await bot.sendPhoto(chatId, video.thumbnail, {
                caption: `
<b>${escapeHtml(video.title)}</b>

👤 ${escapeHtml(video.author.name)}
⏱️ ${video.timestamp} | 👁️ ${formatNumber(video.views)}

<a href="${video.url}">▶️ مشاهدة</a>
                `,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '▶️ مشاهدة', url: video.url }]]
                }
            });
        }
    } catch (e) {
        bot.editMessageText('❌ خطأ في البحث', { chat_id: chatId, message_id: loading.message_id });
    }
});

// بحث صور
bot.onText(/صور[ةه]?\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    if (!query) return bot.sendMessage(chatId, '⚠️ اكتب: صورة [الاسم]');
    
    const loading = await bot.sendMessage(chatId, '📷 <b>جاري البحث...</b>', { parse_mode: 'HTML' });
    
    try {
        const images = [];
        for (let i = 0; i < 4; i++) {
            images.push({
                type: 'photo',
                media: `https://picsum.photos/seed/${encodeURIComponent(query)}${i}/500/400`,
                caption: i === 0 ? `📷 ${escapeHtml(query)}` : ''
            });
        }
        
        await bot.deleteMessage(chatId, loading.message_id);
        db.stats.images++;
        
        await bot.sendMediaGroup(chatId, images);
    } catch (e) {
        bot.sendMessage(chatId, '❌ خطأ في الصور');
    }
});

// همسات
bot.onText(/همس\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1].trim();
    
    if (!text) return bot.sendMessage(chatId, '⚠️ اكتب: همس [رسالتك]');
    if (!msg.reply_to_message) return bot.sendMessage(chatId, '⚠️ رد على رسالة الشخص أولاً!');
    
    const target = msg.reply_to_message.from;
    const sender = msg.from;
    
    if (target.id === sender.id) return bot.sendMessage(chatId, '😄 لا ترسل لنفسك!');
    
    try {
        await bot.sendMessage(target.id, `
<b>🤫 همسة من ${escapeHtml(sender.first_name)}</b>

💬 ${escapeHtml(text)}
        `, { parse_mode: 'HTML' });
        
        await bot.sendMessage(chatId, `✅ تم الإرسال إلى ${escapeHtml(target.first_name)}`, { parse_mode: 'HTML' });
        db.stats.whispers++;
        
    } catch (e) {
        const id = Date.now().toString();
        db.whispers.set(id, { text, senderName: sender.first_name, targetId: target.id });
        
        await bot.sendMessage(chatId, `
🤫 همسة لـ ${escapeHtml(target.first_name)}
👇 اضغط للقراءة
        `, {
            reply_to_message_id: msg.reply_to_message.message_id,
            reply_markup: {
                inline_keyboard: [[{ text: '📩 اقرأ الهمسة', callback_data: `w_${id}` }]]
            }
        });
    }
});

// أزرار الهمسة
bot.on('callback_query', async (query) => {
    if (!query.data.startsWith('w_')) return;
    
    const id = query.data.replace('w_', '');
    const w = db.whispers.get(id);
    
    if (!w) return bot.answerCallbackQuery(query.id, { text: '❌ منتهية', show_alert: true });
    if (query.from.id !== w.targetId) return bot.answerCallbackQuery(query.id, { text: '⛔ ليست لك!', show_alert: true });
    
    await bot.sendMessage(query.from.id, `<b>🤫 من ${escapeHtml(w.senderName)}</b>\n\n${escapeHtml(w.text)}`, { parse_mode: 'HTML' });
    db.whispers.delete(id);
    
    bot.answerCallbackQuery(query.id, { text: '✅ تم الإرسال', show_alert: true });
});

// حماية من الشتم
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') db.groups.add(msg.chat.id);
    
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
            db.groups.add(msg.chat.id);
            await bot.sendMessage(msg.chat.id, '🎉 شكراً لإضافتي!\n\nبحث [اسم] - يوتيوب\nصورة [اسم] - صور\nهمس [نص] - رد + همسة', { parse_mode: 'HTML' });
        }
    }
});

// ==================== SERVER ====================

// Webhook endpoint
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: '✅ Bot Running', stats: db.stats });
});

const server = http.createServer(app);

server.listen(PORT, async () => {
    console.log(`✅ Server on port ${PORT}`);
    
    // ✅ الحل: نحصل على الرابط تلقائياً من Render
    // Render يعطينا RENDER_EXTERNAL_URL تلقائياً
    let webhookUrl = process.env.RENDER_EXTERNAL_URL;
    
    // لو مش موجود (تجربة محلية)، نستخدم polling
    if (!webhookUrl) {
        console.log('⚠️ No RENDER_EXTERNAL_URL, using polling...');
        bot.startPolling();
        return;
    }
    
    // ✅ تعيين Webhook تلقائياً
    const fullUrl = `${webhookUrl}/bot${TOKEN}`;
    
    try {
        // حذف webhook القديم أولاً
        await bot.deleteWebHook();
        
        // تعيين الجديد
        await bot.setWebHook(fullUrl);
        
        const me = await bot.getMe();
        console.log(`🤖 Bot: @${me.username}`);
        console.log(`🌐 Webhook: ${fullUrl}`);
        
    } catch (e) {
        console.error('❌ Webhook error:', e.message);
        console.log('🔄 Switching to polling...');
        bot.startPolling();
    }
});
