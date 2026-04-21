local Socketw = require("lxsocketw")
local sock = Socketw.new()
local component = require("component")

local db = component.database
local me = component.me_interface

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

    if opcode == 0x4 then
        -- provide item
        local len = tonumber(entries[3])
        for i=1,len do
            db.clear(1)
            local id = entries[i * 2 + 2]
            local meta = tonumber(entries[i * 2 + 3])
            local status, err = db.set(1, id, meta, "")
            if not status then
                print("err: " .. err)
                sock:send(sid .. ",6")
                return
            end
            status, err = me.setInterfaceConfiguration(i, db.address, 1, 64)
            if not status then
                print("err: " .. err)
                sock:send(sid .. ",6")
                return
            end
        end
        sock:send(sid .. ",1")
    elseif opcode == 0x5 then
        -- provide fluid
        local len = tonumber(entries[3])
        for i=1,len do
            db.clear(1)
            local id = entries[i + 3]
            -- there appears to be no better way to do this unfortunately
            -- 1) find fluid in network and get its label
            local fluids = me.getFluidsInNetwork()
            local label = nil
            for i, v in ipairs(fluids) do
                if v.name == id then
                    label = v.label
                    break
                end
            end
            if label == nil then
                -- fluid not found
                sock:send(sid .. ",5")
                return
            end
            -- 2) use that label to store the associated fluid drop into a db.
            me.store({ label = "drop of " .. label }, db.address, 1, 1)
            -- 3) set interface config with that fluid drop
            -- tanks are 0-indexed for some reason
            if not me.setFluidInterfaceConfiguration(i - 1, db.address, 1) then
                sock:send(sid .. ",6")
                return
            end
        end 
        sock:send(sid .. ",1")
    end
end

function sock:on_ready(msg)
    print("connected")
end

sock:connect("localhost", 3001)

while true do
    sock:poll(512)
    os.sleep(0.05)
end