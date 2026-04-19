local sides = require("sides")

local Direction = {}

Direction.turnRight = {
    ["NORTH"] = "EAST",
    ["EAST"] = "SOUTH",
    ["SOUTH"] = "WEST",
    ["WEST"] = "NORTH",
    ["BOTTOM"] = "BOTTOM",
    ["TOP"] = "TOP"
}

Direction.turnLeft = {
    ["NORTH"] = "WEST",
    ["EAST"] = "NORTH",
    ["SOUTH"] = "EAST",
    ["WEST"] = "SOUTH",
    ["BOTTOM"] = "BOTTOM",
    ["TOP"] = "TOP"
}

Direction.toSide = {
    ["NORTH"] = sides.north,
    ["SOUTH"] = sides.south,
    ["WEST"] = sides.west,
    ["EAST"] = sides.east,
    ["BOTTOM"] = sides.bottom,
    ["TOP"] = sides.top
}

Direction.fromSide = {
    [sides.north] = "NORTH",
    [sides.south] = "SOUTH",
    [sides.west] = "WEST",
    [sides.east] = "EAST",
    [sides.bottom] = "BOTTOM",
    [sides.top] = "TOP"
}

return Direction


