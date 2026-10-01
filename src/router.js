import https from 'https';

export async function classifyUserIntent(userText, apiKey) {
  if (!apiKey) return { action: 'GENERAL_CHAT' };

  const prompt = `
Ты — маршрутизатор действий для ассистента Jarvis.
Проанализируй запрос пользователя и определи, какое действие нужно выполнить.
Запрос пользователя: "${userText}"

Возможные действия (action):
1. "CREATE_NOTION_PAGE" — если пользователь просит создать страницу, записать, сохранить, зафиксировать, добавить заметку или данные в Notion.
2. "READ_NOTION" — если пользователь просит прочитать, сделать выжимку, найти или показать что лежит в Notion / документации.
3. "READ_CALENDAR" — если пользователь спрашивает про встречи, расписание, созвоны, планы на сегодня / завтра / календарь.
4. "GENERAL_CHAT" — если это обычный вопрос, диалог, программирование, совет или код.

Ответь СТРОГО валидным JSON без markdown оберток:
{
  "action": "CREATE_NOTION_PAGE" | "READ_NOTION" | "READ_CALENDAR" | "GENERAL_CHAT",
  "title": "Название страницы (только для CREATE_NOTION_PAGE)",
  "content": "Текст/данные для сохранения (только для CREATE_NOTION_PAGE)",
  "query": "Поисковый запрос (только для READ_NOTION)"
}
`;

  const postData = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }]
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-3.5-flash-lite:generateContent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const rawText = json.candidates[0].content.parts[0].text;
          const match = rawText.match(/\{[\s\S]*\}/);
          if (match) {
            resolve(JSON.parse(match[0]));
          } else {
            resolve({ action: 'GENERAL_CHAT' });
          }
        } catch (e) {
          resolve({ action: 'GENERAL_CHAT' });
        }
      });
    });

    req.on('error', () => resolve({ action: 'GENERAL_CHAT' }));
    req.write(postData);
    req.end();
  });
}
