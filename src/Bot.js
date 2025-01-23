import { Client, GatewayIntentBits, Events, ChannelType } from 'discord.js';
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
   * Handle server message
   */
  async handleServerMessage(data) {
    const { message, channel } = data;
    const discordChannel = this.channels.get(channel);
    
    if (discordChannel) {
      try {
        await discordChannel.send(message);
      } catch (error) {
        logger.error(`Failed to send message to channel ${channel}:`, error);
      }
    } else {
      logger.error(`No Discord channel found for ID ${channel}`);
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