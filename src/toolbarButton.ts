import joplin from "api";
import { ToolbarButtonLocation } from "api/types";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { getLogger, LogLevel } from "./logger";
import { getExportPathStyle, getExternalEditorPath, getTempDirPath, ExportPathStyle } from "./settings";
import { exportNoteToPath } from "./exporter";
import { openInExternalEditor } from "./externalEditor";
import { initSyncManager, getSyncManager, destroySyncManager, type EditingSession } from "./syncManager";
import { log } from "console";

const logger = getLogger("toolbarButton", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

// 存储当前正在编辑的会话
const editingSessions = new Map<string, EditingSession>();

/**
 * 注册工具栏按钮
 *
 * @returns Promise<void>
 */
export const registerToolbarButton = async (): Promise<void> => {
  logger.logFunctionStart("registerToolbarButton");

  try {
    // 注册命令
    await joplin.commands.register({
      name: 'openInExternalEditor',
      label: '切换外部编辑',
      iconName: 'fas fa-book-open',
      execute: async () => {
        await handleOpenInExternalEditor();
      },
    });

    logger.info("命令已注册: openInExternalEditor");

    // 创建工具栏按钮
    await joplin.views.toolbarButtons.create(
      "openInExternalEditorButton",
      "openInExternalEditor",
      ToolbarButtonLocation.NoteToolbar
    );

    logger.info("工具栏按钮已创建: openInExternalEditorButton");
  } catch (error) {
    logger.logError(error, "注册工具栏按钮失败");
    throw error;
  }

  logger.logFunctionEnd("registerToolbarButton");
};

/**
 * 处理在外部编辑器中打开笔记
 *
 * @returns Promise<void>
 */
const handleOpenInExternalEditor = async (): Promise<void> => {
  logger.logFunctionStart("handleOpenInExternalEditor");

  try {
    // 获取当前选中的笔记
    const selectedNote = await joplin.workspace.selectedNote();

    if (!selectedNote) {
      logger.warn("没有选中的笔记");
      await joplin.views.dialogs.showMessageBox("请先选择要编辑的笔记");
      return;
    }

    logger.info("当前选中的笔记", { noteId: selectedNote.id, title: selectedNote.title });

    // 检查是否已经有正在编辑的会话
    const existingSession = editingSessions.get(selectedNote.id);
    if (existingSession && existingSession.buttonState === 'editing') {
      // 按钮处于 editing 状态，执行关闭和清理操作
      logger.info("按钮处于编辑状态，执行关闭和清理操作", { noteId: selectedNote.id });
      await closeEditorAndCleanup(selectedNote.id);
      return;
    }

    // 获取外部编辑器路径
    const editorPath = await getExternalEditorPath();
    logger.info("外部编辑器路径", { editorPath });

    // 获取临时目录
    const customTempDir = await getTempDirPath();
    const tempDir = customTempDir || await joplin.plugins.dataDir();

    logger.info("临时目录", { tempDir });

    // 确保临时目录存在
    const fs = joplin.require("fs-extra");
    await fs.ensureDir(tempDir);
    logger.info("临时目录已创建", { tempDir });

    // 生成临时文件路径（使用哈希文件名格式）
    const tempFileName = `edit-${selectedNote.id}.md`;
    const tempFilePath = path.join(tempDir, tempFileName);

    logger.info("临时文件路径", { tempFilePath });

    // 导出笔记到临时目录（强制使用扁平结构，使用哈希文件名）
    logger.info("开始导出笔记...");
    await exportNoteToPath(selectedNote.id, tempFilePath, ExportPathStyle.Flat, true);
    logger.info("笔记导出成功");

    // 保存编辑会话，设置按钮状态为 editing
    const session: EditingSession = {
      noteId: selectedNote.id,
      noteTitle: selectedNote.title,
      tempDir,
      tempFilePath,
      timestamp: Date.now(),
      buttonState: 'editing',
    };
    editingSessions.set(selectedNote.id, session);
    logger.info("编辑会话已保存，按钮状态设置为 editing", { session });

    // 启动外部编辑器
    logger.info("启动外部编辑器...");
    const result = await openInExternalEditor(tempFilePath, editorPath);

    if (result.success) {
      logger.info("外部编辑器启动成功");

      // 保存编辑器真实 PID
      if (result.editorPid) {
        session.editorPid = result.editorPid;
        logger.info("编辑器 PID 已保存", { editorPid: result.editorPid });
      }

      // 初始化同步管理器
      const syncManager = initSyncManager({
        autoSync: await joplin.settings.value("autoSync") || false,
        syncInterval: await joplin.settings.value("syncInterval") || 5000,
      });

      // 启动文件监控
      syncManager.startWatching(session);

      // 显示提示消息
      logger.info(
        `已在 ${editorPath} 中打开笔记\n\n${syncManager.getConfig().autoSync
          ? "已启用自动同步，修改会自动同步回 Joplin。"
          : "编辑完成后保存文件，系统会提示您是否同步修改回 Joplin。"
        }\n\n临时文件位置：\n${tempFilePath}`
      );
    } else {
      logger.error("外部编辑器启动失败");
      await joplin.views.dialogs.showMessageBox(
        `无法启动外部编辑器: ${editorPath}\n\n请检查编辑器路径设置。`
      );
    }
  } catch (error) {
    logger.logError(error, "在外部编辑器中打开笔记失败");
    await joplin.views.dialogs.showMessageBox(
      `在外部编辑器中打开笔记失败: ${error}`
    );
  }

  logger.logFunctionEnd("handleOpenInExternalEditor");
};

/**
 * 关闭外部编辑器并清理临时文件
 *
 * @param noteId 笔记 ID
 */
const closeEditorAndCleanup = async (noteId: string): Promise<void> => {
  logger.logFunctionStart("closeEditorAndCleanup", { noteId });

  const session = editingSessions.get(noteId);
  if (!session) {
    logger.warn("未找到编辑会话", { noteId });
    return;
  }

  const syncManager = getSyncManager();
  if (syncManager) {
    // 停止文件监控
    syncManager.stopWatching(noteId);
    logger.info("已停止文件监控", { noteId });
  }

  const fs = joplin.require("fs-extra");

  try {
    // 强制关闭编辑器进程（统一使用命令行）
    if (session.editorPid) {
      logger.info("尝试关闭编辑器进程", {
        noteId,
        editorPid: session.editorPid,
        platform: os.platform()
      });

      try {
        const platform = os.platform();

        if (platform === "win32") {
          // Windows: 使用 taskkill 命令强制终止进程
          const { exec } = require('child_process');
          exec(`taskkill /F /PID ${session.editorPid}`, (error: any, stdout: string, stderr: string) => {
            if (error) {
              logger.warn("Windows taskkill 失败", { pid: session.editorPid, error: error.message });
            } else {
              logger.info("Windows 进程已终止", { pid: session.editorPid });
            }
          });
        } else {
          // Unix-like (Linux/macOS): 使用 kill 命令
          const { exec } = require('child_process');

          // 先尝试 SIGTERM 正常终止
          exec(`kill -TERM ${session.editorPid}`, (error: any, stdout: string, stderr: string) => {
            if (error) {
              logger.debug("kill -TERM 失败，进程可能已不存在", { pid: session.editorPid, error: error.message });
            } else {
              logger.info("已发送 SIGTERM 信号", { pid: session.editorPid });
            }

            // 等待 1 秒后检查进程是否仍在运行
            setTimeout(() => {
              exec(`kill -0 ${session.editorPid}`, (checkError: any) => {
                if (!checkError) {
                  // 进程仍在运行，强制终止
                  exec(`kill -KILL ${session.editorPid}`, (killError: any) => {
                    if (killError) {
                      logger.warn("kill -KILL 失败", { pid: session.editorPid, error: killError.message });
                    } else {
                      logger.info("已发送 SIGKILL 信号强制终止", { pid: session.editorPid });
                    }
                  });
                }
              });
            }, 1000);
          });
        }
      } catch (processError) {
        logger.warn("关闭编辑器进程时出错", {
          noteId,
          error: processError
        });
      }

      // 清除 PID 引用
      session.editorPid = undefined;
      logger.info("已清除编辑器 PID 引用", { noteId });
    } else {
      logger.info("没有活动的编辑器进程需要关闭", { noteId });
    }

    // 清理临时文件
    if (await fs.pathExists(session.tempFilePath)) {
      await fs.remove(session.tempFilePath);
      logger.info("临时文件已删除", { tempFilePath: session.tempFilePath });
    }

    // 清理 assets 目录（如果存在）
    const assetsDir = path.join(session.tempDir, "assets");
    if (await fs.pathExists(assetsDir)) {
      await fs.remove(assetsDir);
      logger.info("assets 目录已删除", { assetsDir });
    }

    // 更新按钮状态为 idle
    session.buttonState = 'idle';
    editingSessions.set(noteId, session);
    logger.info("按钮状态已设置为 idle", { noteId });

    // 移除会话
    editingSessions.delete(noteId);
    logger.info("编辑会话已移除", { noteId });

    // 显示提示消息
    logger.info(
      `清理临时文件\n\n笔记：${session.noteTitle}`
    );
  } catch (error) {
    logger.logError(error, "清理临时文件失败");
    await joplin.views.dialogs.showMessageBox(
      `清理临时文件失败: ${error}`
    );
  }

  logger.logFunctionEnd("closeEditorAndCleanup");
};

/**
 * 获取当前正在编辑的会话
 *
 * @param noteId 笔记 ID
 * @returns 编辑会话或 null
 */
export const getEditingSession = (noteId: string): EditingSession | null => {
  return editingSessions.get(noteId) || null;
};

/**
 * 移除编辑会话
 *
 * @param noteId 笔记 ID
 */
export const removeEditingSession = (noteId: string): void => {
  editingSessions.delete(noteId);
  logger.info("编辑会话已移除", { noteId });
};

/**
 * 获取所有编辑会话
 *
 * @returns 所有编辑会话的数组
 */
export const getAllEditingSessions = (): EditingSession[] => {
  return Array.from(editingSessions.values());
};

/**
 * 清理所有编辑会话的临时文件
 *
 * @returns Promise<void>
 */
export const cleanupAllEditingSessions = async (): Promise<void> => {
  logger.logFunctionStart("cleanupAllEditingSessions");

  // 停止所有文件监控
  destroySyncManager();

  const fs = joplin.require("fs-extra");

  // 没起作用，不知道怎么获取Joplin软件关闭按钮点击事件
  for (const session of editingSessions.values()) {
    try {
      // 检查临时目录是否存在
      if (await fs.pathExists(session.tempDir)) {
        // 删除临时目录及其内容
        await fs.remove(session.tempDir);
        logger.info("临时目录已清理", { tempDir: session.tempDir });
      }
    } catch (error) {
      logger.logError(error, `清理临时目录失败: ${session.tempDir}`);
    }
  }

  // 清空会话映射
  editingSessions.clear();
  logger.info("所有编辑会话已清理");

  logger.logFunctionEnd("cleanupAllEditingSessions");
};