/**
 * 🤖 Telegram Pro Bot
 * Professional bot for Render.com
 * Features: YouTube search, Images, Whispers, Anti-spam
 */

require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const yts = require('yt-search');
const axios = require('axios');
const http = require('http');

// ==================== CONFIG ====================
const CONFIG = {
    TOKEN: process.env.BOT_TOKEN,
    PORT: process.env.PORT || 3000,
    BAD_WORDS: ['سب', 'شتم', 'قذف', 'خنيث', 'منيوك', 'عاهر', 'كلب', 'حيوان'],
    MAX_RESULTS: 5,
    ADMIN_ID: null // ضع معرفك هنا للتحكم
};

// ==================== VALIDATION ====================
if (!CONFIG.TOKEN) {
    console.error('❌ BOT_TOKEN is required!');
    console.error('Add it in Render Environment Variables');
    process.exit(1);
}

// ==================== EXPRESS APP ====================
const app = express();
app.use(express.json());

// ==================== BOT SETUP ====================
const bot = new TelegramBot(CONFIG.TOKEN, { 
    webHook: {
        port: CONFIG.PORT,
        autoOpen: false // نفتحه يدوياً
    }
});

// ==================== DATABASE (MEMORY) ====================
const db = {
    whispers: new Map(),
    stats: { searches: 0, images: 0, whispers: 0 },
    groups: new Set()
};

// ==================== UTILITIES ====================
const utils = {
    formatNumber: (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    },

    escapeMarkdown: (text) => {
        return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
    },

    log: (action, user, details = '') => {
        const time = new Date().toLocaleString('ar-SA');
        console.log(`[${time}] ${action} | User: ${user} ${details}`);
    },

    containsBadWord: (text) => {
        if (!text) return false;
        const lower = text.toLowerCase();
        return CONFIG.BAD_WORDS.some(word => lower.includes(word));
    }
};

// ==================== KEYBOARDS ====================
const keyboards = {
    main: {
        inline_keyboard: [
            [{ text: '🔍 بحث يوتيوب', callback_data: 'search_yt' }],
            [{ text: '📷 بحث صور', callback_data: 'search_img' }],
            [{ text: '💬 همسة سرية', callback_data: 'whisper' }],
            [{ text: '➕ ضفني لقروبك', url: `https://t.me/${bot.options.username}?startgroup=true` }]
        ]
    },

    help: {
        inline_keyboard: [
            [{ text: '📖 شرح الاستخدام', callback_data: 'tutorial' }],
            [{ text: '👨‍💻 الدعم الفني', url: 'https://t.me/your_support' }]
        ]
    },

    backToMain: {
        inline_keyboard: [
            [{ text: '↩️ رجوع للرئيسية', callback_data: 'main_menu' }]
        ]
    }
};

// ==================== MESSAGES ====================
const messages = {
    welcome: (name) => `
🎉 *أهلاً وسهلاً ${utils.escapeMarkdown(name)}!*

🤖 أنا بوت احترافي متعدد المهام:

┌─ 🎵 *بحث يوتيوب* ─┐
│ اكتب: بحث [اسم الأغنية] │
│ مثال: بحث عمرو دياب    │
└────────────────────┘

┌─ 📷 *بحث صور* ─┐
│ اكتب: صورة [الاسم]   │
│ مثال: صورة طبيعة     │
└────────────────────┘

┌─ 💬 *همسة سرية* ─┐
│ 1. رد على رسالة شخص    │
│ 2. اكتب: همس [رسالتك]   │
└────────────────────┘

🛡️ *الحماية التلقائية:*
• حذف الشتائم فوراً
• حماية من السبام

⬇️ اختر من القائمة:
    `,

    help: `
📚 *طريقة الاستخدام:*

*1️⃣ البحث في يوتيوب:*
\`\`\`
بحث [اسم الأغنية أو الفيديو]
\`\`\`
مثال: \`بحث ماهر زين\`

*2️⃣ البحث عن صور:*
\`\`\`
صورة [ما تريد البحث عنه]
\`\`\`
مثال: \`صورة قطط\`

*3️⃣ الهمسات السرية:*
• رد على رسالة الشخص
• اكتب: \`همس [رسالتك]\`
• سأرسلها سراً له فقط!

⚠️ *ملاحظة:* البوت يحذف الشتائم تلقائياً في القروبات.
    `,

    stats: () => `
📊 *إحصائيات البوت:*
🔍 عمليات البحث: ${db.stats.searches}
📷 الصور المرسلة: ${db.stats.images}
💬 الهمسات: ${db.stats.whispers}
👥 المجموعات النشطة: ${db.groups.size}
    `
};

