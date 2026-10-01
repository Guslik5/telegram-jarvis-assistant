import { Telegraf } from 'telegraf';
import { Client as NotionClient } from '@notionhq/client';
import { getCalendarEvents, createCalendarEvent } from './calendar.js';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!BOT_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN is required in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const notion = NOTION_TOKEN ? new NotionClient({ auth: NOTION_TOKEN }) : null;

// Helper: safe reply with Markdown fallback
async function replyFormatted(ctx, text) {
  try {
    // Convert **bold** to *bold* for Telegram Markdown
    const tgMarkdown = text
      .replace(/\*\*(.*?)\*\*/g, '*$1*')
      .replace(/### (.*?)\n/g, '*$1*\n')
      .replace(/## (.*?)\n/g, '*$1*\n')
      .replace(/# (.*?)\n/g, '*$1*\n');

    await ctx.replyWithMarkdown(tgMarkdown);
  } catch (err) {
    // If Markdown parsing fails, fallback to clean plain text
    await ctx.reply(text);
  }
}

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

// Notion helper: Search and get text content of pages
async function getNotionPagesContent(query = '') {
  if (!notion) return null;

  try {
    const searchRes = await notion.search({
      query: query,
      page_size: 10
    });

    if (!searchRes.results || searchRes.results.length === 0) {
      return null;
    }

    let resultText = '';

    for (const page of searchRes.results) {
      let title = 'Без названия';
      if (page.properties?.title?.title?.[0]?.plain_text) {
        title = page.properties.title.title[0].plain_text;
      } else if (page.properties?.Name?.title?.[0]?.plain_text) {
        title = page.properties.Name.title[0].plain_text;
      }

      resultText += `\n\n=== СТРАНИЦА NOTION: "${title}" ===\n`;

      try {
        const blocks = await notion.blocks.children.list({
          block_id: page.id,
          page_size: 40
        });

        for (const block of blocks.results) {
          const type = block.type;
          if (block[type]?.rich_text) {
            const text = block[type].rich_text.map(t => t.plain_text).join('');
            if (text.trim()) {
              resultText += `- ${text}\n`;
            }
          }
        }
      } catch (blockErr) {
        console.error('Error fetching blocks for page', page.id, blockErr.message);
      }
    }

    return resultText;
  } catch (err) {
    console.error('Notion search error:', err.message);
    return null;
  }
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
  replyFormatted(ctx,
    `👋 *Привет, ${name}! Я твой личный ассистент Jarvis.*\n\n` +
    `Я подключен к твоему Notion, Google Календарю и твоим проектам.\n\n` +
    `📌 *Что я умею:*\n` +
    `• 📅 *Календарь*: напиши "какие встречи сегодня?", "что в расписании?" или /calendar\n` +
    `• 📄 *Выжимки из Notion*: напиши "что лежит в notion?" или /notion\n` +
    `• 🖼 *Анализ фото и скриншотов*: отправь мне скриншот ошибки, макет Figma или фото документа\n` +
    `• 🔍 *Поиск по проектам*: отвечу на любые вопросы по ТЗ, архитектуре, стеку\n` +
    `• 💬 *Быстрый диалог*: пиши мне как обычному напарнику по коду\n\n` +
    `Попробуй спросить: "Посмотри встречи на сегодня!" или отправь скриншот!`
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

  let text = '📅 *Твои встречи на сегодня:*\n\n';
  for (const e of events) {
    const start = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Весь день';
    const end = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    text += `• 🕐 *${start}${end ? ' - ' + end : ''}*: ${e.summary || 'Без названия'}\n`;
  }

  replyFormatted(ctx, text);
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

  replyFormatted(ctx, summary);
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

    replyFormatted(ctx, response);
  } catch (err) {
    console.error('Error handling photo:', err.message);
    ctx.reply('Произошла ошибка при анализе изображения. Попробуйте отправить еще раз.');
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  await ctx.sendChatAction('typing');

  // Check if message is related to Calendar
  const calendarKeywords = ['встреч', 'расписани', 'календар', 'созвон', 'план на сегодня', 'что сегодня', 'дела на сегодня'];
  const isCalendarQuery = calendarKeywords.some(k => text.toLowerCase().includes(k));

  if (isCalendarQuery) {
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

      const prompt = `Запрос пользователя: "${text}"\n\nВот события из его Google Календаря на сегодня:\n${eventSummary}\n\nОтветь дружелюбно и четко:`;
      const response = await askGemini(prompt, SYSTEM_PROMPT);
      return replyFormatted(ctx, response);
    }
  }

  // Check if message is related to Notion
  const notionKeywords = ['ноушен', 'notion', 'выжимк', 'тз', 'документаци', 'что лежит', 'страниц', 'дома аренд', 'открытк', 'проект'];
  const isNotionQuery = notionKeywords.some(k => text.toLowerCase().includes(k));

  if (isNotionQuery) {
    const content = await getNotionPagesContent();
    if (content) {
      const prompt = `Запрос пользователя: "${text}"\n\nВот актуальные данные из Notion:\n${content}\n\nОтветь на запрос пользователя, используя данные из Notion:`;
      const response = await askGemini(prompt, SYSTEM_PROMPT);
      return replyFormatted(ctx, response);
    }
  }

  // General assistant dialogue
  const response = await askGemini(text, SYSTEM_PROMPT);
  replyFormatted(ctx, response);
});

// Launch bot
bot.launch().then(() => {
  console.log('🚀 Jarvis Telegram Bot is running live on @jarvis_guslik_helper_bot!');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
