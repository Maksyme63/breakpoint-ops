-- Voitures construites par script, conduite "arcade" (pas de suspension, tres stable).
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local VehicleService = {}

local cars = {} -- [Model] = etat de la voiture
local personal = {} -- [Player] = Model
local lastSpawn = {} -- [Player] = os.clock()
local folder

VehicleService.OnEnter = nil -- fonction(player, model), definie par le script principal

local SLIPPERY = PhysicalProperties.new(1, 0, 0, 100, 1)
local WHEEL_RADIUS = 1.3
local RIDE_HEIGHT = WHEEL_RADIUS + 0.3 -- hauteur du centre du chassis au-dessus du sol

local function addPart(model, chassis, props, offset)
	local p = Instance.new("Part")
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	p.Massless = true
	p.CanCollide = false
	for key, value in pairs(props) do
		p[key] = value
	end
	p.CFrame = chassis.CFrame * offset
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = chassis
	weld.Part1 = p
	weld.Parent = p
	p.Parent = model
	return p
end

-- Construit le modele. display = true : voiture d'exposition (fixe, sans siege).
local function buildModel(specName, cf, color, display)
	local spec = Config.Cars[specName]
	local size = spec.Size
	local w, h, l = size.X, size.Y, size.Z

	local model = Instance.new("Model")
	model.Name = spec.DisplayName

	local chassis = Instance.new("Part")
	chassis.Name = "Chassis"
	chassis.Size = size
	chassis.Color = color
	chassis.Material = Enum.Material.SmoothPlastic
	chassis.Reflectance = 0.15
	chassis.TopSurface = Enum.SurfaceType.Smooth
	chassis.BottomSurface = Enum.SurfaceType.Smooth
	chassis.CustomPhysicalProperties = SLIPPERY
	chassis.CFrame = cf * CFrame.new(0, RIDE_HEIGHT, 0)
	chassis.Parent = model
	model.PrimaryPart = chassis

	local top = h / 2

	-- Habitacle vitre + toit
	addPart(model, chassis, {
		Name = "Vitres",
		Size = Vector3.new(w - 0.6, 3.6, l * 0.42),
		Color = Color3.fromRGB(30, 40, 56),
		Material = Enum.Material.Glass,
		Transparency = 0.5,
	}, CFrame.new(0, top + 1.8, l * 0.06))
	addPart(model, chassis, {
		Name = "Toit",
		Size = Vector3.new(w - 0.4, 0.4, l * 0.44),
		Color = color,
		Reflectance = 0.15,
	}, CFrame.new(0, top + 3.8, l * 0.06))
	-- Capot et coffre
	addPart(model, chassis, {
		Name = "Capot",
		Size = Vector3.new(w - 0.2, 0.8, l * 0.26),
		Color = color,
		Reflectance = 0.15,
	}, CFrame.new(0, top + 0.4, -l * 0.36))
	addPart(model, chassis, {
		Name = "Coffre",
		Size = Vector3.new(w - 0.2, 0.9, l * 0.2),
		Color = color,
		Reflectance = 0.15,
	}, CFrame.new(0, top + 0.45, l * 0.39))
	if spec.Spoiler then
		addPart(model, chassis, {
			Name = "Aileron",
			Size = Vector3.new(w, 0.3, 1.4),
			Color = Color3.fromRGB(24, 24, 28),
		}, CFrame.new(0, top + 2, l * 0.46))
		for _, sx in ipairs({ -1, 1 }) do
			addPart(model, chassis, {
				Name = "SupportAileron",
				Size = Vector3.new(0.3, 1.2, 0.6),
				Color = Color3.fromRGB(24, 24, 28),
			}, CFrame.new(sx * (w / 2 - 0.8), top + 1.3, l * 0.46))
		end
	end

	-- Roues (decor) + billes invisibles qui portent la voiture
	for _, sx in ipairs({ -1, 1 }) do
		for _, sz in ipairs({ -1, 1 }) do
			addPart(model, chassis, {
				Name = "Roue",
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(0.9, WHEEL_RADIUS * 2, WHEEL_RADIUS * 2),
				Color = Color3.fromRGB(20, 20, 22),
			}, CFrame.new(sx * (w / 2), -0.3, sz * l * 0.32))
			addPart(model, chassis, {
				Name = "Appui",
				Shape = Enum.PartType.Ball,
				Size = Vector3.new(WHEEL_RADIUS * 2, WHEEL_RADIUS * 2, WHEEL_RADIUS * 2),
				Transparency = 1,
				CanCollide = not display,
				Massless = false,
				CustomPhysicalProperties = SLIPPERY,
			}, CFrame.new(sx * (w / 2 - 1), -0.3, sz * l * 0.32))
		end
	end

	-- Phares et feux arriere
	for _, sx in ipairs({ -1, 1 }) do
		local head = addPart(model, chassis, {
			Name = "Phare",
			Size = Vector3.new(1.3, 0.5, 0.2),
			Color = Color3.fromRGB(255, 244, 214),
			Material = Enum.Material.Neon,
		}, CFrame.new(sx * (w / 2 - 1.1), 0.1, -l / 2 - 0.05))
		if not display then
			local light = Instance.new("SpotLight")
			light.Face = Enum.NormalId.Front
			light.Range = 60
			light.Angle = 70
			light.Brightness = 2
			light.Shadows = false
			light.Parent = head
		end
		addPart(model, chassis, {
			Name = "FeuArriere",
			Size = Vector3.new(1.3, 0.5, 0.2),
			Color = Color3.fromRGB(255, 40, 40),
			Material = Enum.Material.Neon,
		}, CFrame.new(sx * (w / 2 - 1.1), 0.1, l / 2 + 0.05))
	end

	if display then
		for _, d in ipairs(model:GetDescendants()) do
			if d:IsA("BasePart") then
				d.Anchored = true
			end
		end
		return model, chassis
	end

	-- Sieges
	local seat = Instance.new("VehicleSeat")
	seat.Name = "Conducteur"
	seat.Size = Vector3.new(2, 0.5, 2)
	seat.Transparency = 1
	seat.HeadsUpDisplay = false
	seat.Massless = true
	seat.CanCollide = false
	seat.CFrame = chassis.CFrame * CFrame.new(-w / 4, top - 0.2, l * 0.02)
	local seatWeld = Instance.new("WeldConstraint")
	seatWeld.Part0 = chassis
	seatWeld.Part1 = seat
	seatWeld.Parent = seat
	seat.Parent = model

	local passenger = Instance.new("Seat")
	passenger.Name = "Passager"
	passenger.Size = Vector3.new(2, 0.5, 2)
	passenger.Transparency = 1
	passenger.Massless = true
	passenger.CanCollide = false
	passenger.CFrame = chassis.CFrame * CFrame.new(w / 4, top - 0.2, l * 0.02)
	local passengerWeld = Instance.new("WeldConstraint")
	passengerWeld.Part0 = chassis
	passengerWeld.Part1 = passenger
	passengerWeld.Parent = passenger
	passenger.Parent = model

	return model, chassis, seat, passenger
