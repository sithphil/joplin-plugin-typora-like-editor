import joplin from "api";
import { ModelType } from "api/types";
const fs = joplin.require("fs-extra");
import * as path from "path";
import { getLogger, LogLevel } from "./logger";
import { ExportPathStyle, getDefaultAuthor } from "./settings";

// 创建日志记录器实例
const logger = getLogger("exporter", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

// 笔记信息接口
export interface NoteInfo {
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  fileName: string;
}

// 全局缓存：存储笔记内容、资源映射（解决context共享问题）
export interface ExportGlobalCache {
  exportPathStyle: ExportPathStyle;
  saveMergedContent: boolean;
  content: string;
  notes: Map<string, NoteInfo>;
  resourceMap: Map<string, string>;
  folderMap: Map<string, any>;
  noteFolderMap: Map<string, string>;
  usingHashName?: boolean;
}

// 创建全局缓存实例
export const createExportCache = (): ExportGlobalCache => ({
  exportPathStyle: ExportPathStyle.Flat,
  saveMergedContent: false,
  content: "",
  notes: new Map(),
  resourceMap: new Map(),
  folderMap: new Map(),
  noteFolderMap: new Map(),
  usingHashName: false,
});

// 处理YAML前沿：生成/替换核心字段，保留自定义字段
export const processYamlFrontmatter = (noteBody: string, note: any): string => {
  logger.logFunctionStart("processYamlFrontmatter", { noteId: note.id, noteTitle: note.title });

  // 定义YAML分隔符正则，匹配开头的YAML块（兼容前后空白）
  const yamlRegex = /^---\s*[\s\S]*?\s*---\s*/;
  // 核心元数据（同步Joplin内部元数据，固定补全顺序）
  const coreKeys = ["title", "author", "created", "updated"];
  const coreMetadata = {
    title: note.title || "未命名笔记",
    author: getDefaultAuthor() || note.author,
    created: new Date(note.created_time).toISOString(),
    updated: new Date(note.updated_time).toISOString(),
  };

  let processedBody: string;

  // 情况1：原有YAML前沿，保留顺序+补全缺失核心字段+更新已有核心字段值
  if (yamlRegex.test(noteBody)) {
    const originalYaml = noteBody.match(yamlRegex)[0];
    // 拆分原有YAML行，过滤空行和分隔符，保留有效内容行
    const yamlLines = originalYaml.split("\n").filter(line => {
      const trimed = line.trim();
      return trimed !== "" && trimed !== "---";
    });
    // 记录原有已存在的核心字段（用于后续检测缺失）
    const existedCoreKeys = new Set<string>();
    let processedLines: string[] = [];

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
export const replaceResourceLinks = (content: string, noteId: string, resourceMap: Map<string, string>): string => {
  logger.logFunctionStart("replaceResourceLinks", { noteId, resourceMapSize: resourceMap.size });

  if (!content || resourceMap.size === 0) {
    logger.debug("内容为空或资源映射为空，跳过链接替换");
    logger.logFunctionEnd("replaceResourceLinks");
    return content;
  }

  // 匹配Joplin内部资源链接格式：![alt](:/资源ID)
  const resourceRegex = /!\[(.*?)\]\(:\/([a-f0-9]+)\)/g;
  const processedContent = content.replace(resourceRegex, (match, alt, resId) => {
    // 优先使用笔记特定的资源映射，否则使用全局映射
    const resourceKey = `${noteId}_${resId}`;
    const localPath = resourceMap.get(resourceKey) ||
      resourceMap.get(resId) ||
      match;
    logger.debug(`资源链接替换：${match} -> ![${alt}](${localPath})`);
    return `![${alt}](${localPath})`;
  });

  logger.logFunctionEnd("replaceResourceLinks", { 替换数量: (content.match(resourceRegex) || []).length });
  return processedContent;
};

// 清理文件名，移除非法字符
export const sanitizeFileName = (fileName: string): string => {
  return fileName.replace(/[<>:"/\\|?*]/g, "_").trim();
};

// 构建文件夹路径（从叶节点向上追溯到根节点）
export const buildFolderPath = (folderId: string, destDir: string, folderMap: Map<string, any>): string => {
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

    const folder = folderMap.get(currentFolderId);
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

// 初始化导出缓存
export const initExportCache = async (
  exportPathStyle: ExportPathStyle,
  saveMergedContent: boolean,
  usingHashName: boolean = false
): Promise<ExportGlobalCache> => {
  const cache = createExportCache();
  cache.exportPathStyle = exportPathStyle;
  cache.saveMergedContent = saveMergedContent;
  cache.usingHashName = usingHashName;

  // 层次结构模式：预加载所有文件夹信息
  if (exportPathStyle === ExportPathStyle.Hierarchical) {
    logger.info("层次结构模式：开始预加载所有文件夹信息");
    try {
      const allFolders = await joplin.data.get(["folders"], {
        fields: ["id", "title", "parent_id"],
        order_by: "title",
        order_dir: "ASC",
      });

      for (const folder of allFolders.items) {
        cache.folderMap.set(folder.id, folder);
      }

      logger.info(`文件夹预加载完成，共加载 ${allFolders.items.length} 个文件夹`);
    } catch (error) {
      logger.logError(error, "预加载文件夹信息失败");
    }
  }

  return cache;
};

// 处理笔记项
export const processNoteItem = async (item: any, cache: ExportGlobalCache): Promise<void> => {
  logger.debug("当前处理笔记基础信息", { id: item.id, title: item.title });

  // 获取笔记完整信息（含创建/更新时间、作者，用于前沿生成）
  const note = await joplin.data.get(["notes", item.id], {
    fields: ["id", "title", "body", "created_time", "updated_time", "author", "parent_id"],
  });

  logger.debug("当前处理笔记完整属性", note);

  // 层次结构模式：记录笔记与文件夹的关联
  if (cache.exportPathStyle === ExportPathStyle.Hierarchical && note.parent_id) {
    cache.noteFolderMap.set(note.id, note.parent_id);
    logger.debug("记录笔记文件夹关联", { noteId: note.id, folderId: note.parent_id });
  }

  // 处理YAML前沿，排除标题（标题仅在前沿中存在）
  const processedBody = processYamlFrontmatter(note.body || "", note);

  // 生成笔记文件名
  const noteFileName = `${sanitizeFileName(note.title)}.md`;

  // 保存笔记信息到缓存
  cache.notes.set(note.id, {
    id: note.id,
    title: note.title,
    content: processedBody,
    folderId: note.parent_id,
    fileName: noteFileName,
  });

  // 累加笔记内容（多笔记用空行分隔）- 保留用于合并导出
  cache.content += processedBody + "\n\n";

  logger.info(`笔记【${note.title}】处理完成，已加入全局缓存`, { noteId: note.id, fileName: noteFileName });
};

// 处理资源项
export const processResourceItem = async (resource: any, filePath: string, cache: ExportGlobalCache, destPath: string): Promise<void> => {
  logger.logFunctionStart("onProcessResource", { resourceId: resource.id, filePath, style: cache.exportPathStyle });

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

    if (cache.exportPathStyle === ExportPathStyle.Flat) {
      // ========== 扁平结构模式 ==========
      logger.debug("使用扁平结构模式处理资源");

      const destDir = path.dirname(destPath); // 导出文件所在目录
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
      cache.resourceMap.set(resDetail.id, resRelativePath);

      logger.debug("资源映射已记录", { resourceId: resDetail.id, relativePath: resRelativePath });

    } else if (cache.exportPathStyle === ExportPathStyle.Hierarchical) {
      // ========== 层次结构模式 ==========
      logger.debug("使用层次结构模式处理资源");

      // 获取使用该资源的笔记列表
      const resourceNotes = await joplin.data.get(["resources", resDetail.id, "notes"]);
      logger.info("resourceNotes: ", resourceNotes);

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
        const destDir = path.dirname(destPath);
        // 构建完整文件夹路径
        const folderPath = buildFolderPath(folderId, destDir, cache.folderMap);
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
        cache.resourceMap.set(resourceKey, resRelativePath);

        logger.debug("资源映射已记录", { resourceKey, relativePath: resRelativePath });
      }
    }
  } catch (error) {
    logger.logError(error, "资源处理失败");
  }

  logger.logFunctionEnd("onProcessResource");
};

// 完成导出
export const finalizeExport = async (cache: ExportGlobalCache, destPath: string): Promise<void> => {
  logger.logFunctionStart("finalizeExport", { destPath, style: cache.exportPathStyle });

  try {
    const destDir = path.dirname(destPath);

    // ========== 保存合并内容 ==========
    if (cache.saveMergedContent) {
      logger.info("保存合并内容到文件");
      const finalContent = cache.content || "";
      await fs.writeFile(destPath, finalContent, "utf8");
      logger.info(`合并内容已保存：${destPath}，长度：${finalContent.length} 字符`);
    }

    // ========== 分别保存每个笔记 ==========
    logger.info(`开始分别保存 ${cache.notes.size} 个笔记`);

    for (const [noteId, noteInfo] of cache.notes) {
      // 替换资源链接
      const processedContent = replaceResourceLinks(noteInfo.content, noteId, cache.resourceMap);

      let noteFilePath: string;
      let assetsDir: string;

      // 确定文件名
      const fileName = cache.usingHashName ? `edit-${noteId}.md` : noteInfo.fileName;

      if (cache.exportPathStyle === ExportPathStyle.Flat) {
        // 扁平结构：所有笔记在同一目录
        noteFilePath = path.join(destDir, fileName);
        assetsDir = path.join(destDir, "assets");
      } else {
        // 层次结构：笔记按文件夹组织
        if (noteInfo.folderId) {
          const folderPath = buildFolderPath(noteInfo.folderId, destDir, cache.folderMap);
          noteFilePath = path.join(folderPath, fileName);
          assetsDir = path.join(folderPath, "assets");
        } else {
          // 无文件夹的笔记放在根目录
          noteFilePath = path.join(destDir, fileName);
          assetsDir = path.join(destDir, "assets");
        }
      }

      // 确保目录存在
      await fs.ensureDir(path.dirname(noteFilePath));

      // 检测文件是否存在，如果存在则先删除
      if (await fs.pathExists(noteFilePath)) {
        logger.info(`文件已存在，先删除：${noteFilePath}`);
        await fs.remove(noteFilePath);
      }

      // 写入笔记文件
      await fs.writeFile(noteFilePath, processedContent, "utf8");
      logger.info(`笔记已保存：${noteFilePath}`);

      // 确保assets目录存在（扁平结构需要）
      if (cache.exportPathStyle === ExportPathStyle.Flat) {
        await fs.ensureDir(assetsDir);
      }
    }

    // 记录导出结果
    logger.info(`导出成功！共保存 ${cache.notes.size} 个笔记`);
    logger.info(`资源总数：${cache.resourceMap.size} 个`);
    logger.info(`导出路径样式：${cache.exportPathStyle}`);
    logger.info(`保存合并内容：${cache.saveMergedContent}`);

  } catch (error) {
    logger.logError(error, "导出失败");
  } finally {
    // 兜底：重置缓存，避免多次导出污染
    cache.content = "";
    cache.notes.clear();
    cache.resourceMap.clear();
    cache.folderMap.clear();
    cache.noteFolderMap.clear();
    logger.debug("全局缓存已重置");
  }

  logger.logFunctionEnd("finalizeExport");
};

/**
 * 导出单个笔记到指定路径
 *
 * @param noteId 笔记 ID
 * @param destPath 目标文件路径
 * @param exportPathStyle 导出路径样式（此参数已忽略，函数强制使用扁平结构）
 * @param usingHashName 是否使用哈希文件名格式（edit-noteId.md）
 * @returns Promise<void>
 */
export const exportNoteToPath = async (
  noteId: string,
  destPath: string,
  exportPathStyle: ExportPathStyle,
  usingHashName: boolean = false
): Promise<void> => {
  // 强制使用扁平结构导出模式，忽略 exportPathStyle 参数
  const forcedExportPathStyle = ExportPathStyle.Flat;
  logger.logFunctionStart("exportNoteToPath", { noteId, destPath, exportPathStyle, forcedExportPathStyle, usingHashName });

  try {
    // 初始化缓存（强制使用扁平结构）
    const cache = await initExportCache(forcedExportPathStyle, false, usingHashName);

    // 获取笔记完整信息
    const note = await joplin.data.get(["notes", noteId], {
      fields: ["id", "title", "body", "created_time", "updated_time", "author", "parent_id"],
    });

    logger.debug("获取笔记信息成功", { noteId, title: note.title });

    // 处理笔记项
    await processNoteItem(note, cache);

    // 获取笔记的资源列表
    const resources = await joplin.data.get(["notes", noteId, "resources"], {
      fields: ["id", "title"],
      order_by: "title",
      order_dir: "ASC",
    });

    logger.info(`找到 ${resources.items.length} 个资源`);

    // 处理每个资源
    for (const resource of resources.items) {
      try {
        // 获取资源的文件路径
        const resourcePath = await joplin.data.resourcePath(resource.id);

        // 处理资源项
        await processResourceItem(resource, resourcePath, cache, destPath);
      } catch (error) {
        logger.logError(error, `处理资源失败: ${resource.id}`);
      }
    }

    // 完成导出
    await finalizeExport(cache, destPath);

    logger.info(`单个笔记导出成功: ${note.title}`);
  } catch (error) {
    logger.logError(error, "导出单个笔记失败");
    throw error;
  }

  logger.logFunctionEnd("exportNoteToPath");
};

/**
 * 导出多个笔记到指定目录
 *
 * @param noteIds 笔记 ID 数组
 * @param destDir 目标目录路径
 * @param exportPathStyle 导出路径样式
 * @returns Promise<void>
 */
export const exportNotesToDir = async (
  noteIds: string[],
  destDir: string,
  exportPathStyle: ExportPathStyle
): Promise<void> => {
  logger.logFunctionStart("exportNotesToDir", { noteCount: noteIds.length, destDir, exportPathStyle });

  try {
    // 初始化缓存
    const cache = await initExportCache(exportPathStyle, false);

    // 处理每个笔记
    for (const noteId of noteIds) {
      try {
        // 获取笔记完整信息
        const note = await joplin.data.get(["notes", noteId], {
          fields: ["id", "title", "body", "created_time", "updated_time", "author", "parent_id"],
        });

        logger.debug("处理笔记", { noteId, title: note.title });

        // 层次结构模式：记录笔记与文件夹的关联
        if (exportPathStyle === ExportPathStyle.Hierarchical && note.parent_id) {
          cache.noteFolderMap.set(note.id, note.parent_id);
        }

        // 处理笔记项
        await processNoteItem(note, cache);
      } catch (error) {
        logger.logError(error, `处理笔记失败: ${noteId}`);
      }
    }

    // 获取所有涉及的资源
    const allResources = new Set<string>();
    for (const noteId of noteIds) {
      try {
        const resources = await joplin.data.get(["notes", noteId, "resources"], {
          fields: ["id", "title"],
        });
        for (const resource of resources.items) {
          allResources.add(resource.id);
        }
      } catch (error) {
        logger.logError(error, `获取笔记资源失败: ${noteId}`);
      }
    }

    logger.info(`找到 ${allResources.size} 个唯一资源`);

    // 处理每个资源
    for (const resourceId of allResources) {
      try {
        const resource = await joplin.data.get(["resources", resourceId], {
          fields: ["id", "title", "file_extension"],
        });

        const resourcePath = await joplin.data.resourcePath(resourceId);

        // 处理资源项
        await processResourceItem(resource, resourcePath, cache, destDir);
      } catch (error) {
        logger.logError(error, `处理资源失败: ${resourceId}`);
      }
    }

    // 完成导出
    await finalizeExport(cache, destDir);

    logger.info(`批量导出成功: ${noteIds.length} 个笔记`);
  } catch (error) {
    logger.logError(error, "批量导出失败");
    throw error;
  }

  logger.logFunctionEnd("exportNotesToDir");
};