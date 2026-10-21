/*
 * llama_jni.cpp —— 奇点OS 副框架：安卓原生 AI 推理引擎（llama.cpp JNI 封装）
 *
 * 职责：在安卓原生侧加载 GGUF 模型并执行推理，通过共享内存桥与容器互通。
 * 适配 llama.cpp v0.4.0 API（手动填充 llama_batch，无 batch_add/clear）。
 */
#include <jni.h>
#include <llama.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>

/* musl libc 内部符号在安卓 bionic 上不可用，在此强定义 */
extern "C" {
static __thread int g_errno = 0;
int *__errno_location(void) { return &g_errno; }
int *__h_errno_location(void) { return &g_errno; }

float ldexpf(float x, int exp) {
    union { float f; uint32_t i; } u; u.f = x;
    uint32_t s = u.i & 0x80000000u, a = u.i & 0x7FFFFFFFu;
    if (a == 0 || a >= 0x7F800000u) return x;
    int e = (a >> 23) + exp;
    if (e >= 0xFF) { u.i = s | 0x7F800000u; return u.f; }
    if (e <= 0) return 0.0f;
    u.i = s | ((uint32_t)e << 23) | (a & 0x7FFFFFu);
    return u.f;
}
double ldexp(double x, int exp) { return (double)ldexpf((float)x, exp); }
float scalbnf(float x, int exp) { return ldexpf(x, exp); }
double scalbn(double x, int exp) { return ldexp(x, exp); }
float frexpf(float x, int *exp) {
    *exp = 0; if (x == 0.0f) return 0.0f;
    union { float f; uint32_t i; } u; u.f = x;
    *exp = ((u.i >> 23) & 0xFF) - 126;
    u.i = (u.i & 0x807FFFFFu) | 0x3F000000u;
    return u.f;
}
double frexp(double x, int *exp) { float f; *exp = 0; f = frexpf((float)x, exp); return (double)f; }

void __stack_chk_fail(void) { abort(); }
void __stack_chk_fail_local(void) { abort(); }

/* libdl 桩：纯 CPU 模式下 llama.cpp 不实际调用 */
void *dlopen(const char *filename, int flags) { (void)filename; (void)flags; return NULL; }
void *dlsym(void *handle, const char *symbol) { (void)handle; (void)symbol; return NULL; }
int dlclose(void *handle) { (void)handle; return 0; }
char *dlerror(void) { return (char*)"dlopen not supported"; }
int dladdr(const void *addr, void *info) { (void)addr; (void)info; return 0; }
}

#define LOGI(...) do { fprintf(stderr, "[LlamaEngine] " __VA_ARGS__); fprintf(stderr, "\n"); } while(0)
#define LOGE(...) do { fprintf(stderr, "[LlamaEngine][ERROR] " __VA_ARGS__); fprintf(stderr, "\n"); } while(0)

struct Engine {
    llama_model   *model = nullptr;
    llama_context *ctx   = nullptr;
    const llama_vocab *vocab = nullptr;
    llama_sampler *smpl  = nullptr;
    int            n_ctx = 0;
};

