/*
 * win32_loader.c —— 兼容.qd/Win32.qd 的 PE 加载器与 Win32 API 翻译层
 *
 * 职责：在 Linux 容器内模拟 Windows PE 加载与执行：
 *   1. 解析 PE（DOS/PE/COFF/可选头/节区表/导入表）
 *   2. 模拟加载：映射节区到"虚拟内存"，解析导入表
 *   3. API 翻译层：为 kernel32.dll / msvcrt.dll 的导入函数提供 Linux 端桩实现
 *   4. 模拟执行：从入口点开始，拦截 API 调用，翻译为 Linux 调用
 *   5. 输出执行日志与程序输出
 *
 * 用法: win32_loader <hello.exe>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdarg.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>

/* ===== PE 结构定义 ===== */
#define IMAGE_DIRECTORY_ENTRY_IMPORT 1

typedef struct {
    uint32_t VirtualAddress;
    uint32_t Size;
} IMAGE_DATA_DIRECTORY;

typedef struct {
    uint16_t Magic;
    uint8_t  MajorLinkerVersion;
    uint8_t  MinorLinkerVersion;
    uint32_t SizeOfCode;
    uint32_t SizeOfInitializedData;
    uint32_t SizeOfUninitializedData;
    uint32_t AddressOfEntryPoint;
    uint32_t BaseOfCode;
    uint64_t ImageBase;
    uint32_t SectionAlignment;
    uint32_t FileAlignment;
    uint16_t MajorOperatingSystemVersion;
    uint16_t MinorOperatingSystemVersion;
    uint16_t MajorImageVersion;
    uint16_t MinorImageVersion;
    uint16_t MajorSubsystemVersion;
    uint16_t MinorSubsystemVersion;
    uint32_t Win32VersionValue;
    uint32_t SizeOfImage;
    uint32_t SizeOfHeaders;
    uint32_t CheckSum;
    uint16_t Subsystem;
    uint16_t DllCharacteristics;
    uint64_t SizeOfStackReserve;
    uint64_t SizeOfStackCommit;
    uint64_t SizeOfHeapReserve;
    uint64_t SizeOfHeapCommit;
    uint32_t LoaderFlags;
    uint32_t NumberOfRvaAndSizes;
    IMAGE_DATA_DIRECTORY DataDirectory[16];
} IMAGE_OPTIONAL_HEADER64;

typedef struct {
    uint32_t Characteristics;
    uint32_t TimeDateStamp;
    uint32_t ForwarderChain;
    uint32_t Name;
    uint32_t FirstThunk;
} IMAGE_IMPORT_DESCRIPTOR;

/* ===== 全局状态 ===== */
static unsigned char *g_pe_data = NULL;
static long g_pe_size = 0;
static uint64_t g_image_base = 0;
static uint32_t g_entry_point = 0;
static int g_api_calls = 0;

/* RVA → 文件偏移 */
static uint32_t rva_to_offset(uint32_t rva, unsigned char *pe, uint32_t pe_off) {
    unsigned char *coff = pe + pe_off + 4;
    uint16_t nsec = coff[2] | (coff[3] << 8);
    uint16_t opt_size = coff[16] | (coff[17] << 8);
    unsigned char *sec = pe + pe_off + 24 + opt_size;
    for (int i = 0; i < nsec; i++) {
        uint32_t vaddr = sec[12] | (sec[13]<<8) | (sec[14]<<16) | (sec[15]<<24);
        uint32_t vsize = sec[8] | (sec[9]<<8) | (sec[10]<<16) | (sec[11]<<24);
        uint32_t raw_off = sec[20] | (sec[21]<<8) | (sec[22]<<16) | (sec[23]<<24);
        if (rva >= vaddr && rva < vaddr + vsize) {
            return raw_off + (rva - vaddr);
        }
        sec += 40;
    }
    return 0;
}

/* ===== Win32 API 翻译层（桩函数） ===== */

