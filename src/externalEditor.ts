import { exec } from "child_process";
import * as os from "os";
import * as path from "path";
import { getLogger, LogLevel } from "./logger";

const logger = getLogger("externalEditor", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

/**
 * 启动外部编辑器打开指定文件
 *
 * @param filePath 要打开的文件路径（绝对路径）
 * @param editorPath 外部编辑器路径或名称
 * @returns Promise<boolean> 是否成功启动
 */
export const openInExternalEditor = async (
  filePath: string,
  editorPath: string
): Promise<boolean> => {
  logger.logFunctionStart("openInExternalEditor", { filePath, editorPath });

  return new Promise<boolean>((resolve) => {
    const platform = os.platform();
    let command: string;

    try {
      if (platform === "win32") {
        // Windows: 使用 start 命令
        // 注意：start 命令的第一个参数是窗口标题，使用空字符串
        command = `start "" "${editorPath}" "${filePath}"`;
      } else if (platform === "darwin") {
        // macOS: 使用 open 命令
        command = `open -a "${editorPath}" "${filePath}"`;
      } else {
        // Linux: 直接执行编辑器命令
        command = `${editorPath} "${filePath}"`;
      }

      logger.info(`执行命令: ${command}`);

      exec(command, (error, stdout, stderr) => {
        if (error) {
          logger.error("启动外部编辑器失败", {
            error: error.message,
            stderr,
            platform,
            command,
          });
          resolve(false);
        } else {
          logger.info("外部编辑器已启动", { editorPath, filePath });
          if (stdout) {
            logger.debug(`stdout: ${stdout}`);
          }
          resolve(true);
        }
      });
    } catch (error) {
      logger.logError(error, "启动外部编辑器异常");
      resolve(false);
    }
  });
};

/**
 * 获取平台信息
 *
 * @returns 当前操作系统平台
 */
export const getPlatform = (): string => {
  return os.platform();
};

/**
 * 检查路径是否为绝对路径
 *
 * @param filePath 文件路径
 * @returns 是否为绝对路径
 */
export const isAbsolutePath = (filePath: string): boolean => {
  if (os.platform() === "win32") {
    // Windows: 检查是否以驱动器号开头（如 C:\）
    return /^[A-Za-z]:/.test(filePath);
  } else {
    // Unix-like: 检查是否以 / 开头
    return filePath.startsWith("/");
  }
};

/**
 * 规范化文件路径
 *
 * @param filePath 文件路径
 * @returns 规范化后的路径
 */
export const normalizePath = (filePath: string): string => {
  return path.normalize(filePath);
};

/**
 * 获取文件名（不含扩展名）
 *
 * @param filePath 文件路径
 * @returns 文件名（不含扩展名）
 */
export const getFileNameWithoutExtension = (filePath: string): string => {
  const fileName = path.basename(filePath);
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex > 0) {
    return fileName.substring(0, lastDotIndex);
  }
  return fileName;
};