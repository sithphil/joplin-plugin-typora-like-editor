import joplin from "api";
import * as fs from "fs";
import * as path from "path";
import { getLogger, LogLevel } from "./logger";
import { importMarkdown } from "./importer";

const logger = getLogger("syncManager", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

/**
 * 同步配置接口
 */
export interface SyncConfig {
  autoSync: boolean;
  syncInterval: number;
}

/**
 * 编辑会话接口
 */
export interface EditingSession {
  noteId: string;
  noteTitle: string;
  tempDir: string;
  tempFilePath: string;
  timestamp: number;
  fileWatcher?: fs.FSWatcher;
  syncTimeout?: NodeJS.Timeout;
  buttonState: 'idle' | 'editing'; // 按钮状态：idle=未按下，editing=已按下（正在编辑）
  editorPid?: number; // 编辑器真实 PID（全平台统一）
}

/**
 * 同步管理器类
 */
export class SyncManager {
  private sessions: Map<string, EditingSession> = new Map();
  private config: SyncConfig;

  constructor(config: SyncConfig) {
    this.config = config;
    logger.info("SyncManager 已初始化", { config });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info("SyncManager 配置已更新", { config: this.config });
  }

  /**
   * 获取当前配置
   */
  getConfig(): SyncConfig {
    return { ...this.config };
  }

  /**
   * 开始监控文件变化
   */
  startWatching(session: EditingSession): void {
    logger.logFunctionStart("startWatching", {
      noteId: session.noteId,
      tempFilePath: session.tempFilePath,
      autoSync: this.config.autoSync,
    });

    // 如果已经存在监控器，先停止
    if (session.fileWatcher) {
      this.stopWatching(session.noteId);
    }

    try {
      // 使用 fs.watch 监控文件变化
      const watcher = fs.watch(
        session.tempFilePath,
        { persistent: false },
        (eventType, filename) => {
          if (eventType === "change") {
            logger.info("检测到文件变化", {
              noteId: session.noteId,
              filename,
              eventType,
            });

            if (this.config.autoSync) {
              // 自动同步：使用防抖机制
              this.scheduleAutoSync(session);
            } else {
              // 手动同步：提示用户
              this.notifyFileChanged(session);
            }
          }
        }
      );

      // 保存监控器到会话
      session.fileWatcher = watcher;
      this.sessions.set(session.noteId, session);

      logger.info(`文件监控已启动: ${session.noteId}`);
    } catch (error) {
      logger.logError(error, `启动文件监控失败: ${session.noteId}`);
    }

    logger.logFunctionEnd("startWatching");
  }

  /**
   * 停止监控文件变化
   */
  stopWatching(noteId: string): void {
    logger.logFunctionStart("stopWatching", { noteId });

    const session = this.sessions.get(noteId);
    if (!session) {
      logger.warn("未找到编辑会话", { noteId });
      return;
    }

    // 停止文件监控器
    if (session.fileWatcher) {
      session.fileWatcher.close();
      session.fileWatcher = undefined;
      logger.info("文件监控已停止", { noteId });
    }

    // 清除待执行的同步任务
    if (session.syncTimeout) {
      clearTimeout(session.syncTimeout);
      session.syncTimeout = undefined;
    }

    logger.logFunctionEnd("stopWatching");
  }

  /**
   * 停止所有监控
   */
  stopAllWatching(): void {
    logger.logFunctionStart("stopAllWatching");

    for (const noteId of this.sessions.keys()) {
      this.stopWatching(noteId);
    }

    this.sessions.clear();
    logger.info("所有文件监控已停止");

    logger.logFunctionEnd("stopAllWatching");
  }

  /**
   * 调度自动同步（使用防抖机制）
   */
  private scheduleAutoSync(session: EditingSession): void {
    logger.logFunctionStart("scheduleAutoSync", {
      noteId: session.noteId,
      syncInterval: this.config.syncInterval,
    });

    // 清除之前的同步任务
    if (session.syncTimeout) {
      clearTimeout(session.syncTimeout);
    }

    // 设置新的同步任务
    session.syncTimeout = setTimeout(async () => {
      await this.performSync(session);
    }, this.config.syncInterval);

    logger.info("已调度自动同步", {
      noteId: session.noteId,
      delay: this.config.syncInterval,
    });

    logger.logFunctionEnd("scheduleAutoSync");
  }

  /**
   * 执行同步操作
   */
  private async performSync(session: EditingSession): Promise<void> {
    logger.logFunctionStart("performSync", { noteId: session.noteId });

    try {
      // 读取修改后的文件内容
      const fileSystem = joplin.require("fs-extra");
      const modifiedContent = await fileSystem.readFile(
        session.tempFilePath,
        "utf8"
      );

      logger.info("读取修改后的文件内容成功", {
        noteId: session.noteId,
        contentLength: modifiedContent.length,
      });

      // 导入更新现有笔记
      const { updateNoteFromMarkdown } = await import("./importer");
      const importResult = await updateNoteFromMarkdown(
        modifiedContent,
        session.tempFilePath,
        session.noteId
      );

      if (importResult.success) {
        logger.info(`笔记"${session.noteTitle}"同步成功`, {
          noteId: session.noteId,
          importedResources: importResult.importedResources,
        });
      } else {
        logger.error("同步失败", { errors: importResult.errors });
        await joplin.views.dialogs.showMessageBox(
          `同步失败: ${importResult.errors.join("\n")}`
        );
      }
    } catch (error) {
      logger.logError(error, "同步异常");
      await joplin.views.dialogs.showMessageBox(
        `同步异常: ${error}`
      );
    }

    logger.logFunctionEnd("performSync");
  }

  /**
   * 通知用户文件已变化（手动同步模式）
   */
  private async notifyFileChanged(session: EditingSession): Promise<void> {
    logger.logFunctionStart("notifyFileChanged", {
      noteId: session.noteId,
    });

    // 显示简单提示，用户需要点击工具栏按钮手动同步
    await joplin.views.dialogs.showMessageBox(
      `笔记"${session.noteTitle}"已被修改\n\n请点击工具栏的"切换外部编辑"按钮来同步修改回 Joplin。\n\n或者忽略此消息继续编辑。`
    );

    // 记录日志，继续监控
    logger.info("已提示用户文件变化，继续监控", { noteId: session.noteId });

    logger.logFunctionEnd("notifyFileChanged");
  }

  /**
   * 手动触发同步
   */
  async manualSync(noteId: string): Promise<void> {
    logger.logFunctionStart("manualSync", { noteId });

    const session = this.sessions.get(noteId);
    if (!session) {
      logger.warn("未找到编辑会话", { noteId });
      await joplin.views.dialogs.showMessageBox("未找到正在编辑的笔记");
      return;
    }

    await this.performSync(session);

    logger.logFunctionEnd("manualSync");
  }

  /**
   * 获取所有活动会话
   */
  getActiveSessions(): EditingSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 检查是否有活动会话
   */
  hasActiveSession(noteId: string): boolean {
    return this.sessions.has(noteId);
  }
}

// 创建全局同步管理器实例
let syncManagerInstance: SyncManager | null = null;

/**
 * 获取同步管理器实例
 */
export function getSyncManager(): SyncManager | null {
  return syncManagerInstance;
}

/**
 * 初始化同步管理器
 */
export function initSyncManager(config: SyncConfig): SyncManager {
  if (!syncManagerInstance) {
    syncManagerInstance = new SyncManager(config);
  } else {
    syncManagerInstance.updateConfig(config);
  }
  return syncManagerInstance;
}

/**
 * 销毁同步管理器
 */
export function destroySyncManager(): void {
  if (syncManagerInstance) {
    syncManagerInstance.stopAllWatching();
    syncManagerInstance = null;
    logger.info("同步管理器已销毁");
  }
}