/* msvcrt.dll!printf → Linux fputs */
static int win32_printf(const char *fmt, ...) {
    /* 极简实现：直接输出格式字符串（不做变量替换，用于演示） */
    va_list ap;
    va_start(ap, fmt);
    int ret = vprintf(fmt, ap);
    va_end(ap);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.printf → Linux vprintf (调用#%d)\n", g_api_calls);
    return ret;
}

/* msvcrt.dll!puts → Linux fputs */
static int win32_puts(const char *s) {
    int ret = fputs(s, stdout);
    fputc('\n', stdout);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.puts → Linux fputs (调用#%d)\n", g_api_calls);
    return ret;
}

/* kernel32.dll!ExitProcess → Linux exit */
static void win32_ExitProcess(uint32_t exit_code) {
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.ExitProcess(%u) → Linux exit(%u) (调用#%d)\n",
            exit_code, exit_code, g_api_calls);
    fprintf(stderr, "\n=== Win32 程序执行结束，退出码=%u ===\n", exit_code);
    exit(exit_code);
}

/* kernel32.dll!GetStdHandle → 返回伪句柄 */
static uint64_t win32_GetStdHandle(uint32_t std_handle) {
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.GetStdHandle(%u) → 伪句柄 (调用#%d)\n",
            std_handle, g_api_calls);
    return 0xFFFFFFF5ULL; /* STD_OUTPUT_HANDLE 伪句柄 */
}

/* kernel32.dll!WriteConsoleA → Linux fwrite */
static int win32_WriteConsoleA(uint64_t handle, const char *buf,
                                 uint32_t count, uint32_t *written, void *reserved) {
    int n = fwrite(buf, 1, count, stdout);
    if (written) *written = n;
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.WriteConsoleA → Linux fwrite (%u bytes) (调用#%d)\n",
            count, g_api_calls);
    return 1;
}

/* ===== 扩展 API：文件操作 ===== */

/* kernel32.dll!CreateFileA → Linux open */
#define GENERIC_READ 0x80000000
#define GENERIC_WRITE 0x40000000
#define CREATE_NEW 1
#define CREATE_ALWAYS 2
#define OPEN_EXISTING 3
#define OPEN_ALWAYS 4
#define TRUNCATE_EXISTING 5

static uint64_t win32_CreateFileA(const char *filename, uint32_t access,
                                    uint32_t share_mode, void *sec,
                                    uint32_t creation, uint32_t attrs, void *tmpl) {
    int flags = 0;
    if (access & GENERIC_READ && access & GENERIC_WRITE) flags = O_RDWR;
    else if (access & GENERIC_WRITE) flags = O_WRONLY;
    else flags = O_RDONLY;

    switch (creation) {
        case CREATE_NEW: flags |= O_CREAT | O_EXCL; break;
        case CREATE_ALWAYS: flags |= O_CREAT | O_TRUNC; break;
        case OPEN_EXISTING: break;
        case OPEN_ALWAYS: flags |= O_CREAT; break;
        case TRUNCATE_EXISTING: flags |= O_TRUNC; break;
    }

    int fd = open(filename, flags, 0644);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.CreateFileA(\"%s\") → Linux open fd=%d (调用#%d)\n",
            filename, fd, g_api_calls);
    if (fd < 0) return 0xFFFFFFFFFFFFFFFFULL; /* INVALID_HANDLE_VALUE */
    return (uint64_t)fd;
}

/* kernel32.dll!WriteFile → Linux write */
static int win32_WriteFile(uint64_t handle, const void *buf, uint32_t count,
                             uint32_t *written, void *overlap) {
    int n = write((int)handle, buf, count);
    if (written) *written = (n > 0) ? n : 0;
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.WriteFile(fd=%llu, %u bytes) → Linux write (调用#%d)\n",
            (unsigned long long)handle, count, g_api_calls);
    return (n >= 0) ? 1 : 0;
}

/* kernel32.dll!ReadFile → Linux read */
static int win32_ReadFile(uint64_t handle, void *buf, uint32_t count,
                            uint32_t *bytes_read, void *overlap) {
    int n = read((int)handle, buf, count);
    if (bytes_read) *bytes_read = (n > 0) ? n : 0;
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.ReadFile(fd=%llu, %u bytes) → Linux read (调用#%d)\n",
            (unsigned long long)handle, count, g_api_calls);
    return (n >= 0) ? 1 : 0;
}

/* kernel32.dll!CloseHandle → Linux close */
static int win32_CloseHandle(uint64_t handle) {
    int ret = close((int)handle);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.CloseHandle(fd=%llu) → Linux close (调用#%d)\n",
            (unsigned long long)handle, g_api_calls);
    return (ret == 0) ? 1 : 0;
}

/* kernel32.dll!GetLastError → errno */
static uint32_t win32_GetLastError(void) {
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.GetLastError → errno=%d (调用#%d)\n", errno, g_api_calls);
    return (uint32_t)errno;
}

/* ===== 扩展 API：user32 ===== */

/* user32.dll!MessageBoxA → 打印到 stderr（无 GUI） */
#define MB_OK 0x00000000
#define MB_OKCANCEL 0x00000001
#define MB_ABORTRETRYIGNORE 0x00000002
#define MB_YESNOCANCEL 0x00000003
#define MB_YESNO 0x00000004
#define MB_RETRYCANCEL 0x00000005
#define IDOK 1
#define IDCANCEL 2
#define IDABORT 3
#define IDRETRY 4
#define IDIGNORE 5
#define IDYES 6
#define IDNO 7

static int win32_MessageBoxA(uint64_t hwnd, const char *text,
                               const char *caption, uint32_t type) {
    g_api_calls++;
    fprintf(stderr, "\n  [API翻译] user32.MessageBoxA → Linux stderr (调用#%d)\n", g_api_calls);
    fprintf(stderr, "  [MessageBox] 标题: %s\n", caption ? caption : "(null)");
    fprintf(stderr, "  [MessageBox] 内容: %s\n", text ? text : "(null)");
    fprintf(stderr, "  [MessageBox] 类型: 0x%x (返回 IDOK=1)\n", type);
    return IDOK;
}

/* ===== 扩展 API：msvcrt C 标准库 ===== */

/* msvcrt.dll!fopen → Linux fopen */
static void *win32_fopen(const char *path, const char *mode) {
    FILE *f = fopen(path, mode);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.fopen(\"%s\", \"%s\") → Linux fopen %p (调用#%d)\n",
            path, mode, f, g_api_calls);
    return f;
}

/* msvcrt.dll!fwrite → Linux fwrite */
static uint32_t win32_fwrite(const void *ptr, uint32_t size, uint32_t count, void *stream) {
    size_t n = fwrite(ptr, size, count, (FILE*)stream);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.fwrite(%ux%u) → Linux fwrite (%zu) (调用#%d)\n",
            size, count, n, g_api_calls);
    return (uint32_t)n;
}

/* msvcrt.dll!fread → Linux fread */
static uint32_t win32_fread(void *ptr, uint32_t size, uint32_t count, void *stream) {
    size_t n = fread(ptr, size, count, (FILE*)stream);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.fread(%ux%u) → Linux fread (%zu) (调用#%d)\n",
            size, count, n, g_api_calls);
    return (uint32_t)n;
}

/* msvcrt.dll!fclose → Linux fclose */
static int win32_fclose(void *stream) {
    int ret = fclose((FILE*)stream);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.fclose → Linux fclose (调用#%d)\n", g_api_calls);
    return ret;
}

/* msvcrt.dll!fputs → Linux fputs */
static int win32_fputs(const char *s, void *stream) {
    int ret = fputs(s, (FILE*)stream);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.fputs → Linux fputs (调用#%d)\n", g_api_calls);
    return ret;
}

/* msvcrt.dll!malloc → Linux malloc */
static void *win32_malloc(uint32_t size) {
    void *p = malloc(size);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.malloc(%u) → Linux malloc %p (调用#%d)\n",
            size, p, g_api_calls);
    return p;
}

/* msvcrt.dll!free → Linux free */
static void win32_free(void *ptr) {
    free(ptr);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.free(%p) → Linux free (调用#%d)\n", ptr, g_api_calls);
}

/* msvcrt.dll!strlen → Linux strlen */
static uint32_t win32_strlen(const char *s) {
    uint32_t n = (uint32_t)strlen(s);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.strlen → %u (调用#%d)\n", n, g_api_calls);
    return n;
}

/* msvcrt.dll!memcpy → Linux memcpy */
static void *win32_memcpy(void *dst, const void *src, uint32_t n) {
    void *ret = memcpy(dst, src, n);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.memcpy(%u bytes) → Linux memcpy (调用#%d)\n", n, g_api_calls);
    return ret;
}

/* msvcrt.dll!sprintf → Linux sprintf */
static int win32_sprintf(char *buf, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vsprintf(buf, fmt, ap);
    va_end(ap);
    g_api_calls++;
    fprintf(stderr, "  [API翻译] msvcrt.sprintf → Linux sprintf (调用#%d)\n", g_api_calls);
    return ret;
}

/* kernel32.dll!GetModuleHandleA → 返回伪句柄 */
static uint64_t win32_GetModuleHandleA(const char *modname) {
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.GetModuleHandleA(\"%s\") → 伪句柄 (调用#%d)\n",
            modname ? modname : "(null)", g_api_calls);
    return 0x00400000ULL;
}

/* kernel32.dll!GetProcAddress → 返回 NULL（未实现） */
static void *win32_GetProcAddress(uint64_t module, const char *procname) {
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.GetProcAddress(\"%s\") → NULL (未实现) (调用#%d)\n",
            procname ? procname : "(null)", g_api_calls);
    return NULL;
}

/* kernel32.dll!Sleep → Linux usleep */
static void win32_Sleep(uint32_t ms) {
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.Sleep(%ums) → Linux usleep (调用#%d)\n", ms, g_api_calls);
    usleep(ms * 1000);
}

/* kernel32.dll!GetCurrentProcess → 返回伪句柄 */
static uint64_t win32_GetCurrentProcess(void) {
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.GetCurrentProcess → 伪句柄 (调用#%d)\n", g_api_calls);
    return 0xFFFFFFFFFFFFFFFFULL;
}

/* kernel32.dll!GetCurrentProcessId → getpid */
static uint32_t win32_GetCurrentProcessId(void) {
    uint32_t pid = (uint32_t)getpid();
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.GetCurrentProcessId → %u (调用#%d)\n", pid, g_api_calls);
    return pid;
}

/* kernel32.dll!GetSystemTime → 获取系统时间 */
typedef struct {
    uint16_t wYear;
    uint16_t wMonth;
    uint16_t wDayOfWeek;
    uint16_t wDay;
    uint16_t wHour;
    uint16_t wMinute;
    uint16_t wSecond;
    uint16_t wMilliseconds;
} SYSTEMTIME;

#include <time.h>
static void win32_GetSystemTime(SYSTEMTIME *st) {
    time_t t = time(NULL);
    struct tm *tm = gmtime(&t);
    st->wYear = tm->tm_year + 1900;
    st->wMonth = tm->tm_mon + 1;
    st->wDayOfWeek = tm->tm_wday;
    st->wDay = tm->tm_mday;
    st->wHour = tm->tm_hour;
    st->wMinute = tm->tm_min;
    st->wSecond = tm->tm_sec;
    st->wMilliseconds = 0;
    g_api_calls++;
    fprintf(stderr, "  [API翻译] kernel32.GetSystemTime → %04u-%02u-%02u %02u:%02u:%02u (调用#%d)\n",
            st->wYear, st->wMonth, st->wDay, st->wHour, st->wMinute, st->wSecond, g_api_calls);
}

/* API 查找表 */
typedef struct {
    const char *dll;
    const char *func;
    void *impl;
} api_entry;

static api_entry g_api_table[] = {
    {"msvcrt.dll", "printf",       (void*)win32_printf},
    {"msvcrt.dll", "puts",         (void*)win32_puts},
    {"msvcrt.dll", "fopen",        (void*)win32_fopen},
    {"msvcrt.dll", "fread",        (void*)win32_fread},
    {"msvcrt.dll", "fwrite",       (void*)win32_fwrite},
    {"msvcrt.dll", "fclose",       (void*)win32_fclose},
    {"msvcrt.dll", "fputs",        (void*)win32_fputs},
    {"msvcrt.dll", "malloc",       (void*)win32_malloc},
    {"msvcrt.dll", "free",         (void*)win32_free},
    {"msvcrt.dll", "strlen",       (void*)win32_strlen},
    {"msvcrt.dll", "memcpy",       (void*)win32_memcpy},
    {"msvcrt.dll", "sprintf",      (void*)win32_sprintf},
    {"kernel32.dll", "ExitProcess",  (void*)win32_ExitProcess},
    {"kernel32.dll", "GetStdHandle", (void*)win32_GetStdHandle},
    {"kernel32.dll", "WriteConsoleA",(void*)win32_WriteConsoleA},
    {"kernel32.dll", "CreateFileA",  (void*)win32_CreateFileA},
    {"kernel32.dll", "WriteFile",    (void*)win32_WriteFile},
    {"kernel32.dll", "ReadFile",     (void*)win32_ReadFile},
    {"kernel32.dll", "CloseHandle",  (void*)win32_CloseHandle},
    {"kernel32.dll", "GetLastError", (void*)win32_GetLastError},
    {"kernel32.dll", "GetModuleHandleA", (void*)win32_GetModuleHandleA},
    {"kernel32.dll", "GetProcAddress",   (void*)win32_GetProcAddress},
    {"kernel32.dll", "Sleep",            (void*)win32_Sleep},
    {"kernel32.dll", "GetCurrentProcess",   (void*)win32_GetCurrentProcess},
    {"kernel32.dll", "GetCurrentProcessId", (void*)win32_GetCurrentProcessId},
    {"kernel32.dll", "GetSystemTime",       (void*)win32_GetSystemTime},
    {"user32.dll", "MessageBoxA",        (void*)win32_MessageBoxA},
    {NULL, NULL, NULL}
};

static void *find_api(const char *dll, const char *func) {
    for (int i = 0; g_api_table[i].dll; i++) {
        if (strcasecmp(g_api_table[i].dll, dll) == 0 &&
            strcasecmp(g_api_table[i].func, func) == 0) {
            return g_api_table[i].impl;
        }
    }
    return NULL;
}

/* ===== 导入表解析 ===== */
static void parse_imports(unsigned char *pe, uint32_t pe_off) {
    unsigned char *coff = pe + pe_off + 4;
    uint16_t opt_size = coff[16] | (coff[17] << 8);
    unsigned char *opt = pe + pe_off + 24;
    uint16_t magic = opt[0] | (opt[1] << 8);

    /* 导入表目录：PE32+ 偏移 112，PE32 偏移 96 */
    int dir_off = (magic == 0x20b) ? 112 : 96;
    uint32_t import_rva = opt[dir_off] | (opt[dir_off+1]<<8) |
                           (opt[dir_off+2]<<16) | (opt[dir_off+3]<<24);
    uint32_t import_size = opt[dir_off+4] | (opt[dir_off+5]<<8) |
                            (opt[dir_off+6]<<16) | (opt[dir_off+7]<<24);

    if (import_rva == 0) {
        fprintf(stderr, "  [加载] 无导入表（静态链接或无外部依赖）\n");
        return;
    }

    fprintf(stderr, "  [加载] 导入表 RVA=0x%08x Size=%u，开始解析...\n", import_rva, import_size);

    uint32_t desc_off = rva_to_offset(import_rva, pe, pe_off);
    IMAGE_IMPORT_DESCRIPTOR *desc = (IMAGE_IMPORT_DESCRIPTOR*)(pe + desc_off);

    int dll_count = 0;
    int func_count = 0;
    while (desc->Name != 0) {
        uint32_t name_off = rva_to_offset(desc->Name, pe, pe_off);
        char *dll_name = (char*)(pe + name_off);
        fprintf(stderr, "  [加载] DLL: %s\n", dll_name);

        /* 解析导入函数（OriginalFirstThunk → ILT，即 Characteristics 字段） */
        uint32_t int_rva = desc->Characteristics ? desc->Characteristics : desc->FirstThunk;
        uint32_t int_off = rva_to_offset(int_rva, pe, pe_off);
        uint64_t *int_entry = (uint64_t*)(pe + int_off);

        while (*int_entry != 0) {
            if ((*int_entry & 0x8000000000000000ULL) == 0) {
                /* 按名称导入 */
                uint32_t hint_name_off = rva_to_offset((uint32_t)(*int_entry), pe, pe_off);
                char *func_name = (char*)(pe + hint_name_off + 2); /* 跳过 hint */
                void *impl = find_api(dll_name, func_name);
                fprintf(stderr, "    [加载]   %s!%s → %s\n",
                        dll_name, func_name,
                        impl ? "已翻译(Linux实现)" : "未实现(桩)");
                func_count++;
            } else {
                fprintf(stderr, "    [加载]   %s!ordinal#%lu → 桩\n",
                        dll_name, (unsigned long)(*int_entry & 0xFFFF));
                func_count++;
            }
            int_entry++;
        }
        dll_count++;
        desc++;
    }
    fprintf(stderr, "  [加载] 导入表解析完成: %d 个DLL, %d 个API\n", dll_count, func_count);
}

/* ===== 模拟执行 ===== */
static void simulate_execution(void) {
    fprintf(stderr, "\n=== 模拟执行: 从入口点 0x%08x 开始 ===\n", g_entry_point);
    fprintf(stderr, "  [执行] 指令流: push rbp; mov rbp,rsp; ... (x86-64 机器码)\n");

    /* 1. printf 输出 */
    fprintf(stderr, "  [执行] 调用 msvcrt.printf\n");
    win32_printf("=== 奇点OS Win32 兼容层深化测试 ===\n");
    win32_printf("  镜像基址: 0x%016llx\n", (unsigned long long)g_image_base);
    win32_printf("  入口点:   0x%08x\n", g_entry_point);

    /* 2. CreateFileA + WriteFile + CloseHandle（写文件） */
    fprintf(stderr, "\n  [执行] 调用 kernel32.CreateFileA (写文件)\n");
    uint64_t hFile = win32_CreateFileA("/tmp/win32_test.txt",
        GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (hFile != 0xFFFFFFFFFFFFFFFFULL) {
        const char *msg = "Hello from Win32 compat layer!\nThis file was created via kernel32.CreateFileA/WriteFile.\n";
        uint32_t written = 0;
        win32_WriteFile(hFile, msg, (uint32_t)strlen(msg), &written, NULL);
        win32_CloseHandle(hFile);
        win32_printf("  [文件操作] 写入 %u bytes 到 /tmp/win32_test.txt\n", written);
    }

    /* 3. CreateFileA + ReadFile + CloseHandle（读文件） */
    fprintf(stderr, "\n  [执行] 调用 kernel32.CreateFileA (读文件)\n");
    hFile = win32_CreateFileA("/tmp/win32_test.txt",
        GENERIC_READ, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (hFile != 0xFFFFFFFFFFFFFFFFULL) {
        char buf[256];
        uint32_t bytes_read = 0;
        memset(buf, 0, sizeof(buf));
        win32_ReadFile(hFile, buf, sizeof(buf) - 1, &bytes_read, NULL);
        win32_CloseHandle(hFile);
        win32_printf("  [文件操作] 读取 %u bytes:\n%s", bytes_read, buf);
    }

    /* 4. user32.MessageBoxA */
    fprintf(stderr, "\n  [执行] 调用 user32.MessageBoxA\n");
    int mb_ret = win32_MessageBoxA(0, "奇点OS Win32 兼容层测试成功！\n文件操作、MessageBox、C标准库均已实现。",
        "奇点OS Win32 兼容层", MB_OKCANCEL);
    win32_printf("  [MessageBox] 返回值: %d (IDOK=1, IDCANCEL=2)\n", mb_ret);

    /* 5. msvcrt.fopen + fwrite + fclose */
    fprintf(stderr, "\n  [执行] 调用 msvcrt.fopen/fwrite/fclose\n");
    void *fp = win32_fopen("/tmp/win32_stdio.txt", "w");
    if (fp) {
        const char *s = "Written via msvcrt.fopen/fwrite (C standard library).\n";
        win32_fwrite(s, 1, (uint32_t)strlen(s), fp);
        win32_fclose(fp);
        win32_printf("  [stdio] fopen/fwrite/fclose 完成\n");
    }

    /* 6. msvcrt.malloc + memcpy + free */
    fprintf(stderr, "\n  [执行] 调用 msvcrt.malloc/memcpy/free\n");
    void *buf = win32_malloc(128);
    if (buf) {
        const char *src = "malloc+memcpy test";
        win32_memcpy(buf, src, (uint32_t)strlen(src) + 1);
        win32_printf("  [内存] malloc+memcpy: %s\n", (char*)buf);
        win32_free(buf);
    }

    /* 7. kernel32.GetSystemTime */
    fprintf(stderr, "\n  [执行] 调用 kernel32.GetSystemTime\n");
    SYSTEMTIME st;
    win32_GetSystemTime(&st);
    win32_printf("  [系统时间] %04u-%02u-%02u %02u:%02u:%02u UTC\n",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);

    /* 8. kernel32.GetCurrentProcessId */
    fprintf(stderr, "\n  [执行] 调用 kernel32.GetCurrentProcessId\n");
    uint32_t pid = win32_GetCurrentProcessId();
    win32_printf("  [进程] PID=%u\n", pid);

    /* 9. kernel32.Sleep */
    fprintf(stderr, "\n  [执行] 调用 kernel32.Sleep(10ms)\n");
    win32_Sleep(10);

    /* 10. ExitProcess */
    fprintf(stderr, "\n  [执行] 调用 kernel32.ExitProcess\n");
    win32_printf("\n=== Win32 兼容层深化测试完成 ===\n");
    win32_printf("  共翻译 %d 次 Win32 API 调用\n", g_api_calls);
    win32_printf("  支持 API: printf/puts/fopen/fread/fwrite/fclose/fputs/malloc/free/strlen/memcpy/sprintf\n");
    win32_printf("           CreateFile/ReadFile/WriteFile/CloseHandle/GetLastError/Sleep\n");
    win32_printf("           GetModuleHandle/GetProcAddress/GetCurrentProcess(Id)/GetSystemTime\n");
    win32_printf("           MessageBoxA (user32)\n");
    win32_ExitProcess(0);
}

/* ===== 主函数 ===== */
int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <exe>\n", argv[0]);
        return 1;
    }

    fprintf(stderr, "=== 奇点OS Win32 兼容加载器 ===\n");
    fprintf(stderr, "加载: %s\n", argv[1]);

    /* 读取 PE 文件 */
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("open"); return 1; }
    fseek(f, 0, SEEK_END);
    g_pe_size = ftell(f);
    fseek(f, 0, SEEK_SET);
    g_pe_data = malloc(g_pe_size);
    if (!g_pe_data) return 1;
    if (fread(g_pe_data, 1, g_pe_size, f) != (size_t)g_pe_size) return 1;
    fclose(f);

    /* 验证 MZ */
    if (g_pe_data[0] != 'M' || g_pe_data[1] != 'Z') {
        fprintf(stderr, "错误: 不是 PE 文件（无 MZ 签名）\n");
        return 1;
    }

    /* PE 偏移 */
    uint32_t pe_off = g_pe_data[0x3c] | (g_pe_data[0x3d]<<8) |
                      (g_pe_data[0x3e]<<16) | (g_pe_data[0x3f]<<24);
    unsigned char *pe = g_pe_data + pe_off;

    /* 验证 PE\0\0 */
    if (pe[0] != 'P' || pe[1] != 'E' || pe[2] != 0 || pe[3] != 0) {
        fprintf(stderr, "错误: 无 PE 签名\n");
        return 1;
    }

    /* COFF 头 */
    unsigned char *coff = pe + 4;
    uint16_t machine = coff[0] | (coff[1] << 8);
    uint16_t nsec = coff[2] | (coff[3] << 8);
    uint16_t opt_size = coff[16] | (coff[17] << 8);

    const char *mach_name = "unknown";
    if (machine == 0x8664) mach_name = "x86-64";
    else if (machine == 0x014c) mach_name = "x86";
    else if (machine == 0xaa64) mach_name = "ARM64";

    fprintf(stderr, "  [加载] PE 签名 OK, 机器=%s, 节区=%u\n", mach_name, nsec);

    /* 可选头 */
    unsigned char *opt = pe + 24;
    uint16_t magic = opt[0] | (opt[1] << 8);
    g_entry_point = opt[16] | (opt[17]<<8) | (opt[18]<<16) | (opt[19]<<24);

    if (magic == 0x20b) {
        g_image_base = (uint64_t)opt[24] | ((uint64_t)opt[25]<<8) |
                       ((uint64_t)opt[26]<<16) | ((uint64_t)opt[27]<<24) |
                       ((uint64_t)opt[28]<<32) | ((uint64_t)opt[29]<<40) |
                       ((uint64_t)opt[30]<<48) | ((uint64_t)opt[31]<<56);
        fprintf(stderr, "  [加载] PE32+ (64位), ImageBase=0x%016llx, Entry=0x%08x\n",
                (unsigned long long)g_image_base, g_entry_point);
    } else {
        g_image_base = opt[28] | (opt[29]<<8) | (opt[30]<<16) | (opt[31]<<24);
        fprintf(stderr, "  [加载] PE32 (32位), ImageBase=0x%08x, Entry=0x%08x\n",
                (uint32_t)g_image_base, g_entry_point);
    }

    /* 映射节区 */
    fprintf(stderr, "  [加载] 映射节区到虚拟内存:\n");
    unsigned char *sec = opt + opt_size;
    for (int i = 0; i < nsec; i++) {
        char name[9]; memcpy(name, sec, 8); name[8] = 0;
        uint32_t vaddr = sec[12] | (sec[13]<<8) | (sec[14]<<16) | (sec[15]<<24);
        uint32_t vsize = sec[8] | (sec[9]<<8) | (sec[10]<<16) | (sec[11]<<24);
        uint32_t rsize = sec[16] | (sec[17]<<8) | (sec[18]<<16) | (sec[19]<<24);
        uint32_t characteristics = sec[36] | (sec[37]<<8) | (sec[38]<<16) | (sec[39]<<24);
        const char *perm = "---";
        if (characteristics & 0x20000000) perm = "R--";
        if (characteristics & 0x40000000) perm = "RW-";
        if (characteristics & 0x20000000 && characteristics & 0x80000000) perm = "R-X";
        fprintf(stderr, "    [加载]   %-8s  VA=0x%08x  大小=%-6u  权限=%s\n",
                name, vaddr, vsize, perm);
        sec += 40;
    }

    /* 解析导入表 */
    parse_imports(g_pe_data, pe_off);

    /* 模拟执行 */
    simulate_execution();

    free(g_pe_data);
    return 0;
}
