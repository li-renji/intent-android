/*
 * intent_agent.c —— AI.qd/ai_service.qds（INTENT 意图 Agent 真实实现）
 *
 * 职责：奇点OS系统级智能体，运行在容器内 AI.qd 模块中：
 *   1. 通过共享内存(shm)调用原生层 MNN 引擎推理
 *   2. 解析 AI 回复中的【思考】【工具】【回答】
 *   3. 在容器内执行工具调用（exec/readFile/writeFile等）
 *   4. 多轮推理循环：思考→调工具→观察→继续→回答
 *   5. 输出最终结果给前端
 *
 * 用法: ai_service.qds <shm_path> "<用户问题>"
 *
 * 这是 INTENT Agent 的本体，决策循环完全在容器内执行，
 * 原生层只负责 MNN 推理，符合奇点OS主副框架设计。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/select.h>
#include <sys/un.h>
#include <fcntl.h>
#include <time.h>

/* ===== 界面 IPC（Unix Domain Socket） ===== */
#define DEFAULT_UI_SOCKET_PATH "/tmp/qd_ui.sock"
#define UI_IPC_TIMEOUT_MS 10000

static const char *get_ui_socket_path(void) {
    const char *env = getenv("QD_UI_SOCKET");
    return (env && env[0]) ? env : DEFAULT_UI_SOCKET_PATH;
}

/* 连接到界面模块的 IPC 服务端 */
static int ui_connect(void) {
    const char *socket_path = get_ui_socket_path();
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);
    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

/* 向界面模块发送请求并接收响应 */
static char *ui_request(const char *request) {
    int fd = ui_connect();
    if (fd < 0) {
        return strdup("[界面IPC连接失败] 窗口管理服务未启动（/tmp/qd_ui.sock）");
    }
    /* 发送请求 */
    write(fd, request, strlen(request));
    write(fd, "\n", 1);
    /* 接收响应 */
    static char buf[16384];
    int total = 0;
    fd_set rfds;
    struct timeval tv;
    FD_ZERO(&rfds);
    FD_SET(fd, &rfds);
    tv.tv_sec = UI_IPC_TIMEOUT_MS / 1000;
    tv.tv_usec = (UI_IPC_TIMEOUT_MS % 1000) * 1000;
    while (total < (int)sizeof(buf) - 1) {
        int ret = select(fd + 1, &rfds, NULL, NULL, &tv);
        if (ret <= 0) break;
        int n = read(fd, buf + total, sizeof(buf) - 1 - total);
        if (n <= 0) break;
        total += n;
        if (buf[total - 1] == '\n') break;
    }
    close(fd);
    buf[total] = 0;
    /* 去掉末尾换行 */
    while (total > 0 && (buf[total-1] == '\n' || buf[total-1] == '\r')) buf[--total] = 0;
    return strdup(buf);
}

/* 屏幕操纵工具：发送工具调用到界面模块 */
static char *ui_tool(const char *tool, const char *params) {
    char request[4096];
    if (params && params[0]) {
        snprintf(request, sizeof(request), "%s|%s", tool, params);
    } else {
        snprintf(request, sizeof(request), "%s", tool);
    }
    return ui_request(request);
}

/* ===== 共享内存布局（与原生层一致） ===== */
#define SHM_MAGIC   0x514D5348u
#define SHM_SIZE    (256 * 1024)
#define SHM_IN_OFF  4096
#define SHM_IN_CAP  (64 * 1024)
#define SHM_OUT_OFF (SHM_IN_OFF + SHM_IN_CAP)
#define SHM_OUT_CAP (64 * 1024)
#define STATE_IN_READY  0x1u
#define STATE_OUT_READY 0x2u
#define POLL_TIMEOUT_MS 60000
#define MAX_ROUNDS 5
#define MAX_TOOL_OUTPUT 8192

struct shm_header {
    unsigned int magic;
    unsigned int version;
    unsigned int state;
    unsigned int in_len;
    unsigned int out_len;
    unsigned int reserved[3];
};

static unsigned char *shm_base = NULL;
static struct shm_header *shm_h = NULL;

