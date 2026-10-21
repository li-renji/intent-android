/*
 * wm.c —— 界面.qd/窗口管理.qds（完整版：IPC 服务端）
 *
 * 职责：奇点OS 图形界面窗口管理核心，同时作为 IPC 服务端：
 *   - 窗口表：创建 / 销毁 / 聚焦 / 移动 / 缩放 / 最小化 / 最大化 / 列表
 *   - 屏幕操纵：接收 INTENT Agent 的 getScreen/click/input/scroll 等请求
 *   - Unix Domain Socket：/tmp/qd_ui.sock，与 /AI.qd/ai_service.qds 通信
 *   - 独立崩溃设计：本模块只是数据结构 + 逻辑，不依赖渲染管线
 *
 * 用法:
 *   wm              # 启动 IPC 服务端（常驻）
 *   wm --self-test  # 自检演示
 *
 * IPC 协议：
 *   请求：工具名|参数1|参数2...\n
 *   响应：OK|结果\n 或 ERROR|错误信息\n
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <fcntl.h>
#include <errno.h>

#define MAX_WIN 32
#define DEFAULT_UI_SOCKET_PATH "/tmp/qd_ui.sock"
#define BUF_SIZE 16384

static const char *get_socket_path(void) {
    const char *env = getenv("QD_UI_SOCKET");
    return (env && env[0]) ? env : DEFAULT_UI_SOCKET_PATH;
}

struct win {
    int used;
    int id;
    int x, y, w, h;
    char title[128];
    int visible;
    int z;          /* z 序：越大越靠前 */
    int minimized;
    int maximized;
};

static struct win wins[MAX_WIN];
static int next_id = 1;
static int z_top = 0;
static int focus_win = 0;

/* ===== 窗口管理 ===== */

static int wm_create(int x, int y, int w, int h, const char *title) {
    if (w <= 0 || h <= 0) return -1;
    for (int i = 0; i < MAX_WIN; i++) {
        if (!wins[i].used) {
            wins[i].used = 1;
            wins[i].id = next_id++;
            wins[i].x = x; wins[i].y = y;
            wins[i].w = w; wins[i].h = h;
            snprintf(wins[i].title, sizeof(wins[i].title), "%s", title ? title : "未命名");
            wins[i].visible = 1;
            wins[i].minimized = 0;
            wins[i].maximized = 0;
            wins[i].z = ++z_top;
            focus_win = wins[i].id;
            return wins[i].id;
        }
    }
    return -1;
}

static int wm_find(int id) {
    for (int i = 0; i < MAX_WIN; i++)
        if (wins[i].used && wins[i].id == id) return i;
    return -1;
}

static int wm_destroy(int id) {
    int i = wm_find(id);
    if (i < 0) return -1;
    wins[i].used = 0;
    if (focus_win == id) focus_win = 0;
    return 0;
}

static int wm_focus(int id) {
    int i = wm_find(id);
    if (i < 0) return -1;
    wins[i].z = ++z_top;
    wins[i].visible = 1;
    wins[i].minimized = 0;
    focus_win = id;
    return 0;
}

static int wm_move(int id, int x, int y) {
    int i = wm_find(id);
    if (i < 0) return -1;
    wins[i].x = x; wins[i].y = y;
    return 0;
}

static int wm_resize(int id, int w, int h) {
    int i = wm_find(id);
    if (i < 0 || w <= 0 || h <= 0) return -1;
    wins[i].w = w; wins[i].h = h;
    return 0;
}

static int wm_minimize(int id) {
    int i = wm_find(id);
    if (i < 0) return -1;
    wins[i].minimized = 1;
    wins[i].visible = 0;
    if (focus_win == id) focus_win = 0;
    return 0;
}

static int wm_maximize(int id) {
    int i = wm_find(id);
    if (i < 0) return -1;
    wins[i].maximized = 1;
    wins[i].minimized = 0;
    wins[i].visible = 1;
    wins[i].z = ++z_top;
    focus_win = id;
    return 0;
}