end

local function register(model, chassis, seat, passenger, specName, home)
	local spec = Config.Cars[specName]

	local attachment = Instance.new("Attachment")
	attachment.Name = "Moteur"
	attachment.Parent = chassis

	model.Parent = folder
	local mass = chassis.AssemblyMass

	-- Vitesse dans le plan horizontal (la gravite reste libre)
	local lv = Instance.new("LinearVelocity")
	lv.Attachment0 = attachment
	lv.RelativeTo = Enum.ActuatorRelativeTo.World
	lv.VelocityConstraintMode = Enum.VelocityConstraintMode.Plane
	lv.PrimaryTangentAxis = Vector3.new(1, 0, 0)
	lv.SecondaryTangentAxis = Vector3.new(0, 0, 1)
	lv.PlaneVelocity = Vector2.new(0, 0)
	lv.MaxForce = mass * 90
	lv.Parent = chassis

	-- Rotation : seul le lacet est autorise, la voiture ne peut pas se retourner
	local av = Instance.new("AngularVelocity")
	av.Attachment0 = attachment
	av.RelativeTo = Enum.ActuatorRelativeTo.World
	av.AngularVelocity = Vector3.new(0, 0, 0)
	av.MaxTorque = mass * 4000
	av.Parent = chassis

	local state = {
		Model = model,
		Chassis = chassis,
		Seat = seat,
		Passenger = passenger,
		Spec = spec,
		LV = lv,
		AV = av,
		Speed = 0,
		Home = home,
		Idle = 0,
	}
	cars[model] = state

	-- Monter en voiture avec la touche d'interaction (E sur clavier) ; sauter pour descendre
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Monter"
	prompt.ObjectText = spec.DisplayName
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.Parent = chassis
	prompt.Triggered:Connect(function(player)
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		if not humanoid or humanoid.Health <= 0 or humanoid.SeatPart then
			return
		end
		if seat.Occupant == nil then
			seat:Sit(humanoid)
		elseif passenger.Occupant == nil then
			passenger:Sit(humanoid)
		end
	end)

	seat:GetPropertyChangedSignal("Occupant"):Connect(function()
		local humanoid = seat.Occupant
		if humanoid and VehicleService.OnEnter then
			local player = Players:GetPlayerFromCharacter(humanoid.Parent)
			if player then
				VehicleService.OnEnter(player, model)
			end
		end
	end)

	return state
end

