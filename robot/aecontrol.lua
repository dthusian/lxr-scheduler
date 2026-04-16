local Socketw = require("lxsocketw")
local sock = Socketw.new()

function split(input, regex)
    local entries = {}
    for str in string.gmatch(input, regex) do
        table.insert(entries, str)
    end  
    return entries
end

function sock:on_message(msg)
    print("msg: " .. msg)
    local entries = split(msg, "([^,]+)")
    local sid = tonumber(entries[1])
    local opcode = tonumber(entries[2])
    print("sid: " .. sid .. "; opcode: " .. opcode)

    if opcode == 0x1 then
        -- provide item
    elseif opcode == 0x2 then
        -- provide fluid
    end
end