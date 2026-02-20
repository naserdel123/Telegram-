// ==================== أدوات مساعدة ====================

// تنسيق حجم الملف
export function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return 'غير معروف';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

// تهريب Markdown
export function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// تنسيق الوقت
export function formatDuration(seconds) {
    if (!seconds) return 'غير معروف';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// التحقق من رابط يوتيوب
export function isValidYoutubeUrl(url) {
    const regex = /(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)/;
    return regex.test(url);
}

// إنشاء ID عشوائي
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