local function randomColor()
	return Config.CarColors[math.random(1, #Config.CarColors)]
end

-- Voiture garee dans la rue ; elle revient a sa place si on l'abandonne.
function VehicleService.spawnStreetCar(specName, cf)
	local model, chassis, seat, passenger = buildModel(specName, cf, randomColor(), false)
	model:SetAttribute("Street", true)
	register(model, chassis, seat, passenger, specName, cf)
	return model
end

-- Voiture d'exposition du concessionnaire (decor uniquement).
function VehicleService.spawnDisplay(specName, cf, color)
	local model = buildModel(specName, cf, color or randomColor(), true)
	model.Parent = folder
	return model
end

-- Fait apparaitre la voiture personnelle du joueur devant lui.
function VehicleService.spawnPersonal(player, specName)
	if not Config.Cars[specName] then
		return false, "Vehicule inconnu."
	end
	local now = os.clock()
	if lastSpawn[player] and now - lastSpawn[player] < 5 then
		return false, "Patiente quelques secondes."
	end
	local character = player.Character
	local rootPart = character and character:FindFirstChild("HumanoidRootPart")
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not rootPart or not humanoid or humanoid.Health <= 0 then
		return false, "Impossible pour le moment."
	end
	if humanoid.SeatPart then
		return false, "Descends d'abord de ton vehicule."
	end
	lastSpawn[player] = now

	VehicleService.removePersonal(player)

	local _, yaw = rootPart.CFrame:ToOrientation()
	local flat = CFrame.new(rootPart.Position) * CFrame.Angles(0, yaw, 0)
	local cf = flat * CFrame.new(0, -1, -14)
	local model, chassis, seat, passenger = buildModel(specName, cf, randomColor(), false)
	model:SetAttribute("Owner", player.UserId)
	register(model, chassis, seat, passenger, specName, nil)
	personal[player] = model
	return true
end

function VehicleService.removePersonal(player)
	local model = personal[player]
	if model then
		cars[model] = nil
		model:Destroy()
		personal[player] = nil
	end
end

local function approach(current, target, maxDelta)
	if current < target then
		return math.min(current + maxDelta, target)
	end
	return math.max(current - maxDelta, target)
end

local function update(dt)
	for model, st in pairs(cars) do
		local chassis = st.Chassis
		if not model.Parent or not chassis.Parent then
			cars[model] = nil
		else
			local seat = st.Seat
			local spec = st.Spec
			local occupied = seat.Occupant ~= nil
			local throttle, steer = 0, 0
			if occupied then
				throttle = seat.ThrottleFloat
				steer = seat.SteerFloat
			end

			-- Acceleration / freinage
			local speed = st.Speed
			local target = 0
			if throttle > 0.05 then
				target = spec.MaxSpeed * throttle
			elseif throttle < -0.05 then
				target = spec.MaxSpeed * 0.35 * throttle
			end
			local rate
			if target == 0 then
				rate = occupied and 28 or 70 -- roue libre, ou frein a main quand la voiture est vide
			elseif speed ~= 0 and (speed > 0) ~= (target > 0) then
				rate = 110 -- freinage
			else
				rate = spec.Accel
			end
			speed = approach(speed, target, rate * dt)

			local look = chassis.CFrame.LookVector
			local flat = Vector3.new(look.X, 0, look.Z)
			if flat.Magnitude > 0.01 then
				flat = flat.Unit
			else
				flat = Vector3.new(0, 0, -1)
			end

			-- Si la voiture est bloquee par un mur, la vitesse voulue retombe
			local actual = chassis.AssemblyLinearVelocity:Dot(flat)
			if math.abs(speed) > math.abs(actual) + 25 then
				speed = actual + (speed > 0 and 25 or -25)
			end
			st.Speed = speed

			st.LV.PlaneVelocity = Vector2.new(flat.X * speed, flat.Z * speed)
			local turn = -steer * spec.Turn * math.clamp(speed / 25, -1, 1)
			st.AV.AngularVelocity = Vector3.new(0, turn, 0)

			-- Remise en place des voitures abandonnees ou tombees a l'eau
			local empty = not occupied and st.Passenger.Occupant == nil
			if empty and st.Home then
				local away = (chassis.Position - st.Home.Position).Magnitude > 25
				if away then
					st.Idle = st.Idle + dt
				else
					st.Idle = 0
				end
				if st.Idle > 90 or chassis.Position.Y < -30 then
					st.Idle = 0
					st.Speed = 0
					chassis.AssemblyLinearVelocity = Vector3.new(0, 0, 0)
					chassis.AssemblyAngularVelocity = Vector3.new(0, 0, 0)
					model:PivotTo(st.Home * CFrame.new(0, RIDE_HEIGHT + 0.5, 0))
					model:SetAttribute("Taken", nil)
				end
			else
				st.Idle = 0
			end
		end
	end
end

function VehicleService.init()
	folder = Instance.new("Folder")
	folder.Name = "Vehicules"
	folder.Parent = workspace

	RunService.Heartbeat:Connect(update)

	Players.PlayerRemoving:Connect(function(player)
		VehicleService.removePersonal(player)
		lastSpawn[player] = nil
	end)
end

return VehicleService
