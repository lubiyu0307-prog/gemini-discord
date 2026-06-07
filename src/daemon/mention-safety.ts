import type { MessageMentionOptions } from 'discord.js';
import type { Config } from '../shared/types.js';

export const SUPPRESS_DISCORD_MENTIONS: MessageMentionOptions = {
  parse: [],
  repliedUser: false,
};

export function resolveAllowedMentions(config: Config): MessageMentionOptions {
  const parse: Array<'users' | 'roles' | 'everyone'> = [];
  
  if (config.discordAllowedMentions && config.discordAllowedMentions.length > 0) {
    for (const val of config.discordAllowedMentions) {
      if (val === 'users' || val === 'roles' || val === 'everyone') {
        parse.push(val);
      }
    }
  } else if (!config.discordAllowedMentions) {
    // Default fallback if config doesn't have it
    parse.push('users');
  }

  return {
    parse,
    repliedUser: config.discordPingRepliedUser ?? true,
  };
}
