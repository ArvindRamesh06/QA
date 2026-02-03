export class Logger {
    private context: string;

    constructor(context: string) {
        this.context = context;
    }

    private getTimestamp(): string {
        return new Date().toISOString();
    }

    private formatMessage(level: string, message: string, meta?: any): string {
        const timestamp = this.getTimestamp();
        let formattedMeta = '';
        if (meta) {
            if (typeof meta === 'object') {
                formattedMeta = `\n${JSON.stringify(meta, null, 2)}`;
            } else {
                formattedMeta = ` ${meta}`;
            }
        }
        return `[${timestamp}] [${level.toUpperCase()}] [${this.context}]: ${message}${formattedMeta}`;
    }

    info(message: string, meta?: any) {
        console.log(this.formatMessage('INFO', message, meta));
    }

    warn(message: string, meta?: any) {
        console.warn(this.formatMessage('WARN', message, meta));
    }

    error(message: string, meta?: any) {
        console.error(this.formatMessage('ERROR', message, meta));
    }

    debug(message: string, meta?: any) {
        // Only log debug if needed, or just standard log for now
        console.log(this.formatMessage('DEBUG', message, meta));
    }

    // Section header for readability
    section(title: string) {
        console.log(`\n===============================================================`);
        console.log(`🔷 [${this.context}] ${title}`);
        console.log(`===============================================================\n`);
    }
}
