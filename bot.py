import os
import asyncio
import aiofiles
from pyrogram import Client, filters, types
from pyrogram.types import InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from yt_dlp import YoutubeDL
import yt_dlp.utils
from config import Config

# تعطيل الألوان في سجل yt-dlp (لتجنب مشاكل الترميز)
yt_dlp.utils._windows_enable_vt_mode = lambda: None

# إنشاء مجلد التحميلات
if not os.path.exists(Config.DOWNLOAD_PATH):
    os.makedirs(Config.DOWNLOAD_PATH)

# ==================== إنشاء البوت ====================
app = Client(
    "youtube_downloader_bot",
    api_id=Config.API_ID,
    api_hash=Config.API_HASH,
    bot_token=Config.BOT_TOKEN
)

# ==================== قاعدة البيانات المؤقتة ====================
user_data = {}  # تخزين حالة المستخدمين

# ==================== لوحة المفاتيح ====================
def start_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(Config.START_BUTTON, callback_data="start_download")],
        [InlineKeyboardButton("📊 المساعدة", callback_data="help")]
    ])

def quality_keyboard(formats):
    """إنشاء أزرار الجودة"""
    buttons = []
    row = []
    
    for i, fmt in enumerate(formats):
        quality = fmt['quality']
        size = fmt.get('filesize_approx', 'Unknown')
        if size != 'Unknown':
            size_mb = size / (1024 * 1024)
            size_str = f"{size_mb:.1f}MB" if size_mb < 1024 else f"{size_mb/1024:.1f}GB"
        else:
            size_str = "?"
        
        btn_text = f"{quality} ({size_str})"
        callback = f"quality_{i}"
        
        row.append(InlineKeyboardButton(btn_text, callback_data=callback))
        
        if len(row) == 2:  # صفين في كل صف
            buttons.append(row)
            row = []
    
    if row:
        buttons.append(row)
    
    buttons.append([InlineKeyboardButton(Config.CANCEL_BUTTON, callback_data="cancel")])
    return InlineKeyboardMarkup(buttons)

# ==================== الأوامر ====================
@app.on_message(filters.command("start"))
async def start_command(client, message):
    """رسالة الترحيب"""
    await message.reply_text(
        Config.WELCOME_MESSAGE,
        reply_markup=start_keyboard(),
        parse_mode="markdown"
    )

@app.on_message(filters.command("help"))
async def help_command(client, message):
    """رسالة المساعدة"""
    help_text = """
📚 **طريقة استخدام البوت:**

1️⃣ **بدء التحميل:**
   - اضغط على زر 🎬 بدء التحميل
   - أو أرسل /download

2️⃣ **إرسال الرابط:**
   - أرسل رابط الفيديو من اليوتيوب
   - يدعب الروابط القصيرة والطويلة

3️⃣ **اختيار الجودة:**
   - سيعرض البوت جميع الجودات المتاحة
   - من 144p (أقل حجم) إلى 4K (أعلى جودة)
   - يظهر حجم الملف لكل جودة

4️⃣ **الانتظار:**
   - سيقوم البوت بتحميل الفيديو
   - ثم إرساله مباشرة لك

⚠️ **ملاحظات:**
• الحد الأقصى للملف: 4GB للمستخدمين المميزين، 2GB للعاديين
• قد يستغرق التحميل بعض الوقت حسب حجم الفيديو
    """
    await message.reply_text(help_text, parse_mode="markdown")

@app.on_message(filters.command("download"))
async def download_command(client, message):
    """بدء عملية التحميل"""
    user_data[message.from_user.id] = {"step": "waiting_url"}
    await message.reply_text(
        "🎬 **حسناً!** أرسل لي رابط الفيديو من اليوتيوب الآن:",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(Config.CANCEL_BUTTON, callback_data="cancel")]])
    )

