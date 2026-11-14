-- Port Mirage : interface du joueur (argent, etoiles, mission, compteur, garage, messages).
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local notifyRemote = remotes:WaitForChild("Notify")
local missionRemote = remotes:WaitForChild("Mission")
local spawnVehicleRemote = remotes:WaitForChild("SpawnVehicle")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local DARK = Color3.fromRGB(16, 18, 26)
local GOLD = Color3.fromRGB(255, 190, 80)
local GREEN = Color3.fromRGB(110, 235, 140)
local RED = Color3.fromRGB(255, 90, 90)

local gui = Instance.new("ScreenGui")
gui.Name = "PortMirageHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = false
gui.Parent = playerGui

local function round(instance, radius)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = instance
end

local function makeLabel(props)
	local label = Instance.new("TextLabel")
	label.BackgroundColor3 = DARK
	label.BackgroundTransparency = 0.25
	label.BorderSizePixel = 0
	label.Font = Enum.Font.GothamBold
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextSize = 20
	for key, value in pairs(props) do
		label[key] = value
	end
	round(label, 10)
	label.Parent = props.Parent or gui
	return label
end

local function formatCash(amount)
	local text = tostring(math.floor(amount))
	local result = ""
	while #text > 3 do
		result = " " .. string.sub(text, -3) .. result
		text = string.sub(text, 1, -4)
	end
	return "$ " .. text .. result
end

---------------------------------------------------------------------
-- Argent et etoiles (en haut a droite)
---------------------------------------------------------------------
local cashLabel = makeLabel({
	Name = "Argent",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -16, 0, 16),
	Size = UDim2.fromOffset(190, 44),
	TextColor3 = GREEN,
	TextSize = 26,
	Text = "$ 0",
})

local starsLabel = makeLabel({
	Name = "Etoiles",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -16, 0, 66),
	Size = UDim2.fromOffset(190, 38),
	TextColor3 = GOLD,
	TextSize = 26,
	Text = "",
	Visible = false,
})

local function refreshCash(value)
	cashLabel.Text = formatCash(value)
end

task.spawn(function()
	local stats = player:WaitForChild("leaderstats")
	local cash = stats:WaitForChild("Cash")
	refreshCash(cash.Value)
	cash.Changed:Connect(refreshCash)
end)

local function refreshStars()
	local stars = player:GetAttribute("Wanted") or 0
	if stars <= 0 then
		starsLabel.Visible = false
		return
	end
	local maxStars = Config.Wanted.MaxStars
	starsLabel.Text = string.rep("★", stars) .. string.rep("☆", maxStars - stars)
	starsLabel.Visible = true
end
player:GetAttributeChangedSignal("Wanted"):Connect(refreshStars)
refreshStars()

---------------------------------------------------------------------
-- Mission (en haut au centre) + balise dans le monde
---------------------------------------------------------------------
local missionLabel = makeLabel({
	Name = "Mission",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 16),
	Size = UDim2.fromOffset(420, 44),
	TextColor3 = GOLD,
	Text = "",
	Visible = false,
})

local beacon = nil
local missionDest = nil
local missionReward = 0
local missionDeadline = 0

local function clearMission()
	missionDest = nil
	missionLabel.Visible = false
	if beacon then
		beacon:Destroy()
		beacon = nil
	end
end

