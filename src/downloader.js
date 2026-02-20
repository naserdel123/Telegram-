import YTDlpWrap from 'yt-dlp-wrap';
import fs from 'fs-extra';
import path from 'path';
import { config } from './config.js';
import { formatFileSize } from './utils.js';

const ytDlpWrap = new YTDlpWrap();

// ==================== استخراج معلومات الفيديو ====================
export async function getVideoInfo(url) {
    try {
        console.log('🔍 جاري تحليل:', url);
        
        const info = await ytDlpWrap.getVideoInfo(url);
        
        // تصفية الجودات المتاحة (فيديو + صوت)
        const formats = [];
        const seenQualities = new Set();
        
        for (const format of info.formats) {
            if (format.vcodec !== 'none' && format.acodec !== 'none') {
                const height = format.height || 0;
                
                // نحتفظ فقط بجودات معقولة (حتى 1080p للباقة المجانية)
                if (height && !seenQualities.has(height) && height <= 1080) {
                    seenQualities.add(height);
                    
                    const size = format.filesize || format.filesize_approx || 0;
                    
                    formats.push({
                        formatId: format.format_id,
                        quality: `${height}p`,
                        height: height,
                        ext: format.ext || 'mp4',
                        filesize: size,
                        filesizeFormatted: formatFileSize(size)
                    });
                }
            }
        }
        
        // ترتيب من الأقل للأعلى
        formats.sort((a, b) => a.height - b.height);
        
        console.log(`✅ تم العثور على ${formats.length} جودة`);
        
        return {
            id: info.id,
            title: info.title || 'فيديو بدون عنوان',
            uploader: info.uploader || 'غير معروف',
            duration: info.duration || 0,
            thumbnail: info.thumbnail,
            webpageUrl: info.webpage_url || url,
            formats: formats
        };
        
    } catch (error) {
        console.error('❌ خطأ في استخراج المعلومات:', error.message);
        throw new Error(`فشل في تحليل الفيديو: ${error.message}`);
    }
}

// ==================== تحميل الفيديو ====================
export async function downloadVideo(url, formatId, filename, onProgress) {
    const outputPath = path.join(config.DOWNLOAD_PATH, filename);
    
    try {
        // التأكد من وجود المجلد
        await fs.ensureDir(config.DOWNLOAD_PATH);
        
        console.log(`⬇️ جاري التحميل: ${filename}`);
        
        const downloadEmitter = ytDlpWrap.exec([
            url,
            '-f', formatId,
            '-o', outputPath,
            '--no-warnings',
            '--newline',
            '--no-check-certificates',
            '--geo-bypass'
        ]);
        
        return new Promise((resolve, reject) => {
            let lastPercent = 0;
            
            downloadEmitter.ytDlpProcess.stdout.on('data', (data) => {
                const output = data.toString();
                
                // استخراج النسبة المئوية
                const match = output.match(/(\d+\.?\d*)%/);
                if (match) {
                    const percent = parseFloat(match[1]);
                    if (percent !== lastPercent && onProgress) {
                        lastPercent = percent;
                        onProgress(percent);
                    }
                }
            });
            
            downloadEmitter.on('close', async (code) => {
                if (code === 0) {
                    // التحقق من الملف
                    const stats = await fs.stat(outputPath);
                    console.log(`✅ تم التحميل: ${formatFileSize(stats.size)}`);
                    resolve({
                        path: outputPath,
                        size: stats.size
                    });
                } else {
                    reject(new Error(`فشل التحميل، رمز الخروج: ${code}`));
                }
            });
            
            downloadEmitter.on('error', (error) => {
                reject(error);
            });
        });
        
    } catch (error) {
        // تنظيف الملف في حالة الخطأ
        if (await fs.pathExists(outputPath)) {
            await fs.remove(outputPath);
        }
        throw error;
    }
}

// ==================== تنظيف الملفات القديمة ====================
export async function cleanupOldFiles() {
    try {
        const files = await fs.readdir(config.DOWNLOAD_PATH);
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // ساعة واحدة
        
        for (const file of files) {
            const filePath = path.join(config.DOWNLOAD_PATH, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtime.getTime() > maxAge) {
                await fs.remove(filePath);
                console.log('🗑️ تم حذف ملف قديم:', file);
            }
        }
    } catch (error) {
        console.error('خطأ في التنظيف:', error);
    }
}

// ==================== التحقق من yt-dlp ====================
export async function checkYtDlp() {
    try {
        const version = await ytDlpWrap.getVersion();
        console.log('✅ yt-dlp version:', version);
        return true;
    } catch (error) {
        console.error('❌ yt-dlp غير مثبت!');
        return false;
    }
}