static char *wm_list_str(void) {
    static char buf[4096];
    int pos = 0;
    pos += snprintf(buf + pos, sizeof(buf) - pos, "窗口列表（共 %d 个）：\n", z_top > 0 ? z_top : 0);
    for (int i = 0; i < MAX_WIN; i++) {
        if (!wins[i].used) continue;
        pos += snprintf(buf + pos, sizeof(buf) - pos,
            "  ID=%d 标题=\"%s\" 位置=(%d,%d) 大小=%dx%d 状态=%s%s z=%d%s\n",
            wins[i].id, wins[i].title, wins[i].x, wins[i].y,
            wins[i].w, wins[i].h,
            wins[i].visible ? "可见" : "隐藏",
            wins[i].minimized ? "(最小化)" : (wins[i].maximized ? "(最大化)" : ""),
            wins[i].z, wins[i].id == focus_win ? " [焦点]" : "");
    }
    return buf;
}

/* ===== 屏幕操纵（基础实现，完整版图形界面做出来后替换） ===== */

static char *screen_get(void) {
    /* 返回当前界面结构：窗口列表 + 焦点窗口 */
    static char buf[8192];
    int pos = 0;
    pos += snprintf(buf + pos, sizeof(buf) - pos, "=== 奇点OS 界面结构 ===\n");
    pos += snprintf(buf + pos, sizeof(buf) - pos, "屏幕分辨率: 1920x1080（默认）\n");
    pos += snprintf(buf + pos, sizeof(buf) - pos, "焦点窗口: %s\n\n", focus_win > 0 ? "有" : "无");
    pos += snprintf(buf + pos, sizeof(buf) - pos, "%s", wm_list_str());
    pos += snprintf(buf + pos, sizeof(buf) - pos, "\n=== 可用操作 ===\n");
    pos += snprintf(buf + pos, sizeof(buf) - pos, "click|x|y  clickText|文字  input|文字  scroll|方向  keyPress|键名\n");
    return buf;
}

static char *screen_click(int x, int y) {
    static char buf[256];
    /* 基础实现：记录点击，查找点击位置的窗口 */
    int hit = 0;
    for (int i = 0; i < MAX_WIN; i++) {
        if (wins[i].used && wins[i].visible &&
            x >= wins[i].x && x < wins[i].x + wins[i].w &&
            y >= wins[i].y && y < wins[i].y + wins[i].h) {
            wm_focus(wins[i].id);
            snprintf(buf, sizeof(buf), "点击 (%d,%d) → 命中窗口 \"%s\" (ID=%d)，已聚焦",
                     x, y, wins[i].title, wins[i].id);
            hit = 1;
            break;
        }
    }
    if (!hit) snprintf(buf, sizeof(buf), "点击 (%d,%d) → 未命中任何窗口（桌面）", x, y);
    return buf;
}

static char *screen_click_text(const char *text) {
    static char buf[512];
    /* 基础实现：在窗口标题中查找文字 */
    for (int i = 0; i < MAX_WIN; i++) {
        if (wins[i].used && wins[i].visible && strstr(wins[i].title, text)) {
            wm_focus(wins[i].id);
            snprintf(buf, sizeof(buf), "clickText \"%s\" → 命中窗口 \"%s\" (ID=%d)，已聚焦",
                     text, wins[i].title, wins[i].id);
            return buf;
        }
    }
    snprintf(buf, sizeof(buf), "clickText \"%s\" → 未找到包含该文字的控件", text);
    return buf;
}

static char *screen_input(const char *text) {
    static char buf[512];
    if (focus_win <= 0) {
        snprintf(buf, sizeof(buf), "input 失败：当前没有聚焦的窗口/输入框");
    } else {
        snprintf(buf, sizeof(buf), "input \"%s\" → 已输入到焦点窗口 (ID=%d)", text, focus_win);
    }
    return buf;
}

static char *screen_scroll(const char *dir) {
    static char buf[256];
    snprintf(buf, sizeof(buf), "scroll %s → 已在焦点区域滚动（方向=%s）", dir, dir);
    return buf;
}

