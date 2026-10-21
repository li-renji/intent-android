package com.qidian.minios;

public class MnnEngine {
    static {
        System.loadLibrary("MNN");
        System.loadLibrary("llm");
        System.loadLibrary("mnn_jni");
    }

    private long nativePtr = 0;

    public native long nativeCreate(String configPath);
    public native String nativeInfer(long ptr, String prompt, int maxTokens);
    public native void nativeDestroy(long ptr);

    public boolean load(String configPath) {
        nativePtr = nativeCreate(configPath);
        return nativePtr != 0;
    }

    public String infer(String prompt, int maxTokens) {
        if (nativePtr == 0) return "";
        return nativeInfer(nativePtr, prompt, maxTokens);
    }

    public void close() {
        if (nativePtr != 0) {
            nativeDestroy(nativePtr);
            nativePtr = 0;
        }
    }
}
