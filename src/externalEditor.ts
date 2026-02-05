import { spawn, ChildProcessWithoutNullStreams, exec } from "child_process";
import * as os from "os";
import * as path from "path";
import { getLogger, LogLevel } from "./logger";

const logger = getLogger("externalEditor", {
  level: LogLevel.DEBUG,
  consoleEnabled: true,
  fileEnabled: true,
});

/**
 * 工具函数：解析 wmic 输出获取 PID
 * @param stdout wmic 命令的输出内容
 * @returns number | null 解析到的 PID，失败返回 null
 */
const parsePidFromWmic = (stdout: string): number | null => {
  const pidMatch = stdout.trim().match(/ProcessId=(\d+)/);
  return pidMatch ? Number(pidMatch[1]) : null;
};

/**
 * 工具函数：阻塞延时（Promise 版）
 * @param ms 延时毫秒数
 * @returns Promise<void>
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 工具函数：执行 wmic 查询命令，获取编辑器 PID
 * @param processName 编辑器进程名（如 Typora.exe）
 * @param filePath 打开的文件路径（用于精准匹配）
 * @returns Promise<number | null> 目标 PID，查询失败返回 null
 */
const queryEditorPid = async (processName: string, filePath: string): Promise<number | null> => {
  logger.info("[开始执行查询] 单独执行 wmic 命令，精准匹配编辑器进程");

  // 将文件路径的单个反斜杠 \ 转义为双反斜杠 \\，适配 wmic 查询语法
  const escapedFilePath = filePath.replace(/\\/g, '\\\\');

  // wmic 的 like 查询用单 % 通配符
  const wmicCmd = `wmic process where "Name='${processName}' and CommandLine like '%${escapedFilePath}%'" get ProcessId /format:list`;

  logger.debug(`[查询命令] 执行 wmic：${wmicCmd}`);

  return new Promise((resolve) => {
    exec(wmicCmd, (error, stdout) => {
      if (error) {
        logger.error(`[查询 PID 失败] wmic 执行错误：${error.message}`);
        return resolve(null);
      }

      const pid = parsePidFromWmic(stdout);
      if (pid) {
        logger.info(`[查询 PID 成功] 解析到编辑器真实 PID：${pid}`);
      } else {
        logger.warn(`[查询 PID 失败] 未匹配到「${processName}」打开「${filePath}」的进程`);
      }
      resolve(pid);
    });
  });
};

/**
 * 跨平台启动外部编辑器并打开指定文件，返回编辑器 PID 用于后续管理
 * @param filePath 要打开的文件绝对路径（需引号包裹特殊字符/空格）
 * @param editorPath 编辑器可执行文件绝对路径
 * @returns Promise<{ success: boolean, editorPid?: number, error?: string }> 编辑器 PID
 */
