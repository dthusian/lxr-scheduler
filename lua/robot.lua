local Socketw = require("lxsocketw")
local Direction = require("direction")
local robot = require("robot")
local component = require("component")
local sides = require("sides")

local ic = component.inventory_controller
local tc = component.tank_controller

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
    if tbl and tbl.name == name and tonumber(tbl.amount) >= tonumber(amount) then
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


local g_facingDir = "WEST"
function sock:on_message(msg)
    print("msg: " .. msg)
    local entries = split(msg, "([^,]+)")
    local sid = tonumber(entries[1])
    local opcode = tonumber(entries[2])

    print("sid: " .. sid .. "; opcode: " .. opcode)

    if opcode == 2 then
        
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
        local isItemOperation = {
            [0] = true, [1] = true
        }
        local isFluidOperation = {
            [4] = true, [5] = true
        }
        local isSrcSelf = {
            [0] = true, [4] = true
        }

        local subop = tonumber(entries[2 + 1])
        local side = tonumber(entries[2 + 2])
        local srcSlot = tonumber(entries[2 + 3])
        local dstSlot = tonumber(entries[2 + 4])
        local amount = tonumber(entries[2 + 5])
        local expectId = entries[2 + 6]
        local expectMeta = tonumber(entries[2 + 7])

        --print("subop: " .. subop)
        --print("side: " .. Direction.fromSide[side])
        --print("srcSlot/dstSlot amount " .. srcSlot .. "/" .. dstSlot .. " " .. amount)
        --print("id:meta " .. expectId .. ":" .. expectMeta)

        local interactSide = nil
        if side == sides.up then
            interactSide = sides.up
        elseif side == sides.down then
            interactSide = sides.down
        else
            local targetDir = Direction.fromSide[side]
            g_facingDir = turnTo(g_facingDir, targetDir)
            interactSide = sides.front
        end

        -- check if machine is there
        if ic.getInventorySize(interactSide) == nil then
            print("no machine inventory on side")
            sock:send(sid .. ",4")
            return
        end

        -- item transfer
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

            if dstStack ~= nil then
                print("dst not empty")
                sock:send(sid .. ",6")
                return
            end

            if not verifyItemStack(srcStack, amount, expectId, expectMeta) then
                print("expected item " .. amount .. " of " .. expectId .. " " .. expectMeta)
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
                sock:send(sid .. ",6")
                return
            end

        end

        -- fluid transfer
        if isFluidOperation[subop] then
            local srcStack = nil
            local dstStack = nil

            if isSrcSelf[subop] then
                srcStack = tc.getFluidInTankInSlot(srcSlot)
                dstStack = tc.getFluidInTank(interactSide, dstSlot)
            else
                srcStack = tc.getFluidInTank(interactSide, srcSlot)
                dstStack = tc.getFluidInTankInSlot(dstSlot)
            end

            if dstStack ~= nil then
                print("dst not empty")
                sock:send(sid .. ",6")
                return
            end

            if tc.getFluidInInternalTank(1) ~= nil then
                print("internal tank not empty")
                sock:send(sid .. ",6")
            end

            if not verifyFluidStack(srcStack, amount, expectId) then
               print("expected fluid " .. amount .. " of " .. expectId)
               sock:send(sid .. ",2")
               return
            end

            local success, err
            robot.selectTank(1)
            if isSrcSelf[subop] then
                robot.select(srcSlot)
                success, err = tc.drain(amount)
                if not success then print("err: " .. err) sock:send(sid .. ",6") return end
                success, err = robot.fill(interactSide, dstSlot, amount)
                if not success then print("err: " .. err) sock:send(sid .. ",6") return end
            else
                robot.select(dstSlot)
                success, err = robot.drain(interactSide, srcSlot, amount)
                if not success then print("err: " .. err) sock:send(sid .. ",6") return end
                success, err = tc.fill(amount)
                if not success then print("err: " .. err) sock:send(sid .. ",6") return end
            end
        end

        -- success if no errors
        print("transfer success")
        sock:send(sid .. ",1")
    elseif opcode == 6 then
        -- dump inventory, ignore errors
        local side = tonumber(entries[2 + 1])

        local targetDir = Direction.fromSide[side]
        g_facingDir = turnTo(g_facingDir, targetDir)
        local interactSide = sides.front

        for i=1,9 do
            robot.select(i)
            ic.dropIntoSlot(interactSide, i)
        end
        if ic.getStackInInternalSlot(10) then
            os.sleep(0.5) -- wait for interface to take item
            robot.select(10)
            ic.dropIntoSlot(interactSide, 1)
        end
        sock:send(sid .. ",1")
    elseif opcode == 7 then
        local id = entries[2 + 1]
        local meta = tonumber(entries[2 + 2])

        -- check if wrench
        dura, err = robot.durability()
        if dura == nil then
            -- no wrench (or invalid item in tool slot)
            sock:send(sid .. ",8")
            return
        end

        -- break/replace
        local success, err = robot.swingUp()
        if not success then print("err: " .. err) sock:send(sid .. ",6") return end
        local found = false 
        for i=1,16 do
            -- find the machine
            local stack = ic.getStackInInternalSlot(i)
            if stack ~= nil and stack.name == id and stack.damage == meta then
                robot.select(i)
                found = true
                local success, err = robot.placeUp() -- place it
                if not success then print("err: " .. err) sock:send(sid .. ",6") return end
                break
            end
        end
        if not found then
            print("err: machine item not found")
            sock:send(sid .. ",6")
            return
        end
        sock:send(sid .. ",1")
    elseif opcode == 8 then
        -- errors probably wont happen here
        local slot = tonumber(entries[2 + 1])
        robot.select(slot)
        robot.equip()
        sock:send(sid .. ",1")
    else
        print("invalid opcode")
        sock:send(sid .. ",6")
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


