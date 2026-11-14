-- Argent, vehicules possedes et sauvegarde.
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local EconomyService = {}

local data = {} -- [Player] = { Cash = number, Cars = { [nom] = true }, Loaded = bool }
local store = nil

-- La sauvegarde ne fonctionne que si le jeu est publie et que l'acces API est active dans Studio.
pcall(function()
	store = DataStoreService:GetDataStore("PortMirage_v1")
end)

local function carsToString(owned)
	local names = {}
	for name in pairs(owned) do
		table.insert(names, name)
	end
	table.sort(names)
	return table.concat(names, ",")
end

local function sync(player)
	local entry = data[player]
	if not entry then
		return
	end
	local stats = player:FindFirstChild("leaderstats")
	local cash = stats and stats:FindFirstChild("Cash")
	if cash then
		cash.Value = entry.Cash
	end
	player:SetAttribute("OwnedCars", carsToString(entry.Cars))
end

local function load(player)
	local entry = { Cash = Config.StartCash, Cars = {}, Loaded = false }
	if store then
		local ok, saved = pcall(function()
			return store:GetAsync("joueur_" .. player.UserId)
		end)
		if ok then
			entry.Loaded = true
			if type(saved) == "table" then
				if type(saved.Cash) == "number" then
					entry.Cash = math.max(0, math.floor(saved.Cash))
				end
				if type(saved.Cars) == "table" then
					for _, name in ipairs(saved.Cars) do
						if Config.Cars[name] then
							entry.Cars[name] = true
						end
					end
				end
			end
		end
	end
	return entry
end

local function save(player)
	local entry = data[player]
	-- On ne sauvegarde jamais par-dessus des donnees qu'on n'a pas reussi a charger
	if not entry or not store or not entry.Loaded then
		return
	end
	local owned = {}
	for name in pairs(entry.Cars) do
		table.insert(owned, name)
	end
	pcall(function()
		store:SetAsync("joueur_" .. player.UserId, { Cash = entry.Cash, Cars = owned })
	end)
end

local function onPlayerAdded(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local cash = Instance.new("IntValue")
	cash.Name = "Cash"
	cash.Value = Config.StartCash
	cash.Parent = stats
	stats.Parent = player

	local entry = load(player)
	if player.Parent then
		data[player] = entry
		sync(player)
	end
end

function EconomyService.get(player)
	local entry = data[player]
	return entry and entry.Cash or 0
end

-- Ajoute (ou retire si negatif) de l'argent. Le solde ne descend jamais sous zero.
function EconomyService.add(player, amount)
	local entry = data[player]
	if not entry then
		return
	end
	entry.Cash = math.max(0, math.floor(entry.Cash + amount))
	sync(player)
end

function EconomyService.owns(player, carName)
	local entry = data[player]
	return entry ~= nil and entry.Cars[carName] == true
end

-- Achat d'un vehicule. Renvoie succes, message.
function EconomyService.buyCar(player, carName)
	local entry = data[player]
	local spec = Config.Cars[carName]
	if not entry or not spec then
		return false, "Achat impossible."
	end
	if entry.Cars[carName] then
		return false, "Tu possedes deja ce vehicule. Ouvre le Garage pour le faire venir."
	end
	if entry.Cash < spec.Price then
		return false, "Il te manque $" .. (spec.Price - entry.Cash) .. "."
	end
	entry.Cash = entry.Cash - spec.Price
	entry.Cars[carName] = true
	sync(player)
	return true, spec.DisplayName .. " achete ! Ouvre le Garage pour le faire venir."
end

function EconomyService.init()
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, player in ipairs(Players:GetPlayers()) do
		task.spawn(onPlayerAdded, player)
	end

	Players.PlayerRemoving:Connect(function(player)
		save(player)
		data[player] = nil
	end)

	game:BindToClose(function()
		for _, player in ipairs(Players:GetPlayers()) do
			save(player)
		end
	end)

	-- Sauvegarde automatique
	task.spawn(function()
		while true do
			task.wait(120)
			for _, player in ipairs(Players:GetPlayers()) do
				save(player)
			end
		end
	end)
end

return EconomyService
