import logger from 'winston';
import net from 'net';
import { EventEmitter } from 'events';

class TCPServer extends EventEmitter {
  constructor(serverConfig) {
    super();

    this.name = serverConfig.name;
    this.port = serverConfig.port;
    this.password = serverConfig.password;
    this.channel = serverConfig.channel;
    this.debug = serverConfig.debug;
    this.authed = false;
  }

  start() {
    logger.info(`Starting TCP server ${this.name} on port ${this.port}...`);
    this.server = net.createServer(socket => this.onClientConnected(socket));
    this.addListeners();
  }

  addListeners() {
    this.server.on('error', error => {
      logger.error(`Error on server ${this.name}:`, error);
    });

    this.server.listen(this.port, () => {
      const address = this.server.address();
      logger.info(`Server ${this.name} listening on ${address.address}:${address.port}`);
    });
  }

  /**
   * Client connected
   */
  onClientConnected(socket) {
    // if (this.socket) {
    //   return;
    // }
    this.socket = socket;
    // this.socket.setTimeout(0);

    const clientName = this.clientName();
    logger.info(`${clientName} connected!`);

    this.socket.on('data', this.onClientData.bind(this));

    this.socket.on('error', error => {
      logger.error(`${clientName} errored.`, error);
      this.onClientDisconnected();
    });

    // this.socket.on('close', (hasError) => {
    //   logger.info(`${clientName} terminated`, hasError);
    //   // this.onClientDisconnected();
    // });

    this.socket.on('timeout', () => {
      logger.info(`${clientName} timed out.`);
      this.onClientDisconnected();
    });

    this.socket.on('end', () => {
      logger.info(`${clientName} disconnected.`);
      this.onClientDisconnected();
    });
  }

  /**
   * Client data reveived
   */
  onClientData(data) {
    const clientName = this.clientName();

    // Get the message string and trim new line characters
    const message = data.toString().replace(/[\n\r]*$/, '');
    if (this.debug) {
      logger.info(`${clientName}: ${message}`);
    }

    // Authentication
    if (!this.authed) {
      if (message === `PASS ${this.password}`) {
        logger.info(`${clientName} logged in to ${this.name}.`);
        this.socket.write('200\r\n'); // OK
        this.authed = true;
      } else {
        this.socket.write('401\r\n'); // Unauthorized
      }
      return;
    }

    // Make sure the password is never exposed
    if (message.startsWith('PASS')) {
      logger.warn(`Password was sent when already authed on ${this.name}...`);
      return;
    }

    // Emit data event with server identification
    this.emit('data', { message, server: this.name, channel: this.channel });
  }

  /**
   * Client disconnected
   */
  onClientDisconnected() {
    logger.info(`Cleaning up client (${this.clientName()}).`);
    this.socket.destroy();
    this.socket = null;
    this.authed = false;
  }

  /**
   * Client name
   */
  clientName() {
    return `${this.name} Client`;
  }
}

export default TCPServer;