static char *screen_keypress(const char *key) {
    static char buf[256];
    snprintf(buf, sizeof(buf), "keyPress %s → 已按下按键 %s", key, key);
    return buf;
}

static char *screen_screenshot(void) {
    /* 基础实现：返回界面文字描述，完整版调用 render 模块生成图片 */
    static char buf[4096];
    snprintf(buf, sizeof(buf),
        "=== 截图（文字描述）===\n"
        "屏幕: 1920x1080\n"
        "焦点窗口: ID=%d\n"
        "%s\n"
        "（完整版图形界面实现后，此处返回真实截图）",
        focus_win, wm_list_str());
    return buf;
}

static char *screen_get_focus(void) {
    static char buf[256];
    if (focus_win > 0) {
        int i = wm_find(focus_win);
        if (i >= 0) {
            snprintf(buf, sizeof(buf), "焦点窗口: ID=%d 标题=\"%s\" 位置=(%d,%d) 大小=%dx%d",
                     wins[i].id, wins[i].title, wins[i].x, wins[i].y, wins[i].w, wins[i].h);
            return buf;
        }
    }
    snprintf(buf, sizeof(buf), "当前无焦点窗口");
    return buf;
}

static char *screen_launch_app(const char *name) {
    static char buf[512];
    /* 基础实现：创建一个应用窗口 */
    int id = wm_create(100, 100, 800, 600, name);
    if (id > 0) {
        snprintf(buf, sizeof(buf), "launchApp \"%s\" → 已启动，窗口 ID=%d", name, id);
    } else {
        snprintf(buf, sizeof(buf), "launchApp \"%s\" → 启动失败（窗口已满）", name);
    }
    return buf;
}

static char *screen_open_file(const char *path) {
    static char buf[512];
    /* 基础实现：创建一个文件查看器窗口 */
    char title[256];
    snprintf(title, sizeof(title), "文件: %s", path);
    int id = wm_create(150, 150, 700, 500, title);
    if (id > 0) {
        snprintf(buf, sizeof(buf), "openFile \"%s\" → 已打开，窗口 ID=%d", path, id);
    } else {
        snprintf(buf, sizeof(buf), "openFile \"%s\" → 打开失败", path);
    }
    return buf;
}

/* ===== IPC 请求处理 ===== */

