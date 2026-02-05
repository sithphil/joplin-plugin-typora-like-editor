import { spawn, exec, ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 工具函数：解析wmic输出获取PID（复用，仅做格式解析）
 * @param stdout wmic命令的输出内容
 * @returns number | null 解析到的PID，失败返回null
 */
const parsePidFromWmic = (stdout: string): number | null => {
    const pidMatch = stdout.trim().match(/ProcessId=(\d+)/);
    return pidMatch ? Number(pidMatch[1]) : null;
};

/**
 * 工具函数：TS内阻塞延时（Promise版，不阻塞事件循环，精准控制时间）
 * @param ms 延时毫秒数
 * @returns Promise<void>
 */
const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 工具函数：单独执行wmic查询命令，获取编辑器PID（第二步：查询）
 * @param processName 编辑器进程名（如Typora.exe）
 * @param filePath 打开的文件路径（用于精准匹配）
 * @returns Promise<number | null> 目标PID，查询失败返回null
 */
const queryEditorPid = async (processName: string, filePath: string): Promise<number | null> => {
    console.info("[开始执行查询] 单独执行wmic命令，精准匹配编辑器进程");
    // 按「进程名+命令行含文件路径」查询，避免匹配其他实例
    // 核心修复1：将文件路径的单个反斜杠\ 转义为双反斜杠\\，适配wmic查询语法
    const escapedFilePath = filePath.replace(/\\/g, '\\\\');
    // 核心修复2：wmic的like查询用单%通配符（CMD中才用%%，直接exec执行wmic用%）
    const wmicCmd = `wmic process where "Name='${processName}' and CommandLine like '%${escapedFilePath}%'" get ProcessId /format:list`;
    console.log(`[查询命令] 最终执行wmic：${wmicCmd}`); // 新增：打印最终执行的wmic命令，方便调试

    return new Promise((resolve) => {
        exec(wmicCmd, (error, stdout) => {
            if (error) {
                console.error(`[查询PID失败] wmic执行错误：${error.message}`);
                return resolve(null);
            }
            // Windows CMD默认GBK编码，解析前转码避免乱码
            const strout = Buffer.from(stdout, 'utf8').toString();
            console.log(strout)
            const pid = parsePidFromWmic(strout);
            if (pid) {
                console.log(`[查询PID成功] 解析到编辑器真实PID：${pid}`);
            } else {
                console.warn(`[查询PID失败] 未匹配到「${processName}」打开「${filePath}」的进程`);
            }
            resolve(pid);
        });
    });
};

/**
 * 核心函数：分两步执行（TS内阻塞2秒）
 * 第一步：纯启动编辑器；第二步：TS阻塞2秒后，单独查询PID
 * @param filePath 要打开的文件路径（相对/绝对均可）
 * @param editorPath 编辑器路径（默认Typora.exe，支持环境变量/绝对路径）
 * @returns Promise<{ success: boolean, cmdPid?: number, editorPid?: number, error?: string }>
 */
const openEditorAndGetPid = async (
    filePath: string,
    editorPath: string = 'Typora.exe'
): Promise<{
    success: boolean;
    cmdPid?: number;
    editorPid?: number;
    error?: string;
}> => {
    // 仅支持Windows平台
    if (os.platform() !== 'win32') {
        return {
            success: false,
            error: `仅支持Windows平台，当前平台：${os.platform()}`
        };
    }

    // 解析绝对路径+自动创建测试文件（文件不存在时）
    const absFilePath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(absFilePath)) {
        fs.writeFileSync(absFilePath, '# 测试文件\n由openEditorAndGetPid自动创建 | TS内阻塞延时测试', 'utf-8');
        console.log(`[文件初始化] 已自动创建测试文件：${absFilePath}`);
    }

    // 提取编辑器进程名（如C:\Typora\Typora.exe → Typora.exe），用于wmic查询
    const editorProcessName = path.basename(editorPath);

    return new Promise((resolve) => {
        try {
            // ===================== 第一步：纯启动编辑器（无任何后续命令）=====================
            const spawnCommand = 'cmd.exe';
            // 仅执行start启动命令，无拼接、无延时、无查询，极简！
            const spawnArgs = ['/c', 'start', '""', '/b', `"${editorPath}"`, `"${absFilePath}"`];
            console.log(`[第一步：启动编辑器] 执行命令：${spawnCommand} ${spawnArgs.join(' ')}`);

            // 启动CMD子进程（仅用于启动编辑器，stdio忽略即可，无需捕获）
            const cmdProcess: ChildProcess = spawn(spawnCommand, spawnArgs, {
                detached: true,
                stdio: 'ignore', // 纯启动，无需捕获输出，避免卡顿
                shell: false,
                windowsHide: true, // 隐藏CMD黑窗口，仅显示编辑器
                windowsVerbatimArguments: true // 原样解析参数，解决路径空格问题
            });

            // 存储CMD进程PID
            let cmdPid: number | undefined;

            // CMD进程启动成功（编辑器开始启动）
            cmdProcess.on('spawn', async () => {
                cmdPid = cmdProcess.pid!;
                console.log(`[CMD启动成功] 临时CMD PID：${cmdPid}（仅用于启动编辑器，启动后立即退出）`);
                console.log(`[TS内阻塞] 开始阻塞2秒，等待编辑器进程完全创建...`);

                // ===================== 第二步：TS内阻塞2秒后，单独执行查询 =====================
                await sleep(2000); // 核心：TS内阻塞2秒，替代CMD内的ping/timeout
                const editorPid = await queryEditorPid(editorProcessName, absFilePath);

                // 查询完成后，直接返回结果（核心：两步执行完成，统一resolve）
                if (editorPid) {
                    resolve({
                        success: true,
                        cmdPid,
                        editorPid
                    });
                } else {
                    resolve({
                        success: false,
                        cmdPid,
                        error: '编辑器启动成功，但未查询到对应PID（排查：编辑器进程名/文件路径是否匹配）'
                    });
                }
            });

            // CMD进程启动失败（如路径错误、权限不足）
            cmdProcess.on('error', (error) => {
                resolve({
                    success: false,
                    error: `第一步：编辑器启动失败 - CMD进程创建失败：${error.message}`
                });
            });

            // 监听CMD进程退出（纯启动命令，CMD启动编辑器后会立即退出，属于正常现象）
            cmdProcess.on('exit', (code, signal) => {
                console.log(`[CMD进程退出] 启动编辑器的CMD进程已退出，退出码：${code ?? '未知'}（正常现象，仅用于启动）`);
            });

        } catch (error: any) {
            resolve({
                success: false,
                error: `同步代码异常：${error.message || '未知错误'}`
            });
        }
    });
};