local function startMission(dest, reward, allowed)
	clearMission()
	missionDest = dest
	missionReward = reward
	missionDeadline = os.clock() + allowed

	beacon = Instance.new("Part")
	beacon.Name = "BaliseLivraison"
	beacon.Anchored = true
	beacon.CanCollide = false
	beacon.CanQuery = false
	beacon.CastShadow = false
	beacon.Shape = Enum.PartType.Cylinder
	beacon.Size = Vector3.new(400, 14, 14)
	beacon.CFrame = CFrame.new(dest + Vector3.new(0, 200, 0)) * CFrame.Angles(0, 0, math.rad(90))
	beacon.Color = GOLD
	beacon.Material = Enum.Material.Neon
	beacon.Transparency = 0.6
	beacon.Parent = workspace

	-- Repere visible a travers les immeubles
	local anchor = Instance.new("Attachment")
	anchor.Parent = beacon
	anchor.WorldPosition = dest + Vector3.new(0, 12, 0)
	local marker = Instance.new("BillboardGui")
	marker.Adornee = anchor
	marker.AlwaysOnTop = true
	marker.Size = UDim2.fromOffset(150, 34)
	marker.MaxDistance = 100000
	marker.Parent = beacon
	local markerText = Instance.new("TextLabel")
	markerText.Size = UDim2.fromScale(1, 1)
	markerText.BackgroundColor3 = DARK
	markerText.BackgroundTransparency = 0.2
	markerText.Font = Enum.Font.GothamBold
	markerText.TextSize = 18
	markerText.TextColor3 = GOLD
	markerText.Text = "LIVRAISON"
	round(markerText, 8)
	markerText.Parent = marker

	missionLabel.Visible = true
end

missionRemote.OnClientEvent:Connect(function(action, dest, reward, allowed)
	if action == "start" then
		startMission(dest, reward, allowed)
	else
		clearMission()
	end
end)

---------------------------------------------------------------------
-- Compteur de vitesse (en bas a droite)
---------------------------------------------------------------------
local speedLabel = makeLabel({
	Name = "Vitesse",
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -16, 1, -16),
	Size = UDim2.fromOffset(170, 54),
	TextSize = 30,
	Text = "0 km/h",
	Visible = false,
})

---------------------------------------------------------------------
-- Messages (en bas au centre)
---------------------------------------------------------------------
local toastHolder = Instance.new("Frame")
toastHolder.Name = "Messages"
toastHolder.AnchorPoint = Vector2.new(0.5, 1)
toastHolder.Position = UDim2.new(0.5, 0, 1, -110)
toastHolder.Size = UDim2.fromOffset(560, 200)
toastHolder.BackgroundTransparency = 1
toastHolder.Parent = gui

local toastLayout = Instance.new("UIListLayout")
toastLayout.VerticalAlignment = Enum.VerticalAlignment.Bottom
toastLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
toastLayout.Padding = UDim.new(0, 6)
toastLayout.SortOrder = Enum.SortOrder.LayoutOrder
toastLayout.Parent = toastHolder

local toastCount = 0

local function showToast(text, kind)
	toastCount = toastCount + 1
	local color = Color3.new(1, 1, 1)
	if kind == "good" then
		color = GREEN
	elseif kind == "bad" then
		color = RED
	end
	local toast = makeLabel({
		Parent = toastHolder,
		Size = UDim2.new(1, 0, 0, 40),
		LayoutOrder = toastCount,
		TextColor3 = color,
		TextSize = 18,
		TextWrapped = true,
		Text = text,
	})
	task.delay(5, function()
		local tween = TweenService:Create(toast, TweenInfo.new(0.5), { TextTransparency = 1, BackgroundTransparency = 1 })
		tween:Play()
		tween.Completed:Wait()
		toast:Destroy()
	end)
end

notifyRemote.OnClientEvent:Connect(showToast)

---------------------------------------------------------------------
-- Garage (a gauche) : faire venir un vehicule achete
---------------------------------------------------------------------
local garageButton = Instance.new("TextButton")
garageButton.Name = "Garage"
garageButton.AnchorPoint = Vector2.new(0, 0.5)
garageButton.Position = UDim2.new(0, 16, 0.5, 0)
garageButton.Size = UDim2.fromOffset(120, 44)
garageButton.BackgroundColor3 = DARK
garageButton.BackgroundTransparency = 0.2
garageButton.BorderSizePixel = 0
garageButton.Font = Enum.Font.GothamBold
garageButton.TextSize = 20
garageButton.TextColor3 = GOLD
garageButton.Text = "Garage"
round(garageButton, 10)
garageButton.Parent = gui