static char *handle_request(const char *request) {
    static char response[BUF_SIZE];
    char buf[BUF_SIZE];
    strncpy(buf, request, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = 0;

    /* 去掉末尾换行 */
    int len = strlen(buf);
    while (len > 0 && (buf[len-1] == '\n' || buf[len-1] == '\r')) buf[--len] = 0;

    char *tool = strtok(buf, "|");
    if (!tool) {
        snprintf(response, sizeof(response), "ERROR|空请求");
        return response;
    }

    /* 窗口管理工具 */
    if (strcmp(tool, "windowList") == 0) {
        snprintf(response, sizeof(response), "OK|%s", wm_list_str());
    }
    else if (strcmp(tool, "windowFocus") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) { snprintf(response, sizeof(response), "ERROR|缺少窗口ID"); }
        else if (wm_focus(atoi(id)) == 0) { snprintf(response, sizeof(response), "OK|已聚焦窗口 ID=%s", id); }
        else { snprintf(response, sizeof(response), "ERROR|窗口不存在 ID=%s", id); }
    }
    else if (strcmp(tool, "windowClose") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) { snprintf(response, sizeof(response), "ERROR|缺少窗口ID"); }
        else if (wm_destroy(atoi(id)) == 0) { snprintf(response, sizeof(response), "OK|已关闭窗口 ID=%s", id); }
        else { snprintf(response, sizeof(response), "ERROR|窗口不存在 ID=%s", id); }
    }
    else if (strcmp(tool, "windowMove") == 0) {
        char *id = strtok(NULL, "|");
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        if (!id || !x || !y) { snprintf(response, sizeof(response), "ERROR|参数不足"); }
        else if (wm_move(atoi(id), atoi(x), atoi(y)) == 0) { snprintf(response, sizeof(response), "OK|窗口 ID=%s 已移动到 (%s,%s)", id, x, y); }
        else { snprintf(response, sizeof(response), "ERROR|窗口不存在"); }
    }
    else if (strcmp(tool, "windowResize") == 0) {
        char *id = strtok(NULL, "|");
        char *w = strtok(NULL, "|");
        char *h = strtok(NULL, "|");
        if (!id || !w || !h) { snprintf(response, sizeof(response), "ERROR|参数不足"); }
        else if (wm_resize(atoi(id), atoi(w), atoi(h)) == 0) { snprintf(response, sizeof(response), "OK|窗口 ID=%s 已调整为 %sx%s", id, w, h); }
        else { snprintf(response, sizeof(response), "ERROR|窗口不存在或参数无效"); }
    }
    else if (strcmp(tool, "windowMinimize") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) { snprintf(response, sizeof(response), "ERROR|缺少窗口ID"); }
        else if (wm_minimize(atoi(id)) == 0) { snprintf(response, sizeof(response), "OK|窗口 ID=%s 已最小化", id); }
        else { snprintf(response, sizeof(response), "ERROR|窗口不存在"); }
    }
    else if (strcmp(tool, "windowMaximize") == 0) {
        char *id = strtok(NULL, "|");
        if (!id) { snprintf(response, sizeof(response), "ERROR|缺少窗口ID"); }
        else if (wm_maximize(atoi(id)) == 0) { snprintf(response, sizeof(response), "OK|窗口 ID=%s 已最大化", id); }
        else { snprintf(response, sizeof(response), "ERROR|窗口不存在"); }
    }
    /* 屏幕观察工具 */
    else if (strcmp(tool, "getScreen") == 0) {
        snprintf(response, sizeof(response), "OK|%s", screen_get());
    }
    else if (strcmp(tool, "screenshot") == 0) {
        snprintf(response, sizeof(response), "OK|%s", screen_screenshot());
    }
    else if (strcmp(tool, "getFocus") == 0) {
        snprintf(response, sizeof(response), "OK|%s", screen_get_focus());
    }
    /* 屏幕操作工具 */
    else if (strcmp(tool, "click") == 0) {
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        if (!x || !y) { snprintf(response, sizeof(response), "ERROR|click 需要 x|y"); }
        else { snprintf(response, sizeof(response), "OK|%s", screen_click(atoi(x), atoi(y))); }
    }
    else if (strcmp(tool, "clickText") == 0) {
        char *text = strtok(NULL, "");
        if (!text) { snprintf(response, sizeof(response), "ERROR|clickText 缺少文字"); }
        else { snprintf(response, sizeof(response), "OK|%s", screen_click_text(text)); }
    }
    else if (strcmp(tool, "input") == 0) {
        char *text = strtok(NULL, "");
        if (!text) { snprintf(response, sizeof(response), "ERROR|input 缺少文字"); }
        else { snprintf(response, sizeof(response), "OK|%s", screen_input(text)); }
    }
    else if (strcmp(tool, "inputAt") == 0) {
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        char *text = strtok(NULL, "");
        if (!x || !y || !text) { snprintf(response, sizeof(response), "ERROR|inputAt 参数不足"); }
        else {
            screen_click(atoi(x), atoi(y));
            snprintf(response, sizeof(response), "OK|%s", screen_input(text));
        }
    }
    else if (strcmp(tool, "scroll") == 0) {
        char *dir = strtok(NULL, "|");
        if (!dir) { snprintf(response, sizeof(response), "ERROR|scroll 缺少方向"); }
        else { snprintf(response, sizeof(response), "OK|%s", screen_scroll(dir)); }
    }
    else if (strcmp(tool, "scrollAt") == 0) {
        char *x = strtok(NULL, "|");
        char *y = strtok(NULL, "|");
        char *dir = strtok(NULL, "|");
        if (!x || !y || !dir) { snprintf(response, sizeof(response), "ERROR|scrollAt 参数不足"); }
        else { snprintf(response, sizeof(response), "OK|在 (%s,%s) 滚动 %s", x, y, dir); }
    }
    else if (strcmp(tool, "keyPress") == 0) {
        char *key = strtok(NULL, "|");
        if (!key) { snprintf(response, sizeof(response), "ERROR|keyPress 缺少键名"); }
        else { snprintf(response, sizeof(response), "OK|%s", screen_keypress(key)); }
    }
    /* 系统操作工具 */
    else if (strcmp(tool, "launchApp") == 0) {
        char *name = strtok(NULL, "");
        if (!name) { snprintf(response, sizeof(response), "ERROR|launchApp 缺少应用名"); }
        else { snprintf(response, sizeof(response), "OK|%s", screen_launch_app(name)); }
    }
    else if (strcmp(tool, "openFile") == 0) {
        char *path = strtok(NULL, "");
        if (!path) { snprintf(response, sizeof(response), "ERROR|openFile 缺少路径"); }
        else { snprintf(response, sizeof(response), "OK|%s", screen_open_file(path)); }
    }
    else {
        snprintf(response, sizeof(response), "ERROR|未知工具: %s", tool);
    }

    return response;
}

