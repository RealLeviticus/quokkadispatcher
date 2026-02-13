cmake_minimum_required(VERSION 3.20)
project(qd_audio_forwarder LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(qd_audio_forwarder
    src/main.cpp
    src/audio_packet.cpp
)

target_include_directories(qd_audio_forwarder PRIVATE include)