// ==================== HANDLERS ====================

// /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name;
    
    utils.log('START', msg.from.username || name);
    
    await bot.sendMessage(chatId, messages.welcome(name), {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboards.main
    });
});

// /help command
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId, messages.help, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboards.help
    });
});

// /stats command (للمشرف)
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (CONFIG.ADMIN_ID && msg.from.id.toString() !== CONFIG.ADMIN_ID) {
        return bot.sendMessage(chatId, '⛔ هذا الأمر للمشرف فقط');
    }
    
    await bot.sendMessage(chatId, messages.stats(), {
        parse_mode: 'MarkdownV2'
    });
});

// ==================== YOUTUBE SEARCH ====================
bot.onText(/بحث\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    if (!query) {
        return bot.sendMessage(chatId, '⚠️ اكتب اسم الأغنية بعد كلمة "بحث"');
    }
    
    utils.log('YOUTUBE_SEARCH', msg.from.username, query);
    
    const loading = await bot.sendMessage(chatId, '🔍 *جاري البحث...*', { parse_mode: 'Markdown' });
    
    try {
        const search = await yts(query);
        const videos = search.videos.slice(0, CONFIG.MAX_RESULTS);
        
        await bot.deleteMessage(chatId, loading.message_id);
        
        if (videos.length === 0) {
            return bot.sendMessage(chatId, '❌ لم أجد نتائج للبحث. جرب كلمات أخرى.');
        }
        
        db.stats.searches++;
        
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            const caption = `
${i === 0 ? '🥇' : '🎵'} *${utils.escapeMarkdown(video.title)}*

👤 *القناة:* ${utils.escapeMarkdown(video.author.name)}
⏱️ *المدة:* ${video.timestamp}
👁️ *المشاهدات:* ${utils.formatNumber(video.views)}
📅 *النشر:* ${video.ago}

[▶️ اضغط للمشاهدة](${video.url})
            `;
            
            await bot.sendPhoto(chatId, video.thumbnail, {
                caption: caption,
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '▶️ مشاهدة', url: video.url },
                        { text: '🔍 بحث آخر', switch_inline_query_current_chat: 'بحث ' }
                    ]]
                }
            });
        }
        
    } catch (error) {
        console.error('YouTube Error:', error);
        bot.editMessageText('❌ حدث خطأ في البحث. حاول مرة أخرى.', {
            chat_id: chatId,
            message_id: loading.message_id
        });
    }
});

// ==================== IMAGE SEARCH ====================
bot.onText(/صور[ةه]?\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    if (!query) {
        return bot.sendMessage(chatId, '⚠️ اكتب ما تريد البحث عنه بعد كلمة "صورة"');
    }
    
    utils.log('IMAGE_SEARCH', msg.from.username, query);
    
    const loading = await bot.sendMessage(chatId, '📷 *جاري البحث عن الصور...*', { parse_mode: 'Markdown' });
    
    try {
        // استخدام Lorem Picsum (مجاني وموثوق)
        const images = [];
        for (let i = 0; i < 4; i++) {
            images.push(`https://picsum.photos/seed/${encodeURIComponent(query)}${i}/500/400`);
        }
        
        await bot.deleteMessage(chatId, loading.message_id);
        db.stats.images++;
        
        // إرسال الصور كـ album
        const mediaGroup = images.map((url, index) => ({
            type: 'photo',
            media: url,
            caption: index === 0 ? `📷 نتائج البحث عن: "${query}"` : ''
        }));
        
        await bot.sendMediaGroup(chatId, mediaGroup);
        
    } catch (error) {
        console.error('Image Error:', error);
        
        // محاولة فردية
        try {
            for (let i = 0; i < 3; i++) {
                await bot.sendPhoto(chatId, `https://picsum.photos/500/400?random=${Date.now() + i}`, {
                    caption: i === 0 ? `📷 ${query}` : ''
                });
            }
        } catch (e) {
            bot.sendMessage(chatId, '❌ حدث خطأ في جلب الصور');
        }
    }
});

