-- Port Mirage : script principal du serveur. Construit la ville et relie tous les systemes.
local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local CityBuilder = require(script.Parent.CityBuilder)
local VehicleService = require(script.Parent.VehicleService)
local EconomyService = require(script.Parent.EconomyService)
local WantedService = require(script.Parent.WantedService)
local MissionService = require(script.Parent.MissionService)

---------------------------------------------------------------------
-- Communication serveur <-> joueurs
---------------------------------------------------------------------
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"

local notifyRemote = Instance.new("RemoteEvent")
notifyRemote.Name = "Notify"
notifyRemote.Parent = remotes

local missionRemote = Instance.new("RemoteEvent")
missionRemote.Name = "Mission"
missionRemote.Parent = remotes

local spawnVehicleRemote = Instance.new("RemoteEvent")
spawnVehicleRemote.Name = "SpawnVehicle"
spawnVehicleRemote.Parent = remotes

remotes.Parent = ReplicatedStorage

local function notify(player, text, kind)
	notifyRemote:FireClient(player, text, kind or "info")
end

---------------------------------------------------------------------
-- Ambiance
---------------------------------------------------------------------
-- Le sol de depart de Studio n'est pas utile : la ville a son propre sol.
local baseplate = workspace:FindFirstChild("Baseplate")
if baseplate then
	baseplate:Destroy()
end

Lighting.ClockTime = 16.5
Lighting.Brightness = 2.4
Lighting.GlobalShadows = true
Lighting.OutdoorAmbient = Color3.fromRGB(120, 116, 128)
Lighting.Ambient = Color3.fromRGB(60, 58, 70)

local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere")
atmosphere.Density = 0.28
atmosphere.Haze = 1.4
atmosphere.Color = Color3.fromRGB(255, 214, 178)
atmosphere.Decay = Color3.fromRGB(255, 150, 110)
atmosphere.Parent = Lighting

local bloom = Lighting:FindFirstChildOfClass("BloomEffect") or Instance.new("BloomEffect")
bloom.Intensity = 0.6
bloom.Size = 24
bloom.Threshold = 1.1
bloom.Parent = Lighting

-- Cycle jour / nuit
local hoursPerSecond = 24 / (Config.DayLengthMinutes * 60)
RunService.Heartbeat:Connect(function(dt)
	Lighting.ClockTime = (Lighting.ClockTime + dt * hoursPerSecond) % 24
end)

---------------------------------------------------------------------
-- Ville et systemes
---------------------------------------------------------------------
local city = CityBuilder.build()

EconomyService.init()
VehicleService.init()
WantedService.init({
	Economy = EconomyService,
	Notify = notify,
	Intersections = city.Intersections,
	PoliceCFrame = city.PoliceCFrame,
})
MissionService.init({
	Economy = EconomyService,
	Notify = notify,
	MissionRemote = missionRemote,
	DeliveryPoints = city.DeliveryPoints,
	Board = city.DepotBoard,
})

