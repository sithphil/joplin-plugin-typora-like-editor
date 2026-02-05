import joplin from "api";
import { FileSystemItem, ModelType, ImportModuleOutputFormat } from "api/types";
import { getLogger, LogLevel } from "./logger";
import { registerSettings, getExportPathStyle, getSaveMergedContent, ExportPathStyle } from "./settings";
import {
  initExportCache,
  processNoteItem,
  processResourceItem,
  finalizeExport,
  type ExportGlobalCache
} from "./exporter";
import { importMarkdown, type ImportResult } from "./importer";
import { registerToolbarButton, cleanupAllEditingSessions } from "./toolbarButton";

// 创建日志记录器实例
const logger = getLogger("joplin-plugin-typora-like-editor", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

// 全局导出缓存实例
let exportCache: ExportGlobalCache | null = null;

joplin.plugins.register({
  onStart: async function() {
    // 初始化日志系统
    await logger.initialize();
    logger.info("Typora-like Editor Plugin started!");

    // 无用且暂时不考虑这行代码：临时文件会在每次插件启动时清理
    await cleanupAllEditingSessions();

    // 输出日志文件路径
    const logFilePath = logger.getLogFilePath();
    if (logFilePath) {
      logger.info(`日志文件路径: ${logFilePath}`);
    }

    // 注册插件设置
    await registerSettings();
    logger.info("插件设置已注册");

    // 注册导出模块
    await joplin.interop.registerExportModule({
      format: "typora_md",
      description: "Markdown (Typora)",
      target: FileSystemItem.File,
      isNoteArchive: false,
      fileExtensions: ["md"],

      onInit: async function(context: any) {
        logger.logFunctionStart("onInit", { destPath: context.destPath });

        // 获取当前导出路径样式设置
        const rawExportPathStyle = await joplin.settings.value("exportPathStyle");
        const exportPathStyle = await getExportPathStyle();
        logger.info("当前导出路径样式", {
          rawValue: rawExportPathStyle,
          convertedValue: exportPathStyle,
          styleName: exportPathStyle === ExportPathStyle.Flat ? "扁平结构" : "层次结构"
        });

        // 获取保存合并内容开关设置
        const saveMergedContent = await getSaveMergedContent();
        logger.info("当前保存合并内容开关", { enabled: saveMergedContent });

        // 初始化导出缓存
        exportCache = await initExportCache(exportPathStyle, saveMergedContent);

        logger.info("导出初始化完成，全局缓存已清空");
        logger.logFunctionEnd("onInit");
      },

      onProcessItem: async function(context: any, itemType: number, item: any) {
        logger.logFunctionStart("onProcessItem", { itemType, itemId: item.id, style: exportCache?.exportPathStyle });

        if (itemType === ModelType.Folder) {
          // 层次结构模式：文件夹信息已在 onInit 时预加载到 folderMap
          // 此处无需额外处理，跳过即可
          logger.logFunctionEnd("onProcessItem");
          return;
        }

        if (itemType === ModelType.Note) {
          if (!exportCache) {
            logger.error("导出缓存未初始化");
            return;
          }

          // 处理笔记项
          await processNoteItem(item, exportCache);
        }

        logger.logFunctionEnd("onProcessItem");
      },

      onProcessResource: async function(context: any, resource: any, filePath: string) {
        if (!exportCache) {
          logger.error("导出缓存未初始化");
          return;
        }

        // 处理资源项
        await processResourceItem(resource, filePath, exportCache, context.destPath);
      },

      onClose: async function(context: any) {
        if (!exportCache) {
          logger.error("导出缓存未初始化");
          return;
        }

        // 完成导出
        await finalizeExport(exportCache, context.destPath);
      },
    });

    // 注册导入模块
    await joplin.interop.registerImportModule({
      format: "typora_md",
      description: "Markdown (typora)",
      isNoteArchive: false,
      sources: [FileSystemItem.File],
      fileExtensions: ["md"],
      outputFormat: ImportModuleOutputFormat.Markdown,

      // onExec(context: ImportContext): Promise<void>;
      onExec: async function(context: any) {
        logger.logFunctionStart("onExec", { sourcePath: context.sourcePath });

        const result: ImportResult = {
          success: false,
          errors: [],
          importedResources: 0
        };

        try {
          // 读取 Markdown 文件内容
          const fileSystem = joplin.require("fs-extra");
          const markdownContent = await fileSystem.readFile(context.sourcePath, "utf8");

          logger.info(`读取 Markdown 文件成功，长度: ${markdownContent.length} 字符`);

          // 获取当前选中的文件夹
          const selectedFolder = await joplin.workspace.selectedFolder();
          const folderId = selectedFolder?.id || null;

          // 提取文件名作为笔记标题（不含扩展名）
          const fileName = context.sourcePath.split(/[/\\]/).pop() || "导入笔记";
          const noteTitle = fileName.replace(/\.md$/i, "");

          // 导入 Markdown
          const importResult = await importMarkdown(
            markdownContent,
            context.sourcePath,
            folderId,
            noteTitle
          );

          result.success = importResult.success;
          result.noteId = importResult.noteId;
          result.errors = importResult.errors;
          result.importedResources = importResult.importedResources;

          if (importResult.success) {
            logger.info(`导入成功！笔记ID: ${importResult.noteId}, 导入图片: ${importResult.importedResources} 个`);
          } else {
            logger.error("导入失败", { errors: importResult.errors });
          }

        } catch (error) {
          result.errors.push(`导入异常: ${error}`);
          logger.logError(error, "导入 Markdown 异常");
        }

        logger.logFunctionEnd("onExec", {
          success: result.success,
          noteId: result.noteId,
          errors: result.errors.length,
          importedResources: result.importedResources
        });
      },
    });

    // 注册工具栏按钮
    await registerToolbarButton();
    logger.info("工具栏按钮已注册");

  },
});
