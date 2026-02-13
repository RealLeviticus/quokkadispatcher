-- ============================================================
-- Phone call routing for dispatchers
-- ============================================================

---@type table<number, { callerSource: number, callerName: string, callChannelId: number, dispatcherSource: number|nil, state: string }>
local pendingCalls = {}
local nextCallId = 1

-- ============================================================
-- Utility
-- ============================================================

---Generate a unique call channel ID in the configured range.
---@return number
local function generateCallChannelId()
    return math.random(Config.CallChannelMin, Config.CallChannelMax)
end

---Get the display name for a player source.
---@param source number
---@return string
local function getPlayerDisplayName(source)
    local name = GetPlayerName(source)
    return name or ('Player ' .. source)
end

-- ============================================================
-- Route a call to an available dispatcher
-- ============================================================

---@param callerSource number
---@param callerName? string
---@return boolean
function RouteCallToDispatcher(callerSource, callerName)
    local dispatcher = FindAvailableDispatcher()
    if not dispatcher then
        return false
    end

    local callId = nextCallId
    nextCallId = nextCallId + 1

    local callChannelId = generateCallChannelId()
    local displayName = callerName or getPlayerDisplayName(callerSource)

    pendingCalls[callId] = {
        callerSource = callerSource,
        callerName = displayName,
        callChannelId = callChannelId,
        dispatcherSource = dispatcher.source,
        state = 'ringing',
    }

    -- Store on dispatcher so they can only have one pending/active call
    dispatcher.activeCall = {
        callerSource = callerSource,
        callerName = displayName,
        callId = callId,
    }

    -- Notify the Electron app
    SendToDispatcher(dispatcher, 'INCOMING_CALL', {
        callId = callId,
        callerName = displayName,
        callerSource = callerSource,
    })

    print(('[QuokkaDispatcher] Call %d from %s routed to dispatcher %s'):format(callId, displayName, dispatcher.name))
    return true
end

-- ============================================================
-- /calldispatch command for in-game players
-- ============================================================

RegisterCommand('calldispatch', function(source)
    if source == 0 then return end -- ignore console

    local playerName = getPlayerDisplayName(source)
    local success = RouteCallToDispatcher(source, playerName)

    if success then
        TriggerClientEvent('ox_lib:notify', source, {
            title = 'Dispatch',
            description = 'Calling dispatch... please wait.',
            type = 'inform',
        })
    else
        TriggerClientEvent('ox_lib:notify', source, {
            title = 'Dispatch',
            description = 'No dispatchers available. Try again later.',
            type = 'error',
        })
    end
end, false)

-- /000 command for emergency calls, routes to dispatch
RegisterCommand('000', function(source)
    if source == 0 then return end -- ignore console

    local playerName = getPlayerDisplayName(source)
    local success = RouteCallToDispatcher(source, playerName)

    if success then
        TriggerClientEvent('ox_lib:notify', source, {
            title = 'Dispatch',
            description = 'Calling dispatch... please wait.',
            type = 'inform',
        })
    else
        TriggerClientEvent('ox_lib:notify', source, {
            title = 'Dispatch',
            description = 'No dispatchers available. Try again later.',
            type = 'error',
        })
    end
end, false)

-- ============================================================
-- Answer a call
-- ============================================================

AddEventHandler('qd:phone:answerCall', function(dispatcherSource, callId)
    local dispatcher = Dispatchers[dispatcherSource]
    if not dispatcher then return end

    local call = pendingCalls[callId]
    if not call or call.state ~= 'ringing' then
        SendToDispatcher(dispatcher, 'ERROR', {
            code = 'CALL_NOT_FOUND',
            message = 'Call not found or already handled',
        })
        return
    end

    call.state = 'active'

    -- Put both players in the same pma-voice call channel
    local ok1, err1 = pcall(function()
        exports['pma-voice']:setPlayerCall(dispatcherSource, call.callChannelId)
    end)

    local ok2, err2 = pcall(function()
        exports['pma-voice']:setPlayerCall(call.callerSource, call.callChannelId)
    end)

    if not ok1 or not ok2 then
        print(('[QuokkaDispatcher] Failed to set up call audio: %s / %s'):format(tostring(err1), tostring(err2)))
        SendToDispatcher(dispatcher, 'ERROR', {
            code = 'CALL_AUDIO_FAILED',
            message = 'Failed to set up call audio',
        })
        return
    end

    dispatcher.callChannel = call.callChannelId

    -- Notify caller
    TriggerClientEvent('ox_lib:notify', call.callerSource, {
        title = 'Dispatch',
        description = 'Dispatch has answered your call.',
        type = 'success',
    })

    -- Notify Electron app
    SendToDispatcher(dispatcher, 'CALL_ANSWERED', { callId = callId })

    print(('[QuokkaDispatcher] Call %d answered by %s'):format(callId, dispatcher.name))
end)

-- ============================================================
-- End a call
-- ============================================================

AddEventHandler('qd:phone:endCall', function(dispatcherSource, callId)
    local dispatcher = Dispatchers[dispatcherSource]
    if not dispatcher then return end

    local call = pendingCalls[callId]
    if not call then return end

    -- Remove both from call channel
    pcall(function()
        exports['pma-voice']:setPlayerCall(dispatcherSource, 0)
    end)
    pcall(function()
        exports['pma-voice']:setPlayerCall(call.callerSource, 0)
    end)

    -- Notify caller
    if call.state == 'active' then
        TriggerClientEvent('ox_lib:notify', call.callerSource, {
            title = 'Dispatch',
            description = 'Dispatch has ended the call.',
            type = 'inform',
        })
    end

    -- Cleanup
    dispatcher.activeCall = nil
    dispatcher.callChannel = 0
    pendingCalls[callId] = nil

    SendToDispatcher(dispatcher, 'CALL_ENDED', { callId = callId })

    print(('[QuokkaDispatcher] Call %d ended by %s'):format(callId, dispatcher.name))
end)

-- ============================================================
-- Reject a call
-- ============================================================

AddEventHandler('qd:phone:rejectCall', function(dispatcherSource, callId)
    local dispatcher = Dispatchers[dispatcherSource]
    if not dispatcher then return end

    local call = pendingCalls[callId]
    if not call then return end

    -- Notify caller
    TriggerClientEvent('ox_lib:notify', call.callerSource, {
        title = 'Dispatch',
        description = 'Dispatch is currently unavailable.',
        type = 'error',
    })

    -- Cleanup
    dispatcher.activeCall = nil
    pendingCalls[callId] = nil

    SendToDispatcher(dispatcher, 'CALL_ENDED', { callId = callId })

    print(('[QuokkaDispatcher] Call %d rejected by %s'):format(callId, dispatcher.name))
end)

-- ============================================================
-- Cleanup calls when caller disconnects
-- ============================================================

AddEventHandler('playerDropped', function()
    local src = source

    for callId, call in pairs(pendingCalls) do
        if call.callerSource == src then
            -- Caller disconnected, clean up the call
            if call.dispatcherSource then
                local dispatcher = Dispatchers[call.dispatcherSource]
                if dispatcher then
                    pcall(function()
                        exports['pma-voice']:setPlayerCall(call.dispatcherSource, 0)
                    end)
                    dispatcher.activeCall = nil
                    dispatcher.callChannel = 0
                    SendToDispatcher(dispatcher, 'CALL_ENDED', { callId = callId })
                end
            end
            pendingCalls[callId] = nil
        end
    end
end)

print('[QuokkaDispatcher] Phone module loaded')
