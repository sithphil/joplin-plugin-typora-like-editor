import joplin from "api";
import { FileSystemItem, ModelType } from "api/types";
const fs = joplin.require("fs-extra");
import * as path from "path"; // 引入路径处理，适配跨平台
import { getLogger, LogLevel } from "./logger";

// 创建日志记录器实例
const logger = getLogger("joplin-plugin-typora-like-editor", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

// 全局缓存：存储笔记内容、资源映射（解决context共享问题）
let exportGlobalCache = {
  content: "", // 存储累加的笔记正文内容（含处理后的YAML前沿）
  resourceMap: new Map(), // 资源ID -> assets相对路径映射
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
const replaceResourceLinks = (content) => {
  logger.logFunctionStart("replaceResourceLinks", { resourceMapSize: exportGlobalCache.resourceMap.size });

  if (!content || exportGlobalCache.resourceMap.size === 0) {
    logger.debug("内容为空或资源映射为空，跳过链接替换");
    logger.logFunctionEnd("replaceResourceLinks");
    return content;
  }

  // 匹配Joplin内部资源链接格式：![alt](:/资源ID)
  const resourceRegex = /!\[(.*?)\]\(:\/([a-f0-9]+)\)/g;
  const processedContent = content.replace(resourceRegex, (match, alt, resId) => {
    const localPath = exportGlobalCache.resourceMap.get(resId) || match;
    logger.debug(`资源链接替换：${match} -> ![${alt}](${localPath})`);
    return `![${alt}](${localPath})`;
  });

  logger.logFunctionEnd("replaceResourceLinks", { 替换数量: (content.match(resourceRegex) || []).length });
  return processedContent;
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

    await joplin.interop.registerExportModule({
      format: "typora_md",
      description: "Markdown (No Title From metadata)",
      target: FileSystemItem.File,
      isNoteArchive: false,
      fileExtensions: ["md"],

      onInit: async function(context: any) {
        logger.logFunctionStart("onInit", { destPath: context.destPath });

        // 初始化缓存，清空上次导出残留数据
        exportGlobalCache.content = "";
        exportGlobalCache.resourceMap.clear();

        logger.info("导出初始化完成，全局缓存已清空");
        logger.logFunctionEnd("onInit");
      },

      onProcessItem: async function(context: any, itemType: number, item: any) {
        logger.logFunctionStart("onProcessItem", { itemType, itemId: item.id });

        if (itemType === ModelType.Note) {
          // 记录笔记基础信息
          logger.debug("当前处理笔记基础信息", { id: item.id, title: item.title });

          // 获取笔记完整信息（含创建/更新时间、作者，用于前沿生成）
          const note = await joplin.data.get(["notes", item.id], {
            fields: ["id", "title", "body", "created_time", "updated_time", "author"],
          });

          logger.debug("当前处理笔记完整属性", note);

          // 处理YAML前沿，排除标题（标题仅在前沿中存在）
          let processedBody = processYamlFrontmatter(note.body || "", note);

          // 替换资源链接为assets相对路径
          processedBody = replaceResourceLinks(processedBody);

          logger.debug("当前处理笔记处理后内容", { bodyLength: processedBody.length });

          // 累加笔记内容（多笔记用空行分隔）
          exportGlobalCache.content += processedBody + "\n\n";

          logger.info(`笔记【${note.title}】处理完成，已加入全局缓存`, { noteId: note.id });
        }

        logger.logFunctionEnd("onProcessItem");
      },

      onProcessResource: async function(context: any, resource: any, filePath:string) {
        logger.logFunctionStart("onProcessResource", { resourceId: resource.id, filePath });

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

          // 1. 定义资源存储路径：导出目录/assets/资源文件
          const destDir = path.dirname(context.destPath); // 导出文件所在目录
          const assetsDir = path.join(destDir, "assets"); // assets目录（同级）
          // 资源文件名：优先用原始名称，无则用资源ID
          const resFileName = resDetail.title
            ? `${resDetail.title}`
            : `${resDetail.id}.${resDetail.file_extension}`;
          const resDestPath = path.join(assetsDir, resFileName); // 资源目标路径
          const resRelativePath = `./assets/${resFileName}`; // 笔记中使用的相对路径

          logger.debug("资源路径计算", {
            destDir,
            assetsDir,
            resFileName,
            resDestPath,
            resRelativePath
          });

          // 2. 创建assets目录（若不存在）
          if (!await fs.pathExists(assetsDir)) {
            await fs.mkdir(assetsDir);
            logger.info("创建assets资源目录", { assetsDir });
          }

          // 3. 复制Joplin内部资源到assets目录
          await fs.copyFile(filePath, resDestPath);
          logger.info(`资源复制完成`, { from: filePath, to: resDestPath });

          // 4. 记录资源映射，供后续链接替换使用
          exportGlobalCache.resourceMap.set(resDetail.id, resRelativePath);

          logger.debug("资源映射已记录", { resourceId: resDetail.id, relativePath: resRelativePath });
        } catch (error) {
          logger.logError(error, "资源处理失败");
        }

        logger.logFunctionEnd("onProcessResource");
      },

      onClose: async function(context: any) {
        logger.logFunctionStart("onClose", { destPath: context.destPath });

        try {
          const finalContent = exportGlobalCache.content || "";

          // 写入最终处理后的内容（含YAML前沿、修正后的资源链接）
          await fs.writeFile(context.destPath, finalContent, "utf8");

          // 记录导出结果
          logger.info(`导出成功！文件路径：${context.destPath}`);
          logger.info(`导出内容长度：${finalContent.length} 字符`);
          logger.info(
            `资源总数：${exportGlobalCache.resourceMap.size} 个，存储目录：${
              path.join(path.dirname(context.destPath), "assets")
            }`,
          );
        } catch (error) {
          logger.logError(error, "导出失败");
        } finally {
          // 兜底：重置缓存，避免多次导出污染
          exportGlobalCache.content = "";
          exportGlobalCache.resourceMap.clear();
          logger.debug("全局缓存已重置");
        }

        logger.logFunctionEnd("onClose");
      },
    });
  },
});