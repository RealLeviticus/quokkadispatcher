---@class DispatcherData
---@field name string
---@field source number
---@field radioChannel number
---@field callChannel number
---@field activeCall? { callerSource: number, callerName: string, callId: number }
---@field wsClientId? string
---@field talkingOnRadio boolean

---@type table<number, DispatcherData>
Dispatchers = {}

--- Map wsClientId -> dispatcher source for fast lookup
---@type table<string, number>
local wsToSource = {}

-- ============================================================
-- Utility
-- ============================================================

---Check if a player's identifiers match any dispatcher identifier in config.
---@param source number
---@return boolean
local function isDispatcherIdentifier(source)
    local identifiers = GetPlayerIdentifiers(source)
    for _, id in ipairs(identifiers) do
        for _, allowed in ipairs(Config.DispatcherIdentifiers) do
            if id == allowed then
                return true
            end
        end
    end
    return false
end

---Find an available dispatcher (not currently on a call).
---@return DispatcherData?
function FindAvailableDispatcher()
    for _, dispatcher in pairs(Dispatchers) do
        if dispatcher.wsClientId and not dispatcher.activeCall then
            return dispatcher
        end
    end
    return nil
end

---Get dispatcher data by wsClientId.
---@param wsClientId string
---@return DispatcherData?
function GetDispatcherByWsClient(wsClientId)
    local src = wsToSource[wsClientId]
    if src then
        return Dispatchers[src]
    end
    return nil
end

---Send a message to a dispatcher's Electron app.
---@param dispatcher DispatcherData
---@param msgType string
---@param data? table
function SendToDispatcher(dispatcher, msgType, data)
    if dispatcher.wsClientId then
        TriggerEvent('qd:ws:sendToClient', dispatcher.wsClientId, msgType, data or {})
    end
end

-- ============================================================
-- Player lifecycle
-- ============================================================

AddEventHandler('playerJoining', function()
    local src = source

    if not isDispatcherIdentifier(src) then
        return
    end

    -- Check max dispatchers
    local count = 0
    for _ in pairs(Dispatchers) do count = count + 1 end
    if count >= Config.MaxDispatchers then
        print(('[QuokkaDispatcher] Dispatcher %s rejected: max dispatchers reached'):format(GetPlayerName(src)))
        return
    end

    print(('[QuokkaDispatcher] Dispatcher connected: %s (source: %d)'):format(GetPlayerName(src), src))

    Dispatchers[src] = {
        name = GetPlayerName(src),
        source = src,
        radioChannel = 0,
        callChannel = 0,
        activeCall = nil,
        wsClientId = nil,
        talkingOnRadio = false,
    }

    -- Place in routing bucket to isolate from normal players.
    -- If bucket 0, dispatcher stays in the default world but is hidden.
    if Config.DispatcherBucket > 0 then
        SetPlayerRoutingBucket(src, Config.DispatcherBucket)
    end

    -- Tell the client to set up invisibility
    TriggerClientEvent('qd:client:setDispatcher', src, true)
end)

AddEventHandler('playerDropped', function(reason)
    local src = source
    local dispatcher = Dispatchers[src]
    if not dispatcher then return end

    print(('[QuokkaDispatcher] Dispatcher disconnected: %s (%s)'):format(dispatcher.name, reason))

    -- Clean up radio
    if dispatcher.radioChannel > 0 then
        pcall(function()
            exports['pma-voice']:setPlayerRadio(src, 0)
        end)
    end

    -- Clean up active call
    if dispatcher.activeCall then
        pcall(function()
            exports['pma-voice']:setPlayerCall(src, 0)
            exports['pma-voice']:setPlayerCall(dispatcher.activeCall.callerSource, 0)
        end)
    end

    -- Remove WS mapping
    if dispatcher.wsClientId then
        wsToSource[dispatcher.wsClientId] = nil
    end

    Dispatchers[src] = nil
end)

-- ============================================================
-- WebSocket client lifecycle (events from websocket.js)
-- ============================================================