// ==================== WHISPERS ====================
bot.onText(/همس\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1].trim();
    
    if (!text) {
        return bot.sendMessage(chatId, '⚠️ اكتب رسالتك بعد كلمة "همس"');
    }
    
    if (!msg.reply_to_message) {
        return bot.sendMessage(chatId, '⚠️ عليك *الرد على رسالة* الشخص الذي تريد إرسال الهمسة له', {
            parse_mode: 'Markdown'
        });
    }
    
    const target = msg.reply_to_message.from;
    const sender = msg.from;
    
    // لا ترسل لنفسك
    if (target.id === sender.id) {
        return bot.sendMessage(chatId, '😄 لا يمكنك إرسال همسة لنفسك!');
    }
    
    utils.log('WHISPER', sender.username, `to ${target.username}`);
    
    try {
        // محاولة الإرسال مباشرة
        await bot.sendMessage(target.id, `
🤫 *همسة سرية من ${utils.escapeMarkdown(sender.first_name)}*

💬 ${utils.escapeMarkdown(text)}

📍 _من مجموعة:_ ${utils.escapeMarkdown(msg.chat.title || 'خاص')}
        `, { 
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [[
                    { text: '↩️ رد بالهمسة', url: `https://t.me/${bot.options.username}?start=whisper_${sender.id}` }
                ]]
            }
        });
        
        // تأكيد للمرسل
        await bot.sendMessage(chatId, `
✅ *تم إرسال الهمسة بنجاح!*

👤 إلى: ${utils.escapeMarkdown(target.first_name)}
🔒 تم الإرسال سراً في الخاص
        `, { parse_mode: 'MarkdownV2' });
        
        db.stats.whispers++;
        
    } catch (error) {
        // إذا لم يبدأ المستخدم محادثة مع البوت
        console.log('Cannot send PM, using inline button');
        
        const whisperId = Date.now().toString();
        db.whispers.set(whisperId, {
            text: text,
            senderName: sender.first_name,
            senderId: sender.id,
            targetName: target.first_name,
            targetId: target.id,
            chatTitle: msg.chat.title,
            time: new Date()
        });
        
        // تنظيف قديم
        if (db.whispers.size > 1000) {
            const firstKey = db.whispers.keys().next().value;
            db.whispers.delete(firstKey);
        }
        
        await bot.sendMessage(chatId, `
🤫 *همسة سرية لـ ${utils.escapeMarkdown(target.first_name)}*

💬 الرسالة مخفية!
👆 اضغط الزر أدناه لقراءتها (للمستلم فقط)
        `, {
            parse_mode: 'MarkdownV2',
            reply_to_message_id: msg.reply_to_message.message_id,
            reply_markup: {
                inline_keyboard: [[
                    { text: '📩 اضغط لقراءة الهمسة', callback_data: `read_whisper_${whisperId}` }
                ]]
            }
        });
    }
});

// معالجة قراءة الهمسة
bot.on('callback_query', async (query) => {
    const data = query.data;
    
    if (data.startsWith('read_whisper_')) {
        const id = data.replace('read_whisper_', '');
        const whisper = db.whispers.get(id);
        
        if (!whisper) {
            return bot.answerCallbackQuery(query.id, {
                text: '❌ الهمسة منتهية الصلاحية أو تم قراءتها',
                show_alert: true
            });
        }
        
        // التحقق من أن الشخص المستلم هو نفسه
        if (query.from.id !== whisper.targetId) {
            return bot.answerCallbackQuery(query.id, {
                text: '⛔ هذه الهمسة ليست لك!',
                show_alert: true
            });
        }
        
        // إرسال الهمسة
        await bot.sendMessage(query.from.id, `
🤫 *همسة من ${utils.escapeMarkdown(whisper.senderName)}*

💬 ${utils.escapeMarkdown(whisper.text)}

📍 _من:_ ${utils.escapeMarkdown(whisper.chatTitle || 'خاص')}
🕐 _الوقت:_ ${whisper.time.toLocaleString('ar-SA')}
        `, { parse_mode: 'MarkdownV2' });
        
        // حذف من الذاكرة
        db.whispers.delete(id);
        
        bot.answerCallbackQuery(query.id, {
            text: '✅ تم إرسال الهمسة لك في الخاص',
            show_alert: true
        });
        
    } else if (data === 'main_menu') {
        await bot.editMessageText(messages.welcome(query.from.first_name), {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'MarkdownV2',
            reply_markup: keyboards.main
        });
        bot.answerCallbackQuery(query.id);
        
    } else if (data === 'tutorial') {
        await bot.editMessageText(messages.help, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: 'MarkdownV2',
            reply_markup: keyboards.backToMain
        });
        bot.answerCallbackQuery(query.id);
        
    } else {
        bot.answerCallbackQuery(query.id, { text: 'قريباً...' });
    }
});

