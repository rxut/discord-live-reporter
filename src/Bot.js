import { Client, GatewayIntentBits, Events, ChannelType, EmbedBuilder } from 'discord.js';
import logger from 'winston';
import packageJson from '../package.json';
import TCPServer from './TCPServer';

class Bot {
  constructor(config) {
    this.config = config;
    this.discord = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    this.channels = new Map();
    this.servers = new Map();
    this.messageBuffer = new Map(); // Buffer for split messages
    this.messageTimeouts = new Map(); // Timeouts for message cleanup
  }

  async connect() {
    logger.info('Connecting to Discord ...');
    await this.discord.login(this.config.token);
    this.addListeners();

    // Initialize TCP servers
    for (const serverConfig of this.config.servers) {
      const server = new TCPServer({
        ...serverConfig,
        debug: this.config.debug
      });
      server.on('data', data => this.handleServerMessage(data));
      server.start();
      this.servers.set(serverConfig.name, server);
    }
  }

  addListeners() {
    this.discord.on(Events.ClientReady, async () => {
      logger.info('Connected to Discord');

      // Get all channels
      for (const serverConfig of this.config.servers) {
        try {
          const channel = await this.discord.channels.fetch(serverConfig.channel);
          if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error(`Invalid channel or channel type for server ${serverConfig.name}`);
          }
          this.channels.set(serverConfig.channel, channel);
        } catch (error) {
          logger.error(`Failed to fetch channel for server ${serverConfig.name}:`, error);
        }
      }
    });

    this.discord.on(Events.MessageCreate, message => this.parseMessage(message));

    this.discord.on(Events.Warn, warning => {
      logger.warn('Received warn event from Discord:', warning);
    });