/* 手动填充 batch（v0.4.0 无 batch_add 辅助函数） */
static void batch_set_token(llama_batch &b, int idx, llama_token tok, int pos, bool output) {
    b.token[idx]    = tok;
    b.pos[idx]      = pos;
    b.n_seq_id[idx] = 1;
    b.seq_id[idx][0] = 0;
    b.logits[idx]   = output ? 1 : 0;
}

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_qidian_minios_LlamaEngine_loadModel(JNIEnv *env, jobject thiz, jstring path, jint n_ctx) {
    const char *cpath = env->GetStringUTFChars(path, nullptr);
    Engine *e = new Engine();
    e->n_ctx = n_ctx;

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0;
    e->model = llama_model_load_from_file(cpath, mparams);
    env->ReleaseStringUTFChars(path, cpath);

    if (!e->model) {
        LOGE("模型加载失败: %s", cpath);
        delete e;
        return 0;
    }

    e->vocab = llama_model_get_vocab(e->model);

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx = n_ctx;
    cparams.n_batch = n_ctx;
    e->ctx = llama_init_from_model(e->model, cparams);
    if (!e->ctx) {
        LOGE("上下文创建失败");
        llama_model_free(e->model);
        delete e;
        return 0;
    }

    e->smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    llama_sampler_chain_add(e->smpl, llama_sampler_init_temp(0.7f));
    llama_sampler_chain_add(e->smpl, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(e->smpl, llama_sampler_init_top_p(0.9f, 1));
    llama_sampler_chain_add(e->smpl, llama_sampler_init_dist(1234));

    LOGI("模型加载成功: vocab=%d ctx=%d", llama_vocab_n_tokens(e->vocab), n_ctx);
    return (jlong)(intptr_t)e;
}

JNIEXPORT jstring JNICALL
Java_com_qidian_minios_LlamaEngine_infer(JNIEnv *env, jobject thiz, jlong handle, jstring prompt, jint max_tokens) {
    Engine *e = (Engine *)(intptr_t)handle;
    if (!e || !e->ctx) return env->NewStringUTF("ERROR: engine not loaded");

    const char *cprompt = env->GetStringUTFChars(prompt, nullptr);
    std::string text = cprompt;
    env->ReleaseStringUTFChars(prompt, cprompt);

    /* tokenize */
    std::vector<llama_token> tokens(e->n_ctx);
    int n_tok = llama_tokenize(e->vocab, text.c_str(), (int32_t)text.size(),
                               tokens.data(), e->n_ctx, true, false);
    if (n_tok <= 0) return env->NewStringUTF("ERROR: tokenize failed");

    /* 找 EOS token（Qwen <|im_end|>） */
    llama_token eos_tok = 0;
    {
        std::vector<llama_token> eos_toks(8);
        int ne = llama_tokenize(e->vocab, "<|im_end|>", 10, eos_toks.data(), 8, false, false);
        if (ne > 0) eos_tok = eos_toks[0];
    }

    /* 首次 decode（prompt）—— 手动填充 batch */
    llama_batch batch = llama_batch_init(e->n_ctx, 0, 1);
    batch.n_tokens = n_tok;
    for (int i = 0; i < n_tok; i++) {
        batch_set_token(batch, i, tokens[i], i, i == n_tok - 1);
    }
    if (llama_decode(e->ctx, batch) != 0) {
        llama_batch_free(batch);
        return env->NewStringUTF("ERROR: decode failed");
    }

    std::string output;
    char piece_buf[256];

    for (int i = 0; i < max_tokens; i++) {
        llama_token tok = llama_sampler_sample(e->smpl, e->ctx, -1);
        llama_sampler_accept(e->smpl, tok);
        if (tok == eos_tok) break;

        int plen = llama_token_to_piece(e->vocab, tok, piece_buf, sizeof(piece_buf), 0, false);
        if (plen > 0) output.append(piece_buf, plen);

        /* 单 token decode */
        batch.n_tokens = 1;
        batch_set_token(batch, 0, tok, n_tok + i, true);
        if (llama_decode(e->ctx, batch) != 0) break;
    }

    llama_batch_free(batch);
    llama_sampler_reset(e->smpl);

    return env->NewStringUTF(output.c_str());
}

JNIEXPORT void JNICALL
Java_com_qidian_minios_LlamaEngine_freeModel(JNIEnv *env, jobject thiz, jlong handle) {
    Engine *e = (Engine *)(intptr_t)handle;
    if (!e) return;
    if (e->smpl) llama_sampler_free(e->smpl);
    if (e->ctx) llama_free(e->ctx);
    if (e->model) llama_model_free(e->model);
    delete e;
}

} // extern "C"
