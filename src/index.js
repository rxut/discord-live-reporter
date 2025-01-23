#!/usr/bin/env node

import fs from 'fs';
import logger from 'winston';
import Bot from './Bot';

// Configure Winston logger
logger.configure({
  format: logger.format.combine(
    logger.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    logger.format.printf(info => `${info.level}: ${info.message}`)
  ),
  transports: [
    new logger.transports.Console()
  ]
});

function readJSONConfig(filePath) {
  const configFile = fs.readFileSync(filePath, { encoding: 'utf8' });
  try {
    return JSON.parse(configFile);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('The configuration file contains invalid JSON.');
    } else {
      throw err;
    }
  }
}

// Load the configuration file
const config = readJSONConfig(__dirname + '/../config.json');

// Initialize and connect the bot
const bot = new Bot(config);
bot.connect();
