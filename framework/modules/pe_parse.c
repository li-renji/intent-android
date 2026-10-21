/*
 * pe_parse.c —— 兼容.qd/Win32.qd 的 PE 解析器（真实实现）
 *
 * 职责：解析 Windows PE 可执行文件（Win32 加载的第一步）：
 *   - DOS 头 (MZ) 与 e_lfanew
 *   - PE 签名与 COFF 头（机器类型、节区数）
 *   - 可选头（magic: PE32/PE32+、入口点、镜像基址）
 *   - 节区表（名称、虚拟地址、虚拟大小、原始大小）
 *   - 导入表目录位置（Win32 API 翻译层的入口信息）
 *
 * 用法: pe_parse <test.exe>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

static const char *machine_name(uint16_t m) {
    switch (m) {
        case 0x014c: return "x86 (i386)";
        case 0x8664: return "x86-64 (AMD64)";
        case 0xaa64: return "ARM64";
        case 0x01c0: return "ARM";
        default: return "unknown";
    }
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <exe>\n", argv[0]); return 1; }
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror("open"); return 1; }
    fseek(f, 0, SEEK_END);
    long fsz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (fsz < 64) { fprintf(stderr, "too small\n"); return 1; }
    unsigned char *d = malloc(fsz);
    if (!d) return 1;
    if (fread(d, 1, fsz, f) != (size_t)fsz) return 1;
    fclose(f);

    printf("=== PE 解析: %s (%ld bytes) ===\n", argv[1], fsz);
    if (d[0] != 'M' || d[1] != 'Z') {
        printf("结论: 不是 PE 文件（无 MZ 签名）\n");
        free(d); return 1;
    }
    printf("DOS 头: MZ 签名 OK\n");
    uint32_t pe_off = (uint32_t)d[0x3c] | ((uint32_t)d[0x3d] << 8) |
                      ((uint32_t)d[0x3e] << 16) | ((uint32_t)d[0x3f] << 24);
    if (pe_off + 24 > (uint32_t)fsz || d[pe_off] != 'P' || d[pe_off+1] != 'E' ||
        d[pe_off+2] != 0 || d[pe_off+3] != 0) {
        printf("结论: e_lfanew=%u 处无 PE\\0\\0 签名\n", pe_off);
        free(d); return 1;
    }
    unsigned char *pe = d + pe_off;
    printf("PE 头: 签名 OK (offset %u)\n", pe_off);
    uint16_t machine = pe[4] | (pe[5] << 8);
    uint16_t nsec = pe[6] | (pe[7] << 8);
    uint32_t timestamp = (uint32_t)pe[8] | ((uint32_t)pe[9] << 8) |
                         ((uint32_t)pe[10] << 16) | ((uint32_t)pe[11] << 24);
    uint16_t opt_size = pe[20] | (pe[21] << 8);
    printf("COFF: 机器=%s (0x%04x)  节区数=%u  时间戳=%u\n",
           machine_name(machine), machine, nsec, timestamp);

    unsigned char *opt = pe + 24;
    uint16_t magic = opt[0] | (opt[1] << 8);
    uint32_t entry = 0, imagebase = 0;
    if (magic == 0x10b) {           /* PE32 */
        imagebase = (uint32_t)opt[28] | ((uint32_t)opt[29] << 8) |
                    ((uint32_t)opt[30] << 16) | ((uint32_t)opt[31] << 24);
        entry = (uint32_t)opt[16] | ((uint32_t)opt[17] << 8) |
                ((uint32_t)opt[18] << 16) | ((uint32_t)opt[19] << 24);
        printf("可选头: PE32 (32位)  ImageBase=0x%08x  EntryPoint=0x%08x\n", imagebase, entry);
    } else if (magic == 0x20b) {    /* PE32+ */
        imagebase = (uint32_t)opt[24] | ((uint32_t)opt[25] << 8) |
                    ((uint32_t)opt[26] << 16) | ((uint32_t)opt[27] << 24);
        entry = (uint32_t)opt[16] | ((uint32_t)opt[17] << 8) |
                ((uint32_t)opt[18] << 16) | ((uint32_t)opt[19] << 24);
        printf("可选头: PE32+ (64位)  ImageBase=0x%08x  EntryPoint=0x%08x\n", imagebase, entry);
    } else {
        printf("可选头: magic=0x%04x (未知)\n", magic);
    }
    /* 数据目录（可选头尾部）：导入表目录在 PE32 偏移 104/PE32+ 112 */
    uint32_t import_rva = 0, import_size = 0;
    int dir_off = (magic == 0x10b) ? 96 + 8 : 112 + 8;
    if (dir_off + 8 <= opt_size) {
        unsigned char *dd = opt + dir_off;
        import_rva = (uint32_t)dd[0] | ((uint32_t)dd[1] << 8) |
                     ((uint32_t)dd[2] << 16) | ((uint32_t)dd[3] << 24);
        import_size = (uint32_t)dd[4] | ((uint32_t)dd[5] << 8) |
                      ((uint32_t)dd[6] << 16) | ((uint32_t)dd[7] << 24);
    }
    printf("导入表目录: RVA=0x%08x  Size=%u (Win32 API 翻译层入口)\n", import_rva, import_size);

    /* 节区表 */
    unsigned char *sec = opt + opt_size;
    printf("--- 节区表 (%u) ---\n", nsec);
    for (int i = 0; i < nsec && i < 16; i++) {
        char name[9]; memcpy(name, sec, 8); name[8] = 0;
        uint32_t vsize = (uint32_t)sec[8] | ((uint32_t)sec[9] << 8) |
                         ((uint32_t)sec[10] << 16) | ((uint32_t)sec[11] << 24);
        uint32_t vaddr = (uint32_t)sec[12] | ((uint32_t)sec[13] << 8) |
                         ((uint32_t)sec[14] << 16) | ((uint32_t)sec[15] << 24);
        uint32_t rsize = (uint32_t)sec[16] | ((uint32_t)sec[17] << 8) |
                         ((uint32_t)sec[18] << 16) | ((uint32_t)sec[19] << 24);
        printf("  %-8s  VA=0x%08x  VSize=%-8u  RawSize=%-8u\n", name, vaddr, vsize, rsize);
        sec += 40;
    }
    printf("=== 结论: 合法 PE（%s），可作为 Win32 兼容层加载对象 ===\n", machine_name(machine));
    free(d);
    return 0;
}