    this.discord.on(Events.Error, error => {
      logger.error('Received error event from Discord:', error);
    });
  }

  /**
   * Create a game status embed
   */
  createGameStatusEmbed(data) {
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle(data.serverName)
      .setDescription(`${data.gameMode} • ${data.map} • ${data.timeRemaining}`);

    // Add Red Team field
    if (data.redTeam && data.redTeam.players.length > 0) {
      const redTeamText = data.redTeam.players
        .map(p => `${p.name} ${p.score} (${p.efficiency}% Effi)`)
        .join('\n');
      embed.addFields({
        name: `🔴 Red Team [${data.redTeam.score} frags]`,
        value: redTeamText,
        inline: true
      });
    }

    // Add Blue Team field
    if (data.blueTeam && data.blueTeam.players.length > 0) {
      const blueTeamText = data.blueTeam.players
        .map(p => `${p.name} ${p.score} (${p.efficiency}% Effi)`)
        .join('\n');
      embed.addFields({
        name: `🔵 Blue Team [${data.blueTeam.score} frags]`,
        value: blueTeamText,
        inline: true
      });
    }

    // Add spectators if any
    if (data.spectators && data.spectators.length > 0) {
      const specText = data.spectators
        .map(s => s.name)
        .join(', ');
      embed.addFields({
        name: `👁️ ${data.spectators.length} ${data.spectators.length === 1 ? 'Spectator' : 'Spectators'}`,
        value: specText,
        inline: false
      });
    } else if (data.spectators) {
      embed.addFields({
        name: '👁️ No Spectators',
        value: '\u200B', // Zero-width space to satisfy Discord's requirement for non-empty field values
        inline: false
      });
    }

    // Add server info
    if (data.serverIP && data.serverIP !== 'unreal://') {
      embed.addFields({
        name: 'Server IP',
        value: `\`${data.serverIP}\``,
        inline: false
      });
    }

    // Set timestamp
    embed.setTimestamp();

    return embed;
  }

  /**
   * Clean up message buffer for a channel
   */
  cleanupMessageBuffer(channel) {
    this.messageBuffer.delete(channel);
    const timeout = this.messageTimeouts.get(channel);
    if (timeout) {
      clearTimeout(timeout);
      this.messageTimeouts.delete(channel);
    }
  }

  /**
   * Handle split messages with improved error handling and timeout
   */
  handleSplitMessage(data, channel) {
    try {
      // First try to parse the outer SPLIT_MSG wrapper
      let splitMessage;
      try {
        const messageData = data.substring(10); // Remove "SPLIT_MSG:"
        splitMessage = JSON.parse(messageData);
      } catch (parseError) {
        logger.error('Failed to parse split message wrapper:', parseError);
        logger.error('Raw message data:', data);
        logger.error('Extracted message data:', data.substring(10));
        return null;
      }

      const { chunk, total, data: messageData } = splitMessage;
      
      // Validate chunk data
      if (!Number.isInteger(chunk) || chunk < 1 || 
          !Number.isInteger(total) || total < 1 || 
          chunk > total || 
          typeof messageData !== 'string') {
        logger.error('Invalid split message format:', splitMessage);
        return null;
      }

      // Get or create buffer for this channel
      let channelBuffer = this.messageBuffer.get(channel);
      if (!channelBuffer) {
        channelBuffer = new Map();
        this.messageBuffer.set(channel, channelBuffer);

        // Set timeout to clean up incomplete messages
        const timeout = setTimeout(() => {
          logger.warn(`Cleaning up incomplete message buffer for channel ${channel}`);
          this.cleanupMessageBuffer(channel);
        }, 30000); // 30 second timeout

        this.messageTimeouts.set(channel, timeout);
      }

      // Store this chunk
      channelBuffer.set(chunk, messageData);

      // Check if we have all chunks
      if (channelBuffer.size === total) {
        try {
          // Reassemble message in correct order
          let fullMessage = '';
          for (let i = 1; i <= total; i++) {
            const chunkData = channelBuffer.get(i);
            if (!chunkData) {
              throw new Error(`Missing chunk ${i} of ${total}`);
            }
            fullMessage += chunkData;
          }

          // Clean up
          this.cleanupMessageBuffer(channel);

          // For GAME_STATUS messages, validate the JSON structure
          if (fullMessage.startsWith('GAME_STATUS:')) {
            try {
              const gameStatus = JSON.parse(fullMessage.substring(12));
              // Validate required fields
              if (!gameStatus.serverName || !gameStatus.gameMode || !gameStatus.map) {
                throw new Error('Missing required fields in game status');
              }
            } catch (jsonError) {
              logger.error('Invalid game status JSON:', jsonError);
              logger.error('Game status data:', fullMessage.substring(12));
              return null;
            }
          }

          return fullMessage;
        } catch (error) {
          logger.error('Error reassembling message:', error);
          this.cleanupMessageBuffer(channel);
          return null;
        }
      }

      return null; // Still waiting for more chunks
    } catch (error) {
      logger.error('Unexpected error in handleSplitMessage:', error);
      this.cleanupMessageBuffer(channel);
      return null;
    }
  }

  /**
   * Handle server message with improved error handling
   */
  async handleServerMessage(data) {
    const { message, channel } = data;
    const discordChannel = this.channels.get(channel);
    
    if (!discordChannel) {
      logger.error(`No Discord channel found for ID ${channel}`);
      return;
    }

    try {
      // Split incoming message by double newline to handle multiple messages
      const messages = message.split(/\r\n\r\n|\n\n/).filter(msg => msg.trim());
      
      for (const msg of messages) {
        let processedMessage = msg.trim();

        // Handle split messages
        if (processedMessage.startsWith('SPLIT_MSG:')) {
          processedMessage = this.handleSplitMessage(processedMessage, channel);
          if (!processedMessage) {
            // Not all chunks received yet or error occurred
            continue;
          }
        }

        // Check if message is a game status update
        if (processedMessage.startsWith('GAME_STATUS:')) {
          try {
            const statusData = JSON.parse(processedMessage.substring(12));
            const embed = this.createGameStatusEmbed(statusData);
            await discordChannel.send({ embeds: [embed] });
          } catch (error) {
            logger.error('Failed to process game status update:', error);
            logger.error('Problematic message:', processedMessage);
          }
        } else {
          // Regular message
          await discordChannel.send(processedMessage);
        }
      }
    } catch (error) {
      logger.error(`Failed to handle message for channel ${channel}:`, error);
      logger.error('Raw message:', message);
      this.cleanupMessageBuffer(channel);
    }
  }

  /**
   * Parse Discord messages
   */
  parseMessage(message) {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Parse command and arguments
    if (message.content.startsWith(this.config.prefix)) {
      const content = message.content.toLowerCase();
      const args = content.trim().split(/\s+/);
      const command = args.shift().substr(1);

      if (command.length) {
        this.command(command, args, message);
      }
    }
  }

  /**
   * Command
   */
  command(command, args, message) {
    switch (command) {
      case 'info':
      case 'about':
      case 'version': {
        this.info(args, message);
        break;
      }
    }
  }

  /**
   * Info command
   */
  async info(args, message) {
    try {
      await message.channel.send(
        `${packageJson.description} v${packageJson.version} - ${packageJson.url}`
      );
    } catch (error) {
      logger.error('Failed to send info message:', error);
    }
  }
}

export default Bot;