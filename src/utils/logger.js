// ===============================================
// Logger Utility
// ===============================================

const colors = {
 reset: '\x1b[0m',
 red: '\x1b[31m',
 green: '\x1b[32m',
 yellow: '\x1b[33m',
 blue: '\x1b[34m',
 magenta: '\x1b[35m',
 cyan: '\x1b[36m'
};

export const logger = {
 info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${new Date().toISOString()} - ${msg}`),
 warn: (msg) => console.warn(`${colors.yellow}[WARN]${colors.reset} ${new Date().toISOString()} - ${msg}`),
 error: (msg) => console.error(`${colors.red}[ERROR]${colors.reset} ${new Date().toISOString()} - ${msg}`),
 success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${new Date().toISOString()} - ${msg}`)
};