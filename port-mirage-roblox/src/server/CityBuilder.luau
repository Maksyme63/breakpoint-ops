-- Construit toute la ville par script : sol, routes, immeubles, plage, lieux speciaux.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local CityBuilder = {}

local GRID = Config.Grid
local N = GRID.Blocks
local PITCH = GRID.Pitch
local BLOCK = GRID.BlockSize
local ROAD = GRID.RoadWidth
local HALF = N * PITCH / 2 -- demi-largeur de la ville
local SIDEWALK_Y = 0.7

local BUILDING_COLORS = {
	Color3.fromRGB(214, 196, 170),
	Color3.fromRGB(180, 188, 196),
	Color3.fromRGB(226, 214, 200),
	Color3.fromRGB(150, 160, 172),
	Color3.fromRGB(200, 170, 150),
	Color3.fromRGB(120, 132, 148),
	Color3.fromRGB(235, 228, 215),
	Color3.fromRGB(170, 150, 135),
}

local NEON_COLORS = {
	Color3.fromRGB(255, 170, 60),
	Color3.fromRGB(80, 220, 200),
	Color3.fromRGB(255, 90, 120),
	Color3.fromRGB(120, 160, 255),
	Color3.fromRGB(190, 255, 110),
}

local rng = Random.new(20261114)
local root

local function newPart(props)
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for key, value in pairs(props) do
		if key ~= "Parent" then
			p[key] = value
		end
	end
	p.Parent = props.Parent or root
	return p
end

local function addSign(part, face, text, textColor)
	local gui = Instance.new("SurfaceGui")
	gui.Face = face
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 20
	gui.LightInfluence = 0
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Text = text
	label.TextScaled = true
	label.Font = Enum.Font.GothamBlack
	label.TextColor3 = textColor or Color3.new(1, 1, 1)
	label.Parent = gui
	gui.Parent = part
	return gui
end

local function blockCenter(i, j)
	local x = (i - (N - 1) / 2) * PITCH
	local z = (j - (N - 1) / 2) * PITCH
	return x, z
end

local function buildGround()
	-- Terre ferme
	newPart({
		Name = "Sol",
		Size = Vector3.new(HALF * 2 + 400, 8, HALF * 2 + 400),
		Position = Vector3.new(0, -4, 0),
		Color = Color3.fromRGB(196, 178, 128),
		Material = Enum.Material.Sand,
	})
	-- Plage et ocean au sud
	newPart({
		Name = "Plage",
		Size = Vector3.new(HALF * 2 + 400, 8, 260),
		Position = Vector3.new(0, -4.4, HALF + 200 + 130),
		Color = Color3.fromRGB(236, 220, 170),
		Material = Enum.Material.Sand,
	})
	newPart({
		Name = "Ocean",
		Size = Vector3.new(2048, 6, 1400),
		Position = Vector3.new(0, -5, HALF + 200 + 700),
		Color = Color3.fromRGB(30, 130, 190),
		Material = Enum.Material.Glass,
		Transparency = 0.25,
		Reflectance = 0.2,
		CanCollide = false,
	})
	newPart({
		Name = "FondMarin",
		Size = Vector3.new(2048, 4, 1400),
		Position = Vector3.new(0, -5.5, HALF + 200 + 700), -- eau peu profonde : on peut ressortir en sautant
		Color = Color3.fromRGB(200, 190, 140),
		Material = Enum.Material.Sand,
	})

	-- Murs invisibles autour de la carte
	local limit = HALF + 200
	local wallHeight = 400
	local walls = {
		{ Vector3.new(4, wallHeight, limit * 2 + 600), Vector3.new(-limit, wallHeight / 2 - 20, 300) },
		{ Vector3.new(4, wallHeight, limit * 2 + 600), Vector3.new(limit, wallHeight / 2 - 20, 300) },
		{ Vector3.new(limit * 2, wallHeight, 4), Vector3.new(0, wallHeight / 2 - 20, -limit) },
		{ Vector3.new(limit * 2, wallHeight, 4), Vector3.new(0, wallHeight / 2 - 20, limit + 600) },
	}
	for _, wall in ipairs(walls) do
		newPart({
			Name = "Limite",
			Size = wall[1],
			Position = wall[2],
			Transparency = 1,
			CastShadow = false,
		})
	end
