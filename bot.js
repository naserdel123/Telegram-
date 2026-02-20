/**
 * 🤖 Telegram Search Bot v4.0
 * بحث ويب عام + يوتيوب + صور + أخبار
 */

require('dotenv').config();

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const SERPAPI_KEY = process.env.SERPAPI_KEY; // اختياري لنتائج أفضل

if (!TOKEN) {
    console.error('❌ BOT_TOKEN مطلوب!');
    process.exit(1);
}

const app = express();
app.use(express.json());
const bot = new TelegramBot(TOKEN);

// ==================== DATA ====================
const db = { stats: { searches: 0 }, cache: new Map() };

// ==================== UTILS ====================
const escapeHtml = (text) => {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// ==================== SEARCH ENGINES ====================

// 1. بحث ويب عام (DuckDuckGo)
const searchWeb = async (query) => {
    try {
        // محاولة 1: استخدام DuckDuckGo
        const response = await axios.get(`https://html.duckduckgo.com/html/`, {
            params: { q: query, kl: 'ar-sa' },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.result').each((i, elem) => {
            if (i >= 5) return;
            const title = $(elem).find('.result__title').text().trim();
            const url = $(elem).find('.result__url').text().trim();
            const snippet = $(elem).find('.result__snippet').text().trim();
            
            if (title && url) {
                results.push({ title, url: `https://${url}`, snippet });
            }
        });
        
        return results;
    } catch (e) {
        console.log('DuckDuckGo failed:', e.message);
        return [];
    }
};

// 2. بحث يوتيوب (بديل: استخدام Invidious API)
const searchYouTube = async (query) => {
    try {
        // Invidious instances (بديل يوتيوب مفتوح)
        const instances = [
            'https://vid.puffyan.us',
            'https://y.com.sb',
            'https://invidious.snopyta.org'
        ];
        
        for (const instance of instances) {
            try {
                const response = await axios.get(`${instance}/api/v1/search`, {
                    params: { q: query, type: 'video' },
                    timeout: 5000
                });
                
                return response.data.slice(0, 5).map(v => ({
                    title: v.title,
                    author: v.author,
                    videoId: v.videoId,
                    url: `https://youtube.com/watch?v=${v.videoId}`,
                    thumbnail: v.videoThumbnails?.[0]?.url || '',
                    lengthSeconds: v.lengthSeconds,
                    viewCount: v.viewCount
                }));
            } catch (e) {
                continue; // جرب النسخة التالية
            }
        }
        
        return [];
    } catch (e) {
        console.log('YouTube search failed:', e.message);
        return [];
    }
};

// 3. بحث صور (Unsplash + Picsum)
const searchImages = async (query) => {
    try {
        // محاولة Unsplash أولاً
        if (process.env.UNSPLASH_KEY) {
            const response = await axios.get('https://api.unsplash.com/search/photos', {
                params: { query, per_page: 5 },
                headers: { Authorization: `Client-ID ${process.env.UNSPLASH_KEY}` }
            });
            
            return response.data.results.map(img => ({
                url: img.urls.regular,
                thumb: img.urls.small,
                source: 'Unsplash',
                author: img.user.name
            }));
        }
    } catch (e) {
        console.log('Unsplash failed, using fallback');
    }
    
    // Fallback: Picsum
    return Array(4).fill(0).map((_, i) => ({
        url: `https://picsum.photos/seed/${encodeURIComponent(query)}${i}/600/400`,
        thumb: `https://picsum.photos/seed/${encodeURIComponent(query)}${i}/200/150`,
        source: 'Random',
        author: 'Picsum'
    }));
};

// 4. بحث أخبار
const searchNews = async (query) => {
    try {
        // استخدام NewsAPI (مجاني 100 طلب/يوم)
        if (process.env.NEWSAPI_KEY) {
            const response = await axios.get('https://newsapi.org/v2/everything', {
                params: { q: query, language: 'ar', pageSize: 5, apiKey: process.env.NEWSAPI_KEY }
            });
            
            return response.data.articles.map(a => ({
                title: a.title,
                url: a.url,
                source: a.source.name,
                publishedAt: new Date(a.publishedAt).toLocaleDateString('ar-SA')
            }));
        }
    } catch (e) {
        console.log('NewsAPI failed');
    }
    return [];
};

// 5. بحث فيكتوريا (محاكاة ويكيبيديا)
const searchWiki = async (query) => {
    try {
        const response = await axios.get('https://ar.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(query), {
            timeout: 5000
        });
        
        if (response.data.extract) {
            return {
                title: response.data.title,
                extract: response.data.extract.substring(0, 1000),
                url: response.data.content_urls?.desktop?.page || `https://ar.wikipedia.org/wiki/${query}`
            };
        }
    } catch (e) {
        return null;
    }
};

// ==================== BOT COMMANDS ====================

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const name = escapeHtml(msg.from.first_name);
    const me = await bot.getMe();
    
    await bot.sendMessage(chatId, `
<b>🔍 بوت البحث الشامل</b>

أهلاً ${name}!

<b>الأوامر المتاحة:</b>

🌐 <code>بحث [كلمة]</code>
بحث ويب عام (Google بديل)

🎵 <code>يوتيوب [اسم]</code>
بحث فيديوهات يوتيوب

🖼️ <code>صورة [اسم]</code>
بحث صور عالية الجودة

📰 <code>خبر [موضوع]</code>
بحث أخبار عربية

📚 <code>ويكي [موضوع]</code>
بحث ويكيبيديا

⚡ سريع ومجاني!
`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ ضفني لقروبك', url: `https://t.me/${me.username}?startgroup=true` }]
            ]
        }
    });
});

