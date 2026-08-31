import { FACTIONS, TRIGGERS, KEYWORDS } from "../gameSettings";

export const ssVehicles = [
    {
        name: 'Iron Maiden',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a card',
        materialCost: 170000,
        blueprintCost: 174000,
        cpCost: 0,
        imageUrl: 'ironMaiden.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_DEATH]: 'ironMaidenOnDeath',
        }
    },{
        name: 'Victoria',
        isBuiltIn: true,
        cardText: 'Each turn you may spend 200k resources to spawn another victoria into this zone',
        materialCost: 250000,
        blueprintCost: 270185,
        cpCost: 0,
        imageUrl: 'victoria.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_ACTIVATE]: 'victoriaActivate',
            // "spend 200k resources" — a MATERIAL price, not a CP one. An
            // activated ability needs onActivate plus at least one price, or
            // ACTIVATE_VEHICLE refuses it and BoardZone renders no button.
            activateMaterialCost: 200000,
        }
    },
    {
        name: 'Trondheim',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a card',
        materialCost: 400000,
        blueprintCost: 403000,
        cpCost: 0,
        imageUrl: 'trodnheim.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_DEATH]: 'trondheimOnDeath',
        }
    },
    {
        name: 'Air Strafe',
        isBuiltIn: true,
        cardText: 'Choose an enemy ship, it fights alone against two predatorX. If the target is a player design, also spawn your choice of hydra or cyclone',
        materialCost: 180000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'airStrafe.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_VEHICLE]: 'airStrafeEffect'
        }
    },{
        name: 'Repairmen Ready',
        isBuiltIn: true,
        cardText: 'Grant target vehicle scrappy. If the target is an AI vehicle that costs less than 400k, draw a card.',
        materialCost: 0,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'repairmenReady.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_VEHICLE]: 'repairmenReadyEffect'
        }
    },{
        name: 'Excalibur',
        isBuiltIn: true,
        cardText: 'Pick one AI ship in hand and reduce its cost by 200k',
        materialCost: 550000,
        blueprintCost: 553900,
        cpCost: 0,
        imageUrl: 'excalibur.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.PLAY_ON_CARD]: 'excaliburEffect'
        }
    } ,{
        name: 'Asphodel',
        isBuiltIn: true,
        cardText: '',
        materialCost: 470000,
        blueprintCost: 544000,
        cpCost: 0,
        imageUrl: 'asphodel.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.AIR_SCREEN],
        meta: {
        }
    } ,{
        name: 'Braveheart',
        isBuiltIn: true,
        cardText: 'Once per turn, you may pay 1cp to have this ship 1v1 an enemy vehicle in the same zone',
        materialCost: 350000,
        blueprintCost: 371000,
        cpCost: 0,
        imageUrl: 'Braveheart.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_ACTIVATE]: 'braveheartActivate',
            activateCpCost: 1
        }
    }
    ,{
        name: 'Tyr',
        isBuiltIn: true,
        cardText: '',
        materialCost: 950000,
        blueprintCost: 983000,
        cpCost: 0,
        imageUrl: 'Tyr.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    }

    ,{
        name: 'Catshark',
        isBuiltIn: true,
        cardText: 'Whenever this vehicle participates in a fleet combat, gain 30k resources this turn',
        materialCost: 100000,
        blueprintCost: 115450,
        cpCost: 0,
        imageUrl: 'catshark.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [ KEYWORDS.SCRAPPY],
        meta: {
            [TRIGGERS.ON_BATTLE_EFFECT]: 'catsharkBattle',
        }
    }, {
        name: 'Sacrilego',
        isBuiltIn: true,
        cardText: 'Whenever this vehicle survives a fleet battle, gain 1cp. Additionally you may sacrifice it to increase the remaining hp percent of a friendly ship by 15',
        materialCost: 80000,
        blueprintCost: 86000,
        cpCost: 0,
        imageUrl: 'sacrilego.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.SCRAPPY, KEYWORDS.STEALTHY, KEYWORDS.MOBILE],
        meta: {
            [TRIGGERS.ON_BATTLE_EFFECT]: 'sacrilegoBattle',
        }
    }, {
        name: 'Resolute',
        isBuiltIn: true,
        cardText: 'When this vehicle is played, draw a card',
        materialCost: 60000,
        blueprintCost: 63300,
        cpCost: 0,
        imageUrl: 'resolute.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_PLAY]: 'resoluteOnPlay',
        }
    }, {
        name: 'Dryad',
        isBuiltIn: true,
        cardText: 'Whenever this ship participates in a defensive battle, spawn another dryad into the zone under your control',
        materialCost: 40500,
        blueprintCost: 40500,
        cpCost: 0,
        imageUrl: 'dryad.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_BATTLE_EFFECT]: 'dryadBattle',
        }
    }, {
        name: 'Typhoon',
        isBuiltIn: true,
        cardText: '',
        materialCost: 130000,
        blueprintCost: 135323,
        cpCost: 0,
        imageUrl: 'typhoon.png',
        playerId: null,
        vehicleType: 'sub',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    },
     {
        name: 'Cyclone',
        isBuiltIn: true,
        cardText: '',
        materialCost: 280000,
        blueprintCost: 281000,
        cpCost: 0,
        imageUrl: 'typhoon.png',
        playerId: null,
        vehicleType: 'sub',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
     {
        name: 'Argonaut',
        isBuiltIn: true,
        cardText: '',
        materialCost: 90000,
        blueprintCost: 94000,
        cpCost: 0,
        imageUrl: 'Argonaut.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.SCRAPPY],
        meta: {
        }
    },
     {
        name: 'Chrysaor',
        isBuiltIn: true,
        cardText: 'While you have more than 200k resources, this card costs 100k more and spawns in a second Chrysaor',
        materialCost: 100000,
        blueprintCost: 116000,
        cpCost: 0,
        imageUrl: 'Chrysaor.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        meta: {
            // "While you have more than 200k resources, this card costs 100k
            // more and spawns in a second Chrysaor." costDelta raises the
            // PLAY price only — base damage and repairs still read 100k.
            resourceSurge: { materialsOver: 200000, extraSpawns: 1, costDelta: 100000 },
        }
    },
     {
        name: 'Paladin',
        isBuiltIn: true,
        cardText: 'While you have less than 240k materials, this can be played with halfcost and temporary',
        materialCost: 240000,
        blueprintCost: 240000,
        cpCost: 0,
        imageUrl: 'paladin.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            // "While you have less than 240k materials, this can be played
            // with halfcost and temporary." Both keywords land on the HULL
            // (spec §4.6, departure 2) — endTurn's cull reads `temporary` off
            // the board, so a price-only grant would never despawn it.
            resourceSurge: {
                materialsUnder: 240000,
                grantKeywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
            },
        }
    },
     {
        name: 'Nothung',
        isBuiltIn: true,
        cardText: 'Whenever this vehicle is played into a zone, also create a friendly Sacrilego in that zone',
        materialCost: 470000,
        blueprintCost: 478000,
        cpCost: 0,
        imageUrl: 'nothung.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_PLAY]: 'nothungOnPlay',
        }
    },
     {
        name: 'Balmung',
        isBuiltIn: true,
        cardText: 'When this is played into a zone, create a hydra card in hand and reduce its cost to zero',
        materialCost: 630000,
        blueprintCost: 636000,
        cpCost: 0,
        imageUrl: 'balmung.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_PLAY]: 'balmungOnPlay',
        }
    },
     {
        name: 'Blockade',
        isBuiltIn: true,
        cardText: 'Choose a zone, whenever the opponent plays a vehicle into that zone while you have at least one vehicle there, a fleet battle immediately begins in that zone. If you lose with no surviving vehicles, the blockade goes away, otherwise it remains.',
        materialCost: 100000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'blockade.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_ZONE]: 'blockadeEffect',
        }
    },
     {
        name: 'Wolin',
        isBuiltIn: true,
        cardText: '',
        materialCost: 270000,
        blueprintCost: 271000,
        cpCost: 0,
        imageUrl: 'wolin.png',
        playerId: null,
        vehicleType: 'sub',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
     {
        name: 'Spectre',
        isBuiltIn: true,
        cardText: '',
        materialCost: 210000,
        blueprintCost: 214000,
        cpCost: 0,
        imageUrl: 'spectre.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        meta: {
        }
    },
    {
        name: 'Falcon Squadron',
        isBuiltIn: true,
        cardText: 'This card is considered destroyed if any of its sub-vehicles is destroyed in battle',
        materialCost: 80000,
        blueprintCost: 96276,
        cpCost: 0,
        imageUrl: 'falcon.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
        }
    },  
    {
        name: 'Maelstrom',
        isBuiltIn: true,
        cardText: 'When played, gain 1cp',
        materialCost: 220000,
        blueprintCost: 228000,
        cpCost: 0,
        imageUrl: 'maelstrom.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
            [TRIGGERS.ON_PLAY]: 'maelstromOnPlay',
        }
    },
    {
        name: 'PredatorX',
        isBuiltIn: true,
        cardText: 'While you have more than 120k resources, this card loses its HALFCOST keyword and instead spawns in a second PredatorX',
        materialCost: 120000,
        blueprintCost: 127000,
        cpCost: 0,
        imageUrl: 'predatorX.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
            resourceSurge: { materialsOver: 120000, extraSpawns: 1 },
        }
    },
    {
        name: 'Mobula',
        isBuiltIn: true,
        cardText: '',
        materialCost: 600000,
        blueprintCost: 603000,
        cpCost: 0,
        imageUrl: 'mobula.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
        }
    },  
    {
        name: 'Hydra',
        isBuiltIn: true,
        cardText: '',
        materialCost: 230000,
        blueprintCost: 238000,
        cpCost: 0,
        imageUrl: 'hydra.png',
        playerId: null,
        vehicleType: 'airship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.MOBILE],
        meta: {
        }
    },
    

];