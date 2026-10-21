#include <jni.h>
#include <string>
#include <sstream>
#include <vector>
#include "llm/llm.hpp"

using namespace MNN::Transformer;

static JavaVM* g_vm = nullptr;

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void* reserved) {
    g_vm = vm;
    return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_qidian_minios_MnnEngine_nativeCreate(JNIEnv* env, jobject thiz, jstring configPath) {
    const char* path = env->GetStringUTFChars(configPath, nullptr);
    Llm* llm = Llm::createLLM(std::string(path));
    env->ReleaseStringUTFChars(configPath, path);
    if (!llm) return 0;
    bool ok = llm->load();
    if (!ok) {
        delete llm;
        return 0;
    }
    return reinterpret_cast<jlong>(llm);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_qidian_minios_MnnEngine_nativeInfer(JNIEnv* env, jobject thiz, jlong ptr, jstring prompt, jint maxTokens) {
    Llm* llm = reinterpret_cast<Llm*>(ptr);
    if (!llm) return env->NewStringUTF("");
    const char* input = env->GetStringUTFChars(prompt, nullptr);
    std::ostringstream oss;
    llm->response(std::string(input), &oss, nullptr, maxTokens);
    env->ReleaseStringUTFChars(prompt, input);
    std::string result = oss.str();
    return env->NewStringUTF(result.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_qidian_minios_MnnEngine_nativeDestroy(JNIEnv* env, jobject thiz, jlong ptr) {
    Llm* llm = reinterpret_cast<Llm*>(ptr);
    if (llm) delete llm;
}