// بحث ويب عام
bot.onText(/بحث\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    const loading = await bot.sendMessage(chatId, '🔍 <b>جاري البحث في الويب...</b>', { parse_mode: 'HTML' });
    
    try {
        const results = await searchWeb(query);
        await bot.deleteMessage(chatId, loading.message_id);
        
        if (results.length === 0) {
            return bot.sendMessage(chatId, '❌ لم أجد نتائج. جرب كلمات مختلفة.');
        }
        
        db.stats.searches++;
        
        let message = `<b>🔍 نتائج البحث عن:</b> ${escapeHtml(query)}\n\n`;
        
        results.forEach((r, i) => {
            message += `${i + 1}. <b>${escapeHtml(r.title)}</b>\n`;
            message += `${escapeHtml(r.snippet.substring(0, 100))}...\n`;
            message += `<a href="${r.url}">🔗 زيارة الموقع</a>\n\n`;
        });
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        
    } catch (e) {
        bot.editMessageText('❌ خطأ في البحث', { chat_id: chatId, message_id: loading.message_id });
    }
});

// بحث يوتيوب
bot.onText(/يوتيوب\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    const loading = await bot.sendMessage(chatId, '🎵 <b>جاري البحث في يوتيوب...</b>', { parse_mode: 'HTML' });
    
    try {
        const videos = await searchYouTube(query);
        await bot.deleteMessage(chatId, loading.message_id);
        
        if (videos.length === 0) {
            return bot.sendMessage(chatId, '❌ لم أجد فيديوهات. جرب كلمات أخرى.');
        }
        
        for (const v of videos) {
            const duration = v.lengthSeconds ? 
                `${Math.floor(v.lengthSeconds / 60)}:${(v.lengthSeconds % 60).toString().padStart(2, '0')}` : 
                '??:??';
            
            await bot.sendMessage(chatId, `
🎵 <b>${escapeHtml(v.title)}</b>

👤 ${escapeHtml(v.author)}
⏱️ ${duration} | 👁️ ${v.viewCount || '?'}

<a href="${v.url}">▶️ مشاهدة على يوتيوب</a>
            `, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '▶️ مشاهدة', url: v.url }
                    ]]
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
    
    const loading = await bot.sendMessage(chatId, '🖼️ <b>جاري البحث عن الصور...</b>', { parse_mode: 'HTML' });
    
    try {
        const images = await searchImages(query);
        await bot.deleteMessage(chatId, loading.message_id);
        
        const mediaGroup = images.map((img, i) => ({
            type: 'photo',
            media: img.url,
            caption: i === 0 ? `🖼️ ${escapeHtml(query)} | المصدر: ${img.source}` : ''
        }));
        
        await bot.sendMediaGroup(chatId, mediaGroup);
        
    } catch (e) {
        bot.sendMessage(chatId, '❌ خطأ في الصور');
    }
});

// بحث أخبار
bot.onText(/خبر\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    const loading = await bot.sendMessage(chatId, '📰 <b>جاري البحث عن الأخبار...</b>', { parse_mode: 'HTML' });
    
    try {
        const news = await searchNews(query);
        await bot.deleteMessage(chatId, loading.message_id);
        
        if (news.length === 0) {
            return bot.sendMessage(chatId, '❌ لم أجد أخبار. أضف NEWSAPI_KEY للحصول على نتائج.');
        }
        
        let message = `<b>📰 أخبار عن:</b> ${escapeHtml(query)}\n\n`;
        
        news.forEach((n, i) => {
            message += `${i + 1}. <b>${escapeHtml(n.title)}</b>\n`;
            message += `📍 ${escapeHtml(n.source)} | 📅 ${n.publishedAt}\n`;
            message += `<a href="${n.url}">🔗 قراءة الخبر</a>\n\n`;
        });
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        
    } catch (e) {
        bot.editMessageText('❌ خطأ في البحث', { chat_id: chatId, message_id: loading.message_id });
    }
});

// بحث ويكيبيديا
bot.onText(/ويكي\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const query = match[1].trim();
    
    const loading = await bot.sendMessage(chatId, '📚 <b>جاري البحث في ويكيبيديا...</b>', { parse_mode: 'HTML' });
    
    try {
        const result = await searchWiki(query);
        await bot.deleteMessage(chatId, loading.message_id);
        
        if (!result) {
            return bot.sendMessage(chatId, '❌ لم أجد مقال في ويكيبيديا.');
        }
        
        await bot.sendMessage(chatId, `
📚 <b>${escapeHtml(result.title)}</b>

${escapeHtml(result.extract)}

<a href="${result.url}">🔗 قراءة المزيد في ويكيبيديا</a>
        `, { parse_mode: 'HTML' });
        
    } catch (e) {
        bot.editMessageText('❌ خطأ في البحث', { chat_id: chatId, message_id: loading.message_id });
    }
});

// ==================== SERVER ====================
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.json({
        status: '✅ Search Bot Running',
        stats: db.stats
    });
});

const server = http.createServer(app);

server.listen(PORT, async () => {
    console.log(`✅ Server on port ${PORT}`);
    
    const webhookUrl = process.env.RENDER_EXTERNAL_URL;
    
    if (!webhookUrl) {
        return bot.startPolling();
    }
    
    try {
        await bot.deleteWebHook();
        await bot.setWebHook(`${webhookUrl}/bot${TOKEN}`);
        const me = await bot.getMe();
        console.log(`🔍 Search Bot: @${me.username}`);
    } catch (e) {
        bot.startPolling();
    }
});
  