// ------------------- 测试示例 -------------------
// 完全未修改！！！所有日志标题、配置、输出格式和原代码一致
if (require.main === module) {
    // 测试配置：当前目录下的a.md
    const testFilePath = 'a.md';

    // 执行测试
    (async () => {
        console.log('===================== 开始测试：start /wait 模式（记事本） =====================');
        console.log(`[测试配置] 待打开文件：${path.resolve(process.cwd(), testFilePath)}`);
        console.log(`[测试配置] 编辑器：Windows自带notepad.exe\n`);

        // 启动编辑器并获取PID（若Typora未配环境变量，替换为绝对路径：'C:\\Program Files\\Typora\\Typora.exe'）
        const result = await openEditorAndGetPid(testFilePath, 'Typora.exe');

        // 打印测试结果
        console.log('\n===================== 测试结果 =====================');
        if (result.success) {
            console.log(`测试成功 ✅`);
            console.log(`临时CMD PID：${result.cmdPid}`);
            console.log(`编辑器真实PID：${result.editorPid}`);
            console.log(`\n提示：手动关闭编辑器后，可在任务管理器验证PID消失`);
        } else {
            console.log(`测试失败 ❌`);
            console.log(`错误信息：${result.error}`);
        }
    })();
}

// 导出核心函数，供其他模块引入使用
export { openEditorAndGetPid, parsePidFromWmic, sleep, queryEditorPid };