AddEventHandler('qd:clientConnected', function(wsClientId)
    print(('[QuokkaDispatcher] WebSocket client connected: %s'):format(wsClientId))
end)

AddEventHandler('qd:clientDisconnected', function(wsClientId)
    local src = wsToSource[wsClientId]
    if src and Dispatchers[src] then
        print(('[QuokkaDispatcher] WebSocket client disconnected for dispatcher: %s'):format(Dispatchers[src].name))
        Dispatchers[src].wsClientId = nil
    end
    wsToSource[wsClientId] = nil
end)

-- ============================================================
-- Message routing from WebSocket clients
-- ============================================================

AddEventHandler('qd:fromClient', function(wsClientId, msgType, data)
    -- LINK_DISPATCHER: associate a WebSocket client with a connected FiveM dispatcher player
    if msgType == 'LINK_DISPATCHER' then
        local license = data.license
        if not license then
            TriggerEvent('qd:ws:sendToClient', wsClientId, 'ERROR', { code = 'INVALID_LICENSE', message = 'No license provided' })
            return
        end

        -- Find the dispatcher player with this license
        for src, dispatcher in pairs(Dispatchers) do
            local identifiers = GetPlayerIdentifiers(src)
            for _, id in ipairs(identifiers) do
                if id == license then
                    dispatcher.wsClientId = wsClientId
                    wsToSource[wsClientId] = src

                    TriggerEvent('qd:ws:sendToClient', wsClientId, 'DISPATCHER_LINKED', {
                        name = dispatcher.name,
                        source = src,
                    })

                    print(('[QuokkaDispatcher] Linked WS client %s to dispatcher %s (source: %d)'):format(wsClientId, dispatcher.name, src))
                    return
                end
            end
        end

        TriggerEvent('qd:ws:sendToClient', wsClientId, 'ERROR', {
            code = 'DISPATCHER_NOT_FOUND',
            message = 'No dispatcher player found with that license. Make sure FiveM is connected first.',
        })
        return
    end

    -- All other messages require a linked dispatcher
    local dispatcher = GetDispatcherByWsClient(wsClientId)
    if not dispatcher then
        TriggerEvent('qd:ws:sendToClient', wsClientId, 'ERROR', {
            code = 'NOT_LINKED',
            message = 'WebSocket client not linked to a dispatcher. Send LINK_DISPATCHER first.',
        })
        return
    end

    -- Route to the appropriate handler
    if msgType == 'JOIN_RADIO' then
        TriggerEvent('qd:radio:joinChannel', dispatcher.source, tonumber(data.channel))
    elseif msgType == 'LEAVE_RADIO' then
        TriggerEvent('qd:radio:leaveChannel', dispatcher.source)
    elseif msgType == 'START_RADIO_TALK' then
        TriggerEvent('qd:radio:startTalk', dispatcher.source)
    elseif msgType == 'STOP_RADIO_TALK' then
        TriggerEvent('qd:radio:stopTalk', dispatcher.source)
    elseif msgType == 'ANSWER_CALL' then
        TriggerEvent('qd:phone:answerCall', dispatcher.source, data.callId)
    elseif msgType == 'END_CALL' then
        TriggerEvent('qd:phone:endCall', dispatcher.source, data.callId)
    elseif msgType == 'REJECT_CALL' then
        TriggerEvent('qd:phone:rejectCall', dispatcher.source, data.callId)
    elseif msgType == 'PING' then
        TriggerEvent('qd:ws:sendToClient', wsClientId, 'PONG', {})
    end
end)

-- ============================================================
-- Exports for other resources
-- ============================================================

---Route a phone call to an available dispatcher.
---@param callerSource number The in-game player source who is calling.
---@param callerName? string Display name of the caller.
---@return boolean success Whether a dispatcher was found and notified.
exports('routeCallToDispatcher', function(callerSource, callerName)
    return RouteCallToDispatcher(callerSource, callerName)
end)

---Get all currently active dispatchers.
---@return table<number, DispatcherData>
exports('getActiveDispatchers', function()
    return Dispatchers
end)

print('[QuokkaDispatcher] Server resource loaded')
