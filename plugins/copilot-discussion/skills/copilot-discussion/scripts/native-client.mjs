import { nativeCommand } from './native-cli.mjs';
import { JevNativeTransport } from './jev-native.mjs';

// Keep one execution-only worker in the host's persistent Node runtime. The
// current host Agent still chooses each question after reading the reply.
export class NativeClient {
  constructor({ launch = options => JevNativeTransport.launch(options) } = {}) {
    this.launch = launch;
    this.transport = null;
    this.busy = false;
  }

  async command(command, request) {
    if (this.busy) throw new Error('NativeClient 正在执行另一条命令，不能并发发送。');
    this.busy = true;
    try {
      if (command === 'start' && this.transport) await this.dispose();
      return await nativeCommand(command, request, { launch: async options => {
        const reused = !!this.transport;
        if (!this.transport) this.transport = await this.launch(options);
        return new Proxy(this.transport, { get: (target, property) => {
          if (property === 'dispose') return async () => {};
          if (property === 'reused') return reused;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      } });
    } catch (error) {
      // A failed transport is never reused. The durable pending state remains;
      // the caller must inspect/collect instead of blindly sending again.
      await this.dispose();
      throw error;
    } finally { this.busy = false; }
  }

  async dispose() {
    const transport = this.transport;
    this.transport = null;
    if (transport) await transport.dispose();
  }
}