/* 通过 shm 调用原生 MNN 推理 */
static char *shm_infer(const char *prompt) {
    if (!shm_h || !shm_base) return NULL;
    int len = strlen(prompt);
    if (len >= (int)SHM_IN_CAP) len = SHM_IN_CAP - 1;

    /* 清除输出就绪标志 */
    unsigned int state = __atomic_load_n(&shm_h->state, __ATOMIC_ACQUIRE);
    __atomic_store_n(&shm_h->state, state & ~STATE_OUT_READY, __ATOMIC_RELEASE);

    /* 写入请求 */
    memcpy(shm_base + SHM_IN_OFF, prompt, len);
    __atomic_store_n(&shm_h->in_len, (unsigned int)len, __ATOMIC_RELEASE);
    __atomic_store_n(&shm_h->state, STATE_IN_READY, __ATOMIC_RELEASE);

    /* 轮询等待回复 */
    for (int i = 0; i < POLL_TIMEOUT_MS / 10; i++) {
        state = __atomic_load_n(&shm_h->state, __ATOMIC_ACQUIRE);
        if (state & STATE_OUT_READY) break;
        usleep(10000);
    }

    if (!(state & STATE_OUT_READY)) {
        return strdup("[推理超时] 原生 MNN 引擎未响应");
    }

    /* 读取回复 */
    unsigned int out_len = shm_h->out_len;
    if (out_len > SHM_OUT_CAP) out_len = SHM_OUT_CAP;
    char *result = malloc(out_len + 1);
    if (!result) return strdup("[内存不足]");
    memcpy(result, shm_base + SHM_OUT_OFF, out_len);
    result[out_len] = 0;

    /* 清除输出就绪 */
    state = __atomic_load_n(&shm_h->state, __ATOMIC_ACQUIRE);
    __atomic_store_n(&shm_h->state, state & ~STATE_OUT_READY, __ATOMIC_RELEASE);

    return result;
}

/* 执行命令并捕获输出 */
static char *exec_capture(const char *cmd) {
    char *output = malloc(MAX_TOOL_OUTPUT);
    if (!output) return strdup("[内存不足]");
    output[0] = 0;

    /* 用临时文件捕获输出 */
    char tmpfile[] = "/tmp/intent_exec_XXXXXX";
    int fd = mkstemp(tmpfile);
    if (fd < 0) {
        /* 降级：直接执行，不捕获输出 */
        system(cmd);
        snprintf(output, MAX_TOOL_OUTPUT, "[命令已执行] %s", cmd);
        return output;
    }
    close(fd);

    char full_cmd[4096];
    snprintf(full_cmd, sizeof(full_cmd), "%s > %s 2>&1", cmd, tmpfile);
    int ret = system(full_cmd);

    FILE *f = fopen(tmpfile, "r");
    if (f) {
        size_t n = fread(output, 1, MAX_TOOL_OUTPUT - 1, f);
        output[n] = 0;
        fclose(f);
    } else {
        snprintf(output, MAX_TOOL_OUTPUT, "[执行返回码: %d]", ret);
    }
    unlink(tmpfile);

    if (strlen(output) == 0) {
        snprintf(output, MAX_TOOL_OUTPUT, "[命令执行完成，无输出] 返回码=%d", ret);
    }
    return output;
}

