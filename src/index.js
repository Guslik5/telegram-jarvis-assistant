import { Telegraf } from 'telegraf';
import { Client as NotionClient } from '@notionhq/client';
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

// Gemini helper function with verified active models
async function askGemini(prompt, systemInstruction = '') {
  if (!GEMINI_API_KEY) {
    return 'Ошибка: GEMINI_API_KEY не указан в файле .env.';
  }

  const models = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.7-flash',
    'gemini-flash-latest'
  ];
  
  for (const model of models) {
    try {
      const fullPrompt = systemInstruction 
        ? `${systemInstruction}\n\nЗапрос пользователя:\n${prompt}`
        : prompt;

      const postData = JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }]
      });

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
      } else {
        console.log(`Model ${model} returned status:`, res.statusCode);
      }
    } catch (err) {
      console.error(`Error with model ${model}:`, err.message);
    }
  }

  return 'Извините, возникла небольшая заминка при обращении к модели. Попробуйте еще раз через мгновение!';
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

      // Fetch blocks inside page
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

// --- TELEGRAM BOT HANDLERS ---

const SYSTEM_PROMPT = `
Ты — Jarvis, персональный AI-ассистент разработчика Димы (Дмитрия Гусаченко).
Дима — Fullstack-разработчик (React, TypeScript, Tailwind, Node.js, Express/NestJS, PostgreSQL, Docker).
Его активные проекты: конструктор сайтов-открыток & поздравлений, CRM для аренды авто, SimpleOne enterprise low-code платформа.
Твой стиль общения: дружелюбный, технически грамотный, уверенный, уважительный, лаконичный, на русском языке.
Ты помогаешь Диме с проектами, выжимками из Notion, кодом, планированием задач и повседневными вопросами.
`;

bot.start((ctx) => {
  const name = ctx.from.first_name || 'Дима';
  ctx.reply(
    `👋 Привет, ${name}! Я твой личный ассистент Jarvis.\n\n` +
    `Я подключен к твоему Notion, Google Календарю и твоим проектам.\n\n` +
    `📌 Что я умею:\n` +
    `• 📄 Выжимки из Notion: напиши "сделай выжимку по проектам", "что лежит в notion?" или "/notion"\n` +
    `• 🔍 Поиск по проектам: отвечу на любые вопросы по ТЗ, архитектуре, стеку\n` +
    `• 💬 Быстрый диалог: пиши мне как обычному напарнику по коду\n\n` +
    `Попробуй спросить: "Что лежит в Notion?" или "Как дела?"!`
  );
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

  ctx.reply(summary);
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  await ctx.sendChatAction('typing');

  // Check if message is related to Notion
  const notionKeywords = ['ноушен', 'notion', 'выжимк', 'тз', 'документаци', 'что лежит', 'страниц', 'дома аренд', 'открытк', 'проект'];
  const isNotionQuery = notionKeywords.some(k => text.toLowerCase().includes(k));

  if (isNotionQuery) {
    const content = await getNotionPagesContent();
    if (content) {
      const prompt = `Запрос пользователя: "${text}"\n\nВот актуальные данные из Notion:\n${content}\n\nОтветь на запрос пользователя, используя данные из Notion:`;
      const response = await askGemini(prompt, SYSTEM_PROMPT);
      return ctx.reply(response);
    }
  }

  // General assistant dialogue
  const response = await askGemini(text, SYSTEM_PROMPT);
  ctx.reply(response);
});

// Launch bot
bot.launch().then(() => {
  console.log('🚀 Jarvis Telegram Bot is running live on @jarvis_guslik_helper_bot!');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
