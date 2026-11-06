-- Inventory reading module (F22)
--
-- ON-DEMAND request/response, NOT a periodic push.
--
-- The previous version ran a LoopAsync every InventoryUpdateInterval (30s) that
-- walked every online player, ran ForEachProperty() reflection-discovery logging
-- on both PlayerState and InventoryData, and pushed a `type:"inventory"` frame to
-- /chat for every player every cycle. Any reflected read that threw was caught by
-- one big outer pcall that logged "[INVENTORY] Error updating inventories:" at
-- error level - so a single bad read turned into an error logged every 30s forever,
-- for every connected player. That is the "causes errors" spam that got the whole
-- module disabled (config.EnableInventoryTracking = false).
--
-- This rewrite serves inventory the SAME way teleport/location/items already do:
-- the bridge POSTs an inventory request onto a queue, the Lua polls the queue,
-- enumerates once, and replies once. No periodic push, no discovery spam.
--
-- Enumeration mirrors the proven give path (items.lua) plus the Palworld 1.0 SDK
-- container layout (verified against a CXX header dump of PalServer):
--   playerState:GetInventoryData()          -> UPalPlayerInventoryData  (same call items.lua uses to give)
--     .InventoryMultiHelper                  -> UPalItemContainerMultiHelper  (public UPROPERTY, 0x160)
--       .Containers                          -> TArray<UPalItemContainer*>    (public UPROPERTY)
--         container:Num()                    -> slot count (reflected UFunction)
--         container:Get(i)                   -> UPalItemSlot (0-based, reflected UFunction)
--           slot.ItemId.StaticId:ToString()  -> item code FName e.g. "Wood"  (FPalItemId.StaticId, BlueprintVisible)
--           slot.StackCount                  -> quantity (int32, BlueprintVisible)
-- Reference for the runtime path (UPalPlayerInventoryData->InventoryMultiHelper->
-- Containers[0]->Get(idx)->GetItemId()/GetStackCount()):
--   SoTMaulder/SoTMaulder-Palworld feature.cpp (IncrementInventoryItemCountByIndex),
--   SDK/Pal_classes.hpp (UPalItemContainer::Num/Get, UPalItemSlot::ItemId/StackCount),
--   SDK/Pal_structs.hpp (FPalItemId::StaticId). Give-path precedent: dkoz/AdminCommands
--   Scripts/modules/items.lua (playerState:GetInventoryData()).
--
-- Every reflected call is pcall-guarded with IsValid() checks (F17 lesson): a wrong
-- instance-method call raises a Lua-catchable error, never a native crash, so the
-- enumeration can never take the server down. Empty slots (StaticId "None", count 0)
-- are filtered out. code->English-name mapping is done bridge-side from the embedded
-- catalog, so this module only returns {code, count}.

local config = require("config")
local Utils = require("utils")
local logger = Utils.Logger:new()

local Inventory = {}

-- Enumerate a player's inventory into a { [code] = count } table.
-- Never throws. The second result tells a really empty inventory from one that
-- could not be read.
local function EnumeratePlayerInventory(playerState)
    local items = {}
    local readable = false

    local ok, err = pcall(function()
        -- Same resolution as the working give path (items.lua / dkoz AdminCommands).
        local inventoryData = playerState:GetInventoryData()
        if not (inventoryData and inventoryData:IsValid()) then
            logger:log(1, "[INVENTORY] GetInventoryData() returned nothing")
            return
        end

        local multiHelper = inventoryData.InventoryMultiHelper
        if not (multiHelper and multiHelper:IsValid()) then
            logger:log(3, "[INVENTORY] InventoryMultiHelper unavailable")
            return
        end

        local containers = multiHelper.Containers
        if not containers then
            logger:log(3, "[INVENTORY] Containers array unavailable")
            return
        end

        -- Iterate the TArray with the codebase idiom (guild.lua): ForEach + :get().
        if type(containers.ForEach) ~= "function" then
            logger:log(3, "[INVENTORY] Containers is not iterable (no ForEach)")
            return
        end

        readable = true
        containers:ForEach(function(_, containerWrapper)
            local container = containerWrapper:get()
            if not (container and container:IsValid()) then
                return
            end

            -- Slot count via the reflected UFunction Num(); fall back to a bound.
            local slotCount = 0
            pcall(function() slotCount = container:Num() end)
            if not slotCount or slotCount <= 0 then
                return
            end

            for slotIdx = 0, slotCount - 1 do
                local gotSlot, slot = pcall(function() return container:Get(slotIdx) end)
                if gotSlot and slot and slot:IsValid() then
                    -- Read code + count directly from the reflected properties.
                    -- Empty slots have StaticId "None" and StackCount 0, filtered below.
                    local code = nil
                    local count = 0
                    pcall(function() code = slot.ItemId.StaticId:ToString() end)
                    pcall(function() count = slot.StackCount end)

                    if code and code ~= "" and code ~= "None" and count and count > 0 then
                        items[code] = (items[code] or 0) + count
                    end
                end
            end
        end)
    end)

    if not ok then
        readable = false
        logger:log(1, "[INVENTORY] enumeration error: " .. tostring(err))
    end

    return items, readable
end

-- Build the JSON items array from a { [code] = count } table.
local function ItemsToJson(items)
    local parts = {}
    for code, count in pairs(items) do
        -- Item codes are FName strings (alphanumeric + underscore) - JSON-safe.
        table.insert(parts, string.format('{"code":"%s","count":%d}', code, count))
    end
    return "[" .. table.concat(parts, ",") .. "]"
end

