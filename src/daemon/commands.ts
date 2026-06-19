import { 
  SlashCommandBuilder, 
  CommandInteraction, 
  Client, 
  REST, 
  Routes, 
  PermissionFlagsBits,
  AutocompleteInteraction,
  ApplicationIntegrationType,
  InteractionContextType,
  type ThreadChannel
} from 'discord.js';
import { log } from './log.js';
import type { Config } from '../shared/types.js';
import type { DaemonState } from './api.js';
import type { ConversationMemory } from './memory.js';
import { updateEnvModel } from '../shared/config.js';
import { runtimeStore } from './runtime.js';
import { resetConversationSession } from './session-reset.js';
import {
  authorizeAction,
  formatPermissionDenial,
  isBoss,
  resolveDiscordRole,
  type PermissionAction,
  type RoleContext,
} from './permissions.js';
import { createWorkflowThread } from './workflow/thread-creator.js';
import { validateWorkflowTaskSummary, WorkflowTaskValidationError } from './workflow/task-validation.js';
import { SUPPRESS_DISCORD_MENTIONS } from './mention-safety.js';

export interface WorkflowThreadCreatedEvent {
  interaction: CommandInteraction;
  thread: ThreadChannel;
  task: string;
  roleContext: RoleContext;
}

/**
 * Slash command definitions.
 */
