import Koa from 'koa';
import { Server } from 'net';
import chokidar from 'chokidar';
import { promisify } from 'util';

import { EventStreamManager } from '../event-stream/EventStreamManager';
import { DevServerCoreConfig } from '../DevServerCoreConfig';
import { createServer } from './createServer';
import { Logger } from '../logger/Logger';

export class DevServer {
  public koaApp: Koa;
  public server: Server;
  public eventStreams = new EventStreamManager();
  private started = false;

  constructor(
    public config: DevServerCoreConfig,
    public logger: Logger,
    public fileWatcher = chokidar.watch([]),
  ) {
    if (!config) throw new Error('Missing config.');
    if (!logger) throw new Error('Missing logger.');

    const createResult = createServer(
      this.config,
      this.eventStreams,
      this.logger,
      this.fileWatcher,
    );
    this.koaApp = createResult.app;
    this.server = createResult.server;
  }

  async start() {
    this.started = true;
    await promisify(this.server.listen).bind(this.server)({
      port: this.config.port,
      // in case of localhost the host should be undefined, otherwise some browsers connect
      // connect to it via local network. for example safari on browserstack
      host: ['localhost', '127.0.0.1'].includes(this.config.hostname)
        ? undefined
        : this.config.hostname,
    });

    for (const plugin of this.config.plugins ?? []) {
      await plugin.serverStart?.({
        config: this.config,
        app: this.koaApp,
        server: this.server,
        logger: this.logger,
        eventStreams: this.eventStreams,
        fileWatcher: this.fileWatcher,
      });
    }
  }

  async stop() {
    if (!this.started) {
      return;
    }
    this.started = false;

    return Promise.all([
      this.fileWatcher.close(),
      new Promise(resolve => {
        this.server.close(err => {
          if (err) {
            console.error(err);
          }
          resolve();
        });
      }),
      ...(this.config.plugins ?? []).map(p => p.serverStop?.()),
    ]);
  }
}
