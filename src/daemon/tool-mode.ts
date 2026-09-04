export type ToolMode = 'chat' | 'web' | 'discord' | 'web_discord' | 'full';

// 中文觸發（露比 2026-09-05）：原本只認英文，中文講「幫我查」永遠停在 chat。
const ZH_WEB_PATTERNS = [
  /(?:幫我|替我)?(?:查|搜|搜尋|google|估狗|上網|找找看|查一下|查查|查資料|搜一下)/i,
  /(?:最新|新聞|天氣|氣象|價格|股價|匯率|營業時間|幾點開|開到幾點|地址|評價|網址|連結)/,
];
const ZH_DISCORD_PATTERNS = [
  /(?:傳|發|貼|丟|放|送)(?:到|去|進|上)(?:.{0,8})?(?:頻道|群|那邊|那裡)/,
  /(?:頻道|討論串)(?:.{0,6})?(?:的)?(?:歷史|紀錄|之前的訊息|剛剛的訊息)/,
  /(?:翻|看|讀)(?:一下)?(?:之前|剛剛|上面|前面)的(?:訊息|對話|紀錄)/,
  /(?:排程|定時|每天|每週|每周|提醒我|到時候叫我|幾點叫我)/,
  /(?:狀態|重置|重來|清掉|新的對話|新對話)/,
];
const ZH_FULL_PATTERNS = [
  /(?:跑|執行|運行)(?:一下|個|這個|那個)?(?:指令|命令|程式|腳本|script|command)/i,
  /(?:幫我)?(?:跑|算|統計|整理|分析|轉換|處理).{0,6}(?:資料|數據|檔案|表格|報表|csv|json|excel)/i,
  /(?:csv|json|excel|表格|檔案|檔|報表|結果|圖)\s*(?:傳|寄|送|丟)(?:給我|過來|上來)/i,
  /(?:寫|建|建立|產生|做|存成|輸出成|匯出成)(?:一個|一份|個|成)?(?:檔案|檔|文件|表格|csv|json|txt|md|程式|腳本)/i,
  /(?:讀|開|看|改|修改|編輯|刪)(?:一下|個)?(?:檔案|檔|這個檔|那個檔|程式碼|code)/i,
  /(?:傳|寄|送|丟)(?:檔案|檔|圖|截圖|報表|結果)(?:給我|過來|上來)/,
  /(?:把|將).{0,20}(?:傳|寄|送|丟)給我/,
];

const EXPLICIT_WEB_TOOL_PATTERNS = [
  /\bsearch(?: the web| online)?\b/i,
  /\bweb\s*search\b/i,
  /\blook\s*up\b/i,
  /\blookup\b/i,
  /\bresearch\b/i,
  /\bbrowse\b/i,
  /\bgoogle\b/i,
  /\bfind online\b/i,
  /\bcheck online\b/i,
  /\bverify online\b/i,
  /\buse tools?\b/i,
  /\buse search\b/i,
  /(?:https?:\/\/)?(?:www\.)?reddit\.com/i,
  /(?:https?:\/\/)?(?:www\.)?github\.com/i,
  /(?:https?:\/\/)?(?:www\.)?stackoverflow\.com/i,
];

const DISCORD_ACTION_PATTERNS = [
  /\bsend (?:a )?(?:message|reply)\b/i,
  /\bpost (?:a )?(?:message|reply|reminder|update)\b/i,
  /\bremind(?: me)?\b/i,
  /\breminder\b/i,
  /\bcron\b/i,
  /\bschedule\b/i,
  /\bmonitor\b/i,
  /\breport back\b/i,
  /\bfollow up\b/i,
  /\bcheck back\b/i,
  /\b(?:list|show|discover|find) (?:the )?channels?\b/i,
  /\b(?:create|start|make|open) (?:a )?(?:new )?(?:discord )?thread\b/i,
  /\bthread (?:called|named)\b/i,
  /\bdiscord\b/i,
  /\breply to\b/i,
  /\breset (?:the )?(?:session|conversation)\b/i,
  /\bstart (?:a )?new session\b/i,
  /\bhistory\b/i,
  /\bfind (?:an |the )?image\b/i,
  /\b(?:find|send|attach|fetch|get|grab|show|upload)\b.*\b(?:media|file|image|photo|picture|screenshot|video|movie|audio|song|music|clip|gif)\b/i,
  /\b(?:media|file|image|photo|picture|screenshot|video|movie|audio|song|music|clip|gif)\b.*\b(?:from|on) (?:my|the) (?:device|computer|mac|machine)\b/i,
  /\brandom (?:media|file|image|photo|picture|video|movie|audio|song|clip|gif)\b/i,
];