local garagePanel = Instance.new("Frame")
garagePanel.Name = "ListeGarage"
garagePanel.AnchorPoint = Vector2.new(0, 0)
garagePanel.Position = UDim2.new(0, 16, 0.5, 30)
garagePanel.Size = UDim2.fromOffset(220, 0)
garagePanel.AutomaticSize = Enum.AutomaticSize.Y
garagePanel.BackgroundColor3 = DARK
garagePanel.BackgroundTransparency = 0.15
garagePanel.BorderSizePixel = 0
garagePanel.Visible = false
round(garagePanel, 10)
garagePanel.Parent = gui

local garageLayout = Instance.new("UIListLayout")
garageLayout.Padding = UDim.new(0, 6)
garageLayout.SortOrder = Enum.SortOrder.LayoutOrder
garageLayout.Parent = garagePanel

local garagePadding = Instance.new("UIPadding")
garagePadding.PaddingTop = UDim.new(0, 8)
garagePadding.PaddingBottom = UDim.new(0, 8)
garagePadding.PaddingLeft = UDim.new(0, 8)
garagePadding.PaddingRight = UDim.new(0, 8)
garagePadding.Parent = garagePanel

local function rebuildGarage()
	for _, child in ipairs(garagePanel:GetChildren()) do
		if child:IsA("TextButton") or child:IsA("TextLabel") then
			child:Destroy()
		end
	end
	local owned = player:GetAttribute("OwnedCars") or ""
	local count = 0
	for name in string.gmatch(owned, "[^,]+") do
		local spec = Config.Cars[name]
		if spec then
			count = count + 1
			local button = Instance.new("TextButton")
			button.Size = UDim2.new(1, 0, 0, 38)
			button.LayoutOrder = count
			button.BackgroundColor3 = Color3.fromRGB(40, 44, 60)
			button.BorderSizePixel = 0
			button.Font = Enum.Font.GothamBold
			button.TextSize = 18
			button.TextColor3 = Color3.new(1, 1, 1)
			button.Text = spec.DisplayName
			round(button, 8)
			button.Parent = garagePanel
			button.Activated:Connect(function()
				spawnVehicleRemote:FireServer(name)
				garagePanel.Visible = false
			end)
		end
	end
	if count == 0 then
		local empty = Instance.new("TextLabel")
		empty.Size = UDim2.new(1, 0, 0, 60)
		empty.BackgroundTransparency = 1
		empty.Font = Enum.Font.Gotham
		empty.TextSize = 16
		empty.TextWrapped = true
		empty.TextColor3 = Color3.fromRGB(200, 200, 210)
		empty.Text = "Aucun vehicule. Va chez Mirage Motors pour en acheter un."
		empty.Parent = garagePanel
	end
end

garageButton.Activated:Connect(function()
	garagePanel.Visible = not garagePanel.Visible
	if garagePanel.Visible then
		rebuildGarage()
	end
end)
player:GetAttributeChangedSignal("OwnedCars"):Connect(function()
	if garagePanel.Visible then
		rebuildGarage()
	end
end)

---------------------------------------------------------------------
-- Mise a jour continue : compteur, distance de la mission, etoiles clignotantes
---------------------------------------------------------------------
RunService.RenderStepped:Connect(function()
	local character = player.Character
	local rootPart = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")

	local seat = humanoid and humanoid.SeatPart
	if seat and seat:IsA("VehicleSeat") and rootPart then
		local speed = rootPart.AssemblyLinearVelocity.Magnitude
		speedLabel.Text = math.floor(speed * 1.1) .. " km/h"
		speedLabel.Visible = true
	else
		speedLabel.Visible = false
	end

	if missionDest and rootPart then
		local distance = math.floor((missionDest - rootPart.Position).Magnitude / 3.5)
		local remaining = math.ceil(missionDeadline - os.clock())
		local text = "Livraison : " .. distance .. " m   |   $" .. missionReward
		if remaining > 0 then
			text = text .. "   |   bonus " .. remaining .. " s"
		end
		missionLabel.Text = text
	end

	if starsLabel.Visible then
		local pulse = (math.sin(os.clock() * 6) + 1) / 2
		starsLabel.TextColor3 = GOLD:Lerp(RED, pulse)
	end
end)