/* 解析并执行工具调用，返回结果 */
static char *execute_tool(const char *tool_str) {
    /* tool_str 格式: 工具名|参数1|参数2... */
    char *buf = strdup(tool_str);
    char *tool = strtok(buf, "|");
    if (!tool) { free(buf); return strdup("[工具格式错误]"); }

    /* 去掉首尾空白 */
    while (*tool == ' ') tool++;
    char *end = tool + strlen(tool) - 1;
    while (end > tool && (*end == ' ' || *end == '\n' || *end == '\r')) *end-- = 0;

    char *result = NULL;

    if (strcmp(tool, "exec") == 0) {
        char *cmd = strtok(NULL, "|");
        if (!cmd) { result = strdup("[exec 缺少命令]"); }
        else {
            while (*cmd == ' ') cmd++;
            result = exec_capture(cmd);
        }
    }
    else if (strcmp(tool, "readFile") == 0) {
        char *path = strtok(NULL, "|");
        if (!path) { result = strdup("[readFile 缺少路径]"); }
        else {
            while (*path == ' ') path++;
            char cmd[4096];
            snprintf(cmd, sizeof(cmd), "cat \"%s\" 2>&1", path);
            result = exec_capture(cmd);
        }
    }
    else if (strcmp(tool, "writeFile") == 0) {
        char *path = strtok(NULL, "|");
        char *content = strtok(NULL, "");
        if (!path || !content) { result = strdup("[writeFile 参数不足]"); }
        else {
            while (*path == ' ') path++;
            /* 用 base64 避免特殊字符问题 */
            char tmpfile[] = "/tmp/intent_write_XXXXXX";
            int fd = mkstemp(tmpfile);
            if (fd >= 0) {
                write(fd, content, strlen(content));
                close(fd);
                char cmd[4096];
                snprintf(cmd, sizeof(cmd), "cp %s \"%s\" && echo '写入成功'", tmpfile, path);
                result = exec_capture(cmd);
                unlink(tmpfile);
            } else {
                result = strdup("[创建临时文件失败]");
            }
        }
    }
    else if (strcmp(tool, "getStatus") == 0) {
        result = exec_capture("echo '容器: 运行中'; echo 'AI: 就绪(INTENT Agent)'; echo '模块:'; ls /系统/ 2>/dev/null");
    }
    else if (strcmp(tool, "searchKB") == 0) {
        result = strdup("[知识库搜索功能开发中]");
    }
    /* ===== 屏幕操纵工具（奇点OS 完整版） ===== */
    else if (strcmp(tool, "getScreen") == 0) {
        result = ui_tool("getScreen", "");
    }
    else if (strcmp(tool, "screenshot") == 0) {
        result = ui_tool("screenshot", "");
    }
    else if (strcmp(tool, "getFocus") == 0) {
        result = ui_tool("getFocus", "");
    }
    else if (strcmp(tool, "click") == 0) {
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        if (!x || !y) result = strdup("[click 参数不足，需要 x|y]");
        else {
            char params[256];
            snprintf(params, sizeof(params), "%s|%s", x, y);
            result = ui_tool("click", params);
        }
    }
    else if (strcmp(tool, "clickText") == 0) {
        char *text = strtok(NULL, "");
        if (!text) result = strdup("[clickText 缺少文字]");
        else result = ui_tool("clickText", text);
    }
    else if (strcmp(tool, "input") == 0) {
        char *text = strtok(NULL, "");
        if (!text) result = strdup("[input 缺少文字]");
        else result = ui_tool("input", text);
    }
    else if (strcmp(tool, "inputAt") == 0) {
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        char *text = strtok(NULL, "");
        if (!x || !y || !text) result = strdup("[inputAt 参数不足，需要 x|y|文字]");
        else {
            char params[1024];
            snprintf(params, sizeof(params), "%s|%s|%s", x, y, text);
            result = ui_tool("inputAt", params);
        }
    }
    else if (strcmp(tool, "scroll") == 0) {
        char *dir = strtok(NULL, "|");
        if (!dir) result = strdup("[scroll 缺少方向 up/down/left/right]");
        else result = ui_tool("scroll", dir);
    }
    else if (strcmp(tool, "scrollAt") == 0) {
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        char *dir = strtok(NULL, "|");
        if (!x || !y || !dir) result = strdup("[scrollAt 参数不足]");
        else {
            char params[256];
            snprintf(params, sizeof(params), "%s|%s|%s", x, y, dir);
            result = ui_tool("scrollAt", params);
        }
    }
    else if (strcmp(tool, "keyPress") == 0) {
        char *key = strtok(NULL, "|");
        if (!key) result = strdup("[keyPress 缺少键名]");
        else result = ui_tool("keyPress", key);
    }
    /* ===== 窗口管理工具 ===== */
    else if (strcmp(tool, "windowList") == 0) {
        result = ui_tool("windowList", "");
    }
    else if (strcmp(tool, "windowFocus") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) result = strdup("[windowFocus 缺少窗口ID]");
        else result = ui_tool("windowFocus", id);
    }
    else if (strcmp(tool, "windowClose") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) result = strdup("[windowClose 缺少窗口ID]");
        else result = ui_tool("windowClose", id);
    }
    else if (strcmp(tool, "windowMove") == 0) {
        char *id = strtok(NULL, "|");
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        if (!id || !x || !y) result = strdup("[windowMove 参数不足]");
        else {
            char params[256];
            snprintf(params, sizeof(params), "%s|%s|%s", id, x, y);
            result = ui_tool("windowMove", params);
        }
    }
    else if (strcmp(tool, "windowResize") == 0) {
        char *id = strtok(NULL, "|");
        char *w = strtok(NULL, "|");
        char *h = strtok(NULL, "|");
        if (!id || !w || !h) result = strdup("[windowResize 参数不足]");
        else {
            char params[256];
            snprintf(params, sizeof(params), "%s|%s|%s", id, w, h);
            result = ui_tool("windowResize", params);
        }
    }
    else if (strcmp(tool, "windowMinimize") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) result = strdup("[windowMinimize 缺少窗口ID]");
        else result = ui_tool("windowMinimize", id);
    }
    else if (strcmp(tool, "windowMaximize") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) result = strdup("[windowMaximize 缺少窗口ID]");
        else result = ui_tool("windowMaximize", id);
    }
    /* ===== 系统操作工具 ===== */
    else if (strcmp(tool, "launchApp") == 0) {
        char *name = strtok(NULL, "");
        if (!name) result = strdup("[launchApp 缺少应用名]");
        else result = ui_tool("launchApp", name);
    }
    else if (strcmp(tool, "openFile") == 0) {
        char *path = strtok(NULL, "");
        if (!path) result = strdup("[openFile 缺少文件路径]");
        else result = ui_tool("openFile", path);
    }
    else {
        char msg[256];
        snprintf(msg, sizeof(msg), "[未知工具: %s]", tool);
        result = strdup(msg);
    }

    free(buf);
    return result;
}