export const openInExternalEditor = async (
  filePath: string,
  editorPath: string
): Promise<{
  success: boolean;
  editorPid?: number;
  error?: string;
}> => {
  logger.logFunctionStart("openInExternalEditor", { filePath, editorPath });

  return new Promise<{
    success: boolean;
    editorPid?: number;
    error?: string;
  }>((resolve) => {
    const platform = os.platform();
    let spawnArgs: string[] = []; // spawn的参数数组
    let spawnCommand = editorPath; // spawn的主命令（编辑器路径）

    try {
      // ********** 平台专属参数适配 **********
      if (platform === "win32") {
        // Windows适配：两步法
        // 第一步：启动编辑器
        // 第二步：延时后查询编辑器真实 PID
        spawnCommand = 'cmd.exe';
        spawnArgs = ['/c', 'start', '""', '/b', `"${editorPath}"`, `"${filePath}"`];

        // 提取编辑器进程名（如 C:\Typora\Typora.exe -> Typora.exe）
        let editorProcessName = path.basename(editorPath);
        
        // 确保 Windows 平台的进程名以 .exe 结尾
        if (platform === "win32" && !editorProcessName.toLowerCase().endsWith('.exe')) {
          editorProcessName += '.exe';
        }

        logger.info(`[第一步：启动编辑器] 执行命令：${spawnCommand} ${spawnArgs.join(' ')}`);
        logger.info(`[编辑器进程名] ${editorProcessName}`);

        // 启动 CMD 子进程（仅用于启动编辑器）
        const cmdProcess = spawn(spawnCommand, spawnArgs, {
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: true
        });

        // CMD 进程启动成功（编辑器开始启动）
        cmdProcess.on('spawn', async () => {
          logger.info(`[CMD 启动成功] 临时 CMD PID：${cmdProcess.pid}（仅用于启动编辑器）`);
          logger.info(`[TS 内阻塞] 开始阻塞 2 秒，等待编辑器进程完全创建...`);

          // ===================== 第二步：TS 内阻塞 2 秒后，单独执行查询 =====================
          await sleep(2000);
          const editorPid = await queryEditorPid(editorProcessName, filePath);

          // 查询完成后，直接返回结果
          if (editorPid) {
            logger.info("外部编辑器启动成功（已获取真实 PID）", {
              editorPath,
              filePath,
              editorPid,
              platform,
            });
            resolve({
              success: true,
              editorPid: editorPid, // 返回查询到的编辑器真实 PID
            });
          } else {
            // 即使查询失败，也认为启动成功（因为编辑器已经打开）
            logger.warn("外部编辑器启动成功，但未查询到对应 PID", {
              editorPath,
              filePath,
              platform,
            });
            resolve({
              success: true,
            });
          }
        });

        // CMD 进程启动失败
        cmdProcess.on('error', (error) => {
          const errMsg = `编辑器启动失败 - CMD 进程创建失败：${error.message}`;
          logger.error(errMsg, {
            error: error.message,
            platform,
            editorPath,
            filePath,
          });
          resolve({
            success: false,
            error: errMsg,
          });
        });

        // 监听 CMD 进程退出（正常现象，仅用于启动）
        cmdProcess.on('exit', (code, signal) => {
          logger.debug(`[CMD 进程退出] 启动编辑器的 CMD 进程已退出，退出码：${code ?? '未知'}`);
        });

      } else if (platform === "darwin") {
        // macOS适配：open -a 直接指向应用，参数为文件路径
        spawnCommand = 'open';
        spawnArgs = ['-a', editorPath, '--args', filePath];

        const childProcess = spawn(spawnCommand, spawnArgs, {
          detached: true,
          stdio: 'ignore',
          shell: false,
        });

        childProcess.on('spawn', () => {
          logger.info("外部编辑器启动成功（macOS）", {
            editorPath,
            filePath,
            pid: childProcess.pid,
            platform,
          });
          resolve({
            success: true,
            editorPid: childProcess.pid,
          });
        });

        childProcess.on('error', (error) => {
          const errMsg = `编辑器启动失败：${error.message}`;
          logger.error(errMsg, {
            error: error.message,
            platform,
            editorPath,
            filePath,
          });
          resolve({
            success: false,
            error: errMsg,
          });
        });

      } else {
        // Linux/Unix适配：直接执行编辑器，参数为文件路径
        spawnArgs = [filePath];

        const childProcess = spawn(spawnCommand, spawnArgs, {
          detached: true,
          stdio: 'ignore',
          shell: false,
        });

        childProcess.on('spawn', () => {
          logger.info("外部编辑器启动成功（Linux）", {
            editorPath,
            filePath,
            pid: childProcess.pid,
            platform,
          });
          resolve({
            success: true,
            editorPid: childProcess.pid,
          });
        });

        childProcess.on('error', (error) => {
          const errMsg = `编辑器启动失败：${error.message}`;
          logger.error(errMsg, {
            error: error.message,
            platform,
            editorPath,
            filePath,
          });
          resolve({
            success: false,
            error: errMsg,
          });
        });
      }

    } catch (error: any) {
      // 捕获同步代码异常
      const errMsg = `编辑器启动异常：${error.message || '未知错误'}`;
      logger.logError(error, "启动外部编辑器同步异常");
      resolve({
        success: false,
        error: errMsg,
      });
    }
    logger.logFunctionEnd("openInExternalEditor");
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
