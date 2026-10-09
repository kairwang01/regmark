// Command-line entry: runs one fixture shop on 127.0.0.1 until interrupted.
//
//   node fixtures/shop/src/serve.ts --mode misprint --port 4010

import { parseArgs } from 'node:util';
import { startShop } from './server.ts';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'misprint' },
    port: { type: 'string', default: '4010' },
  },
});

const mode = String(values.mode);
const port = Number(values.port);
if ((mode !== 'clean' && mode !== 'misprint') || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('usage: serve.ts [--mode clean|misprint] [--port 0-65535]');
  process.exit(2);
}

const running = await startShop({ mode, port });
console.log(`fixture shop (${mode}) listening on ${running.origin}`);

// Closing the socket on signal lets an in-flight request finish before the process exits.
const stop = () => {
  running.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
