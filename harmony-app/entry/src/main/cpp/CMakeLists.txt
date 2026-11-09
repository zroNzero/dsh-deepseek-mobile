cmake_minimum_required(VERSION 3.5.0)
project(entry)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(entry SHARED napi_init.cpp)

target_link_libraries(entry PUBLIC
    libace_napi.z.so
    libhilog_ndk.z.so
)

# libnode.so / libc++_shared.so 由构建者放进 entry/libs/arm64-v8a/。
# HAP 打包时 DevEco 会把 libs/ 下的 .so 收进 libs/arm64-v8a；这里再兜底复制到
# libentry.so 同目录，保证 dlopen("libnode.so") 在模块搜索路径内命中。
set(NODE_LIBS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../libs/arm64-v8a")
if(EXISTS "${NODE_LIBS_DIR}")
    file(GLOB NODE_SO_FILES "${NODE_LIBS_DIR}/*.so")
    foreach(NODE_SO ${NODE_SO_FILES})
        add_custom_command(TARGET entry POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${NODE_SO}" "$<TARGET_FILE_DIR:entry>")
    endforeach()
endif()
