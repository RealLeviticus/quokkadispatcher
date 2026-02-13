fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'QuokkaDispatcher'
description 'External dispatcher system - radio and phone bridge for dispatch operators'
version '1.0.0'

dependencies {
    'pma-voice',
    'ox_lib',
}

shared_scripts {
    '@ox_lib/init.lua',
    'config.lua',
}

server_scripts {
    'server/main.lua',
    'server/radio.lua',
    'server/phone.lua',
    'server/voice-relay.js',
    'server/websocket.js',
}

client_scripts {
    'client/main.lua',
}
