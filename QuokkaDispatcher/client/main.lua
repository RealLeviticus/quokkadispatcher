local isDispatcher = false

-- ============================================================
-- Dispatcher setup
-- ============================================================

RegisterNetEvent('qd:client:setDispatcher', function(enabled)
    isDispatcher = enabled

    if not enabled then return end

    -- Wait a frame for ped to exist
    Wait(500)

    local ped = PlayerPedId()

    -- Teleport underground to hidden position
    SetEntityCoords(ped, Config.SpawnPosition.x, Config.SpawnPosition.y, Config.SpawnPosition.z, false, false, false, false)
    SetEntityHeading(ped, Config.SpawnPosition.w)

    -- Make invisible and non-interactive
    SetEntityVisible(ped, false, false)
    SetEntityInvincible(ped, true)
    FreezeEntityPosition(ped, true)
    SetEntityCollision(ped, false, false)

    -- Disable HUD elements
    DisplayRadar(false)
    DisplayHud(false)

    -- Disable idle camera
    InvalidateIdleCam()
    InvalidateVehicleIdleCam()
end)

-- ============================================================
-- Frame loop: keep dispatcher invisible and disable controls
-- ============================================================

CreateThread(function()
    while true do
        if isDispatcher then
            local ped = PlayerPedId()

            -- Maintain invisibility (in case of ped respawn)
            if IsEntityVisible(ped) then
                SetEntityVisible(ped, false, false)
                SetEntityInvincible(ped, true)
                FreezeEntityPosition(ped, true)
                SetEntityCollision(ped, false, false)
            end

            -- Disable all player controls
            DisableAllControlActions(0)

            -- Re-enable push-to-talk key so radio works natively
            -- Control 249 = INPUT_PUSH_TO_TALK (N key by default in FiveM)
            EnableControlAction(0, 249, true)

            -- Prevent death/damage
            local health = GetEntityHealth(ped)
            if health < 200 then
                SetEntityHealth(ped, 200)
            end

            -- Disable idle camera
            InvalidateIdleCam()
            InvalidateVehicleIdleCam()

            Wait(0)
        else
            Wait(1000)
        end
    end
end)

-- ============================================================
-- Radio talk control from Electron app (via server)
-- ============================================================

RegisterNetEvent('qd:client:setRadioTalking', function(talking)
    if not isDispatcher then return end

    if talking then
        -- Enable radio property and trigger talk state
        exports['pma-voice']:setVoiceProperty('radioEnabled', true)
        TriggerServerEvent('pma-voice:setTalkingOnRadio', true)
    else
        TriggerServerEvent('pma-voice:setTalkingOnRadio', false)
    end
end)

-- ============================================================
-- Suppress phone UI (dispatcher uses Electron app for call UI)
-- ============================================================

-- If a phone resource tries to show incoming call UI, suppress it
AddEventHandler('qb-phone:client:GetCalled', function()
    if isDispatcher then
        -- Don't show phone UI - Electron app handles this
        return
    end
end)

print('[QuokkaDispatcher] Client resource loaded')
