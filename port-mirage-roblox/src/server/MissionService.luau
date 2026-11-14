-- Missions de livraison : prendre un colis au depot et le deposer a l'adresse indiquee.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local MissionService = {}

local DELIVERY = Config.Delivery

local active = {} -- [Player] = { Dest = Vector3, Reward = number, Deadline = number }
local economy, notify, missionRemote, deliveryPoints

local function rootOf(player)
	local character = player.Character
	return character and character:FindFirstChild("HumanoidRootPart")
end

function MissionService.start(player)
	if active[player] then
		notify(player, "Tu as deja une livraison en cours.", "info")
		return
	end
	local rootPart = rootOf(player)
	if not rootPart then
		return
	end

	-- Adresse au hasard, assez loin du joueur
	local dest = nil
	for _ = 1, 20 do
		local candidate = deliveryPoints[math.random(1, #deliveryPoints)]
		if (candidate - rootPart.Position).Magnitude > 300 then
			dest = candidate
			break
		end
	end
	if not dest then
		dest = deliveryPoints[math.random(1, #deliveryPoints)]
	end

	local distance = (dest - rootPart.Position).Magnitude
	local reward = math.floor((DELIVERY.BaseReward + distance * DELIVERY.RewardPerStud) / 10) * 10
	local allowed = math.floor(distance / 35) + 20 -- secondes pour toucher le bonus de rapidite
	active[player] = { Dest = dest, Reward = reward, Deadline = os.clock() + allowed }
	missionRemote:FireClient(player, "start", dest, reward, allowed)
	notify(player, "Colis charge ! Suis la balise jaune. Bonus si tu livres en moins de " .. allowed .. " s.", "info")
end

local function complete(player, mission)
	active[player] = nil
	local reward = mission.Reward
	local text = "Livraison terminee : +$" .. reward
	if os.clock() <= mission.Deadline then
		local bonus = math.floor(reward * DELIVERY.FastBonus)
		reward = reward + bonus
		text = "Livraison express : +$" .. reward .. " (bonus rapidite inclus)"
	end
	economy.add(player, reward)
	missionRemote:FireClient(player, "done")
	notify(player, text, "good")
end

-- deps = { Economy, Notify, MissionRemote, DeliveryPoints, Board }
function MissionService.init(deps)
	economy = deps.Economy
	notify = deps.Notify
	missionRemote = deps.MissionRemote
	deliveryPoints = deps.DeliveryPoints

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Prendre une livraison"
	prompt.ObjectText = "Mirage Express"
	prompt.HoldDuration = 0.5
	prompt.MaxActivationDistance = 14
	prompt.RequiresLineOfSight = false
	prompt.Parent = deps.Board
	prompt.Triggered:Connect(function(player)
		MissionService.start(player)
	end)

	Players.PlayerRemoving:Connect(function(player)
		active[player] = nil
	end)

	task.spawn(function()
		while true do
			task.wait(0.3)
			for player, mission in pairs(active) do
				local rootPart = rootOf(player)
				if rootPart then
					local offset = rootPart.Position - mission.Dest
					local flatDistance = Vector3.new(offset.X, 0, offset.Z).Magnitude
					if flatDistance < 16 then
						complete(player, mission)
					end
				end
			end
		end
	end)
end

return MissionService
