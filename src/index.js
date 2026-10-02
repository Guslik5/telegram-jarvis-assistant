import { Telegraf } from 'telegraf';
import { getCalendarEvents, createCalendarEvent } from './calendar.js';
import { getNotionPagesContent, createNotionPage } from './notion.js';
import { listDriveFiles, searchDriveFiles, readDriveFile } from './drive.js';
import { sendTelegramFormatted } from './formatter.js';
import { classifyUserIntent } from './router.js';
import dotenv from 'dotenv';
import https from 'https';
import http from 'http';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID || '1913377793';
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN is required in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// 1. HTTP Server for Render Health Check and Port Binding
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🚀 Jarvis Telegram Bot is running healthy 24/7!\n');
});

server.listen(PORT, () => {
  console.log(`[SERVER] HTTP health check listening on port ${PORT}`);
});

// 2. Self-ping Keep-Alive mechanism for Render Free Tier (pings every 10 min)
setInterval(() => {
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (externalUrl) {
    https.get(externalUrl, (res) => {
      console.log(`[KEEP-ALIVE] Pinged ${externalUrl} - Status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('[KEEP-ALIVE] Ping error:', err.message);
    });
  }
}, 10 * 60 * 1000);

// Security Middleware: Allow only Dima (ID: 1913377793)
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id?.toString();
  const allowedIds = ALLOWED_USER_ID.split(',').map(id => id.trim());

  if (userId && allowedIds.includes(userId)) {
    return next();
  }

  console.log(`[SECURITY] Blocked unauthorized access attempt from User ID: ${userId} (${ctx.from?.username || 'unknown'})`);
  return ctx.reply('Что ты тут ищешь) 🕵️‍♂️');
});

// Gemini helper function with multimodal (Text + Images) support
async function askGemini(prompt, systemInstruction = '', imageBuffer = null, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    return 'Ошибка: GEMINI_API_KEY не указан в файле .env.';
  }

  const models = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.7-flash',
    'gemini-flash-latest'
  ];
  
  const parts = [];
  
  if (systemInstruction) {
    parts.push({ text: `[Системная инструкция]: ${systemInstruction}\n\n` });
  }

  if (imageBuffer) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imageBuffer.toString('base64')
      }
    });
  }

  parts.push({ text: prompt });

  const postData = JSON.stringify({
    contents: [{ parts }]
  });

  for (const model of models) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${model}:generateContent`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': GEMINI_API_KEY,
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      if (res.statusCode === 200) {
        const parsed = JSON.parse(res.body);
        if (parsed.candidates && parsed.candidates[0]?.content?.parts?.[0]?.text) {
          return parsed.candidates[0].content.parts[0].text;
        }
      }
    } catch (err) {
      console.error(`Error with model ${model}:`, err.message);
    }
  }

  return 'Извините, возникла небольшая заминка при обработке. Попробуйте еще раз через мгновение!';
}

// Download helper for Telegram files/photos
async function downloadTelegramFile(fileUrl) {
  return new Promise((resolve, reject) => {
    https.get(fileUrl, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

// --- TELEGRAM BOT HANDLERS ---

const SYSTEM_PROMPT = `
Ты — Jarvis, персональный AI-ассистент разработчика Димы (Дмитрия Гусаченко).
Дима — Fullstack-разработчик (React, TypeScript, Tailwind, Node.js, Express/NestJS, PostgreSQL, Docker).
Его активные проекты: конструктор сайтов-открыток & поздравлений, CRM для аренды авто, SimpleOne enterprise low-code платформа.
Твой стиль общения: дружелюбный, технически грамотный, уверенный, уважительный, лаконичный, на русском языке.
Ты помогаешь Диме с проектами, выжимками из Notion, расписанием в Google Календаре, кодом, анализом фото/скриншотов и планированием задач.
`;

bot.start((ctx) => {
  const name = ctx.from.first_name || 'Дима';
  sendTelegramFormatted(ctx,
    `👋 **Привет, ${name}! Я твой личный ассистент Jarvis.**\n\n` +
    `Я подключен к твоему Notion, Google Календарю, Google Диску и твоим проектам.\n\n` +
    `📌 **Что я умею:**\n` +
    `• 📅 **Календарь**: напиши "какие встречи сегодня?", "что в расписании?" или /calendar\n` +
    `• 📁 **Google Диск**: "какие документы на диске?", "найди файл в drive" или /drive\n` +
    `• 📄 **Notion**: выжимки ("что в notion?"), создание страниц ("запиши заметку в notion")\n` +
    `• 🖼 **Анализ фото**: отправь скриншот ошибки, макет Figma или фото\n` +
    `• 💬 **Диалог**: пиши мне любые вопросы по коду и задачам!`
  );
});

bot.command('calendar', async (ctx) => {
  await ctx.sendChatAction('typing');
  const events = await getCalendarEvents();
  
  if (!events) {
    return ctx.reply('📅 Модуль календаря не настроен на сервере.');
  }

  if (events.length === 0) {
    return ctx.reply('📅 На сегодня в Google Календаре встреч не запланировано. Время свободно!');
  }

  let text = '📅 **Твои встречи на сегодня:**\n\n';
  for (const e of events) {
    const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Весь день';
    const end = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    text += `• 🕐 **${start}${end ? ' - ' + end : ''}**: ${e.summary || 'Без названия'}\n`;
  }

  sendTelegramFormatted(ctx, text);
});

bot.command('drive', async (ctx) => {
  const query = ctx.message.text.replace('/drive', '').trim();
  await ctx.sendChatAction('typing');

  const files = query ? await searchDriveFiles(query) : await listDriveFiles(10);
  if (!files || files.length === 0) {
    return ctx.reply('📁 На Google Диске файлов не найдено.');
  }

  let text = `📁 **Файлы на Google Диске${query ? ` (поиск "${query}")` : ''}:**\n\n`;
  files.forEach((f, idx) => {
    const link = f.webViewLink ? `[${f.name}](${f.webViewLink})` : `**${f.name}**`;
    text += `${idx + 1}. 📄 ${link}\n`;
  });

  sendTelegramFormatted(ctx, text);
});

bot.command('notion', async (ctx) => {
  const query = ctx.message.text.replace('/notion', '').trim();
  await ctx.sendChatAction('typing');

  const content = await getNotionPagesContent(query);
  if (!content) {
    return ctx.reply('🔍 В Notion пока не найдено страниц. Убедитесь, что нужная страница подключена к Antigravity Assistant.');
  }

  const prompt = `Пользователь запросил выжимку по Notion (запрос: "${query}"):\n${content}\n\nСделай емкое, структурированное и красивое резюме этой информации:`;
  const summary = await askGemini(prompt, SYSTEM_PROMPT);

  sendTelegramFormatted(ctx, summary);
});

// Photo handler: Multimodal analysis with Gemini Vision
bot.on('photo', async (ctx) => {
  await ctx.sendChatAction('typing');

  try {
    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];
    const fileLink = await ctx.telegram.getFileLink(bestPhoto.file_id);
    const imageBuffer = await downloadTelegramFile(fileLink.href);

    const userCaption = ctx.message.caption || 'Проанализируй это изображение, подробно объясни что на нем и ответь на вопросы, если есть.';
    const response = await askGemini(userCaption, SYSTEM_PROMPT, imageBuffer, 'image/jpeg');

    sendTelegramFormatted(ctx, response);
  } catch (err) {
    console.error('Error handling photo:', err.message);
    ctx.reply('Произошла ошибка при анализе изображения. Попробуйте отправить еще раз.');
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  await ctx.sendChatAction('typing');

  // Smart AI Intent Classification
  const intent = await classifyUserIntent(text, GEMINI_API_KEY);
  console.log('[ROUTER] Intent:', JSON.stringify(intent));

  // 1. ACTION: Create a new page in Notion
  if (intent.action === 'CREATE_NOTION_PAGE') {
    const linkRegex = /(https?:\/\/[^\s]+)/g;
    const links = (text.match(linkRegex) || []).map(url => ({ title: url, url }));

    const title = intent.title || 'Новая запись';
    const content = intent.content || text;

    const createdPage = await createNotionPage(title, content, links);
    if (createdPage) {
      return sendTelegramFormatted(ctx, `✅ **Страница "${title}" успешно создана в твоем Notion!**\n\n📄 [Открыть страницу в Notion](${createdPage.url})`);
    } else {
      return ctx.reply('⚠️ Не удалось создать страницу в Notion. Проверьте подключение и повторите.');
    }
  }

  // 2. ACTION: Read / Summarize Notion
  if (intent.action === 'READ_NOTION') {
    const content = await getNotionPagesContent(intent.query || '');
    if (content) {
      const prompt = `Запрос пользователя: "${text}"\n\nВот актуальные данные из Notion:\n${content}\n\nОтветь на запрос пользователя, используя данные из Notion:`;
      const response = await askGemini(prompt, SYSTEM_PROMPT);
      return sendTelegramFormatted(ctx, response);
    } else {
      return ctx.reply('🔍 В твоем Notion пока нет страниц по этому запросу.');
    }
  }

  // 3. ACTION: Read Google Calendar
  if (intent.action === 'READ_CALENDAR') {
    const events = await getCalendarEvents();
    if (events) {
      if (events.length === 0) {
        return ctx.reply('📅 На сегодня в твоем Google Календаре нет встреч. Расписание свободно!');
      }

      let eventSummary = events.map(e => {
        const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Весь день';
        const end = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
        return `- ${start} ${end ? 'до ' + end : ''}: ${e.summary || 'Событие'}`;
      }).join('\n');

      const prompt = `Запрос пользователя: "${text}"\n\nВот события из его Google Календаря:\n${eventSummary}\n\nОтветь дружелюбно и четко:`;
      const response = await askGemini(prompt, SYSTEM_PROMPT);
      return sendTelegramFormatted(ctx, response);
    }
  }

  // 4. ACTION: Google Drive (List / Search / Read)
  if (intent.action === 'READ_DRIVE') {
    const files = intent.query ? await searchDriveFiles(intent.query) : await listDriveFiles(10);
    if (files && files.length > 0) {
      let fileListText = files.map((f, i) => `${i + 1}. [${f.name}](${f.webViewLink || f.id}) (${f.mimeType})`).join('\n');
      
      // If user specifically asked about a document, try to read the top match if it's a doc
      if (files.length === 1 || (intent.query && files[0].mimeType === 'application/vnd.google-apps.document')) {
        const docData = await readDriveFile(files[0].id);
        if (docData && docData.content) {
          const prompt = `Запрос пользователя: "${text}"\n\nДокумент "${docData.name}" на Google Диске:\n${docData.content.substring(0, 4000)}\n\nОтветь на вопрос пользователя на основе этого документа:`;
          const response = await askGemini(prompt, SYSTEM_PROMPT);
          return sendTelegramFormatted(ctx, response);
        }
      }

      const prompt = `Запрос пользователя: "${text}"\n\nВот найденные файлы на Google Диске:\n${fileListText}\n\nПредоставь пользователю аккуратный список со ссылками:`;
      const response = await askGemini(prompt, SYSTEM_PROMPT);
      return sendTelegramFormatted(ctx, response);
    } else {
      return ctx.reply('📁 На твоем Google Диске не найдено файлов по этому запросу.');
    }
  }

  // 5. ACTION: General Chat & Coding Assistance
  const response = await askGemini(text, SYSTEM_PROMPT);
  sendTelegramFormatted(ctx, response);
});

// Launch bot
bot.launch().then(() => {
  console.log('🚀 Jarvis Telegram Bot is running live on @jarvis_guslik_helper_bot!');
});

// Enable graceful stop
process.once('SIGINT', () => {
  server.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  server.close();
  bot.stop('SIGTERM');
});
