-- Example helper you can adapt inside a pma-voice fork where packet bytes are available.
-- This file is a template, not auto-loaded by fxmanifest.

local seq = 0

local function u16le(n)
    return string.char(n & 0xFF, (n >> 8) & 0xFF)
end

local function u32le(n)
    return string.char(n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF)
end

local function u64le(n)
    local out = {}
    for i = 0, 7 do
        out[#out + 1] = string.char((n >> (8 * i)) & 0xFF)
    end
    return table.concat(out)
end

local function nowMs()
    return math.floor(os.time() * 1000)
end

local function buildQdav(sourceType, codec, channels, sampleRate, payload)
    local payloadLen = #payload
    if payloadLen > 0xFFFF then
        payload = payload:sub(1, 0xFFFF)
        payloadLen = 0xFFFF
    end

    local header = table.concat({
        'QDAV',
        string.char(1),
        string.char(sourceType),
        string.char(codec),
        string.char(channels),
        u16le(sampleRate),
        u16le(payloadLen),
        u32le(seq),
        u64le(nowMs()),
    })

    seq = (seq + 1) % 4294967296
    return header .. payload
end

-- Replace with your fork's base64 helper.
local function toBase64(raw)
    return lib.string.base64.encode(raw)
end

-- Call this from your fork's voice frame hook.
-- sourceType: 1 radio, 2 call
-- routeId: radio channel or call channel
-- codec: 1 Opus, 2 PCM16LE
local function forwardVoiceFrame(sourceType, routeId, codec, channels, sampleRate, frameBytes)
    if not routeId or routeId <= 0 then return end
    local qdav = buildQdav(sourceType, codec, channels, sampleRate, frameBytes)
    exports['quokkadispatcher']:ingestRoutedVoicePayload(sourceType, routeId, toBase64(qdav))
end

return {
    forwardVoiceFrame = forwardVoiceFrame,
}