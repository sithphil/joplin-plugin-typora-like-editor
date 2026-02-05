import joplin from "api";
import * as path from "path";
import * as fs from "fs";
import { getLogger, LogLevel } from "./logger";
import { parseMarkdownImages } from "./tools";
import { getDefaultAuthor } from "./settings";

// HTML 图片信息接口
interface HtmlImageInfo {
  alt: string;
  imagePath: string;
  attributes: Map<string, string>; // 所有 HTML 属性
  lineNumber: number;
}

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
  isHtml: boolean;       // 是否为 HTML 格式
  htmlImage?: HtmlImageInfo; // HTML 图片的完整信息（仅当 isHtml=true 时）
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
      // 查找原始图片信息
      const imageInfo = localImages.find(img => img.originalPath === originalPath);
      if (!imageInfo) continue;

      const alt = imageInfo?.alt || "导入图片";

      if (imageInfo.isHtml && imageInfo.htmlImage) {
        // HTML 标签格式：替换 src 属性
        const updatedHtmlImage = {
          ...imageInfo.htmlImage,
          alt
        };
        const newHtmlTag = updateHtmlImageSrc(updatedHtmlImage, resourceId);

        // 使用正则替换整个 HTML img 标签
        const oldPattern = `<img\\s+[^>]*src=["']${escapeRegExp(originalPath)}["'][^>]*\\s*\/?>`;
        const regex = new RegExp(oldPattern, 'gi');
        processedContent = processedContent.replace(regex, newHtmlTag);

        logger.debug(`替换 HTML 图片引用: ${originalPath} -> :/${resourceId}`);
      } else {
        // Markdown 格式：替换图片引用: ![alt](原路径) -> ![alt](:/资源ID)
        const oldPattern = `!\\[([^\\]]*)\\]\\(${escapeRegExp(originalPath)}\\)`;
        const newPattern = `![${alt}](:/${resourceId})`;

        const regex = new RegExp(oldPattern, 'g');
        processedContent = processedContent.replace(regex, newPattern);

        logger.debug(`替换 Markdown 图片引用: ${originalPath} -> :/${resourceId}`);
      }
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

  // 1. 处理 Markdown 格式的图片引用
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
          lineNumber,
          isHtml: false
        });
      } else {
        logger.warn(`本地图片文件不存在: ${imagePath} (行 ${lineNumber})`);
      }
    }
  }

  // 2. 处理 HTML 格式的图片引用
  const htmlImages = parseHtmlImages(markdownContent);

  for (const htmlImage of htmlImages) {
    const { alt, imagePath, lineNumber, attributes } = htmlImage;

    // 判断是否为本地路径（非 URL）
    if (isLocalPath(imagePath)) {
      const resolvedPath = resolveImagePath(imagePath, sourceFilePath);

      if (resolvedPath && fs.existsSync(resolvedPath)) {
        // 如果 alt 为空，使用文件名（不含扩展名）
        const finalAlt = alt || getFileNameWithoutExtension(resolvedPath) || "导入图片";

        // 更新 htmlImage 的 alt
        const updatedHtmlImage = {
          ...htmlImage,
          alt: finalAlt,
          attributes: new Map(attributes.set('alt', finalAlt))
        };

        images.push({
          originalPath: imagePath,
          alt: finalAlt,
          filePath: resolvedPath,
          lineNumber,
          isHtml: true,
          htmlImage: updatedHtmlImage
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

// 解析 HTML 标签格式的图片
const parseHtmlImages = (markdownContent: string): HtmlImageInfo[] => {
  logger.logFunctionStart("parseHtmlImages");

  const images: HtmlImageInfo[] = [];
  const lines = markdownContent.split(/\r?\n/);

  // HTML img 标签正则表达式
  // 匹配：<img 属性... > 或 <img 属性... />
  // 支持单引号、双引号、无引号的属性值
  const imgRegex = /<img\s+([^>]*?)\s*\/?>/gi;

  lines.forEach((line, lineIdx) => {
    const lineNumber = lineIdx + 1;
    let match;

    while ((match = imgRegex.exec(line)) !== null) {
      const attributesStr = match[1];
      const attributes = new Map<string, string>();

      // 解析所有属性
      const attrRegex = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
      let attrMatch;

      while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
        const attrName = attrMatch[1].toLowerCase();
        const attrValue = attrMatch[2] || attrMatch[3] || attrMatch[4] || "";
        attributes.set(attrName, attrValue);
      }

      // 提取 src 和 alt
      const src = attributes.get('src') || '';
      const alt = attributes.get('alt') || '';

      if (src) {
        images.push({
          alt,
          imagePath: src,
          attributes,
          lineNumber
        });
      }
    }
  });

  logger.logFunctionEnd("parseHtmlImages", { found: images.length });
  return images;
};

// 更新 HTML img 标签的 src 属性
const updateHtmlImageSrc = (htmlImage: HtmlImageInfo, resourceId: string): string => {
  const { alt, attributes } = htmlImage;
  const attributesCopy = new Map(attributes);

  // 替换 src 为 Joplin 内部资源 ID
  attributesCopy.set('src', `:/${resourceId}`);

  // 移除 Joplin 特有的 class 属性
  if (attributesCopy.has('class')) {
    const classValue = attributesCopy.get('class')!;
    const classes = classValue.split(/\s+/).filter(c => c.trim() !== '');
    const filteredClasses = classes.filter(c => c !== 'jop-noMdConv');
    attributesCopy.set('class', filteredClasses.join(' '));
  }

  // 构建 HTML img 标签
  const attrs = Array.from(attributesCopy.entries())
    .map(([name, value]) => {
      // 如果值包含空格或特殊字符，使用双引号
      if (/[ \t\n\r"'=<>]/.test(value)) {
        return `${name}="${value}"`;
      }
      return `${name}="${value}"`;
    })
    .join(' ');

  return `<img ${attrs} />`;
};

/**
 * 更新现有笔记的内容（用于外部编辑器同步）
 *
 * 这个函数将修改后的 Markdown 内容导入并更新到现有笔记中。
 * 它会：
 * 1. 导入新的图片资源
 * 2. 替换图片引用为 Joplin 内部格式
 * 3. 更新笔记正文内容
 *
 * @param markdownContent 修改后的 Markdown 内容
 * @param sourceFilePath 源文件路径（用于解析相对路径）
 * @param noteId 要更新的笔记 ID
 * @returns Promise<ImportResult> 导入结果
 */
export const updateNoteFromMarkdown = async (
  markdownContent: string,
  sourceFilePath: string | null,
  noteId: string
): Promise<ImportResult> => {
  logger.logFunctionStart("updateNoteFromMarkdown", {
    contentLength: markdownContent.length,
    sourceFilePath,
    noteId
  });

  const result: ImportResult = {
    success: false,
    errors: [],
    importedResources: 0
  };

  try {
    // 获取原始笔记信息
    const originalNote = await joplin.data.get(["notes", noteId], {
      fields: ["id", "title", "author", "body", "parent_id"],
    });

    logger.info("获取原始笔记信息成功", {
      noteId: originalNote.id,
      title: originalNote.title,
      author: originalNote.author,
      folderId: originalNote.parent_id
    });

    const defaultAuthor = await getDefaultAuthor();
    const newAuthor = originalNote.author ? originalNote.author : defaultAuthor

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
      // 查找原始图片信息
      const imageInfo = localImages.find(img => img.originalPath === originalPath);
      if (!imageInfo) continue;

      const alt = imageInfo?.alt || "导入图片";

      if (imageInfo.isHtml && imageInfo.htmlImage) {
        // HTML 标签格式：替换 src 属性
        const updatedHtmlImage = {
          ...imageInfo.htmlImage,
          alt
        };
        const newHtmlTag = updateHtmlImageSrc(updatedHtmlImage, resourceId);

        // 使用正则替换整个 HTML img 标签
        const oldPattern = `<img\\s+[^>]*src=["']${escapeRegExp(originalPath)}["'][^>]*\\s*\/?>`;
        const regex = new RegExp(oldPattern, 'gi');
        processedContent = processedContent.replace(regex, newHtmlTag);

        logger.debug(`替换 HTML 图片引用: ${originalPath} -> :/${resourceId}`);
      } else {
        // Markdown 格式：替换图片引用: ![alt](原路径) -> ![alt](:/资源ID)
        const oldPattern = `!\\[([^\\]]*)\\]\\(${escapeRegExp(originalPath)}\\)`;
        const newPattern = `![${alt}](:/${resourceId})`;

        const regex = new RegExp(oldPattern, 'g');
        processedContent = processedContent.replace(regex, newPattern);

        logger.debug(`替换 Markdown 图片引用: ${originalPath} -> :/${resourceId}`);
      }
    }

    // 4. 更新现有笔记的内容
    await joplin.data.put(["notes", noteId], null, {
      author: newAuthor,
      body: processedContent,
    });

    result.success = true;
    result.noteId = noteId;
    logger.info(`笔记更新成功: ${noteId}`);

  } catch (error) {
    result.errors.push(`更新笔记失败: ${error}`);
    logger.logError(error, "更新笔记失败");
  }

  logger.logFunctionEnd("updateNoteFromMarkdown", {
    success: result.success,
    noteId: result.noteId,
    errors: result.errors.length,
    importedResources: result.importedResources
  });

  return result;
};