-- Character facts that ride along on the inventory reply, so they cost no extra pass.
-- Takaro asks for the inventory right before the progression on every player sync.
--   exp        -> FPalIndividualCharacterSaveParameter.Exp
--   instanceId -> FPalInstanceID.InstanceId, the id of this character in the save
-- Returns the extra JSON fields, or "" when nothing could be read.
local factsReadFailed = false
local function ReadCharacterFactsJson(player)
    local parts = {}
    local ok, err = pcall(function()
        local param = player.CharacterParameterComponent.IndividualParameter
        local exp = param.SaveParameter.Exp
        if type(exp) == "number" then
            table.insert(parts, string.format('"exp":%d', exp))
        end
        local id = param.IndividualId.InstanceId
        table.insert(parts, string.format('"instanceId":"%08X%08X%08X%08X"',
            id.A & 0xFFFFFFFF, id.B & 0xFFFFFFFF, id.C & 0xFFFFFFFF, id.D & 0xFFFFFFFF))
    end)
    if not ok and not factsReadFailed then
        factsReadFailed = true
        logger:log(1, "[INVENTORY] Could not read character facts: " .. tostring(err))
    end
    if #parts == 0 then return "" end
    return "," .. table.concat(parts, ",")
end

-- POST an inventory response back to the bridge (always sent, even when empty,
-- so the bridge can clear the pending request).
local function SendInventoryResponse(bridgeHost, requestId, playerName, itemsJson, factsJson)
    local json = string.format(
        '{"requestId":"%s","name":"%s","items":%s,"timestamp":"%s"%s}',
        requestId,
        Utils.EscapeJSON(playerName),
        itemsJson,
        os.date("!%Y-%m-%dT%H:%M:%SZ"),
        factsJson or ""
    )

    local jsonEscaped = json:gsub('"', '\\"')
    local curlCommand = string.format(
        'curl -s -m 3 -X POST -H "Content-Type: application/json" -d "%s" http://%s/inventory-response',
        jsonEscaped,
        bridgeHost
    )

    local handle = io.popen(curlCommand .. ' 2>&1')
    if handle then
        local result = handle:read("*a")
        handle:close()
        logger:log(3, string.format("[INVENTORY] Sent response for request %s", requestId))
        return result
    end
    return nil
end

-- Poll the bridge for inventory requests and answer each one.
local function FetchInventoryRequests()
    if not config.EnableBridge then
        return
    end

    local success, err = pcall(function()
        local bridgeHost = config.BridgeURL:match("http://([^/]+)")
        if not bridgeHost then
            logger:log(1, "[INVENTORY] Could not extract bridge host from URL")
            return
        end

        local url = string.format('http://%s/inventory-queue', bridgeHost)
        local handle = io.popen(string.format('curl -s %s', url))
        if not handle then
            logger:log(1, "[INVENTORY] Failed to fetch inventory queue")
            return
        end
        local result = handle:read("*a")
        handle:close()

        if not result or result == "" or result == '{"requests":[]}' then
            return
        end

        -- Parse {"requests":[{"name":"...","requestId":"..."}]} (same shape as location).
        for playerName, requestId in result:gmatch('"name"%s*:%s*"([^"]+)"%s*,[^}]*"requestId"%s*:%s*"([^"]+)"') do
            logger:log(2, string.format("[INVENTORY] Processing request %s for player %s", requestId, playerName))

            local items = {}
            local factsJson = ""
            local playerFound = false
            local readable = false

            local PlayersList = FindAllOf("PalPlayerCharacter")
            if PlayersList then
                for _, Player in ipairs(PlayersList) do
                    local matchName = nil
                    local matchState = nil
                    local extractOk = pcall(function()
                        if Player and Player:IsValid() and
                           Player.PlayerState and Player.PlayerState:IsValid() and
                           Player.PlayerState.PlayerNamePrivate then
                            matchName = Player.PlayerState.PlayerNamePrivate:ToString()
                            matchState = Player.PlayerState
                        end
                    end)

                    if extractOk and matchName and matchState and
                       matchName:lower() == playerName:lower() then
                        playerFound = true
                        items, readable = EnumeratePlayerInventory(matchState)
                        factsJson = ReadCharacterFactsJson(Player)
                        break
                    end
                end
            else
                logger:log(1, "[INVENTORY] ERROR: FindAllOf returned nil")
            end

            if not playerFound then
                logger:log(1, string.format("[INVENTORY] Player '%s' not found online", playerName))
            end

            -- Always reply, to clear the request. found:false tells the bridge this
            -- is no reading at all, not an empty inventory.
            if not readable then
                factsJson = factsJson .. ',"found":false'
            end
            local itemsJson = ItemsToJson(items)
            local count = 0
            for _ in pairs(items) do count = count + 1 end
            logger:log(2, string.format("[INVENTORY] Player %s: %d item stack(s)", playerName, count))
            SendInventoryResponse(bridgeHost, requestId, playerName, itemsJson, factsJson)
        end
    end)

    if not success then
        logger:log(1, "[INVENTORY] Error fetching inventory requests: " .. tostring(err))
    end
end

-- Initialize inventory reading (on-demand poller).
function Inventory.Initialize()
    if not config.EnableInventoryTracking then
        logger:log(2, "[INVENTORY] Inventory reading is disabled in config")
        return
    end

    logger:log(2, "[INVENTORY] Starting on-demand inventory reader...")

    -- Poll the bridge for inventory requests every second (like items/location).
    LoopAsync(1000, function()
        FetchInventoryRequests()
        return false
    end)

    logger:log(2, "[INVENTORY] On-demand inventory reader started")
end

return Inventory