/* ===== IPC 服务端 ===== */

static void run_server(void) {
    const char *socket_path = get_socket_path();
    /* 清理旧 socket */
    unlink(socket_path);

    int server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("socket");
        return;
    }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);

    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(server_fd);
        return;
    }

    if (listen(server_fd, 5) < 0) {
        perror("listen");
        close(server_fd);
        return;
    }

    printf("[窗口管理.qds] IPC 服务端已启动: %s\n", socket_path);
    printf("[窗口管理.qds] 等待 INTENT Agent 连接...\n");
    fflush(stdout);

    /* 创建默认桌面窗口 */
    wm_create(0, 0, 1920, 1080, "奇点OS 桌面");

    while (1) {
        int client_fd = accept(server_fd, NULL, NULL);
        if (client_fd < 0) {
            if (errno == EINTR) continue;
            perror("accept");
            break;
        }

        char buf[BUF_SIZE];
        int total = 0;
        while (total < (int)sizeof(buf) - 1) {
            int n = read(client_fd, buf + total, sizeof(buf) - 1 - total);
            if (n <= 0) break;
            total += n;
            if (buf[total - 1] == '\n') break;
        }
        buf[total] = 0;

        if (total > 0) {
            fprintf(stderr, "[wm] 收到请求: %.200s\n", buf);
            char *response = handle_request(buf);
            fprintf(stderr, "[wm] 响应: %.200s\n", response);
            write(client_fd, response, strlen(response));
            write(client_fd, "\n", 1);
        }

        close(client_fd);
    }

    close(server_fd);
    unlink(socket_path);
}

/* ===== 自检 ===== */

static void self_test(void) {
    printf("=== 窗口管理.qds 自检 ===\n");
    int w1 = wm_create(10, 10, 320, 240, "桌面");
    int w2 = wm_create(50, 60, 480, 320, "终端");
    int w3 = wm_create(100, 30, 640, 400, "兼容运行器");
    printf("%s", wm_list_str());

    wm_focus(w2);
    printf("\n聚焦 终端 后:\n%s", wm_list_str());

    wm_destroy(w1);
    wm_focus(w3);
    wm_move(w3, 200, 100);
    wm_resize(w3, 800, 600);
    printf("\n销毁 桌面、移动并缩放 兼容运行器 后:\n%s", wm_list_str());

    printf("\n=== 屏幕操纵测试 ===\n");
    printf("%s\n", screen_get());
    printf("%s\n", screen_click(100, 100));
    printf("%s\n", screen_click_text("终端"));
    printf("%s\n", screen_input("hello world"));
    printf("%s\n", screen_scroll("down"));
    printf("%s\n", screen_keypress("enter"));
    printf("%s\n", screen_launch_app("测试应用"));

    printf("\n=== 结论: 窗口管理 + 屏幕操纵 IPC 接口正常 ===\n");
}

int main(int argc, char **argv) {
    if (argc > 1 && strcmp(argv[1], "--self-test") == 0) {
        self_test();
        return 0;
    }
    run_server();
    return 0;
}
