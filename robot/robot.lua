local robot = require("robot")
local component = require("component")
local ic = component.inventory_controller

for k,v in pairs(ic.getStackInInternalSlot(1)) do
    print(k .. ", " .. tostring(v))
end

