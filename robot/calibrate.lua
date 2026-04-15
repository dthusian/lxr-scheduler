local component = require("component")
local sides = require("sides")
local robot = require("robot")
local Direction = require("direction")

local ic = component.inventory_controller


--[[
    calibration procedure
        - moves robot to depot
        - returns a Direction indicating where the robot is facing
]]
function calibrate()
    robot.forward() -- avoid the edge where the robot is on the depot but facing away
    while true do

        -- 1. Check for Instruction Markers in front
        local size_front = ic.getInventorySize(sides.front)
        if size_front then
            local stack = ic.getStackInSlot(sides.front, 1)
            if stack then
                if stack.label == "RIGHT" then
                    robot.turnRight()
                elseif stack.label == "LEFT" then
                    robot.turnLeft()
                end
            end
            -- Move forward after handling the marker instruction
            robot.forward()
        end

        -- 2. Check for the "Depot" marker below (The return condition)
        local size_bottom = ic.getInventorySize(sides.bottom)
        if size_bottom then
            local stack = ic.getStackInSlot(sides.bottom, 1)
            if stack then
                return stack.label -- Success: Returns "NORTH", "SOUTH", etc.
            end
        else
            -- 3. Pathfinding: Move if clear, turn if blocked
            local isSolid = robot.detect()
            if not isSolid then
                robot.forward()
            else
                -- Hit a wall with no inventory? Turn to find a path
                robot.turnRight()
            end
        end
        
        os.sleep(0.05) -- Prevent "Too many signals" error in tight loops
    end
end


return calibrate

