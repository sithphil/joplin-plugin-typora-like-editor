import joplin from "api";
import * as path from "path";
import * as fs from "fs";
import { getLogger, LogLevel } from "./logger";
import { parseMarkdownImages } from "./tools";

// 创建日志记录器实例
const logger = getLogger("importer", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

// 导入结果接口
export interface ImportResult {
  success: boolean;
  noteId?: string;
  errors: string[];
  importedResources: number;
}

// 本地图片信息
interface LocalImageInfo {
  originalPath: string;  // 原始路径
  alt: string;           // alt文本
  filePath: string;      // 实际文件路径
  lineNumber: number;    // 在原文中的行号
}

// 导入 Markdown 文本
export const importMarkdown = async (
  markdownContent: string,
  sourceFilePath: string | null = null,
  folderId: string | null = null,
  noteTitle: string = "导入笔记"
): Promise<ImportResult> => {
  logger.logFunctionStart("importMarkdown", {
    contentLength: markdownContent.length,
    sourceFilePath,
    folderId,
    noteTitle
  });

  const result: ImportResult = {
    success: false,
    errors: [],
    importedResources: 0
  };

  try {
    // 1. 查找所有本地图片引用
    const localImages = findLocalImages(markdownContent, sourceFilePath);
    logger.info(`找到 ${localImages.length} 个本地图片引用`);

    // 2. 导入本地图片到 Joplin 资源库
    const resourceMap = new Map<string, string>(); // 原路径 -> 资源ID映射
    for (const image of localImages) {
      try {
        const resourceId = await importImageResource(image.filePath);
        if (resourceId) {
          resourceMap.set(image.originalPath, resourceId);
          result.importedResources++;
          logger.info(`图片导入成功: ${image.filePath} -> ${resourceId}`);
        } else {
          result.errors.push(`图片导入失败: ${image.filePath} (行 ${image.lineNumber})`);
        }
      } catch (error) {
        result.errors.push(`图片导入异常: ${image.filePath} - ${error}`);
        logger.logError(error, `导入图片失败: ${image.filePath}`);
      }
    }

    // 3. 替换图片引用为 Joplin 内部格式
    let processedContent = markdownContent;
    for (const [originalPath, resourceId] of resourceMap.entries()) {
      // 查找原始 alt 文本
      const imageInfo = localImages.find(img => img.originalPath === originalPath);
      const alt = imageInfo?.alt || "导入图片";

      // 替换图片引用: ![alt](原路径) -> ![alt](:/资源ID)
      const oldPattern = `!\\[([^\\]]*)\\]\\(${escapeRegExp(originalPath)}\\)`;
      const newPattern = `![${alt}](:/${resourceId})`;

      const regex = new RegExp(oldPattern, 'g');
      processedContent = processedContent.replace(regex, newPattern);

      logger.debug(`替换图片引用: ${originalPath} -> :/${resourceId}`);
    }

    // 4. 创建笔记
    const note = await joplin.data.post(["notes"], null, {
      title: noteTitle,
      body: processedContent,
      parent_id: folderId,
    });

    result.success = true;
    result.noteId = note.id;
    logger.info(`笔记创建成功: ${note.id}`);

  } catch (error) {
    result.errors.push(`导入失败: ${error}`);
    logger.logError(error, "导入 Markdown 失败");
  }

  logger.logFunctionEnd("importMarkdown", {
    success: result.success,
    noteId: result.noteId,
    errors: result.errors.length,
    importedResources: result.importedResources
  });

  return result;
};

// 查找 Markdown 文本中的本地图片引用（兼容路径含成对 ()）
const findLocalImages = (markdownContent: string, sourceFilePath: string | null): LocalImageInfo[] => {
  logger.logFunctionStart("findLocalImages", { sourceFilePath });

  const images: LocalImageInfo[] = [];

  // 使用 tools.ts 中的 parseMarkdownImages 解析所有图片引用
  const parsedImages = parseMarkdownImages(markdownContent);

  for (const parsedImage of parsedImages) {
    const { alt, imagePath, lineNumber } = parsedImage;

    // 判断是否为本地路径（非 URL）
    if (isLocalPath(imagePath)) {
      const resolvedPath = resolveImagePath(imagePath, sourceFilePath);

      if (resolvedPath && fs.existsSync(resolvedPath)) {
        // 如果 alt 为空，使用文件名（不含扩展名）
        const finalAlt = alt || getFileNameWithoutExtension(resolvedPath) || "导入图片";

        images.push({
          originalPath: imagePath,
          alt: finalAlt,
          filePath: resolvedPath,
          lineNumber
        });
      } else {
        logger.warn(`本地图片文件不存在: ${imagePath} (行 ${lineNumber})`);
      }
    }
  }

  logger.logFunctionEnd("findLocalImages", { found: images.length });
  return images;
};

// 判断路径是否为本地路径（非 URL）
const isLocalPath = (pathStr: string): boolean => {
  // URL 协议
  if (/^https?:\/\//i.test(pathStr)) {
    return false;
  }

  // data URI
  if (/^data:/i.test(pathStr)) {
    return false;
  }

  // Joplin 内部资源引用
  if (/^:\//.test(pathStr)) {
    return false;
  }

  return true;
};

// 解析图片路径
const resolveImagePath = (imagePath: string, sourceFilePath: string | null): string | null => {
  if (!sourceFilePath) {
    // 如果没有源文件路径，尝试直接作为绝对路径
    if (fs.existsSync(imagePath)) {
      return path.resolve(imagePath);
    }
    return null;
  }

  // 获取源文件所在目录
  const sourceDir = path.dirname(sourceFilePath);

  // 解析相对路径或绝对路径
  const resolvedPath = path.resolve(sourceDir, imagePath);

  if (fs.existsSync(resolvedPath)) {
    return resolvedPath;
  }

  return null;
};

// 导入图片资源到 Joplin
const importImageResource = async (filePath: string): Promise<string | null> => {
  logger.logFunctionStart("importImageResource", { filePath });

  try {
    const fileName = path.basename(filePath);
    const mimeType = getMimeType(filePath);

    // 检查是否为支持的图片格式
    if (!isImageMimeType(mimeType)) {
      logger.error(`不支持的文件类型: ${mimeType}, 跳过导入: ${filePath}`);
      return null;
    }

    // 创建 Joplin 资源（使用文件上传方式）
    const resource = await joplin.data.post(["resources"], null, { title: fileName }, [
      {
        path: filePath,
      },
    ]);

    logger.logFunctionEnd("importImageResource", { resourceId: resource.id });
    return resource.id;

  } catch (error) {
    logger.logError(error, `导入图片资源失败: ${filePath}`);
    return null;
  }
};

// 获取文件的 MIME 类型
const getMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };

  return mimeTypes[ext] || 'application/octet-stream';
};

// 判断是否为图片 MIME 类型
const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

// 获取不含扩展名的文件名
const getFileNameWithoutExtension = (filePath: string): string => {
  const fileName = path.basename(filePath);
  const lastDotIndex = fileName.lastIndexOf('.');

  if (lastDotIndex > 0) {
    return fileName.substring(0, lastDotIndex);
  }

  return fileName;
};

// 转义正则表达式特殊字符
const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};