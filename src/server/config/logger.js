import pino from 'pino';

import { hostname } from 'node:os';

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { pid: process.pid, hostname: hostname() },
});

export default logger;