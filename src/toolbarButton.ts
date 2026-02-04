import joplin from "api";
import { ToolbarButtonLocation } from "api/types";
import * as os from "os";
import * as path from "path";
import { getLogger, LogLevel } from "./logger";
import { getExportPathStyle, getExternalEditorPath, getTempDirPath, ExportPathStyle } from "./settings";
import { exportNoteToPath } from "./exporter";
import { openInExternalEditor } from "./externalEditor";

const logger = getLogger("toolbarButton", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

/**
 * 编辑会话接口
 */
interface EditingSession {
  noteId: string;
  noteTitle: string;
  tempDir: string;
  tempFilePath: string;
  timestamp: number;
}

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

    // 保存编辑会话
    const session: EditingSession = {
      noteId: selectedNote.id,
      noteTitle: selectedNote.title,
      tempDir,
      tempFilePath,
      timestamp: Date.now(),
    };
    editingSessions.set(selectedNote.id, session);
    logger.info("编辑会话已保存", { session });

    // 启动外部编辑器
    logger.info("启动外部编辑器...");
    const opened = await openInExternalEditor(tempFilePath, editorPath);

    if (opened) {
      logger.info("外部编辑器启动成功");
      // 可选：显示提示消息
      // await joplin.views.dialogs.showMessageBox(
      //   `已在 ${editorPath} 中打开笔记\n\n编辑完成后，请手动导入修改后的内容。\n\n临时文件位置：\n${tempFilePath}`
      // );
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

  const fs = joplin.require("fs-extra");

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