end

local function buildRoads()
	local roads = Instance.new("Folder")
	roads.Name = "Routes"
	roads.Parent = root
	local asphalt = Color3.fromRGB(52, 54, 60)
	local length = N * PITCH + ROAD

	for k = 0, N do
		local offset = (k - N / 2) * PITCH
		-- Route nord-sud
		newPart({
			Name = "Route",
			Parent = roads,
			Size = Vector3.new(ROAD, 0.4, length),
			Position = Vector3.new(offset, 0, 0),
			Color = asphalt,
			Material = Enum.Material.Asphalt,
		})
		-- Route est-ouest (1 cm plus bas pour eviter le scintillement aux croisements)
		newPart({
			Name = "Route",
			Parent = roads,
			Size = Vector3.new(length, 0.4, ROAD),
			Position = Vector3.new(0, -0.01, offset),
			Color = asphalt,
			Material = Enum.Material.Asphalt,
		})
	end

	-- Lignes pointillees entre les croisements
	local lineColor = Color3.fromRGB(240, 220, 120)
	for k = 0, N do
		local offset = (k - N / 2) * PITCH
		for b = 0, N - 1 do
			local center = (b - (N - 1) / 2) * PITCH
			local d = -BLOCK / 2 + 12
			while d <= BLOCK / 2 - 12 do
				newPart({
					Name = "Ligne",
					Parent = roads,
					Size = Vector3.new(0.8, 0.05, 9),
					Position = Vector3.new(offset, 0.2, center + d),
					Color = lineColor,
					CanCollide = false,
					CastShadow = false,
				})
				newPart({
					Name = "Ligne",
					Parent = roads,
					Size = Vector3.new(9, 0.05, 0.8),
					Position = Vector3.new(center + d, 0.2, offset),
					Color = lineColor,
					CanCollide = false,
					CastShadow = false,
				})
				d = d + 24
			end
		end
	end
end

local function buildSidewalk(cx, cz, color, material)
	return newPart({
		Name = "Trottoir",
		Size = Vector3.new(BLOCK, SIDEWALK_Y + 1, BLOCK),
		Position = Vector3.new(cx, SIDEWALK_Y - (SIDEWALK_Y + 1) / 2, cz),
		Color = color or Color3.fromRGB(170, 170, 172),
		Material = material or Enum.Material.Concrete,
	})
end