---------------------------------------------------------------------
-- Voitures garees dans la rue
---------------------------------------------------------------------
do
	local spots = city.ParkingSpots
	-- Melange des places
	for index = #spots, 2, -1 do
		local other = math.random(1, index)
		spots[index], spots[other] = spots[other], spots[index]
	end
	for index = 1, math.min(Config.StreetCarCount, #spots) do
		local specName = Config.StreetCars[math.random(1, #Config.StreetCars)]
		VehicleService.spawnStreetCar(specName, spots[index])
	end
end

-- Prendre une voiture de la rue peut alerter la police
VehicleService.OnEnter = function(player, model)
	if model:GetAttribute("Street") and not model:GetAttribute("Taken") then
		model:SetAttribute("Taken", true)
		if math.random() < Config.Wanted.CarTheftChance then
			WantedService.add(player, 1)
			notify(player, "Un temoin t'a vu prendre cette voiture ! La police arrive.", "bad")
		end
	end
end

---------------------------------------------------------------------
-- Concessionnaire
---------------------------------------------------------------------
for index, carName in ipairs(Config.DealerOrder) do
	local pad = city.DealerPads[index]
	local spec = Config.Cars[carName]
	if pad and spec then
		local display = VehicleService.spawnDisplay(carName, pad, Config.CarColors[index])
		local prompt = Instance.new("ProximityPrompt")
		prompt.ActionText = "Acheter ($" .. spec.Price .. ")"
		prompt.ObjectText = spec.DisplayName
		prompt.HoldDuration = 1
		prompt.MaxActivationDistance = 16
		prompt.RequiresLineOfSight = false
		prompt.Parent = display.PrimaryPart
		prompt.Triggered:Connect(function(player)
			local ok, message = EconomyService.buyCar(player, carName)
			notify(player, message, ok and "good" or "bad")
		end)
	end
end

spawnVehicleRemote.OnServerEvent:Connect(function(player, carName)
	if type(carName) ~= "string" or not Config.Cars[carName] then
		return
	end
	if not EconomyService.owns(player, carName) then
		notify(player, "Tu ne possedes pas ce vehicule.", "bad")
		return
	end
	local ok, message = VehicleService.spawnPersonal(player, carName)
	if ok then
		notify(player, Config.Cars[carName].DisplayName .. " livre devant toi.", "good")
	else
		notify(player, message, "bad")
	end
end)

---------------------------------------------------------------------
-- Braquages de superettes
---------------------------------------------------------------------
for _, shop in ipairs(city.Stores) do
	local register = shop.Register
	local alarm = shop.Alarm
	local openColor = register.Color
	local ready = true

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Braquer la caisse"
	prompt.ObjectText = shop.Name
	prompt.HoldDuration = Config.Robbery.HoldSeconds
	prompt.MaxActivationDistance = 10
	prompt.RequiresLineOfSight = false
	prompt.Parent = register

	prompt.Triggered:Connect(function(player)
		if not ready then
			return
		end
		ready = false
		prompt.Enabled = false

		local reward = math.random(Config.Robbery.MinReward, Config.Robbery.MaxReward)
		EconomyService.add(player, reward)
		WantedService.add(player, Config.Robbery.Stars)
		notify(player, "Braquage reussi : +$" .. reward .. ". File avant l'arrivee de la police !", "good")

		-- Alarme clignotante pendant le temps de recharge
		register.Color = Color3.fromRGB(70, 70, 76)
		register.Material = Enum.Material.SmoothPlastic
		local finish = os.clock() + Config.Robbery.CooldownSeconds
		local on = false
		while os.clock() < finish do
			on = not on
			if os.clock() < finish - Config.Robbery.CooldownSeconds + 30 then
				alarm.Material = on and Enum.Material.Neon or Enum.Material.SmoothPlastic
				alarm.Color = on and Color3.fromRGB(255, 40, 40) or Color3.fromRGB(90, 20, 20)
			else
				alarm.Material = Enum.Material.SmoothPlastic
				alarm.Color = Color3.fromRGB(90, 20, 20)
			end
			task.wait(0.4)
		end

		register.Color = openColor
		register.Material = Enum.Material.Neon
		prompt.Enabled = true
		ready = true
	end)
end

---------------------------------------------------------------------
-- Billets a ramasser
---------------------------------------------------------------------
do
	local pickupFolder = Instance.new("Folder")
	pickupFolder.Name = "Billets"
	pickupFolder.Parent = workspace

	local points = city.PickupPoints
	for index = #points, 2, -1 do
		local other = math.random(1, index)
		points[index], points[other] = points[other], points[index]
	end

	for index = 1, math.min(Config.Pickup.Count, #points) do
		local bill = Instance.new("Part")
		bill.Name = "Billet"
		bill.Anchored = true
		bill.CanCollide = false
		bill.Size = Vector3.new(2.6, 1.4, 0.3)
		bill.Color = Color3.fromRGB(90, 230, 120)
		bill.Material = Enum.Material.Neon
		bill.CFrame = CFrame.new(points[index]) * CFrame.Angles(0, math.rad(math.random(0, 180)), 0)
		bill.Parent = pickupFolder

		local available = true
		bill.Touched:Connect(function(hit)
			if not available then
				return
			end
			local player = Players:GetPlayerFromCharacter(hit.Parent)
			if not player then
				return
			end
			available = false
			bill.Transparency = 1
			EconomyService.add(player, Config.Pickup.Value)
			notify(player, "+$" .. Config.Pickup.Value, "good")
			task.wait(Config.Pickup.RespawnSeconds)
			bill.Transparency = 0
			available = true
		end)
	end
end

---------------------------------------------------------------------
-- Accueil
---------------------------------------------------------------------
local function welcome(player)
	task.wait(4)
	if player.Parent then
		notify(player, "Bienvenue a " .. Config.GameName .. " ! Monte dans une voiture, livre des colis ou tente un braquage.", "info")
	end
end
Players.PlayerAdded:Connect(welcome)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(welcome, player)
end
