# 🤖 Telegram Jarvis Assistant

Персональный AI-ассистент разработчика Дмитрия Гусаченко в Telegram.

## 🚀 Возможности
- 🧠 Интеллект на базе **Google Gemini API** (`gemini-3.5-flash`).
- 📓 Прямая интеграция с **Notion API**: мгновенный поиск по страницам и генерация структурированных выжимок.
- ✍️ Помощь в формулировании сообщений, ответов и деловых писем.
- 🐳 Поддержка запуска в **Docker / Docker Compose** и через **PM2** для работы 24/7.

---

## 🛠 Быстрый старт

### 1. Установка зависимостей
```bash
npm install
```

### 2. Настройка переменных окружения
Скопируйте `.env.example` в `.env` и укажите свои ключи:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
NOTION_TOKEN=your_notion_token
GEMINI_API_KEY=your_gemini_key
```

### 3. Запуск локально
```bash
npm start
# или в режиме разработки с автоперезагрузкой:
npm run dev
```

---

## 🚢 Деплой 24/7 на сервере (Docker)
```bash
docker compose up -d --build
```