/* 从文本中提取标记内容 */
static char *extract_tag(const char *text, const char *tag_open, const char *tag_close) {
    const char *start = strstr(text, tag_open);
    if (!start) return NULL;
    start += strlen(tag_open);
    const char *end = strstr(start, tag_close);
    if (!end) end = start + strlen(start);
    int len = end - start;
    char *result = malloc(len + 1);
    if (!result) return NULL;
    memcpy(result, start, len);
    result[len] = 0;
    return result;
}

/* 构造 INTENT 系统提示词 */
static char *build_system_prompt(void) {
    return strdup(
        "你是INTENT，奇点OS系统级智能体。直接回答用户问题，简洁诚实。\n"
        "\n"
        "【可用工具】\n"
        "系统工具：exec|命令、readFile|路径、writeFile|路径|内容、getStatus、searchKB|关键词\n"
        "\n"
        "屏幕操纵工具（操纵奇点OS图形界面）：\n"
        "观察：getScreen（获取界面控件树）、screenshot（截图）、getFocus（当前聚焦）\n"
        "操作：click|x|y、clickText|文字、input|文字、inputAt|x|y|文字、scroll|up/down/left/right、keyPress|back/home/enter/delete\n"
        "窗口：windowList、windowFocus|ID、windowClose|ID、windowMove|ID|x|y、windowResize|ID|宽|高、windowMinimize|ID、windowMaximize|ID\n"
        "系统：launchApp|应用名、openFile|路径\n"
        "\n"
        "【操纵界面的流程】\n"
        "1. 先用 getScreen 观察当前界面\n"
        "2. 分析后调用工具操作（click/input/scroll等）\n"
        "3. 操作后再次 getScreen 验证结果\n"
        "4. 重复直到任务完成\n"
        "\n"
        "【安全约束】\n"
        "涉及删除、支付、密码、发送消息、修改系统设置等敏感操作，必须先询问用户确认。\n"
        "\n"
        "【输出格式】\n"
        "需要工具时单独一行写：工具名|参数1|参数2...\n"
        "不需要工具时直接回答。\n"
    );
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <shm_path> \"<用户问题>\"\n", argv[0]);
        return 1;
    }
    const char *shm_path = argv[1];
    const char *user_input = argv[2];

    /* 1. 打开共享内存 */
    int fd = open(shm_path, O_RDWR);
    if (fd < 0) { perror("open shm"); return 1; }
    shm_base = mmap(NULL, SHM_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (shm_base == MAP_FAILED) { perror("mmap"); return 1; }
    close(fd);
    shm_h = (struct shm_header *)shm_base;

    if (shm_h->magic != SHM_MAGIC) {
        fprintf(stderr, "shm magic 不匹配，原生层未初始化通道\n");
        return 2;
    }

    /* 2. 构造初始 prompt */
    char *sys_prompt = build_system_prompt();
    char prompt[SHM_IN_CAP];
    snprintf(prompt, sizeof(prompt), "%s\n用户: %s\nINTENT: ", sys_prompt, user_input);
    free(sys_prompt);

    char full_log[65536];
    full_log[0] = 0;
    char *final_answer = NULL;

    /* 3. Agent 循环：最多2轮（第一轮推理，如需要工具则第二轮） */
    for (int round = 0; round < 2; round++) {
        fprintf(stderr, "[INTENT] 第 %d 轮推理...\n", round + 1);

        char *response = shm_infer(prompt);
        if (!response) {
            final_answer = strdup("[推理失败] shm 通信异常");
            break;
        }
        fprintf(stderr, "[INTENT] 收到回复(%d字节): %.200s\n", (int)strlen(response), response);

        /* 检查是否有工具调用：以已知工具名开头的行 */
        static const char *tool_names[] = {
            "exec", "readFile", "writeFile", "getStatus", "searchKB",
            "getScreen", "screenshot", "getFocus",
            "click", "clickText", "input", "inputAt", "scroll", "scrollAt", "keyPress",
            "windowList", "windowFocus", "windowClose", "windowMove", "windowResize",
            "windowMinimize", "windowMaximize",
            "launchApp", "openFile",
            NULL
        };
        char *tool_line = NULL;
        const char *matched_tool = NULL;
        char *line = response;
        while (line && *line) {
            char *nl = strchr(line, '\n');
            int linelen = nl ? (int)(nl - line) : (int)strlen(line);
            /* 跳过行首空白 */
            char *trimmed = line;
            while (*trimmed == ' ' || *trimmed == '\t') trimmed++;
            int tlen = linelen - (int)(trimmed - line);
            for (int i = 0; tool_names[i]; i++) {
                int tnl = (int)strlen(tool_names[i]);
                if (tlen > tnl && strncmp(trimmed, tool_names[i], tnl) == 0 &&
                    (trimmed[tnl] == '|' || trimmed[tnl] == ' ' || trimmed[tnl] == '\r')) {
                    tool_line = trimmed;
                    matched_tool = tool_names[i];
                    break;
                }
                /* 无参数工具（单独一行） */
                if (tlen == tnl && strncmp(trimmed, tool_names[i], tnl) == 0) {
                    tool_line = trimmed;
                    matched_tool = tool_names[i];
                    break;
                }
            }
            if (tool_line) break;
            if (!nl) break;
            line = nl + 1;
        }

        if (tool_line && round < MAX_ROUNDS - 1) {
            /* 提取工具调用整行 */
            char *tl_end = strchr(tool_line, '\n');
            if (!tl_end) tl_end = tool_line + strlen(tool_line);
            char tool_str[1024];
            int tlen = tl_end - tool_line;
            if (tlen > (int)sizeof(tool_str) - 1) tlen = sizeof(tool_str) - 1;
            memcpy(tool_str, tool_line, tlen);
            tool_str[tlen] = 0;
            /* 去掉末尾空白 */
            while (tlen > 0 && (tool_str[tlen-1] == ' ' || tool_str[tlen-1] == '\r' || tool_str[tlen-1] == '\n')) tool_str[--tlen] = 0;

            fprintf(stderr, "[INTENT] 调用工具: %s\n", tool_str);
            char *tool_result = execute_tool(tool_str);
            fprintf(stderr, "[INTENT] 工具结果: %.300s\n", tool_result);

            /* 把结果拼回 prompt，再推理一轮 */
            char new_prompt[SHM_IN_CAP];
            snprintf(new_prompt, sizeof(new_prompt),
                "%s%s\n工具结果: %s\n请根据结果继续操作或回答用户。INTENT: ",
                prompt, response, tool_result);
            strncpy(prompt, new_prompt, sizeof(prompt) - 1);
            prompt[sizeof(prompt) - 1] = 0;

            free(tool_result);
            free(response);
            continue;
        }

        /* 没有工具调用，直接返回回答 */
        final_answer = strdup(response);
        free(response);
        break;
    }

    if (!final_answer) {
        final_answer = strdup("[INTENT] 推理超时");
    }

    /* 4. 输出最终结果（stdout 给前端） */
    printf("%s\n", final_answer);
    free(final_answer);

    /* 5. 输出思考日志到 stderr（调试用） */
    fprintf(stderr, "[INTENT] 完成，共 %d 轮\n", MAX_ROUNDS);

    munmap(shm_base, SHM_SIZE);
    return 0;
}