# ==================== معالجة الأزرار ====================
@app.on_callback_query()
async def handle_callback(client, callback_query: CallbackQuery):
    user_id = callback_query.from_user.id
    data = callback_query.data
    
    if data == "start_download":
        user_data[user_id] = {"step": "waiting_url"}
        await callback_query.message.edit_text(
            "🎬 **حسناً!** أرسل لي رابط الفيديو من اليوتيوب الآن:\n\n"
            "💡 *يمكنك إرسال الرابط من:*\n"
            "• youtube.com/watch?v=...\n"
            "• youtu.be/...\n"
            "• youtube.com/shorts/...",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(Config.CANCEL_BUTTON, callback_data="cancel")]]),
            parse_mode="markdown"
        )
    
    elif data == "cancel":
        if user_id in user_data:
            del user_data[user_id]
        await callback_query.message.edit_text(
            "❌ **تم الإلغاء**\n\n"
            "اضغط /start للبدء من جديد",
            parse_mode="markdown"
        )
    
    elif data == "help":
        await callback_query.message.edit_text(
            "📚 **المساعدة:**\n\n"
            "هذا البوت يساعدك في تحميل فيديوهات اليوتيوب بجودات مختلفة.\n\n"
            "🚀 **للبدء:** اضغط على زر بدء التحميل",
            reply_markup=start_keyboard(),
            parse_mode="markdown"
        )
    
    elif data.startswith("quality_"):
        # معالجة اختيار الجودة
        if user_id not in user_data or "formats" not in user_data[user_id]:
            await callback_query.answer("❌ انتهت الجلسة، ابدأ من جديد", show_alert=True)
            return
        
        format_index = int(data.split("_")[1])
        selected_format = user_data[user_id]["formats"][format_index]
        url = user_data[user_id]["url"]
        
        await callback_query.message.edit_text(
            f"⏳ **جاري التحميل...**\n\n"
            f"🎬 الجودة: {selected_format['quality']}\n"
            f"📦 الحجم: ~{selected_format.get('filesize_approx', 'Unknown') / 1024 / 1024:.1f}MB\n"
            f"⏱️ قد يستغرق بعض الوقت...",
            parse_mode="markdown"
        )
        
        # بدء التحميل
        await download_video(client, callback_query.message, url, selected_format, user_id)
    
    await callback_query.answer()

# ==================== معالجة الروابط ====================
@app.on_message(filters.text & filters.private)
async def handle_url(client, message):
    user_id = message.from_user.id
    
    # التحقق من أن المستخدم في خطوة إرسال الرابط
    if user_id not in user_data or user_data[user_id].get("step") != "waiting_url":
        return
    
    url = message.text.strip()
    
    # التحقق من أن الرابط يوتيوب
    if not ("youtube.com" in url or "youtu.be" in url):
        await message.reply_text(
            "❌ **رابط غير صحيح!**\n\n"
            "الرجاء إرسال رابط يوتيوب صحيح.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 رجوع", callback_data="start_download")]])
        )
        return
    
    # إرسال رسالة المعالجة
    processing_msg = await message.reply_text("🔍 **جاري تحليل الفيديو...**", parse_mode="markdown")
    
    try:
        # استخراج معلومات الفيديو
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
        }
        
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # جمع الجودات المتاحة (فيديو فقط مع صوت)
            formats = []
            seen_qualities = set()
            
            for fmt in info.get('formats', []):
                # نريد صيغ فيديو مع صوت فقط (best)
                if fmt.get('vcodec') != 'none' and fmt.get('acodec') != 'none':
                    height = fmt.get('height', 0)
                    if height and height not in seen_qualities:
                        seen_qualities.add(height)
                        formats.append({
                            'format_id': fmt['format_id'],
                            'quality': f"{height}p",
                            'height': height,
                            'filesize_approx': fmt.get('filesize') or fmt.get('filesize_approx', 0),
                            'ext': fmt['ext']
                        })
            
            # ترتيب الجودات من الأقل للأعلى
            formats.sort(key=lambda x: x['height'])
            
            if not formats:
                await processing_msg.edit_text(
                    "❌ **لا توجد جودات متاحة!**\n"
                    "قد يكون الفيديو محمي أو غير متاح.",
                    parse_mode="markdown"
                )
                return
            
            # حفظ البيانات
            user_data[user_id]["url"] = url
            user_data[user_id]["formats"] = formats
            user_data[user_id]["info"] = info
            user_data[user_id]["step"] = "selecting_quality"
            
            # إنشاء نص الجودات
            qualities_text = "\n".join([
                f"• {f['quality']} - {f.get('filesize_approx', 0) / 1024 / 1024:.1f}MB" 
                if f.get('filesize_approx') else f"• {f['quality']}"
                for f in formats
            ])
            
            await processing_msg.edit_text(
                f"🎬 **{info.get('title', 'فيديو بدون عنوان')}**\n\n"
                f"👤 **القناة:** {info.get('uploader', 'غير معروف')}\n"
                f"⏱️ **المدة:** {info.get('duration', 0) // 60}:{info.get('duration', 0) % 60:02d}\n\n"
                f"📊 **الجودات المتاحة (من الأقل للأعلى):**\n{qualities_text}\n\n"
                f"✅ **اختر الجودة المطلوبة:**",
                reply_markup=quality_keyboard(formats),
                parse_mode="markdown"
            )
            
    except Exception as e:
        await processing_msg.edit_text(
            f"❌ **حدث خطأ:**\n`{str(e)}`\n\n"
            f"تأكد من صحة الرابط أو جرب فيديو آخر.",
            parse_mode="markdown"
        )

