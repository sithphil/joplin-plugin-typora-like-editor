import joplin from "api";
import * as path from "path";
import * as os from "os";
const fs = joplin.require("fs-extra");

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

/**
 * 日志配置
 */
interface LoggerConfig {
  level: LogLevel;
  consoleEnabled: boolean;
  fileEnabled: boolean;
  logDir?: string;
}

/**
 * 日志记录器类
 */
class Logger {
  private config: LoggerConfig;
  private logFilePath: string | null = null;
  private pluginName: string;
  private initialized: boolean = false;

  constructor(pluginName: string, config: Partial<LoggerConfig> = {}) {
    this.pluginName = pluginName;
    this.config = {
      level: LogLevel.DEBUG,
      consoleEnabled: true,
      fileEnabled: true,
      ...config,
    };
  }

  /**
   * 初始化日志系统
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.config.fileEnabled) {
      // 获取 Joplin 日志目录路径
      const logDir = this.config.logDir || await this.getJoplinLogDir();
      await fs.ensureDir(logDir);

      // 创建日志文件路径
      this.logFilePath = path.join(logDir, `${this.pluginName}.log`);

      // 清空或创建日志文件（每次启动清空）
      await fs.writeFile(this.logFilePath, "", "utf8");
    }

    this.initialized = true;
    this.info("日志系统初始化完成");
  }

  /**
   * 获取 Joplin 日志目录
   */
  private async getJoplinLogDir(): Promise<string> {
    try {
      const globalSettings = await joplin.settings.globalValues([
        "logLevel",
      ]);
      // 根据平台确定日志目录
      const platform = await joplin.versionInfo().then(v => v.platform);
      let logDir: string;

      if (platform === "mobile") {
        // 移动端日志目录
        const dataDir = await joplin.plugins.dataDir();
        logDir = path.join(dataDir, "logs");
      } else {
        // 桌面端日志目录
        const homeDir = os.homedir();
        const configDir = process.env.APPDATA ||
          (process.platform === "darwin" ? path.join(homeDir, "Library", "Application Support") : path.join(homeDir, ".config"));
        logDir = path.join(configDir, "joplin", "logs");
      }

      return logDir;
    } catch (error) {
      // 如果获取失败，使用插件数据目录
      const pluginDataDir = await joplin.plugins.dataDir();
      return path.join(pluginDataDir, "logs");
    }
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${args.map(arg => this.stringify(arg)).join(" ")}` : "";
    return `[${timestamp}] [${level}] [${this.pluginName}] ${message}${formattedArgs}`;
  }

  /**
   * 安全地序列化对象
   */
  private stringify(value: any): string {
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  /**
   * 写入日志到文件
   */
  private async writeToFile(message: string): Promise<void> {
    if (!this.config.fileEnabled || !this.logFilePath) {
      return;
    }

    try {
      await fs.appendFile(this.logFilePath, message + "\n", "utf8");
    } catch (error) {
      // 文件写入失败，降级到控制台输出
      console.error(`[Logger] 写入日志文件失败: ${error}`);
    }
  }

  /**
   * 输出到控制台
   */
  private writeToConsole(level: LogLevel, message: string): void {
    if (!this.config.consoleEnabled) {
      return;
    }

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        break;
    }
  }

  /**
   * 检查日志级别是否启用
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.config.level);
    const targetIndex = levels.indexOf(level);
    return targetIndex >= currentIndex;
  }

  /**
   * 记录调试日志
   */
  debug(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.DEBUG)) {
      return;
    }
    const formatted = this.formatMessage(LogLevel.DEBUG, message, ...args);
    this.writeToConsole(LogLevel.DEBUG, formatted);
    this.writeToFile(formatted);
  }

  /**
   * 记录信息日志
   */
  info(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.INFO)) {
      return;
    }
    const formatted = this.formatMessage(LogLevel.INFO, message, ...args);
    this.writeToConsole(LogLevel.INFO, formatted);
    this.writeToFile(formatted);
  }

  /**
   * 记录警告日志
   */
  warn(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.WARN)) {
      return;
    }
    const formatted = this.formatMessage(LogLevel.WARN, message, ...args);
    this.writeToConsole(LogLevel.WARN, formatted);
    this.writeToFile(formatted);
  }

  /**
   * 记录错误日志
   */
  error(message: string, ...args: any[]): void {
    if (!this.shouldLog(LogLevel.ERROR)) {
      return;
    }
    const formatted = this.formatMessage(LogLevel.ERROR, message, ...args);
    this.writeToConsole(LogLevel.ERROR, formatted);
    this.writeToFile(formatted);
  }

  /**
   * 记录对象详细信息
   */
  logObject(label: string, obj: any): void {
    const message = `${label}:\n${this.stringify(obj)}`;
    this.debug(message);
  }

  /**
   * 记录函数调用开始
   */
  logFunctionStart(functionName: string, ...args: any[]): void {
    this.debug(`[函数调用] ${functionName} 开始`, ...args);
  }

  /**
   * 记录函数调用结束
   */
  logFunctionEnd(functionName: string, result?: any): void {
    if (result !== undefined) {
      this.debug(`[函数调用] ${functionName} 结束`, result);
    } else {
      this.debug(`[函数调用] ${functionName} 结束`);
    }
  }

  /**
   * 记录错误堆栈
   */
  logError(error: Error, context?: string): void {
    const message = context ? `${context}: ${error.message}` : error.message;
    this.error(message, error.stack);
  }

  /**
   * 获取日志文件路径
   */
  getLogFilePath(): string | null {
    return this.logFilePath;
  }
}

// 创建单例实例
let loggerInstance: Logger | null = null;

/**
 * 获取日志记录器实例
 */
export function getLogger(pluginName: string, config?: Partial<LoggerConfig>): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(pluginName, config);
  }
  return loggerInstance;
}

/**
 * 导出日志级别枚举
 */
export { LoggerConfig };