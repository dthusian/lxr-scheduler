local component = require("component")

local Socketw = {}
Socketw.__index = Socketw

function Socketw:on_message(msg)
end

function Socketw:on_ready()
end

function Socketw:on_error(err)
    print("Socket Error: " .. tostring(err))
end

function Socketw.new()
    local a = setmetatable({}, Socketw)
    a.buffer = ""
    return a
end

function Socketw:connect(host, port)
    if self.socket then
        self.socket.close()
    end

    local internetComp = component.list("internet")()
    if not internetComp then error("no internet card") end
    local internet = component.proxy(internetComp)
    
    local sock = internet.connect(host, port)
    while not sock.finishConnect() do
        os.sleep(0.1)
    end

    self.buffer = ""
    self.socket = sock    
    self:on_ready()
end
    

function Socketw:poll(bytes)
    local chunk = self.socket.read(bytes)
    if chunk == nil then
        self:on_error("remote hung up")
        self.socket.close()
        self.socket = nil
    elseif #chunk > 0 then
        -- print("read chunk: " .. chunk)
        self.buffer = self.buffer .. chunk

        local nl_pos = self.buffer:find("\n")
        while nl_pos do
            local msg = self.buffer:sub(1, nl_pos - 1)   -- everything before \n
            if msg and #msg > 0 then
                self:on_message(msg)
            end
            self.buffer = self.buffer:sub(nl_pos  + 1)   -- everything after \n
            nl_pos = self.buffer:find("\n")  -- keep running
        end
    end
end

function Socketw:send(data)
    if self.socket then
        return self.socket.write(data .. "\n")
    end
    return false
end

return Socketw
