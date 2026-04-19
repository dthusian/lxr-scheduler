local Socketw = require("lxsocketw")
local calibrate = require("calibrate")
local Direction = require("direction")
local robot = require("robot")
local component = require("component")
local sides = require("sides")

local ic = component.inventory_controller

local sock = Socketw.new()

function split(input, regex)
    local entries = {}
    for str in string.gmatch(input, regex) do
        table.insert(entries, str)
    end  
    return entries
end


function turnTo(oldDir, newDir)
    if oldDir == newDir then
        return newDir
    end

    if oldDir == nil then
        return nil
    end

    robot.turnRight()
    return turnTo(Direction.turnRight[oldDir], newDir)
end


function verifyItemStack(tbl, amount, name, damage)
    if tbl and (tbl.name == name) and (tonumber(tbl.damage) == tonumber(damage)) and (tonumber(tbl.size) >= tonumber(amount)) then
        return true
    end
    return false
end

function verifyFluidStack(tbl, amount, name)
    if tank and tank.name == name and tonumber(tank.amount) >= tonumber(amount) then
        return true
    end
    return false
end

function canItemsStack(stackingItem, amount, name, damage)
    if stackingItem == nil then
        return true
    end
    local sameitem = stackingItem.name == name and tonumber(stackingItem.damage) == tonumber(damage)
    if not sameitem then
        return false
    end
    if (stackingItem.size + amount) <= stackingItem.maxSize then
        return true
    end
    return false
end

function canFluidsStack(stackingFluid, amount, name, capacity)
    if not stackingFluid then
        return true
    end
    local samefluid = stackingFluid.name == name
    if not samefluid then
        return false
    end
    if (stackingFluid.amount + amount) <= capacity then
        return true
    end
    return false
end

function printTable(tbl)
    if tbl then
        for k,v in pairs(tbl) do
            print(k .. " " .. tostring(v))
        end 
    else
        print("nil")
    end
end


local g_facingDir = sides.west
function sock:on_message(msg)
    print("msg: " .. msg)
    local entries = split(msg, "([^,]+)")
    local sid = tonumber(entries[1])
    local opcode = tonumber(entries[2])

    print("sid: " .. sid .. "; opcode: " .. opcode)

    
    if opcode == 1 then
        print("opcode1")
        g_facingDir = calibrate()
        sock:send(sid .. ",1")
    elseif opcode == 2 then
        print("opcode2")
        
        local side = tonumber(entries[2 + 1])
        local blocks = tonumber(entries[2 + 2])
        local toDir = Direction.fromSide[side]

        g_facingDir = turnTo(g_facingDir, toDir)
        for i = 1,blocks do
            if robot.detect() then
                sock:send(sid .. ",3")  -- cannot move
                return
            end
            robot.forward()
        end

        sock:send(sid .. ",1")
    elseif opcode == 3 then
        print("opcode3")
        local isItemOperation = {
            [0] = true, [1] = true, [2] = true, [3] = true
        }
        local isFluidOperation = {
            [4] = true, [5] = true, [6] = true, [7] = true
        }
        local isSrcSelf = {
            [0] = true, [2] = true, [4] = true, [6] = true,
        }

        local subop = tonumber(entries[2 + 1])
        local side = tonumber(entries[2 + 2])
        local srcSlot = tonumber(entries[2 + 3])
        local dstSlot = tonumber(entries[2 + 4])
        local amount = tonumber(entries[2 + 5])
        local expectId = entries[2 + 6]
        local expectMeta = tonumber(entries[2 + 7])

        print("subop: " .. subop)
        print("side: " .. Direction.fromSide[side])
        print("srcSlot/dstSlot amount " .. srcSlot .. "/" .. dstSlot .. " " .. amount)
        print("id:meta " .. expectId .. ":" .. expectMeta)

        local targetDir = Direction.fromSide[side]
        g_facingDir = turnTo(g_facingDir, targetDir)
        local interactSide = sides.front

        -- check if machine is there
        if ic.getInventorySize(interactSide) == nil then
            print("no machine inventory on side")
            sock:send(sid .. ",4")
            return
        end

        -- item transfer on slotted inventories
        if isItemOperation[subop] then
            local srcStack = nil
            local dstStack = nil
            if isSrcSelf[subop] then
                srcStack = ic.getStackInInternalSlot(srcSlot)
                dstStack = ic.getStackInSlot(interactSide, dstSlot)
            else
                srcStack = ic.getStackInSlot(interactSide, srcSlot)
                dstStack = ic.getStackInInternalSlot(dstSlot)
            end

            if not verifyItemStack(srcStack, amount, expectId, expectMeta) then
                print("expected item " .. amount .. " of " .. expectId .. " " .. expectMeta)
                sock:send(sid .. ",2")
                return
            end

            if not canItemsStack(dstStack, amount, expectId, expectMeta) then
                print("cannot stack item to dst")
                sock:send(sid .. ",2")
                return
            end

            local status, err
            if isSrcSelf[subop] then
                robot.select(srcSlot)
                status, err = ic.dropIntoSlot(interactSide, dstSlot, amount)
            else
                robot.select(dstSlot)
                status, err = ic.suckFromSlot(interactSide, srcSlot, amount)
            end

            if not status then
                print("error occured when transfering item: " .. tostring(err))
                return
            end

        end

        -- fluid transfer on slotted inventories
        if isFluidOperation[subop] then
            local srcStack = nil
            local dstStack = nil
            local dstCapacity = 0

            if isSrcSelf[subop] then
                srcStack = ic.getFluidInInternalTank(srcSlot)
                dstStack = ic.getFluidInTank(interactSide, dstSlot)
                dstCapacity = ic.getTankCapacity(interactSide, dstSlot)
            else
                srcStack = ic.getFluidInTank(interactSide, srcSlot)
                dstStack = ic.getFluidInInternalTank(dstSlot)
                dstCapacity = ic.getInternalTankCapacity(dstSlot)
            end


            if not verifyFluidStack(srcStack, amount, expectId) then
               print("expected fluid " .. amount .. " of " .. expectId)
               sock:send(sid .. ",2")
               return
            end
            if not canFluidsStack(dstStack, amount, expectId, dstCapacity) then
                print("cannot stack fluid to dst")
                sock:send(sid .. ",2")
                return
            end

            local success, err
            if isSrcSelf[subop] then
                success, err = ic.transferFluidToTank(interactSide, dstSlot, amount)
            else
                success, err = ic.transferFluidFromTank(interactSide, srcSlot, amount)
            end
        
            if not success then
                print("error occured when transfering fluid" .. tostring(err))
                return
            end
        end


        -- success if no errors
        print("transfer success")
        sock:send(sid .. ",1")


    end

end

function sock:on_ready(msg)
    print("connected")
end

sock:connect("localhost", 3000)


while true do
    sock:poll(512)
    os.sleep(0.05)
end


