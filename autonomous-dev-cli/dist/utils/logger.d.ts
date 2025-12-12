export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
interface LoggerOptions {
    level: LogLevel;
    prefix?: string;
}
declare class Logger {
    private level;
    private prefix;
    constructor(options?: LoggerOptions);
    setLevel(level: LogLevel): void;
    private shouldLog;
    private formatMessage;
    debug(message: string, meta?: object): void;
    info(message: string, meta?: object): void;
    warn(message: string, meta?: object): void;
    error(message: string, meta?: object): void;
    success(message: string): void;
    failure(message: string): void;
    step(step: number, total: number, message: string): void;
    divider(): void;
    header(title: string): void;
    child(prefix: string): Logger;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map