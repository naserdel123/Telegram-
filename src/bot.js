import { Bot, InlineKeyboard, GrammyError, HttpError } from 'grammy';
import express from 'express';
import { config } from './config.js';
import { 
    getVideoInfo, 
    downloadVideo, 
    checkYtDlp, 
    cleanupOldFiles 
} from './downloader.js';
import { 
    isValidYoutubeUrl, 
    escapeMarkdown, 
    formatDuration,
    generateId 
} from './utils.js';
import fs from 'fs-extra';
import path from 'path';

// ==================== إنشاء البوت ====================
const bot = new Bot(config.BOT_TOKEN);

// ==================== قاعدة البيانات المؤقتة (في الذاكرة) ====================
const userSessions = new Map();

// تنظيف الجلسات القديمة كل 30 دقيقة
setInterval(() => {
    const now = Date.now();
    for (const [userId, session] of userSessions.entries()) {
        if (now - session.createdAt > 30 * 60 * 1000) { // 30 دقيقة
            userSessions.delete(userId);
        }
    }
    cleanupOldFiles();
}, 30 * 60 * 1000);

// ==================== لوحات المفاتيح ====================
function getMainKeyboard() {
    return new InlineKeyboard()
        .text(config.messages.START_BUTTON, 'start_download')
        .row()
        .text(config.messages.HELP_BUTTON, 'help');
}

function getCancelKeyboard() {
    return new InlineKeyboard()
        .text(config.messages.CANCEL_BUTTON, 'cancel');
}

function getQualitiesKeyboard(formats) {