const CHANNEL_DELIVERY_ACTIONS = 'send|post|write|put|drop|move|copy';
const CHANNEL_DELIVERY_REQUEST_RE = new RegExp(
  `\\b(?:${CHANNEL_DELIVERY_ACTIONS})\\b[\\s\\S]*?\\b(?:to|in|into)\\s+([^.!?\\n,;]+)`,
  'gi',
);
const OWN_ACTION_ADVICE_PREFIX_RE = new RegExp(
  '\\b(?:(?:what|where|when)\\s+(?:should|can|could|would)|how\\s+(?:do|can|should|could|would)|should|can|could|would)\\s+(?:i|we)\\s+$',
  'i',
);

const FULL_TOOL_PATTERNS = [
  /\buse full tools?\b/i,
  /\bterminal\b/i,
  /\bshell\b/i,
  /\brun (?:a |the )?command\b/i,
  /\bexecute (?:a |the )?command\b/i,
  /\bedit (?:the )?(?:code|file|project)\b/i,
  /\bmodify (?:the )?(?:code|file|project)\b/i,
  /\bpatch (?:the )?(?:code|file|project)\b/i,
  /\binspect (?:the )?repo\b/i,
  /\bwork on (?:the )?codebase\b/i,
];

const FRESHNESS_SENSITIVE_PATTERNS = [
  /\blatest\b/i,
  /\bcurrent\b/i,
  /\btoday'?s?\b/i,
  /\bnow\b/i,
  /\brecent\b/i,
  /\bnewest\b/i,
  /\bjust released\b/i,
  /\brelease(?:d| date)?\b/i,
  /\bchapter\b/i,
  /\bepisode\b/i,
  /\bprice\b/i,
  /\bscore\b/i,
  /\bweather\b/i,
  /\bversion\b/i,
  /\bupdate(?:d|s)?\b/i,
  /\boutage\b/i,
  /\btrending\b/i,
];

/**
 * Resolve whether the user is explicitly asking for a tool-heavy turn.
 * Used for UX (placeholder timing) and --allowed-tools selection.
 */
export function resolveToolMode(content: string): ToolMode {
  const normalized = content.trim();
  if (!normalized) {
    return 'chat';
  }

  if (FULL_TOOL_PATTERNS.some((pattern) => pattern.test(normalized)) || ZH_FULL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'full';
  }

  const contentForFreshness = withoutExplicitChannelDeliveryTargets(normalized);
  const wantsWeb = (
    EXPLICIT_WEB_TOOL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    FRESHNESS_SENSITIVE_PATTERNS.some((pattern) => pattern.test(contentForFreshness)) ||
    ZH_WEB_PATTERNS.some((pattern) => pattern.test(normalized))
  );
  const wantsDiscord = (
    DISCORD_ACTION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    hasExplicitChannelDeliveryIntent(normalized) ||
    ZH_DISCORD_PATTERNS.some((pattern) => pattern.test(normalized))
  );

  if (wantsWeb && wantsDiscord) {
    return 'web_discord';
  }

  if (wantsDiscord) {
    return 'discord';
  }

  if (wantsWeb) {
    return 'web';
  }

  return 'chat';
}

function hasExplicitChannelDeliveryIntent(content: string): boolean {
  CHANNEL_DELIVERY_REQUEST_RE.lastIndex = 0;
  for (let match = CHANNEL_DELIVERY_REQUEST_RE.exec(content); match; match = CHANNEL_DELIVERY_REQUEST_RE.exec(content)) {
    if (OWN_ACTION_ADVICE_PREFIX_RE.test(content.slice(0, match.index))) {
      continue;
    }
    if (isExplicitChannelTarget(match[1] ?? '')) {
      return true;
    }
  }

  return false;
}

function withoutExplicitChannelDeliveryTargets(content: string): string {
  return content.replace(CHANNEL_DELIVERY_REQUEST_RE, (match, target: string) => (
    isExplicitChannelTarget(target) ? '' : match
  ));
}

function isExplicitChannelTarget(rawTarget: string): boolean {
  const target = rawTarget.trim().replace(/^["'`]+|["'`]+$/g, '').toLowerCase();
  if (!target) {
    return false;
  }
  const targetWithoutArticle = target.replace(/^(?:the|a)\s+/, '');

  if (/^<#[0-9]{15,25}>/.test(targetWithoutArticle)) {
    return true;
  }

  if (/^#[a-z0-9_-]+(?:\s+channel)?\b/i.test(targetWithoutArticle)) {
    return true;
  }

  if (/^(?:(?:the|a)\s+)?(?:another|other|different|separate|specific)\s+channel\b/.test(target)) {
    return true;
  }

  if (/^(?:(?:the|a|this|that|my|our|your)\s+)?(?:current|same|origin|source|this|that)\s+channel\b/.test(target)) {
    return false;
  }

  if (/^(?:the|a|my|our|your)\s+channel\b/.test(target)) {
    return false;
  }

  if (/^(?:(?:the|a|my|our|your)\s+)?[a-z0-9][a-z0-9_-]*(?:\s+[a-z0-9][a-z0-9_-]*)*\s+channel\b/i.test(target)) {
    return true;
  }

  return /^[a-z0-9][a-z0-9_-]*-channel\b/i.test(target);
}
