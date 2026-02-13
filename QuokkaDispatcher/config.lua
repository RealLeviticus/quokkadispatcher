Config = {}

-- Authentication token the Electron app must provide to connect.
-- CHANGE THIS to a secure random string before deploying.
Config.AuthToken = 'CHANGE_ME_SECURE_RANDOM_TOKEN'

-- Port for the WebSocket server (must be accessible to the dispatcher's machine).
Config.WebSocketPort = 30125

-- FiveM license identifiers allowed to connect as dispatchers.
-- Format: the license hash from the player's FiveM account.
-- Find a player's identifiers with: GetPlayerIdentifiers(source)
Config.DispatcherIdentifiers = {
    -- 'license:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
}

-- Routing bucket for dispatcher peds (isolates them from normal players).
-- Set to 0 if routing buckets break pma-voice audio (see README).
Config.DispatcherBucket = 0

-- Hidden spawn position for dispatcher peds (far underground).
Config.SpawnPosition = vector4(0.0, 0.0, -200.0, 0.0)

-- Maximum concurrent dispatchers allowed.
Config.MaxDispatchers = 5

-- How often (ms) to poll radio channel state and push to Electron app.
Config.RadioPollRate = 500

-- Call channel ID range (high numbers to avoid collisions with normal phone calls).
Config.CallChannelMin = 10000
Config.CallChannelMax = 99999
