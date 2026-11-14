-- Avis de recherche : etoiles, policiers qui poursuivent le joueur, arrestation.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local WantedService = {}

local WANTED = Config.Wanted

local states = {} -- [Player] = { Cops = {}, Evade = number, NextSpawn = number }
local template = nil
local copFolder
local economy, notify, intersections, policeCFrame

local function getState(player)
	local st = states[player]
	if not st then
		st = { Cops = {}, Evade = 0, NextSpawn = 0 }
		states[player] = st
	end
	return st
end

local function clearCops(st)
	for _, cop in ipairs(st.Cops) do
		cop:Destroy()
	end
	st.Cops = {}
end

function WantedService.get(player)
	return player:GetAttribute("Wanted") or 0
end

function WantedService.set(player, stars)
	stars = math.clamp(math.floor(stars), 0, WANTED.MaxStars)
	player:SetAttribute("Wanted", stars)
	local st = getState(player)
	st.Evade = 0
	if stars == 0 then
		clearCops(st)
	end
end

function WantedService.add(player, stars)
	WantedService.set(player, WantedService.get(player) + stars)
end

local function makeTemplate()
	local description = Instance.new("HumanoidDescription")
	local uniform = Color3.fromRGB(28, 46, 92)
	description.HeadColor = Color3.fromRGB(226, 178, 140)
	description.TorsoColor = uniform
	description.LeftArmColor = uniform
	description.RightArmColor = uniform
	description.LeftLegColor = Color3.fromRGB(20, 22, 30)
	description.RightLegColor = Color3.fromRGB(20, 22, 30)
	local ok, model = pcall(function()
		return Players:CreateHumanoidModelFromDescription(description, Enum.HumanoidRigType.R15)
	end)
	if ok and model then
		model.Name = "Policier"
		local humanoid = model:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid.DisplayName = "Policier"
		end
		template = model
	else
		warn("[Port Mirage] Impossible de creer les policiers : " .. tostring(model))
	end
end

local function spawnCop(st, targetPosition)
	if not template then
		return
	end
	-- Croisement a bonne distance du joueur : ni trop pres, ni trop loin
	local best, bestScore = nil, math.huge
	for _, point in ipairs(intersections) do
		local distance = (point - targetPosition).Magnitude
		local score = math.abs(distance - 190) + math.random() * 60
		if distance > 120 and score < bestScore then
			best = point
			bestScore = score
		end
	end
	if not best then
		return
	end
	local cop = template:Clone()
	cop:PivotTo(CFrame.new(best + Vector3.new(math.random(-8, 8), 5, math.random(-8, 8))))
	cop.Parent = copFolder
	local rootPart = cop:FindFirstChild("HumanoidRootPart")
	if rootPart then
		pcall(function()
			rootPart:SetNetworkOwner(nil)
		end)
	end
	table.insert(st.Cops, cop)
end

local function arrest(player, st, stars)
	local fine = math.min(economy.get(player), WANTED.FinePerStar * stars)
	economy.add(player, -fine)
	WantedService.set(player, 0)
	notify(player, "ARRETE ! Amende : $" .. fine, "bad")
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.Sit = false
		task.wait(0.15)
		if character.Parent then
			character:PivotTo(policeCFrame)
		end
	end
end

local function step(player, dt)
	local stars = WantedService.get(player)
	if stars <= 0 then
		return
	end
	local st = getState(player)
	local character = player.Character
	local rootPart = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not rootPart or not humanoid or humanoid.Health <= 0 then
		return
	end
	local position = rootPart.Position

	-- Renforts
	local wantedCops = math.min(stars, WANTED.MaxCops)
	local now = os.clock()
	if #st.Cops < wantedCops and now >= st.NextSpawn then
		st.NextSpawn = now + 2.5
		spawnCop(st, position)
	end

	-- Poursuite
	local nearest = math.huge
	for index = #st.Cops, 1, -1 do
		local cop = st.Cops[index]
		local copRoot = cop:FindFirstChild("HumanoidRootPart")
		local copHumanoid = cop:FindFirstChildOfClass("Humanoid")
		if not copRoot or not copHumanoid or copHumanoid.Health <= 0 or copRoot.Position.Y < -40 then
			cop:Destroy()
			table.remove(st.Cops, index)
		else
			local distance = (copRoot.Position - position).Magnitude
			if distance > 380 then
				-- Seme : il reviendra par un autre croisement
				cop:Destroy()
				table.remove(st.Cops, index)
			else
				nearest = math.min(nearest, distance)
				copHumanoid.WalkSpeed = 17 + stars
				copHumanoid:MoveTo(position)
			end
		end
	end

	-- Arrestation : le policier doit etre tout pres, et le joueur a pied ou presque a l'arret
	local slow = humanoid.SeatPart == nil or rootPart.AssemblyLinearVelocity.Magnitude < 10
	if nearest < WANTED.ArrestDistance and slow then
		arrest(player, st, stars)
		return
	end

	-- Fuite : sans policier a proximite, les etoiles tombent une a une
	if nearest > WANTED.EvadeRadius then
		st.Evade = st.Evade + dt
		if st.Evade >= WANTED.EvadeSeconds then
			WantedService.set(player, stars - 1)
			if stars - 1 == 0 then
				notify(player, "Tu as seme la police.", "good")
			end
		end
	else
		st.Evade = 0
	end
end

-- deps = { Economy, Notify = fonction(player, texte, type), Intersections, PoliceCFrame }
function WantedService.init(deps)
	economy = deps.Economy
	notify = deps.Notify
	intersections = deps.Intersections
	policeCFrame = deps.PoliceCFrame

	copFolder = Instance.new("Folder")
	copFolder.Name = "Police"
	copFolder.Parent = workspace

	task.spawn(makeTemplate)

	local function onPlayerAdded(player)
		player:SetAttribute("Wanted", 0)
		player.CharacterAdded:Connect(function(character)
			local humanoid = character:WaitForChild("Humanoid", 10)
			if humanoid then
				humanoid.Died:Connect(function()
					-- Mourir efface l'avis de recherche
					WantedService.set(player, 0)
				end)
			end
		end)
	end
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, player in ipairs(Players:GetPlayers()) do
		onPlayerAdded(player)
	end

	Players.PlayerRemoving:Connect(function(player)
		local st = states[player]
		if st then
			clearCops(st)
			states[player] = nil
		end
	end)

	task.spawn(function()
		local interval = 0.3
		while true do
			task.wait(interval)
			for _, player in ipairs(Players:GetPlayers()) do
				local ok, err = pcall(step, player, interval)
				if not ok then
					warn("[Port Mirage] Police : " .. tostring(err))
				end
			end
		end
	end)
end

return WantedService
