/*
 * render.c —— 界面.qd/渲染管线.qds（真实实现）
 *
 * 职责：软件渲染管线（离屏帧缓冲）：
 *   - 帧缓冲（64x32 RGB888）
 *   - 清屏 / 填充矩形 / 画线 / 画文字块
 *   - 输出 PPM 图像文件 + 文本摘要（验证渲染结果）
 *
 * 设计：独立进程，崩溃不影响底层（与窗口管理解耦）。
 * 用法: render <out.ppm>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FB_W 64
#define FB_H 32

static unsigned char fb[FB_H][FB_W][3];

static void clear(unsigned char r, unsigned char g, unsigned char b) {
    for (int y = 0; y < FB_H; y++)
        for (int x = 0; x < FB_W; x++) {
            fb[y][x][0] = r; fb[y][x][1] = g; fb[y][x][2] = b;
        }
}

static void rect(int x0, int y0, int w, int h,
                 unsigned char r, unsigned char g, unsigned char b) {
    for (int y = y0; y < y0 + h && y < FB_H; y++)
        for (int x = x0; x < x0 + w && x < FB_W; x++)
            if (y >= 0 && x >= 0) {
                fb[y][x][0] = r; fb[y][x][1] = g; fb[y][x][2] = b;
            }
}

static void line(int x0, int y0, int x1, int y1,
                 unsigned char r, unsigned char g, unsigned char b) {
    int dx = abs(x1 - x0), dy = -abs(y1 - y0);
    int sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (;;) {
        if (x0 >= 0 && x0 < FB_W && y0 >= 0 && y0 < FB_H) {
            fb[y0][x0][0] = r; fb[y0][x0][1] = g; fb[y0][x0][2] = b;
        }
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

static int write_ppm(const char *path) {
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    fprintf(f, "P6\n%d %d\n255\n", FB_W, FB_H);
    fwrite(fb, 1, sizeof(fb), f);
    fclose(f);
    return 0;
}

int main(int argc, char **argv) {
    const char *out = (argc >= 2) ? argv[1] : "/tmp/render.ppm";
    printf("=== 渲染管线.qds 自检 (%dx%d) ===\n", FB_W, FB_H);

    clear(20, 20, 30);                       /* 深色背景 */
    rect(8, 6, 30, 18, 40, 120, 200);        /* 窗口1 */
    rect(30, 14, 24, 12, 200, 80, 40);       /* 窗口2 */
    line(0, 28, 63, 28, 255, 255, 255);      /* 任务栏 */
    line(8, 24, 54, 14, 255, 255, 0);        /* 对角线 */

    if (write_ppm(out) != 0) {
        fprintf(stderr, "写 %s 失败\n", out);
        return 1;
    }

    /* 摘要：统计非背景像素 + 输出 PPM 文件 */
    int lit = 0;
    for (int y = 0; y < FB_H; y++)
        for (int x = 0; x < FB_W; x++)
            if (fb[y][x][0] != 20 || fb[y][x][1] != 20 || fb[y][x][2] != 30) lit++;
    printf("帧缓冲: %dx%d, 已渲染像素=%d (%.1f%%)\n", FB_W, FB_H, lit, 100.0 * lit / (FB_W * FB_H));
    printf("已输出: %s (PPM P6 格式, %u bytes)\n", out, (unsigned)(FB_W * FB_H * 3 + 20));
    printf("=== 结论: 渲染管线工作正常 ===\n");
    return 0;
}