// ==================== ANTI-SPAM / BAD WORDS ====================
bot.on('message', async (msg) => {
    // تسجيل المجموعات
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        db.groups.add(msg.chat.id);
    }
    
    // التحقق من الشتائم
    if (msg.text && utils.containsBadWord(msg.text)) {
        if (msg.chat.type === 'private') return; // لا نحذف في الخاص
        
        try {
            await bot.deleteMessage(msg.chat.id, msg.message_id);
            
            const warning = await bot.sendMessage(msg.chat.id, `
⚠️ @${msg.from.username || msg.from.first_name}

🚫 *تم حذف رسالتك* لاحتوائها على كلمات غير لائقة!
🛡️ هذا القروب محمي من الشتائم.
            `, { parse_mode: 'Markdown' });
            
            // حذف التحذير بعد 5 ثواني
            setTimeout(() => {
                bot.deleteMessage(msg.chat.id, warning.message_id).catch(() => {});
            }, 5000);
            
            utils.log('BAD_WORD_DELETED', msg.from.username, msg.text.substring(0, 20));
            
        } catch (error) {
            console.error('Delete error:', error.message);
        }
    }
    
    // ترحيب عند إضافة البوت
    if (msg.new_chat_members) {
        const me = await bot.getMe();
        const added = msg.new_chat_members.find(m => m.id === me.id);
        
        if (added) {
            db.groups.add(msg.chat.id);
            
            await bot.sendMessage(msg.chat.id, `
🎉 *شكراً لإضافتي للقروب!*

📌 *الأوامر المتاحة:*
• \`بحث [اسم]\` - البحث في يوتيوب
• \`صورة [اسم]\` - البحث عن صور
• \`همس [نص]\` - رد على شخص + همسة

🛡️ *أنا أحذف الشتائم تلقائياً!*

اكتب /help للمساعدة
            `, { parse_mode: 'Markdown' });
            
            utils.log('ADDED_TO_GROUP', msg.chat.title);
        }
    }
});

// ==================== WEBHOOK SETUP ====================
const WEBHOOK_PATH = `/bot${CONFIG.TOKEN}`;

app.post(WEBHOOK_PATH, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: '✅ Bot is running',
        uptime: process.uptime(),
        stats: {
            searches: db.stats.searches,
            images: db.stats.images,
            whispers: db.stats.whispers,
            groups: db.groups.size
        }
    });
});

// Info page
app.get('/info', (req, res) => {
    res.send(`
        <html dir="rtl">
        <head><title>Telegram Pro Bot</title>
        <style>
            body { font-family: Arial; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; padding: 50px; }
            .box { background: rgba(255,255,255,0.1); padding: 30px; border-radius: 20px; max-width: 600px; margin: 0 auto; }
            h1 { font-size: 3em; }
            .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
            .stat { background: rgba(255,255,255,0.2); padding: 20px; border-radius: 10px; }
            .stat-number { font-size: 2em; font-weight: bold; }
        </style>
        </head>
        <body>
            <div class="box">
                <h1>🤖 Telegram Pro Bot</h1>
                <p>بوت احترافي للبحث والحماية</p>
                <div class="stats">
                    <div class="stat"><div class="stat-number">${db.stats.searches}</div><div>عمليات البحث</div></div>
                    <div class="stat"><div class="stat-number">${db.stats.images}</div><div>الصور</div></div>
                    <div class="stat"><div class="stat-number">${db.stats.whispers}</div><div>الهمسات</div></div>
                    <div class="stat"><div class="stat-number">${db.groups.size}</div><div>المجموعات</div></div>
                </div>
                <p>الحالة: ✅ يعمل بنجاح</p>
            </div>
        </body>
        </html>
    `);
});

// ==================== START SERVER ====================
const server = http.createServer(app);

server.listen(CONFIG.PORT, async () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║     🤖 Telegram Pro Bot v2.0          ║
    ║                                         ║
    ║  ✅ Server running on port ${CONFIG.PORT}      ║
    ╚═══════════════════════════════════════╝
    `);
    
    // تعيين Webhook
    const webhookUrl = process.env.RENDER_EXTERNAL_URL || `https://your-app.onrender.com`;
    const fullWebhookUrl = `${webhookUrl}${WEBHOOK_PATH}`;
    
    try {
        await bot.setWebHook(fullWebhookUrl);
        console.log(`🌐 Webhook set: ${fullWebhookUrl}`);
        console.log(`🤖 Bot username: @${(await bot.getMe()).username}`);
    } catch (error) {
        console.error('❌ Webhook error:', error.message);
    }
});

// معالجة الأخطاء
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message);
});

process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received, shutting down gracefully');
    server.close(() => {
        bot.stopPolling();
        process.exit(0);
    });
});
