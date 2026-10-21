package com.qidian.minios;

/**
 * 奇点OS 副框架 · 原生 AI 推理引擎（llama.cpp JNI 封装）。
 * 在安卓原生侧加载 GGUF 模型并执行推理，性能最大化。
 * 对应 native 实现：framework/llama_jni.cpp → libllama_engine.so
 */
public class LlamaEngine {
    static {
        System.loadLibrary("llama_engine");
    }

    /** 加载模型，返回句柄（0 表示失败）。n_ctx 上下文长度。 */
    public native long loadModel(String path, int nCtx);

    /** 推理：prompt 输入，maxTokens 最大生成 token 数，返回生成文本。 */
    public native String infer(long handle, String prompt, int maxTokens);

    /** 释放模型资源。 */
    public native void freeModel(long handle);
}
