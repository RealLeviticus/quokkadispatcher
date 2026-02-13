#include "audio_packet.hpp"

#include <algorithm>
#include <cstddef>

namespace qd {

namespace {

void WriteU16LE(std::vector<std::uint8_t>& out, std::uint16_t value) {
    out.push_back(static_cast<std::uint8_t>(value & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFF));
}

void WriteU32LE(std::vector<std::uint8_t>& out, std::uint32_t value) {
    out.push_back(static_cast<std::uint8_t>(value & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 16) & 0xFF));
    out.push_back(static_cast<std::uint8_t>((value >> 24) & 0xFF));
}

void WriteU64LE(std::vector<std::uint8_t>& out, std::uint64_t value) {
    for (int i = 0; i < 8; ++i) {
        out.push_back(static_cast<std::uint8_t>((value >> (8 * i)) & 0xFF));
    }
}

} // namespace

std::vector<std::uint8_t> BuildPacket(
    AudioSource source,
    AudioCodec codec,
    std::uint8_t channels,
    std::uint16_t sampleRate,
    std::uint32_t sequence,
    std::uint64_t timestampMs,
    const std::vector<std::uint8_t>& payload
) {
    const std::size_t cappedSize = std::min<std::size_t>(payload.size(), 0xFFFF);

    std::vector<std::uint8_t> out;
    out.reserve(24 + cappedSize);

    out.insert(out.end(), {'Q', 'D', 'A', 'V'});
    out.push_back(1); // version
    out.push_back(static_cast<std::uint8_t>(source));
    out.push_back(static_cast<std::uint8_t>(codec));
    out.push_back(channels);
    WriteU16LE(out, sampleRate);
    WriteU16LE(out, static_cast<std::uint16_t>(cappedSize));
    WriteU32LE(out, sequence);
    WriteU64LE(out, timestampMs);
    out.insert(out.end(), payload.begin(), payload.begin() + static_cast<std::ptrdiff_t>(cappedSize));

    return out;
}

} // namespace qd
