import * as core from '@actions/core';
import axios from 'axios';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

function getConfig() {
  const token = core.getInput('telegram-bot-token');
  const chatId = core.getInput('telegram-chat-id');
  return { token, chatId };
}

export function isEnabled(): boolean {
  const { token, chatId } = getConfig();
  return Boolean(token && chatId);
}

export async function sendMessage(text: string): Promise<void> {
  const { token, chatId } = getConfig();

  if (!token || !chatId) {
    return;
  }

  try {
    await axios.post(`${TELEGRAM_API_BASE}${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[Telegram] Failed to send message: ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`[Telegram] Failed to send message: ${error.message}`);
    } else {
      console.error('[Telegram] Failed to send message:', error);
    }
  }
}
