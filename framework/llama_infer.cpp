/* 独立推理可执行文件：完全静态(musl)，通过 stdin/stdout 与 Java 通信
 * 协议：
 *   输入行：JSON {"prompt":"...", "max_tokens":128}
 *   输出：逐 token 输出文本，结束后输出一行 "===DONE==="
 */
#include <llama.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <time.h>

static double now_ms() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static llama_model   *g_model = nullptr;
static llama_context *g_ctx   = nullptr;
static const llama_vocab *g_vocab = nullptr;

static std::string read_line() {
    std::string line;
    int c;
    while ((c = fgetc(stdin)) != EOF) {
        if (c == '\n') break;
        line.push_back((char)c);
    }
    return line;
}

static std::string json_get_str(const std::string &json, const char *key) {
    std::string pat = "\""; pat += key; pat += "\":";
    size_t p = json.find(pat);
    if (p == std::string::npos) return "";
    p += pat.size();
    while (p < json.size() && (json[p]==' '||json[p]=='\"')) p++;
    size_t e = json.find('\"', p);
    if (e == std::string::npos) return "";
    return json.substr(p, e - p);
}

static int json_get_int(const std::string &json, const char *key, int def) {
    std::string pat = "\""; pat += key; pat += "\":";
    size_t p = json.find(pat);
    if (p == std::string::npos) return def;
    p += pat.size();
    while (p < json.size() && json[p]==' ') p++;
    return atoi(json.c_str() + p);
}

/* greedy: 取 logits 最大值 */
static llama_token argmax(const float *logits, int n) {
    int best = 0;
    float best_val = logits[0];
    for (int i = 1; i < n; i++) {
        if (logits[i] > best_val) { best_val = logits[i]; best = i; }
    }
    return (llama_token)best;
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <model.gguf>\n", argv[0]); return 1; }
    fprintf(stderr, "[llama_infer] loading %s\n", argv[1]);

    llama_model_params mparams = llama_model_default_params();
    g_model = llama_model_load_from_file(argv[1], mparams);
    if (!g_model) { fprintf(stderr, "[llama_infer] FAIL load model\n"); return 1; }

    g_vocab = llama_model_get_vocab(g_model);
    int n_vocab = llama_vocab_n_tokens(g_vocab);

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx = 2048;
    cparams.n_threads = 4;
    cparams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;  /* ARM CPU 上禁用 Flash Attention */
    g_ctx = llama_new_context_with_model(g_model, cparams);
    if (!g_ctx) { fprintf(stderr, "[llama_infer] FAIL context\n"); return 1; }

    fprintf(stderr, "[llama_infer] ready (n_vocab=%d)\n", n_vocab);
    fflush(stderr);

    llama_token eos = llama_vocab_eos(g_vocab);

    while (true) {
        std::string line = read_line();
        if (line.empty()) continue;
        if (line == "exit" || line == "quit") break;

        std::string prompt = json_get_str(line, "prompt");
        int max_tokens = json_get_int(line, "max_tokens", 128);
        if (prompt.empty()) { printf("===DONE===\n"); fflush(stdout); continue; }

        /* tokenize */
        std::vector<llama_token> tokens(prompt.size() + 2);
        int n_tok = llama_tokenize(g_vocab, prompt.c_str(), (int)prompt.size(),
                                   tokens.data(), (int)tokens.size(), true, true);
        if (n_tok < 0) n_tok = 0;
        tokens.resize(n_tok);

        llama_batch batch = llama_batch_init(2048, 0, 1);
        for (int i = 0; i < n_tok; i++) {
            batch.token[i] = tokens[i];
            batch.pos[i] = i;
            batch.n_seq_id[i] = 1;
            batch.seq_id[i][0] = 0;
            batch.logits[i] = (i == n_tok - 1) ? 1 : 0;
        }
        batch.n_tokens = n_tok;

        if (llama_decode(g_ctx, batch) != 0) {
            fprintf(stderr, "[llama_infer] decode fail\n");
            printf("===DONE===\n"); fflush(stdout);
            llama_batch_free(batch);
            continue;
        }
        double t_prompt = now_ms();

        int n_cur = n_tok;
        int n_out = 0;
        while (n_out < max_tokens) {
            float *logits = llama_get_logits(g_ctx);
            if (!logits) break;
            llama_token id = argmax(logits, n_vocab);
            if (id == eos || llama_vocab_is_eog(g_vocab, id)) break;

            const char *piece = llama_vocab_get_text(g_vocab, id);
            if (piece) { printf("%s", piece); fflush(stdout); }

            batch.n_tokens = 1;
            batch.token[0] = id;
            batch.pos[0] = n_cur;
            batch.n_seq_id[0] = 1;
            batch.seq_id[0][0] = 0;
            batch.logits[0] = 1;
            if (llama_decode(g_ctx, batch) != 0) break;
            n_cur++;
            n_out++;
        }
        double t_total = now_ms() - t_prompt;
        double tps = (n_out > 0 && t_total > 0) ? (n_out / (t_total / 1000.0)) : 0;
        fprintf(stderr, "[llama_infer] generated %d tokens in %.1fms (%.1f tok/s, prompt=%d tok)\n",
                n_out, t_total, tps, n_tok);
        fflush(stderr);
        llama_batch_free(batch);
        printf("\n===DONE===\n");
        fflush(stdout);
    }

    llama_free(g_ctx);
    llama_model_free(g_model);
    return 0;
}
