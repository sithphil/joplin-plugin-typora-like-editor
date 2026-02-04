import joplin from "api";
import { FileSystemItem, ModelType } from "api/types";
const fs = joplin.require("fs-extra");
import * as path from "path"; // 引入路径处理，适配跨平台
import { getLogger, LogLevel } from "./logger";
import { registerSettings, getExportPathStyle, getSaveMergedContent, ExportPathStyle } from "./settings";

// 创建日志记录器实例
const logger = getLogger("joplin-plugin-typora-like-editor", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

// 笔记信息接口
interface NoteInfo {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  fileName: string;
}

// 全局缓存：存储笔记内容、资源映射（解决context共享问题）
let exportGlobalCache = {
  exportPathStyle: ExportPathStyle.Flat, // 导出路径样式
  saveMergedContent: false, // 是否保存合并内容
  content: "", // 存储累加的笔记正文内容（含处理后的YAML前沿）- 保留用于合并导出
  notes: new Map<string, NoteInfo>(), // 笔记ID -> 笔记信息映射（用于单独导出）
  resourceMap: new Map(), // 资源ID -> assets相对路径映射
  folderMap: new Map(), // 文件夹ID -> 文件夹路径映射（层次结构模式使用）
  noteFolderMap: new Map(), // 笔记ID -> 所属文件夹ID映射（层次结构模式使用）
};

// 处理YAML前沿：生成/替换核心字段，保留自定义字段
const processYamlFrontmatter = (noteBody, note) => {
  logger.logFunctionStart("processYamlFrontmatter", { noteId: note.id, noteTitle: note.title });

  // 定义YAML分隔符正则，匹配开头的YAML块（兼容前后空白）
  const yamlRegex = /^---\s*[\s\S]*?\s*---\s*/;
  // 核心元数据（同步Joplin内部元数据，固定补全顺序）
  const coreKeys = ["title", "author", "created", "updated"]; // 固定核心字段顺序（补全时用）
  const coreMetadata = {
    title: note.title || "未命名笔记",
    author: note.author || "未知作者",
    created: new Date(note.created_time).toISOString(),
    updated: new Date(note.updated_time).toISOString(),
  };

  let processedBody;

  // 情况1：原有YAML前沿，保留顺序+补全缺失核心字段+更新已有核心字段值
  if (yamlRegex.test(noteBody)) {
    const originalYaml = noteBody.match(yamlRegex)[0];
    // 拆分原有YAML行，过滤空行和分隔符，保留有效内容行
    const yamlLines = originalYaml.split("\n").filter(line => {
      const trimed = line.trim();
      return trimed !== "" && trimed !== "---";
    });
    // 记录原有已存在的核心字段（用于后续检测缺失）
    const existedCoreKeys = new Set();
    let processedLines = [];

    // 逐行处理原有YAML：保留顺序，更新核心字段值，保留自定义字段
    yamlLines.forEach(line => {
      const [key, ...valueParts] = line.split(":").map(item => item.trim());
      // 是核心字段：更新值，记录已存在
      if (coreKeys.includes(key)) {
        existedCoreKeys.add(key);
        processedLines.push(`${key}: ${coreMetadata[key]}`);
      } else {
        // 非核心字段：直接保留原行（保持自定义字段格式）
        processedLines.push(line.trim());
      }
    });

    // 补全缺失的核心字段：按coreKeys顺序追加到自定义字段之前
    coreKeys.forEach(key => {
      if (!existedCoreKeys.has(key)) {
        processedLines.push(`${key}: ${coreMetadata[key]}`);
      }
    });

    // 拼接新YAML（保持格式规范，末尾换行）
    const newYaml = [
      "---",
      ...processedLines,
      "---\n"
    ].join("\n");

    // 替换原有YAML，返回处理后的正文
    processedBody = noteBody.replace(yamlRegex, newYaml);
    logger.info("原有YAML前沿处理完成：保留顺序，更新核心字段值，补全缺失核心字段");
  } else {
    // 情况2：无原有YAML，生成标准YAML前沿（核心字段按固定顺序）
    const newYaml = coreKeys
      .map(key => `${key}: ${coreMetadata[key]}`)
      .join("\n");

    processedBody = `---
${newYaml}
---

${noteBody}`;
    logger.info("无原有YAML，生成新前沿信息（同步Joplin元数据）");
  }

  logger.logFunctionEnd("processYamlFrontmatter");
  return processedBody;
};

// 替换笔记中的资源链接：将Joplin内部ID链接转为assets相对路径
const replaceResourceLinks = (content, noteId: string) => {
  logger.logFunctionStart("replaceResourceLinks", { noteId, resourceMapSize: exportGlobalCache.resourceMap.size });

  if (!content || exportGlobalCache.resourceMap.size === 0) {
    logger.debug("内容为空或资源映射为空，跳过链接替换");
    logger.logFunctionEnd("replaceResourceLinks");
    return content;
  }

  // 匹配Joplin内部资源链接格式：![alt](:/资源ID)
  const resourceRegex = /!\[(.*?)\]\(:\/([a-f0-9]+)\)/g;
  const processedContent = content.replace(resourceRegex, (match, alt, resId) => {
    // 优先使用笔记特定的资源映射，否则使用全局映射
    const resourceKey = `${noteId}_${resId}`;
    const localPath = exportGlobalCache.resourceMap.get(resourceKey) ||
                      exportGlobalCache.resourceMap.get(resId) ||
                      match;
    logger.debug(`资源链接替换：${match} -> ![${alt}](${localPath})`);
    return `![${alt}](${localPath})`;
  });

  logger.logFunctionEnd("replaceResourceLinks", { 替换数量: (content.match(resourceRegex) || []).length });
  return processedContent;
};

// 清理文件名，移除非法字符
const sanitizeFileName = (fileName: string): string => {
  return fileName.replace(/[<>:"/\\|?*]/g, "_").trim();
};

// 构建文件夹路径（从叶节点向上追溯到根节点）
const buildFolderPath = (folderId: string, destDir: string): string => {
  const folderPathParts: string[] = [];
  let currentFolderId = folderId;
  let visitedIds = new Set<string>(); // 防止循环引用

  // 向上遍历文件夹树，构建完整路径
  while (currentFolderId) {
    // 检测循环引用，防止无限循环
    if (visitedIds.has(currentFolderId)) {
      logger.warn("检测到文件夹循环引用", { folderId: currentFolderId });
      break;
    }
    visitedIds.add(currentFolderId);

    const folder = exportGlobalCache.folderMap.get(currentFolderId);
    if (!folder) {
      logger.warn("文件夹信息未找到（可能未预加载或ID错误）", { folderId: currentFolderId });
      break;
    }

    // 将文件夹标题添加到路径前端（因为是从叶节点向上追溯）
    folderPathParts.unshift(sanitizeFileName(folder.title));

    // 移动到父节点
    currentFolderId = folder.parent_id;
  }

  // 如果没有找到任何文件夹信息，返回根目录
  if (folderPathParts.length === 0) {
    logger.warn("无法构建文件夹路径，使用根目录", { folderId });
    return destDir;
  }

  return path.join(destDir, ...folderPathParts);
};

joplin.plugins.register({
  onStart: async function() {
    // 初始化日志系统
    await logger.initialize();
    logger.info("Typora-like Editor Plugin started!");

    // 输出日志文件路径
    const logFilePath = logger.getLogFilePath();
    if (logFilePath) {
      logger.info(`日志文件路径: ${logFilePath}`);
    }

    // 注册插件设置
    await registerSettings();
    logger.info("插件设置已注册");

    await joplin.interop.registerExportModule({
      format: "typora_md",
      description: "Markdown (No Title From metadata)",
      target: FileSystemItem.File,
      isNoteArchive: false,
      fileExtensions: ["md"],

      onInit: async function(context: any) {
        logger.logFunctionStart("onInit", { destPath: context.destPath });

        // 获取当前导出路径样式设置
        const rawExportPathStyle = await joplin.settings.value("exportPathStyle");
        exportGlobalCache.exportPathStyle = await getExportPathStyle();
        logger.info("当前导出路径样式", {
          rawValue: rawExportPathStyle,
          convertedValue: exportGlobalCache.exportPathStyle,
          styleName: exportGlobalCache.exportPathStyle === ExportPathStyle.Flat ? "扁平结构" : "层次结构"
        });

        // 获取保存合并内容开关设置
        exportGlobalCache.saveMergedContent = await getSaveMergedContent();
        logger.info("当前保存合并内容开关", { enabled: exportGlobalCache.saveMergedContent });

        // 初始化缓存，清空上次导出残留数据
        exportGlobalCache.content = "";
        exportGlobalCache.notes.clear();
        exportGlobalCache.resourceMap.clear();
        exportGlobalCache.folderMap.clear();
        exportGlobalCache.noteFolderMap.clear();

        // 层次结构模式：预加载所有文件夹信息
        if (exportGlobalCache.exportPathStyle === ExportPathStyle.Hierarchical) {
          logger.info("层次结构模式：开始预加载所有文件夹信息");
          try {
            const allFolders = await joplin.data.get(["folders"], {
              fields: ["id", "title", "parent_id"],
              order_by: "title",
              order_dir: "ASC",
            });

            for (const folder of allFolders.items) {
              exportGlobalCache.folderMap.set(folder.id, folder);
            }

            logger.info(`文件夹预加载完成，共加载 ${allFolders.items.length} 个文件夹`);
          } catch (error) {
            logger.logError(error, "预加载文件夹信息失败");
          }
        }

        logger.info("导出初始化完成，全局缓存已清空");
        logger.logFunctionEnd("onInit");
      },

      onProcessItem: async function(context: any, itemType: number, item: any) {
        logger.logFunctionStart("onProcessItem", { itemType, itemId: item.id, style: exportGlobalCache.exportPathStyle });

        if (itemType === ModelType.Folder) {
          // 层次结构模式：文件夹信息已在 onInit 时预加载到 folderMap
          // 此处无需额外处理，跳过即可
          logger.logFunctionEnd("onProcessItem");
          return;
        }

        if (itemType === ModelType.Note) {
          // 记录笔记基础信息
          logger.debug("当前处理笔记基础信息", { id: item.id, title: item.title });

          // 获取笔记完整信息（含创建/更新时间、作者，用于前沿生成）
          const note = await joplin.data.get(["notes", item.id], {
            fields: ["id", "title", "body", "created_time", "updated_time", "author", "parent_id"],
          });

          logger.debug("当前处理笔记完整属性", note);

          // 层次结构模式：记录笔记与文件夹的关联
          if (exportGlobalCache.exportPathStyle === ExportPathStyle.Hierarchical && note.parent_id) {
            exportGlobalCache.noteFolderMap.set(note.id, note.parent_id);
            logger.debug("记录笔记文件夹关联", { noteId: note.id, folderId: note.parent_id });
          }

          // 处理YAML前沿，排除标题（标题仅在前沿中存在）
          let processedBody = processYamlFrontmatter(note.body || "", note);

          // 生成笔记文件名
          const noteFileName = `${sanitizeFileName(note.title)}.md`;

          // 保存笔记信息到缓存
          exportGlobalCache.notes.set(note.id, {
            id: note.id,
            title: note.title,
            content: processedBody,
            folderId: note.parent_id,
            fileName: noteFileName,
          });

          // 累加笔记内容（多笔记用空行分隔）- 保留用于合并导出
          exportGlobalCache.content += processedBody + "\n\n";

          logger.info(`笔记【${note.title}】处理完成，已加入全局缓存`, { noteId: note.id, fileName: noteFileName });
        }

        logger.logFunctionEnd("onProcessItem");
      },

      onProcessResource: async function(context: any, resource: any, filePath:string) {
        logger.logFunctionStart("onProcessResource", { resourceId: resource.id, filePath, style: exportGlobalCache.exportPathStyle });

        try {
          // 获取资源完整信息（含后缀、原始名称）
          logger.debug("当前处理资源完整属性", { id: resource.id });
          const resDetail = await joplin.data.get(["resources", resource.id], {
            fields: ["id", "file_extension", "title"],
          });

          if (!resDetail.file_extension) {
            logger.warn("资源信息不完整，跳过处理", { resourceId: resource.id });
            return;
          }

          // 资源文件名：优先用原始名称，无则用资源ID
          const resFileName = resDetail.title
            ? sanitizeFileName(resDetail.title)
            : `${resDetail.id}.${resDetail.file_extension}`;

          if (exportGlobalCache.exportPathStyle === ExportPathStyle.Flat) {
            // ========== 扁平结构模式 ==========
            logger.debug("使用扁平结构模式处理资源");

            const destDir = path.dirname(context.destPath); // 导出文件所在目录
            const assetsDir = path.join(destDir, "assets"); // assets目录（同级）
            const resDestPath = path.join(assetsDir, resFileName); // 资源目标路径
            const resRelativePath = `./assets/${resFileName}`; // 笔记中使用的相对路径

            logger.debug("资源路径计算", {
              destDir,
              assetsDir,
              resFileName,
              resDestPath,
              resRelativePath
            });

            // 创建assets目录（若不存在）
            if (!await fs.pathExists(assetsDir)) {
              await fs.mkdir(assetsDir);
              logger.info("创建assets资源目录", { assetsDir });
            }

            // 复制Joplin内部资源到assets目录
            await fs.copyFile(filePath, resDestPath);
            logger.info(`资源复制完成`, { from: filePath, to: resDestPath });

            // 记录资源映射，供后续链接替换使用
            exportGlobalCache.resourceMap.set(resDetail.id, resRelativePath);

            logger.debug("资源映射已记录", { resourceId: resDetail.id, relativePath: resRelativePath });

          } else if (exportGlobalCache.exportPathStyle === ExportPathStyle.Hierarchical) {
            // ========== 层次结构模式 ==========
            logger.debug("使用层次结构模式处理资源");

            // 获取使用该资源的笔记列表
            const resourceNotes = await joplin.data.get(["resources", resDetail.id, "notes"]);
            logger.info("resourceNotes: ", resourceNotes)
            if (!resourceNotes || resourceNotes.items.length === 0) {
              logger.warn("资源未关联任何笔记，跳过处理", { resourceId: resDetail.id });
              return;
            }

            // 为每个使用该资源的笔记处理资源文件
            for (const noteItem of resourceNotes.items) {
              const noteId = noteItem.id;
              const folderId = noteItem.parent_id;

              if (!folderId) {
                logger.warn("笔记未关联文件夹，使用默认路径", { noteId });
                continue;
              }

              // 导出基础目录
              const destDir = path.dirname(context.destPath);
              // 构建完整文件夹路径
              const folderPath = buildFolderPath(folderId, destDir);
              // assets目录
              const assetsDir = path.join(folderPath, "assets");
              // 资源目标路径
              const resDestPath = path.join(assetsDir, resFileName);
              // 笔记中使用的相对路径（相对于笔记所在文件夹）
              const resRelativePath = `./assets/${resFileName}`;

              logger.debug("层次结构资源路径计算", {
                noteId,
                folderId,
                folderPath,
                assetsDir,
                resFileName,
                resDestPath,
                resRelativePath
              });

              // 创建文件夹和assets目录（若不存在）
              await fs.ensureDir(assetsDir);
              logger.info("创建文件夹和assets目录", { folderPath, assetsDir });

              // 复制Joplin内部资源到assets目录
              await fs.copyFile(filePath, resDestPath);
              logger.info(`资源复制完成`, { from: filePath, to: resDestPath });

              // 记录资源映射（使用笔记ID作为键的一部分，避免冲突）
              const resourceKey = `${noteId}_${resDetail.id}`;
              exportGlobalCache.resourceMap.set(resourceKey, resRelativePath);

              logger.debug("资源映射已记录", { resourceKey, relativePath: resRelativePath });
            }
          }
        } catch (error) {
          logger.logError(error, "资源处理失败");
        }

        logger.logFunctionEnd("onProcessResource");
      },

      onClose: async function(context: any) {
        logger.logFunctionStart("onClose", { destPath: context.destPath, style: exportGlobalCache.exportPathStyle });

        try {
          const destDir = path.dirname(context.destPath);

          // ========== 保存合并内容 ==========
          if (exportGlobalCache.saveMergedContent) {
            logger.info("保存合并内容到文件");
            const finalContent = exportGlobalCache.content || "";
            await fs.writeFile(context.destPath, finalContent, "utf8");
            logger.info(`合并内容已保存：${context.destPath}，长度：${finalContent.length} 字符`);
          }

          // ========== 分别保存每个笔记 ==========
          logger.info(`开始分别保存 ${exportGlobalCache.notes.size} 个笔记`);

          for (const [noteId, noteInfo] of exportGlobalCache.notes) {
            // 替换资源链接
            const processedContent = replaceResourceLinks(noteInfo.content, noteId);

            let noteFilePath: string;
            let assetsDir: string;

            if (exportGlobalCache.exportPathStyle === ExportPathStyle.Flat) {
              // 扁平结构：所有笔记在同一目录
              noteFilePath = path.join(destDir, noteInfo.fileName);
              assetsDir = path.join(destDir, "assets");
            } else {
              // 层次结构：笔记按文件夹组织
              if (noteInfo.folderId) {
                const folderPath = buildFolderPath(noteInfo.folderId, destDir);
                noteFilePath = path.join(folderPath, noteInfo.fileName);
                assetsDir = path.join(folderPath, "assets");
              } else {
                // 无文件夹的笔记放在根目录
                noteFilePath = path.join(destDir, noteInfo.fileName);
                assetsDir = path.join(destDir, "assets");
              }
            }

            // 确保目录存在
            await fs.ensureDir(path.dirname(noteFilePath));

            // 写入笔记文件
            await fs.writeFile(noteFilePath, processedContent, "utf8");
            logger.info(`笔记已保存：${noteFilePath}`);

            // 确保assets目录存在（扁平结构需要）
            if (exportGlobalCache.exportPathStyle === ExportPathStyle.Flat) {
              await fs.ensureDir(assetsDir);
            }
          }

          // 记录导出结果
          logger.info(`导出成功！共保存 ${exportGlobalCache.notes.size} 个笔记`);
          logger.info(`资源总数：${exportGlobalCache.resourceMap.size} 个`);
          logger.info(`导出路径样式：${exportGlobalCache.exportPathStyle}`);
          logger.info(`保存合并内容：${exportGlobalCache.saveMergedContent}`);

        } catch (error) {
          logger.logError(error, "导出失败");
        } finally {
          // 兜底：重置缓存，避免多次导出污染
          exportGlobalCache.content = "";
          exportGlobalCache.notes.clear();
          exportGlobalCache.resourceMap.clear();
          exportGlobalCache.folderMap.clear();
          exportGlobalCache.noteFolderMap.clear();
          logger.debug("全局缓存已重置");
        }

        logger.logFunctionEnd("onClose");
      },
    });
  },
});
