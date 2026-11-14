-- Port Mirage : reglages du jeu (modifiable sans toucher au reste du code)
local Config = {}

Config.GameName = "Port Mirage"

-- Ville : grille de paves separes par des routes
Config.Grid = {
	Blocks = 6, -- nombre de paves par cote
	Pitch = 220, -- distance entre deux centres de paves
	BlockSize = 170, -- taille d'un pave (trottoir compris)
	RoadWidth = 50,
}

Config.StartCash = 500
Config.DayLengthMinutes = 12 -- duree d'un cycle jour/nuit complet

-- Vehicules. Price = 0 : voiture garee dans la rue.
Config.Cars = {
	Moineau = {
		DisplayName = "Moineau",
		Price = 0,
		MaxSpeed = 80,
		Accel = 40,
		Turn = 2.1,
		Size = Vector3.new(6, 1.2, 12),
		Spoiler = false,
	},
	Baroudeur = {
		DisplayName = "Baroudeur",
		Price = 2500,
		MaxSpeed = 95,
		Accel = 45,
		Turn = 2.0,
		Size = Vector3.new(7, 1.6, 14),
		Spoiler = false,
	},
	MirageGT = {
		DisplayName = "Mirage GT",
		Price = 12000,
		MaxSpeed = 130,
		Accel = 65,
		Turn = 2.4,
		Size = Vector3.new(6.5, 1.1, 13),
		Spoiler = true,
	},
	Fantome = {
		DisplayName = "Fantome",
		Price = 40000,
		MaxSpeed = 170,
		Accel = 90,
		Turn = 2.6,
		Size = Vector3.new(6.8, 1, 13.5),
		Spoiler = true,
	},
}

Config.StreetCars = { "Moineau", "Moineau", "Moineau", "Baroudeur" }
Config.DealerOrder = { "Baroudeur", "MirageGT", "Fantome" }
Config.StreetCarCount = 16

Config.CarColors = {
	Color3.fromRGB(196, 40, 28),
	Color3.fromRGB(13, 105, 172),
	Color3.fromRGB(245, 205, 48),
	Color3.fromRGB(240, 240, 240),
	Color3.fromRGB(40, 40, 46),
	Color3.fromRGB(39, 140, 90),
	Color3.fromRGB(226, 110, 30),
	Color3.fromRGB(140, 70, 190),
}

-- Avis de recherche
Config.Wanted = {
	MaxStars = 5,
	MaxCops = 4,
	EvadeRadius = 90, -- aucun policier dans ce rayon = on est en train de semer la police
	EvadeSeconds = 15, -- temps pour perdre une etoile
	ArrestDistance = 7,
	FinePerStar = 150,
	CarTheftChance = 0.35,
}

-- Braquages
Config.Robbery = {
	HoldSeconds = 4,
	CooldownSeconds = 120,
	MinReward = 500,
	MaxReward = 1000,
	Stars = 2,
}

-- Livraisons
Config.Delivery = {
	BaseReward = 150,
	RewardPerStud = 0.45,
	FastBonus = 0.3, -- +30 % si la livraison est rapide
}

-- Billets a ramasser dans la ville
Config.Pickup = {
	Count = 40,
	Value = 50,
	RespawnSeconds = 60,
}

return Config