export const COMMANDS = [
  new SlashCommandBuilder()
    .setName('new')
    .setDescription('Start a fresh Gemini conversation for this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('model')
    .setDescription('Switch the active Gemini model.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('The name of the model to use.')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the current daemon health and status.'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot latency.'),

  new SlashCommandBuilder()
    .setName('pool')
    .setDescription('Show CLI process pool status.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('kill')
    .setDescription('Kill a specific CLI pool process.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => 
      option.setName('session')
        .setDescription('Pool key to kill')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('workflow')
    .setDescription('Create a monitored workflow thread for a task.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(option =>
      option.setName('task')
        .setDescription('Description of the task to execute')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message_id')
        .setDescription('Optional ID of a message to promote to a thread')
        .setRequired(false)
    ),
];

export type CommandBuilder = (typeof COMMANDS)[number];

const DM_COMMAND_NAMES = new Set([
  'new',
  'model',
  'status',
  'ping',
  'pool',
  'kill',
  'workflow',
]);

export function buildGuildCommandPayloads(
  commands: readonly CommandBuilder[] = COMMANDS
) {
  return commands.map(cmd => {
    const { contexts, integration_types, ...guildCommand } = cmd.toJSON() as any;
    return guildCommand;
  });
}

export function buildDmOnlyGlobalCommandPayloads(
  commands: readonly CommandBuilder[] = COMMANDS
) {
  return commands
    .map((cmd) => cmd.toJSON() as any)
    .filter((command) => DM_COMMAND_NAMES.has(command.name))
    .map((command) => {
      const {
        contexts,
        integration_types,
        ...baseCommand
      } = command;

      return {
        ...baseCommand,
        contexts: [InteractionContextType.BotDM],
        integration_types: [ApplicationIntegrationType.GuildInstall],
      };
    });
}

const DEFAULT_AVAILABLE_MODELS = [
  'auto',
  'pro',
  'flash',
  'flash-lite',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

/**
 * Perform global and guild-scoped registration. Called from clientReady.
 */
export async function registerGuildCommands(client: Client, config: Config): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);

  // 1. Global registration (DM scoped only)
  try {
    const globalPayloads = buildDmOnlyGlobalCommandPayloads();
    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: globalPayloads },
    );
    log.info('Registered global slash commands (for DMs)');
  } catch (error) {
    log.error('Failed to register global commands', { error });
  }

  // 2. Guild-scoped registration (Instant updates for guilds)
  const guilds = await client.guilds.fetch();
  for (const [guildId] of guilds) {
    try {
      const guildPayloads = buildGuildCommandPayloads();
      await rest.put(
        Routes.applicationGuildCommands(client.user!.id, guildId),
        { body: guildPayloads },
      );
      log.info(`Registered slash commands for guild: ${guildId}`);
    } catch (error) {
      log.error(`Failed to register commands for guild ${guildId}`, { error });
    }
  }
}
/**
 * Set up the interaction handler for slash commands and autocomplete.
 */
export function setupInteractionHandler(
  client: Client,
  config: Config,
  state: DaemonState,
  memory: ConversationMemory,
  extensionDir: string,
  onWorkflowThreadCreated?: (event: WorkflowThreadCreatedEvent) => void,
): void {
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction, config);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const roleContext = resolveDiscordRole(config, {
      discordUserId: interaction.user.id,
      displayLabel: interaction.user.tag,
    });

    const isBossUser = isBoss(roleContext);

    // Hard gate: DM commands are strictly for Boss management.
    if (!interaction.guildId && !isBossUser) {
      await interaction.reply({
        content: 'You do not have permission to use DM bot management commands.',
        ephemeral: true,
      });
      return;
    }

    // Routing check: existing allowlists may permit command interaction, but
    // only DISCORD_BOSS_USER_ID can authorize privileged commands.
    const isAllowed = config.allowedUserIds.includes(interaction.user.id);
    const isOwner = config.ownerIds.includes(interaction.user.id);
    if (!isBossUser && !isOwner && !isAllowed) {
      await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      return;
    }

    const { commandName } = interaction;

    if (commandName === 'new') {
      if (!await authorizeInteraction(interaction, roleContext, 'session_reset')) return;
      resetConversationSession(config, memory, extensionDir, {
        channelId: interaction.channelId,
        guildId: interaction.guildId ?? null,
        authorId: interaction.guildId ? null : interaction.user.id,
      });
      await interaction.reply({
        content: '🧹 **Started a new session.** The active Discord transcript and Gemini CLI session were archived and cleared for this channel.',
        ephemeral: false,
      });
      return;
    }

    if (commandName === 'ping') {
      const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`**Pong!** Latency: \`${latency}ms\` | API: \`${Math.round(client.ws.ping)}ms\``);
      return;
    }

    if (commandName === 'status') {
      if (!await authorizeInteraction(interaction, roleContext, 'status')) return;
      const uptime = ((Date.now() - new Date(state.startedAt).getTime()) / 1000 / 60).toFixed(1);
      let poolInfo = 'Not initialized';
      if (runtimeStore.cliPool) {
        const pStatus = runtimeStore.cliPool.status();
        poolInfo = `Active: ${pStatus.busy} | Idle: ${pStatus.idle} | Max: ${pStatus.maxSize}`;
      }

      const statusMsg = `**Daemon Status**
- **Status:** \`${state.status}\`
- **Model:** \`${config.geminiModel}\`
- **Uptime:** \`${uptime}m\`
- **Messages Handled:** \`${state.messagesHandled}\`
- **Gemini Reachable:** \`${state.geminiReachable ? 'Yes' : 'No'}\`
- **Latency:** \`${Math.round(client.ws.ping)}ms\`
- **Streaming:** \`${config.streaming ? 'Enabled' : 'Disabled'}\`
- **CLI Pool:** \`${poolInfo}\``;
      await interaction.reply({ content: statusMsg, ephemeral: true });
      return;
    }

    if (commandName === 'pool') {
      if (!await authorizeInteraction(interaction, roleContext, 'status')) return;
      if (!runtimeStore.cliPool) {
        await interaction.reply({ content: 'CLI pool is not initialized.', ephemeral: true });
        return;
      }

      const pStatus = runtimeStore.cliPool.status();
      const lines = [`**CLI Process Pool** (\`Active: ${pStatus.busy} | Idle: ${pStatus.idle} | Max: ${pStatus.maxSize}\`)`];
      
      for (const p of pStatus.processes) {
        const aliveMin = Math.round(p.aliveMs / 60000);
        const activeSec = Math.round(p.lastActivityMs / 1000);
        const state = p.busy ? '**(busy)**' : '';
        lines.push(`- \`${p.poolKey}\` — alive ${aliveMin}m, last activity ${activeSec}s ago ${state}`);
      }

      if (lines.length === 1) {
        lines.push('- *No active processes*');
      }

      await interaction.reply({ content: lines.join('\n'), ephemeral: true });
      return;
    }

    if (commandName === 'kill') {
      if (!await authorizeInteraction(interaction, roleContext, 'admin_command')) return;

      const poolKey = interaction.options.getString('session', true);
      if (!runtimeStore.cliPool) {
        await interaction.reply({ content: 'CLI pool is not initialized.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `**Process killed:** \`${poolKey}\``, ephemeral: true });
      runtimeStore.cliPool.kill(poolKey);
      return;
    }

    if (commandName === 'model') {
      if (!await authorizeInteraction(interaction, roleContext, 'model_config')) return;

      const newModel = interaction.options.getString('name', true).trim();
      const oldModel = config.geminiModel;

      if (!isValidModelId(newModel)) {
        await interaction.reply({
          content: 'Invalid model. Use a Gemini model id or alias containing only letters, numbers, dots, dashes, underscores, or slashes.',
          ephemeral: true,
        });
        return;
      }

      const poolStatus = runtimeStore.cliPool?.status();
      if (poolStatus && poolStatus.busy > 0) {
        await interaction.reply({
          content: 'Gemini is busy handling an active turn. Try the model switch again after the current response finishes.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      try {
        await updateEnvModel(extensionDir, newModel);
        config.geminiModel = newModel;
        runtimeStore.cliPool?.killAll();

        await interaction.editReply(`**Model switched successfully.**
- From: \`${oldModel}\`
- To: \`${newModel}\`
The next turn will start with the new model.`);
      } catch (error) {
        log.error('Model switch failed', { error: error instanceof Error ? error.message : String(error) });
        await interaction.editReply(`**Model switch failed.**
Error: \`${error instanceof Error ? error.message : String(error)}\`
Action: Reverted to \`${oldModel}\`.`);
      }
      return;
    }

    if (commandName === 'workflow') {
      if (!await authorizeInteraction(interaction, roleContext, 'admin_command')) return;

      let task = interaction.options.getString('task', true);
      const messageId = interaction.options.getString('message_id') ?? undefined;

      try {
        task = validateWorkflowTaskSummary(task);
      } catch (error) {
        const message = error instanceof WorkflowTaskValidationError ? error.message : String(error);
        await interaction.reply({
          content: `❌ ${message}`,
          ephemeral: true,
          allowedMentions: SUPPRESS_DISCORD_MENTIONS,
        });
        return;
      }

      await interaction.deferReply();

      try {
        const { threadId, thread } = await createWorkflowThread(
          client,
          config,
          extensionDir,
          {
            taskSummary: task,
            creatorUserId: interaction.user.id,
            sourceChannelId: interaction.channelId,
            sourceMessageId: messageId,
          }
        );
        await interaction.editReply({
          content: `🧹 **Monitored Workflow Thread Created:** <#${threadId}>`,
          allowedMentions: SUPPRESS_DISCORD_MENTIONS,
        });
        onWorkflowThreadCreated?.({ interaction, thread, task, roleContext });
      } catch (error) {
        log.error('Failed to create workflow thread from slash command', { error: error instanceof Error ? error.message : String(error) });
        await interaction.editReply({
          content: `❌ **Failed to create workflow thread:** ${error instanceof Error ? error.message : String(error)}`,
          allowedMentions: SUPPRESS_DISCORD_MENTIONS,
        });
      }
      return;
    }
  });
}

async function authorizeInteraction(
  interaction: CommandInteraction,
  roleContext: RoleContext,
  action: PermissionAction,
): Promise<boolean> {
  const decision = authorizeAction(action, roleContext);
  if (decision.decision === 'allow') {
    return true;
  }

  await interaction.reply({ content: formatPermissionDenial(decision), ephemeral: true });
  return false;
}


async function handleAutocomplete(interaction: AutocompleteInteraction, config: Config): Promise<void> {
  const focusedValue = interaction.options.getFocused();
  const models = [...new Set([
    ...DEFAULT_AVAILABLE_MODELS,
    ...(config.geminiAvailableModels ?? []),
  ])];
  const filtered = models.filter(choice => choice.startsWith(focusedValue));
  await interaction.respond(
    filtered.map(choice => ({ name: choice, value: choice })),
  );
}

function isValidModelId(model: string): boolean {
  return /^[A-Za-z0-9._/-]{1,128}$/.test(model);
}
