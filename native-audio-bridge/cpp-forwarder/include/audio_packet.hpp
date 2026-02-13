#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace qd {

enum class AudioSource : std::uint8_t {
    Radio = 1,
    Emergency000 = 2,
};

enum class AudioCodec : std::uint8_t {
    Opus = 1,
    Pcm16Le = 2,
};

struct AudioPacketHeader {
    std::array<char, 4> magic{'Q', 'D', 'A', 'V'};
    std::uint8_t version{1};
    std::uint8_t source{static_cast<std::uint8_t>(AudioSource::Radio)};
    std::uint8_t codec{static_cast<std::uint8_t>(AudioCodec::Pcm16Le)};
    std::uint8_t channels{1};
    std::uint16_t sampleRate{48000};
    std::uint16_t payloadLen{0};
    std::uint32_t sequence{0};
    std::uint64_t timestampMs{0};
};

std::vector<std::uint8_t> BuildPacket(
    AudioSource source,
    AudioCodec codec,
    std::uint8_t channels,
    std::uint16_t sampleRate,
    std::uint32_t sequence,
    std::uint64_t timestampMs,
    const std::vector<std::uint8_t>& payload
);

} // namespace qd