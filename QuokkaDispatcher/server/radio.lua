-- ============================================================
-- Radio channel management for dispatchers
-- ============================================================

-- ============================================================
-- Join a radio channel
-- ============================================================

AddEventHandler('qd:radio:joinChannel', function(dispatcherSource, channel)
    local dispatcher = Dispatchers[dispatcherSource]
    if not dispatcher then return end

    if not channel or channel < 1 or channel > 500 then
        SendToDispatcher(dispatcher, 'ERROR', {
            code = 'INVALID_CHANNEL',
            message = 'Channel must be between 1 and 500',
        })
        return
    end

    -- Leave current channel first
    if dispatcher.radioChannel > 0 then
        pcall(function()
            exports['pma-voice']:setPlayerRadio(dispatcherSource, 0)
        end)
        dispatcher.radioChannel = 0
    end

    -- Join the new channel via pma-voice directly (bypasses mm_radio permission checks)
    local ok, err = pcall(function()
        exports['pma-voice']:setPlayerRadio(dispatcherSource, channel)
    end)

    if not ok then
        print(('[QuokkaDispatcher] Failed to join radio channel %d: %s'):format(channel, tostring(err)))
        SendToDispatcher(dispatcher, 'ERROR', {
            code = 'RADIO_JOIN_FAILED',
            message = ('Failed to join channel %d'):format(channel),
        })
        return
    end

    dispatcher.radioChannel = channel

    -- Enable radio on the client side
    TriggerClientEvent('qd:client:radioChannelChanged', dispatcherSource, channel)

    SendToDispatcher(dispatcher, 'RADIO_JOINED', { channel = channel })

    print(('[QuokkaDispatcher] %s joined radio channel %d'):format(dispatcher.name, channel))
end)

-- ============================================================
-- Leave current radio channel
-- ============================================================

AddEventHandler('qd:radio:leaveChannel', function(dispatcherSource)
    local dispatcher = Dispatchers[dispatcherSource]
    if not dispatcher then return end

    local prevChannel = dispatcher.radioChannel

    if prevChannel > 0 then
        pcall(function()
            exports['pma-voice']:setPlayerRadio(dispatcherSource, 0)
        end)
    end

    dispatcher.radioChannel = 0

    TriggerClientEvent('qd:client:radioChannelChanged', dispatcherSource, 0)

    SendToDispatcher(dispatcher, 'RADIO_LEFT', { channel = prevChannel })

    print(('[QuokkaDispatcher] %s left radio channel %d'):format(dispatcher.name, prevChannel))
end)

-- ============================================================
-- Radio talk state (from Electron PTT button)
-- ============================================================

AddEventHandler('qd:radio:startTalk', function(dispatcherSource)
    local dispatcher = Dispatchers[dispatcherSource]
    if not dispatcher or dispatcher.radioChannel == 0 then return end

    dispatcher.talkingOnRadio = true
    TriggerClientEvent('qd:client:setRadioTalking', dispatcherSource, true)
end)

AddEventHandler('qd:radio:stopTalk', function(dispatcherSource)
    local dispatcher = Dispatchers[dispatcherSource]
    if not dispatcher then return end

    dispatcher.talkingOnRadio = false
    TriggerClientEvent('qd:client:setRadioTalking', dispatcherSource, false)
end)

-- ============================================================
-- Polling thread: send radio state to Electron app periodically
-- ============================================================

CreateThread(function()
    while true do
        Wait(Config.RadioPollRate)

        for src, dispatcher in pairs(Dispatchers) do
            if dispatcher.wsClientId and dispatcher.radioChannel > 0 then
                local ok, players = pcall(function()
                    return exports['pma-voice']:getPlayersInRadioChannel(dispatcher.radioChannel)
                end)

                if ok and players then
                    local playerList = {}
                    for plySource, isTalking in pairs(players) do
                        playerList[#playerList + 1] = {
                            source = plySource,
                            name = GetPlayerName(plySource) or ('Player ' .. plySource),
                            isTalking = isTalking,
                        }
                    end

                    SendToDispatcher(dispatcher, 'RADIO_STATE', {
                        channel = dispatcher.radioChannel,
                        players = playerList,
                    })
                end
            end
        end
    end
end)

print('[QuokkaDispatcher] Radio module loaded')
