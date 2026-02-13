#include "audio_packet.hpp"

#include <chrono>
#include <cstdint>
#include <iostream>
#include <vector>

namespace {

std::uint64_t NowMs() {
    const auto now = std::chrono::time_point_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now());
    return static_cast<std::uint64_t>(now.time_since_epoch().count());
}

} // namespace

int main() {
    std::cout << "QuokkaDispatcher C++ forwarder starter\n";
    std::cout << "Target ingest endpoint: ws://127.0.0.1:30130/voice-relay/ingest\n";
    std::cout << "\n";
    std::cout << "TODO: Hook your game voice callback and forward packets with your preferred WS client.\n";
    std::cout << "Suggested libs: ixwebsocket, websocketpp, Boost.Beast.\n";

    // Example packet build using fake PCM payload.
    std::vector<std::uint8_t> fakePcmPayload(1920, 0); // 20ms @ 48kHz mono PCM16
    const auto packet = qd::BuildPacket(
        qd::AudioSource::Radio,
        qd::AudioCodec::Pcm16Le,
        1,
        48000,
        1,
        NowMs(),
        fakePcmPayload
    );

    std::cout << "Built packet bytes: " << packet.size() << "\n";
    return 0;
}