local function buildTower(x, z, width, depth, height, folder)
	local color = BUILDING_COLORS[rng:NextInteger(1, #BUILDING_COLORS)]
	newPart({
		Name = "Immeuble",
		Parent = folder,
		Size = Vector3.new(width, height, depth),
		Position = Vector3.new(x, SIDEWALK_Y + height / 2, z),
		Color = color,
		Material = Enum.Material.Concrete,
	})
	-- Bandes de fenetres ; certaines sont allumees
	local step = math.max(14, height / 8)
	local y = 10
	while y < height - 6 do
		local lit = rng:NextNumber() < 0.25
		newPart({
			Name = "Fenetres",
			Parent = folder,
			Size = Vector3.new(width + 0.4, 5, depth + 0.4),
			Position = Vector3.new(x, SIDEWALK_Y + y, z),
			Color = lit and Color3.fromRGB(255, 214, 140) or Color3.fromRGB(40, 60, 84),
			Material = lit and Enum.Material.Neon or Enum.Material.SmoothPlastic,
			Reflectance = lit and 0 or 0.25,
			CanCollide = false,
			CastShadow = false,
		})
		y = y + step
	end
	-- Lisere lumineux sur le toit des grandes tours
	if height > 110 then
		newPart({
			Name = "Neon",
			Parent = folder,
			Size = Vector3.new(width + 1, 1.2, depth + 1),
			Position = Vector3.new(x, SIDEWALK_Y + height + 0.6, z),
			Color = NEON_COLORS[rng:NextInteger(1, #NEON_COLORS)],
			Material = Enum.Material.Neon,
			CanCollide = false,
			CastShadow = false,
		})
	end
end

-- Remplit un pave avec 4 immeubles ; skip = { [numero de lot] = true } pour laisser un lot libre
local function buildLots(cx, cz, skip)
	local folder = Instance.new("Folder")
	folder.Name = "Immeubles"
	folder.Parent = root
	local lot = BLOCK / 2
	local centrality = 1 - math.clamp(math.sqrt(cx * cx + cz * cz) / HALF, 0, 1)
	local index = 0
	for a = 0, 1 do
		for b = 0, 1 do
			index = index + 1
			if not (skip and skip[index]) then
				local lx = cx + (a - 0.5) * lot
				local lz = cz + (b - 0.5) * lot
				local width = rng:NextInteger(50, 64)
				local depth = rng:NextInteger(50, 64)
				local height = rng:NextInteger(36, 90) + math.floor(centrality * rng:NextInteger(20, 150))
				buildTower(lx, lz, width, depth, height, folder)
			end
		end
	end
end

local function buildPalm(x, z, baseY)
	local height = rng:NextNumber(18, 26)
	local trunk = newPart({
		Name = "Palmier",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(height, 1.8, 1.8),
		CFrame = CFrame.new(x, baseY + height / 2, z) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(124, 92, 70),
		Material = Enum.Material.Wood,
	})
	for k = 0, 5 do
		newPart({
			Name = "Palme",
			Size = Vector3.new(11, 0.4, 2.6),
			CFrame = CFrame.new(x, baseY + height, z)
				* CFrame.Angles(0, math.rad(k * 60 + rng:NextInteger(-10, 10)), 0)
				* CFrame.Angles(0, 0, math.rad(-22))
				* CFrame.new(5, 0, 0),
			Color = Color3.fromRGB(58, 140, 66),
			Material = Enum.Material.Grass,
			CanCollide = false,
		})
	end
	return trunk
end

local function buildLamp(x, z)
	newPart({
		Name = "Lampadaire",
		Size = Vector3.new(0.7, 20, 0.7),
		Position = Vector3.new(x, SIDEWALK_Y + 10, z),
		Color = Color3.fromRGB(60, 60, 66),
		Material = Enum.Material.Metal,
	})
	local head = newPart({
		Name = "Lampe",
		Size = Vector3.new(2.4, 0.6, 2.4),
		Position = Vector3.new(x, SIDEWALK_Y + 20.3, z),
		Color = Color3.fromRGB(255, 226, 170),
		Material = Enum.Material.Neon,
		CanCollide = false,
		CastShadow = false,
	})
	local light = Instance.new("PointLight")
	light.Range = 46
	light.Brightness = 1.4
	light.Color = Color3.fromRGB(255, 220, 170)
	light.Shadows = false
	light.Parent = head
end

local function buildPlaza(cx, cz)
	buildSidewalk(cx, cz, Color3.fromRGB(205, 196, 180), Enum.Material.Cobblestone)
	-- Fontaine centrale
	newPart({
		Name = "Bassin",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(2, 40, 40),
		CFrame = CFrame.new(cx, SIDEWALK_Y + 1, cz) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(150, 150, 156),
		Material = Enum.Material.Marble,
	})
	newPart({
		Name = "Eau",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(0.4, 35, 35),
		CFrame = CFrame.new(cx, SIDEWALK_Y + 2.1, cz) * CFrame.Angles(0, 0, math.rad(90)),
		Color = Color3.fromRGB(70, 170, 220),
		Material = Enum.Material.Neon,
		Transparency = 0.3,
		CanCollide = false,
	})
	local sign = newPart({
		Name = "Panneau",
		Size = Vector3.new(44, 9, 1.5),
		Position = Vector3.new(cx, SIDEWALK_Y + 14, cz - BLOCK / 2 + 14),
		Color = Color3.fromRGB(24, 28, 40),
	})
	addSign(sign, Enum.NormalId.Front, "PORT MIRAGE", Color3.fromRGB(255, 190, 80))
	addSign(sign, Enum.NormalId.Back, "PORT MIRAGE", Color3.fromRGB(255, 190, 80))
	for _, sx in ipairs({ -19, 19 }) do
		newPart({
			Name = "Poteau",
			Size = Vector3.new(1.4, 10, 1.4),
			Position = Vector3.new(cx + sx, SIDEWALK_Y + 5, cz - BLOCK / 2 + 14),
			Color = Color3.fromRGB(60, 60, 66),
			Material = Enum.Material.Metal,
		})
	end
	for _, corner in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do
		buildPalm(cx + corner[1] * 60, cz + corner[2] * 60, SIDEWALK_Y)
	end
	-- Points d'apparition des joueurs
	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Apparition"
	spawn.Anchored = true
	spawn.Size = Vector3.new(16, 1, 16)
	spawn.Position = Vector3.new(cx, SIDEWALK_Y + 0.5, cz + 45)
	spawn.Color = Color3.fromRGB(255, 190, 80)
	spawn.Material = Enum.Material.Neon
	spawn.Transparency = 0.4
	spawn.TopSurface = Enum.SurfaceType.Smooth
	spawn.Neutral = true
	spawn.Duration = 3
	spawn.Parent = root
end

local function buildPark(cx, cz)
	buildSidewalk(cx, cz, Color3.fromRGB(86, 150, 78), Enum.Material.Grass)
	for _ = 1, 14 do
		buildPalm(
			cx + rng:NextNumber(-BLOCK / 2 + 12, BLOCK / 2 - 12),
			cz + rng:NextNumber(-BLOCK / 2 + 12, BLOCK / 2 - 12),
			SIDEWALK_Y
		)
	end
	newPart({
		Name = "Allee",
		Size = Vector3.new(BLOCK, 0.1, 10),
		Position = Vector3.new(cx, SIDEWALK_Y + 0.05, cz),
		Color = Color3.fromRGB(200, 186, 150),
		Material = Enum.Material.Pebble,
		CanCollide = false,
	})
	newPart({
		Name = "Allee",
		Size = Vector3.new(10, 0.1, BLOCK),
		Position = Vector3.new(cx, SIDEWALK_Y + 0.04, cz),
		Color = Color3.fromRGB(200, 186, 150),
		Material = Enum.Material.Pebble,
		CanCollide = false,
	})
end

-- Batiment simple avec enseigne tournee vers +Z (le sud)
local function buildHall(cx, cz, width, depth, height, color, text, textColor)
	local hall = newPart({
		Name = "Batiment",
		Size = Vector3.new(width, height, depth),
		Position = Vector3.new(cx, SIDEWALK_Y + height / 2, cz),
		Color = color,
		Material = Enum.Material.Concrete,
	})
	local sign = newPart({
		Name = "Enseigne",
		Size = Vector3.new(width * 0.8, 8, 1),
		CFrame = CFrame.new(cx, SIDEWALK_Y + height - 6, cz + depth / 2 + 0.5) * CFrame.Angles(0, math.rad(180), 0),
		Color = Color3.fromRGB(20, 24, 34),
		CanCollide = false,
	})
	addSign(sign, Enum.NormalId.Front, text, textColor)
	return hall
end

local function buildPolice(cx, cz, info)
	buildSidewalk(cx, cz)
	buildHall(cx, cz - 25, 120, 80, 40, Color3.fromRGB(70, 100, 160), "POLICE", Color3.fromRGB(120, 190, 255))
	newPart({
		Name = "Gyrophare",
		Size = Vector3.new(120, 1.2, 1.2),
		Position = Vector3.new(cx, SIDEWALK_Y + 40.6, cz + 15),
		Color = Color3.fromRGB(80, 150, 255),
		Material = Enum.Material.Neon,
		CanCollide = false,
	})
	info.PoliceCFrame = CFrame.new(cx, SIDEWALK_Y + 4, cz + 55)
end

local function buildDealer(cx, cz, info)
	buildSidewalk(cx, cz, Color3.fromRGB(190, 190, 196))
	buildHall(cx, cz - 40, 130, 60, 28, Color3.fromRGB(230, 230, 236), "MIRAGE MOTORS", Color3.fromRGB(255, 110, 140))
	info.DealerPads = {}
	for k = -1, 1 do
		local px = cx + k * 44
		local pz = cz + 35
		newPart({
			Name = "Podium",
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(0.6, 26, 26),
			CFrame = CFrame.new(px, SIDEWALK_Y + 0.3, pz) * CFrame.Angles(0, 0, math.rad(90)),
			Color = Color3.fromRGB(40, 40, 48),
			Material = Enum.Material.Metal,
		})
		table.insert(info.DealerPads, CFrame.new(px, SIDEWALK_Y + 0.6, pz) * CFrame.Angles(0, math.rad(200), 0))
	end
end

local function buildDepot(cx, cz, info)
	buildSidewalk(cx, cz, Color3.fromRGB(150, 150, 150))
	buildHall(cx, cz - 30, 130, 80, 34, Color3.fromRGB(190, 130, 70), "MIRAGE EXPRESS", Color3.fromRGB(255, 220, 120))
	-- Quelques caisses
	for k = 1, 8 do
		local size = rng:NextInteger(5, 9)
		newPart({
			Name = "Caisse",
			Size = Vector3.new(size, size, size),
			Position = Vector3.new(
				cx + rng:NextNumber(-70, 70),
				SIDEWALK_Y + size / 2,
				cz + rng:NextNumber(20, 40) + (k % 2) * 6
			),
			Color = Color3.fromRGB(160, 120, 80),
			Material = Enum.Material.WoodPlanks,
		})
	end
	local board = newPart({
		Name = "TableauLivraisons",
		Size = Vector3.new(12, 9, 1),
		CFrame = CFrame.new(cx, SIDEWALK_Y + 6, cz + 62) * CFrame.Angles(0, math.rad(180), 0),
		Color = Color3.fromRGB(30, 34, 46),
	})
	addSign(board, Enum.NormalId.Front, "LIVRAISONS", Color3.fromRGB(255, 220, 120))
	newPart({
		Name = "Pied",
		Size = Vector3.new(1, 3, 1),
		Position = Vector3.new(cx, SIDEWALK_Y + 1.5, cz + 62),
		Color = Color3.fromRGB(60, 60, 66),
	})
	info.DepotBoard = board
end

-- Superette ouverte sur la rue, avec une caisse a braquer
local function buildStore(cx, cz, info, index)
	local lot = BLOCK / 2
	local sx = cx - lot / 2
	local sz = cz + lot / 2
	local wall = Color3.fromRGB(240, 232, 214)
	-- Mur du fond, cotes, toit
	newPart({ Name = "Mur", Size = Vector3.new(60, 18, 2), Position = Vector3.new(sx, SIDEWALK_Y + 9, sz - 24), Color = wall })
	newPart({ Name = "Mur", Size = Vector3.new(2, 18, 40), Position = Vector3.new(sx - 29, SIDEWALK_Y + 9, sz - 4), Color = wall })
	newPart({ Name = "Mur", Size = Vector3.new(2, 18, 40), Position = Vector3.new(sx + 29, SIDEWALK_Y + 9, sz - 4), Color = wall })
	newPart({
		Name = "Toit",
		Size = Vector3.new(64, 2, 46),
		Position = Vector3.new(sx, SIDEWALK_Y + 19, sz - 3),
		Color = Color3.fromRGB(200, 60, 60),
	})
	local sign = newPart({
		Name = "Enseigne",
		Size = Vector3.new(44, 6, 1),
		CFrame = CFrame.new(sx, SIDEWALK_Y + 23, sz + 19) * CFrame.Angles(0, math.rad(180), 0),
		Color = Color3.fromRGB(20, 24, 34),
		CanCollide = false,
	})
	addSign(sign, Enum.NormalId.Front, "SUPERETTE 24/7", Color3.fromRGB(120, 255, 170))
	-- Rayons
	for k = -1, 1, 2 do
		newPart({
			Name = "Rayon",
			Size = Vector3.new(4, 8, 22),
			Position = Vector3.new(sx + k * 18, SIDEWALK_Y + 4, sz - 6),
			Color = Color3.fromRGB(120, 130, 150),
		})
	end
	-- Comptoir et caisse
	newPart({
		Name = "Comptoir",
		Size = Vector3.new(16, 4, 4),
		Position = Vector3.new(sx, SIDEWALK_Y + 2, sz - 16),
		Color = Color3.fromRGB(110, 80, 60),
		Material = Enum.Material.Wood,
	})
	local register = newPart({
		Name = "Caisse",
		Size = Vector3.new(3, 2, 2.5),
		Position = Vector3.new(sx, SIDEWALK_Y + 5, sz - 16),
		Color = Color3.fromRGB(60, 220, 120),
		Material = Enum.Material.Neon,
	})
	local alarm = newPart({
		Name = "Alarme",
		Size = Vector3.new(2, 2, 2),
		Shape = Enum.PartType.Ball,
		Position = Vector3.new(sx, SIDEWALK_Y + 21, sz + 21),
		Color = Color3.fromRGB(90, 20, 20),
		CanCollide = false,
	})
	table.insert(info.Stores, { Register = register, Alarm = alarm, Name = "Superette " .. index })
end

function CityBuilder.build()
	root = Instance.new("Folder")
	root.Name = "Ville"
	root.Parent = workspace

	local info = {
		Stores = {},
		DeliveryPoints = {},
		ParkingSpots = {},
		Intersections = {},
		PickupPoints = {},
		DealerPads = {},
	}

	buildGround()
	buildRoads()

	local special = {
		["2,3"] = "plaza",
		["3,3"] = "police",
		["2,2"] = "dealer",
		["3,2"] = "depot",
		["1,4"] = "park",
		["4,1"] = "park",
		["0,2"] = "store",
		["5,3"] = "store",
		["2,5"] = "store",
		["4,4"] = "store",
	}

	local storeIndex = 0
	for i = 0, N - 1 do
		for j = 0, N - 1 do
			local cx, cz = blockCenter(i, j)
			local kind = special[i .. "," .. j]
			if kind == "plaza" then
				buildPlaza(cx, cz)
				info.SpawnCFrame = CFrame.new(cx, SIDEWALK_Y + 4, cz + 45)
			elseif kind == "police" then
				buildPolice(cx, cz, info)
			elseif kind == "dealer" then
				buildDealer(cx, cz, info)
			elseif kind == "depot" then
				buildDepot(cx, cz, info)
			elseif kind == "park" then
				buildPark(cx, cz)
			elseif kind == "store" then
				storeIndex = storeIndex + 1
				buildSidewalk(cx, cz)
				buildLots(cx, cz, { [2] = true }) -- lot 2 = coin sud-ouest, reserve a la superette
				buildStore(cx, cz, info, storeIndex)
			else
				buildSidewalk(cx, cz)
				buildLots(cx, cz)
				-- Adresses de livraison : milieu des trottoirs nord et sud
				table.insert(info.DeliveryPoints, Vector3.new(cx, SIDEWALK_Y, cz + BLOCK / 2 - 5))
				table.insert(info.DeliveryPoints, Vector3.new(cx, SIDEWALK_Y, cz - BLOCK / 2 + 5))
			end

			-- Lampadaires a deux coins de chaque pave
			buildLamp(cx + BLOCK / 2 - 3, cz + BLOCK / 2 - 3)
			buildLamp(cx - BLOCK / 2 + 3, cz - BLOCK / 2 + 3)

			-- Places de stationnement le long du trottoir est (voiture orientee nord-sud)
			table.insert(
				info.ParkingSpots,
				CFrame.new(cx + BLOCK / 2 + 6, 0.2, cz + rng:NextNumber(-50, 50))
					* CFrame.Angles(0, rng:NextInteger(0, 1) * math.pi, 0)
			)
			-- Billets : sur le trottoir ouest
			table.insert(info.PickupPoints, Vector3.new(cx - BLOCK / 2 + 4, SIDEWALK_Y + 3, cz + rng:NextNumber(-70, 70)))
		end
	end

	-- Croisements (points d'arrivee de la police) et billets au milieu des routes
	for a = 0, N do
		for b = 0, N do
			local x = (a - N / 2) * PITCH
			local z = (b - N / 2) * PITCH
			table.insert(info.Intersections, Vector3.new(x, 0.2, z))
			if (a + b) % 3 == 0 then
				table.insert(info.PickupPoints, Vector3.new(x, 3.2, z))
			end
		end
	end

	-- Palmiers et billets sur la plage
	for k = -6, 6 do
		buildPalm(k * 95 + rng:NextNumber(-20, 20), HALF + 230 + rng:NextNumber(0, 60), -0.4)
		table.insert(info.PickupPoints, Vector3.new(k * 90, 2.6, HALF + 300 + rng:NextNumber(-20, 40)))
	end

	return info
end

return CityBuilder