# ==================== تحميل وإرسال الفيديو ====================
async def download_video(client, message, url, format_info, user_id):
    """تحميل الفيديو وإرساله"""
    file_path = None
    
    try:
        quality = format_info['quality']
        format_id = format_info['format_id']
        
        # إعدادات التحميل
        output_template = os.path.join(Config.DOWNLOAD_PATH, f"%(title)s_{quality}_%(id)s.%(ext)s")
        
        ydl_opts = {
            'format': format_id,
            'outtmpl': output_template,
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [lambda d: print(f"Downloading: {d.get('_percent_str', '0%')}")],
        }
        
        # تحميل الفيديو
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            file_path = ydl.prepare_filename(info)
            
            # التحقق من وجود الملف
            if not os.path.exists(file_path):
                # قد يكون الامتداد مختلفاً
                base_path = file_path.rsplit('.', 1)[0]
                for ext in ['mp4', 'mkv', 'webm']:
                    possible_path = f"{base_path}.{ext}"
                    if os.path.exists(possible_path):
                        file_path = possible_path
                        break
        
        if not file_path or not os.path.exists(file_path):
            await message.edit_text("❌ **فشل العثور على الملف بعد التحميل**", parse_mode="markdown")
            return
        
        # التحقق من حجم الملف
        file_size = os.path.getsize(file_path)
        if file_size > Config.MAX_FILE_SIZE:
            await message.edit_text(
                f"❌ **الملف كبير جداً!**\n"
                f"الحجم: {file_size / 1024 / 1024 / 1024:.2f}GB\n"
                f"الحد الأقصى: {Config.MAX_FILE_SIZE / 1024 / 1024 / 1024}GB\n\n"
                f"جرب جودة أقل.",
                parse_mode="markdown"
            )
            os.remove(file_path)
            return
        
        # تحديث الرسالة
        await message.edit_text(
            f"✅ **تم التحميل!**\n"
            f"📤 **جاري الإرسال...**",
            parse_mode="markdown"
        )
        
        # إرسال الفيديو
        await client.send_video(
            chat_id=message.chat.id,
            video=file_path,
            caption=f"🎬 **{info.get('title', 'فيديو')}**\n"
                    f"📊 الجودة: {quality}\n"
                    f"📦 الحجم: {file_size / 1024 / 1024:.1f}MB\n\n"
                    f"🤖 @{(await client.get_me()).username}",
            parse_mode="markdown",
            supports_streaming=True,
            duration=info.get('duration', 0),
            width=info.get('width', 1280),
            height=info.get('height', 720),
            thumb=None  # يمكن إضافة thumbnail لاحقاً
        )
        
        # حذف رسالة التحميل
        await message.delete()
        
        # تنظيف الملف
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # تنظيف بيانات المستخدم
        if user_id in user_data:
            del user_data[user_id]
            
    except Exception as e:
        error_msg = str(e)
        await message.edit_text(
            f"❌ **خطأ في التحميل:**\n`{error_msg}`\n\n"
            f"قد يكون الفيديو محمي أو غير متاح في منطقتك.",
            parse_mode="markdown"
        )
        if file_path and os.path.exists(file_path):
            os.remove(file_path)

# ==================== تشغيل البوت ====================
if __name__ == "__main__":
    print("🤖 Bot is starting...")
    print("✅ Bot is running!")
    app.run()
    