import "dotenv/config";

interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

interface TelegramResponse {
  ok: boolean;
  result?: {
    message_id: number;
    date: number;
    text: string;
  };
  error_code?: number;
  description?: string;
}

interface SendTelegramOptions {
  message: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
}

/**
 * Escape special characters for Telegram MarkdownV2 format
 * Based on Telegram Bot API documentation: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
  const specialChars = [
    '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'
  ];
  
  let escaped = text;
  for (const char of specialChars) {
    escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`);
  }
  
  return escaped;
}

/**
 * Get the Telegram bot token from environment variables
 */
function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
  }
  return token;
}

/**
 * Get the list of Telegram chat IDs from environment variables
 * You can easily get the chat ID by sending a message to the bot and then navigating to https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates in your browser.
 */
function getTelegramChatIds(): string[] {
  const chatIds = process.env.TELEGRAM_CHAT_IDS;
  if (!chatIds) {
    throw new Error("TELEGRAM_CHAT_IDS environment variable is not set");
  }

  // Split by comma and trim whitespace
  return chatIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Send a message to a single Telegram chat
 */
async function sendTelegramMessage(
  chatId: string,
  options: SendTelegramOptions
): Promise<TelegramResponse> {
  const botToken = getTelegramBotToken();
  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const message: TelegramMessage = {
    chat_id: chatId,
    text: options.message,
    parse_mode: options.parseMode,
    disable_web_page_preview: options.disableWebPagePreview,
    disable_notification: options.disableNotification,
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Telegram API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data: TelegramResponse = await response.json();

    if (!data.ok) {
      throw new Error(
        `Telegram API returned error: ${data.error_code} - ${data.description}`
      );
    }

    return data;
  } catch (error) {
    console.error(`Failed to send Telegram message to ${chatId}:`, error);
    throw error;
  }
}

/**
 * Send a message to all configured Telegram recipients. Rejects when the
 * recipients are not configured, so callers go through sendSystemAlert,
 * which never rejects.
 */
async function sendTelegramNotification(
  message: string,
  options: Partial<SendTelegramOptions> = {}
): Promise<{ success: boolean; sentTo: string[]; errors: string[] }> {
  const defaultOptions: SendTelegramOptions = {
    message,
    parseMode: "HTML",
    disableWebPagePreview: false,
    disableNotification: false,
  };

  const finalOptions = { ...defaultOptions, ...options };
  const chatIds = getTelegramChatIds();
  const results = {
    success: true,
    sentTo: [] as string[],
    errors: [] as string[],
  };

  console.log(`Sending Telegram notification to ${chatIds.length} recipients`);

  // Send to all chat IDs
  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(chatId, finalOptions);
      results.sentTo.push(chatId);
      console.log(`Successfully sent Telegram message to ${chatId}`);
    } catch (error) {
      results.success = false;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      results.errors.push(`${chatId}: ${errorMessage}`);
      console.error(`Failed to send Telegram message to ${chatId}:`, error);
    }
  }

  return results;
}

/**
 * Send a system alert message to all Telegram recipients
 */
export async function sendSystemAlert(
  title: string,
  message: string,
  level: "info" | "warning" | "error" = "info"
): Promise<void> {
  try {
    const emoji = {
      info: "ℹ️",
      warning: "⚠️",
      error: "🚨",
    };

    // Escape both title and message for MarkdownV2
    const escapedTitle = escapeMarkdownV2(title);
    const escapedMessage = escapeMarkdownV2(message);
    
    const formattedMessage = `*${emoji[level]} ${escapedTitle}*\n\n${escapedMessage}`;

    console.log("Sending Telegram notification for system alert:", formattedMessage);

    await sendTelegramNotification(formattedMessage, {
      parseMode: "MarkdownV2",
      disableWebPagePreview: true,
    });
  } catch (error) {
    console.error(
      "Failed to send Telegram notification for system alert:",
      error
    );
  }
}
