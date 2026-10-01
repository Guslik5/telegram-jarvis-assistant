/**
 * Robust Markdown to Telegram HTML converter
 * Handles bold, italic, headers, inline code, code blocks, links, bullets, and escaping.
 */
export function markdownToTelegramHtml(md) {
  if (!md) return '';

  // 1. Extract code blocks first (to prevent HTML escaping / markdown parsing inside code)
  const codeBlocks = [];
  let text = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    codeBlocks.push(`<pre><code>${escapedCode}</code></pre>`);
    return placeholder;
  });

  // 2. Extract inline code
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `___INLINE_CODE_${inlineCodes.length}___`;
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    inlineCodes.push(`<code>${escapedCode}</code>`);
    return placeholder;
  });

  // 3. Escape HTML special characters in plain text
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 4. Headers: ### Header / ## Header / # Header -> <b>Header</b>
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // 5. Bold: **text** or __text__
  text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

  // 6. Italic: *text* (when not preceded or followed by *)
  text = text.replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '<i>$1</i>');

  // 7. Links: [text](https://...)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 8. Bullet points: lines starting with * or - -> •
  text = text.replace(/^[\*\-]\s+/gm, '• ');

  // 9. Horizontal rule: --- -> ———
  text = text.replace(/^---$/gm, '───────────');

  // 10. Restore code blocks and inline code
  inlineCodes.forEach((code, i) => {
    text = text.replace(`___INLINE_CODE_${i}___`, code);
  });
  codeBlocks.forEach((code, i) => {
    text = text.replace(`___CODE_BLOCK_${i}___`, code);
  });

  return text;
}

/**
 * Sends a message using Telegram HTML mode, with fallback to plain text if parsing errors occur.
 * Automatically splits messages if longer than 4000 characters.
 */
export async function sendTelegramFormatted(ctx, text) {
  if (!text) return;

  const html = markdownToTelegramHtml(text);

  // Split into chunks if > 4000 chars
  const chunks = [];
  if (html.length <= 4000) {
    chunks.push(html);
  } else {
    let remaining = html;
    while (remaining.length > 0) {
      if (remaining.length <= 4000) {
        chunks.push(remaining);
        break;
      }
      let splitIndex = remaining.lastIndexOf('\n', 4000);
      if (splitIndex === -1 || splitIndex < 2000) {
        splitIndex = 4000;
      }
      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }
  }

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (err) {
      console.error('[FORMATTER] HTML parse failed, falling back to plain text:', err.message);
      // Fallback to plain text without tags
      const plainText = text.replace(/<[^>]*>/g, '');
      await ctx.reply(plainText);
    }
  }
}
